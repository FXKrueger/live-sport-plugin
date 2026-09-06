/**
 * EmbedResolver.js — Turn an arbitrary embed/player page URL into a direct
 * HLS stream when possible.
 *
 * Strategy (first hit wins):
 *   1. Known-domain native decryptors
 *        embed.st / embedsports.*  -> EmbedStProvider (WASM)
 *        embedindia.*              -> EmbedIndiaProvider (WASM)
 *        sportsembed.su            -> SportsEmbedExtractor (WASM)
 *   2. Fetch the page HTML and run the EmbedExtractorChain (plain / JSON /
 *      atob / XOR / concat patterns).
 *   3. Follow <iframe src> children (depth-limited) and repeat.
 *
 * Returns { url, referer, origin } for an upstream m3u8 or null. Callers wrap
 * the url in /api/manifest so the player never talks to the CDN directly.
 */

const { request, Agent } = require('undici');
const { extract } = require('./EmbedExtractorChain');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
const MAX_DEPTH = 2;
const FETCH_TIMEOUT_MS = 8000;
const NEGATIVE_TTL_MS = 5 * 60 * 1000;

const dispatcher = new Agent({ connect: { rejectUnauthorized: false, timeout: FETCH_TIMEOUT_MS } });
const negativeCache = new Map(); // url -> expiry

function isEmbedSt(host) {
  return /(^|\.)embed\.st$|(^|\.)embedsports\.|(^|\.)embedme\./.test(host);
}
function isEmbedIndia(host) {
  return /(^|\.)embedindia\.|(^|\.)embedsport\.xyz$/.test(host);
}
function isSportsEmbed(host) {
  return /(^|\.)sportsembed\.su$/.test(host);
}

class EmbedResolver {
  constructor({ embedStProvider, embedIndiaProvider }) {
    this.embedStProvider = embedStProvider;
    this.embedIndiaProvider = embedIndiaProvider;
  }

  /**
   * @param {string} embedUrl
   * @param {object} opts { referer, title, depth }
   * @returns {Promise<{url:string, referer:string, origin:string}|null>}
   */
  async resolve(embedUrl, opts = {}) {
    const depth = opts.depth || 0;
    let parsed;
    try { parsed = new URL(embedUrl); } catch (_) { return null; }
    if (!/^https?:$/.test(parsed.protocol)) return null;

    const key = parsed.toString();
    const neg = negativeCache.get(key);
    if (neg && neg > Date.now()) return null;

    const host = parsed.hostname;
    const referer = opts.referer || parsed.origin + '/';
    const title = opts.title || 'Live Event';

    try {
      // 1. Native decryptors for known hosts
      if (isEmbedIndia(host) && this.embedIndiaProvider) {
        const streams = await this.embedIndiaProvider.resolveStream(key, 'other', title, { embedUrl: key, referer });
        const direct = streams.find(s => s.url);
        if (direct) return this._fromProxyUrl(direct.url);
      } else if (isEmbedSt(host) && this.embedStProvider) {
        const streams = await this.embedStProvider.resolveStream(key, 'other', title, { embedUrl: key, referer });
        const direct = streams.find(s => s.url);
        if (direct) return this._fromProxyUrl(direct.url);
      } else if (isSportsEmbed(host)) {
        const { extractSportsEmbed } = require('../providers/SportsEmbedExtractor');
        const m3u8 = await extractSportsEmbed(key);
        if (m3u8) return { url: m3u8, referer: 'https://sportsembed.su/', origin: 'https://sportsembed.su' };
      }

      // 2. Generic HTML extraction
      const res = await request(key, {
        headers: { 'User-Agent': UA, 'Referer': referer, 'Accept': 'text/html,*/*' },
        dispatcher,
        headersTimeout: FETCH_TIMEOUT_MS,
        bodyTimeout: FETCH_TIMEOUT_MS
      });
      if (res.statusCode >= 400) { this._negative(key); return null; }
      const html = await res.body.text();

      const hit = extract(html);
      if (hit && hit.url) {
        return { url: hit.url, referer: parsed.origin + '/', origin: parsed.origin };
      }

      // 3. Follow iframes
      if (depth < MAX_DEPTH) {
        const iframes = [];
        const re = /<iframe[^>]+src=["']([^"']+)["']/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
          try {
            const child = new URL(m[1], key).toString();
            if (child !== key && !iframes.includes(child)) iframes.push(child);
          } catch (_) {}
        }
        for (const child of iframes.slice(0, 3)) {
          const out = await this.resolve(child, { referer: parsed.origin + '/', title, depth: depth + 1 });
          if (out) return out;
        }
      }
    } catch (err) {
      console.warn(`[EmbedResolver] ${host}: ${err.message}`);
    }

    this._negative(key);
    return null;
  }

  /** Providers hand back /api/manifest?url=...&referer=...&origin=...; unwrap it. */
  _fromProxyUrl(proxyUrl) {
    try {
      const u = new URL(proxyUrl, 'http://localhost');
      const url = u.searchParams.get('url');
      if (!url) return null;
      return {
        url,
        referer: u.searchParams.get('referer') || '',
        origin: u.searchParams.get('origin') || ''
      };
    } catch (_) { return null; }
  }

  _negative(key) {
    negativeCache.set(key, Date.now() + NEGATIVE_TTL_MS);
    if (negativeCache.size > 500) {
      const now = Date.now();
      for (const [k, exp] of negativeCache) if (exp < now) negativeCache.delete(k);
    }
  }

  /** Build the addon's proxied manifest URL for a resolved upstream. */
  static proxyUrl(resolved) {
    const { BASE_URL } = require('../config');
    const origin = resolved.origin || (resolved.referer ? new URL(resolved.referer).origin : '');
    return `${BASE_URL}/api/manifest?url=${encodeURIComponent(resolved.url)}&referer=${encodeURIComponent(resolved.referer || '')}&origin=${encodeURIComponent(origin)}`;
  }
}

module.exports = EmbedResolver;
