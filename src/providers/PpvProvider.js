/**
 * PpvProvider.js — ppv.st (PPV.LAND) live events + 24/7 channels.
 *
 * Catalog : https://api.ppv.st/api/streams          (categories -> streams[])
 * Detail  : https://api.ppv.st/api/streams/{id}     (m3u8 | iframe sources)
 *
 * Most events are delivered through an embedindia.st iframe. That page is
 * decrypted natively by EmbedIndiaProvider (WASM), so the result is a direct
 * HLS stream that plays inside Nuvio. Some events carry their own m3u8.
 */

const BaseProvider = require('./BaseProvider');
const MatchEntity = require('../domain/MatchEntity');
const StreamEntity = require('../domain/StreamEntity');

const API = 'https://api.ppv.st/api/streams';
const SITE = 'https://ppv.st';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

class PpvProvider extends BaseProvider {
  constructor(opts) {
    super(opts);
    this.name = 'PPV';
    this.embedIndiaProvider = opts.embedIndiaProvider;

    const headers = { 'User-Agent': UA, 'Accept': 'application/json', 'Origin': SITE, 'Referer': SITE + '/' };

    this.fetchList = this.circuitBreaker.wrap(`${this.name}_fetchList`, async () => {
      const res = await this.proxyFetch(API, { headers, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !Array.isArray(data.streams)) throw new Error('unexpected payload');
      return data;
    });

    this.fetchDetail = this.circuitBreaker.wrap(`${this.name}_fetchDetail`, async (id) => {
      const res = await this.proxyFetch(`${API}/${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data && data.data ? data.data : null;
    });
  }

  mapCategory(name, isAlwaysLive) {
    if (isAlwaysLive) return 'networks';
    const n = String(name || '').toLowerCase();
    if (n.includes('24/7')) return 'networks';
    if (n.includes('american football')) return 'american_football';
    if (n.includes('australian')) return 'other';
    if (n.includes('combat') || n.includes('wrestling') || n.includes('boxing') || n.includes('mma') || n.includes('ufc')) return 'mma';
    if (n.includes('motor') || n.includes('racing')) return 'motorsport';
    if (n.includes('basketball')) return 'basketball';
    return this.normalizeCategory(n);
  }

  async getMatches() {
    const matches = [];
    try {
      const data = await this.fetchList.fire();
      if (!data) return matches;
      const now = Date.now();

      for (const cat of data.streams) {
        const catName = cat.category || '';
        const catAlwaysLive = !!cat.always_live;
        for (const s of cat.streams || []) {
          if (!s.id || !s.name) continue;
          const alwaysLive = catAlwaysLive || !!s.always_live;
          const startMs = s.starts_at ? Number(s.starts_at) * 1000 : 0;
          const endMs = s.ends_at ? Number(s.ends_at) * 1000 : 0;

          // Skip finished events (ended more than 1h ago). 24/7 channels never end.
          if (!alwaysLive && endMs && endMs + 60 * 60 * 1000 < now) continue;

          const category = this.mapCategory(catName, alwaysLive);
          const isLive = alwaysLive || (startMs && startMs <= now && (!endMs || endMs > now));

          matches.push(new MatchEntity({
            id: `ppv_${s.id}`,
            title: s.name,
            category,
            status: alwaysLive ? '' : (isLive ? 'live' : (startMs > now ? 'upcoming' : '')),
            date: alwaysLive ? '' : (startMs ? String(startMs) : ''),
            popular: (Number(s.viewers) || 0) > 200 ? '1' : '0',
            league: s.tag || s.category_name || '',
            poster: s.poster || '',
            background: s.poster || '',
            sources: [{ source: 'ppv', id: String(s.id), iframe: s.iframe || '' }]
          }));
        }
      }
    } catch (err) {
      console.error(`[${this.name}] Failed to get matches:`, err.message);
    }
    return matches;
  }

  async resolveStream(sourceId, matchCategory, matchTitle, src = {}) {
    const streams = [];
    try {
      const detail = await this.fetchDetail.fire(sourceId);
      const { BASE_URL } = require('../config');

      // 1. Own HLS playlist
      if (detail && typeof detail.m3u8 === 'string' && detail.m3u8.includes('.m3u8')) {
        const proxyUrl = `${BASE_URL}/api/manifest?url=${encodeURIComponent(detail.m3u8)}&referer=${encodeURIComponent(SITE + '/')}&origin=${encodeURIComponent(SITE)}`;
        streams.push(new StreamEntity({
          name: 'PPV',
          title: `PPV ${detail.source_tag ? '(' + detail.source_tag + ')' : ''}`.trim(),
          url: proxyUrl,
          behaviorHints: { notWebReady: true },
          resolution: 'HD'
        }));
      }

      // 2. Iframe sources (embedindia.st) -> native decryption
      const iframeUrls = [];
      if (detail && Array.isArray(detail.sources)) {
        for (const s of detail.sources) {
          if (s && s.type === 'iframe' && typeof s.data === 'string' && s.data.startsWith('http')) iframeUrls.push(s.data);
        }
      }
      if (iframeUrls.length === 0 && src.iframe && src.iframe.startsWith('http')) {
        iframeUrls.push(src.iframe.split('?')[0]);
      }

      for (const iframeUrl of iframeUrls.slice(0, 2)) {
        let host = '';
        try { host = new URL(iframeUrl).hostname; } catch (_) {}
        if (/embedindia|embedsport\.xyz/.test(host) && this.embedIndiaProvider) {
          const label = detail && detail.source_tag ? `PPV (${detail.source_tag})` : 'PPV';
          const resolved = await this.embedIndiaProvider.resolveStream(iframeUrl, matchCategory, label, {
            embedUrl: iframeUrl,
            referer: new URL(iframeUrl).origin + '/'
          });
          for (const r of resolved) {
            r.name = 'PPV';
            if (r.url) r.title = label;
            streams.push(r);
          }
        } else {
          streams.push(new StreamEntity({
            name: 'PPV',
            title: `PPV (Web Player)`,
            externalUrl: `/watch?url=${encodeURIComponent(iframeUrl)}&title=${encodeURIComponent(matchTitle || 'Live Event')}`
          }));
        }
      }
    } catch (err) {
      console.error(`[${this.name}] resolveStream failed for ${sourceId}:`, err.message);
    }
    return streams;
  }
}

module.exports = PpvProvider;
