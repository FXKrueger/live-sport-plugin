/**
 * HlsGateway.js — stable, self-healing HLS endpoint for every direct stream.
 *
 * Problem this solves: upstream stream URLs carry short-lived, often IP-bound
 * tokens. Handing them to the player means (a) the URL changes on every
 * re-resolve, so the picker "shuffles", (b) the player's IP may be rejected,
 * and (c) when the token expires mid-game the player dies and the user has to
 * re-open the stream.
 *
 * The gateway gives each verified stream a permanent identity:
 *
 *   /api/hls/<key>/index.m3u8        master (or media) playlist
 *   /api/hls/<key>/sub.m3u8?v=<n>    n-th variant of the current master
 *   /api/hls/<key>/sub.m3u8?u=<url>  audio/subtitle rendition by absolute URL
 *   /api/hls/<key>/seg?u=<url>       media segment / key / init relay
 *
 * <key> = base64url({ source, matchId, srcId, idx }). The gateway maps it to
 * the current upstream URL. If the upstream fails (403/404/5xx/garbage), it
 * re-mints the source through the normal resolve + verify pipeline and keeps
 * serving from the new upstream under the same key. The player never notices.
 * While a re-mint is running, the last good playlist is served (stale) so the
 * player keeps buffering instead of erroring out.
 */

const { request, Agent } = require('undici');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
const RELAY_SEGMENTS = process.env.RELAY_SEGMENTS === 'true';
const PLAYLIST_TTL_MS = 2500;
const STALE_MAX_MS = 60 * 1000;
const ENTRY_TTL_MS = 6 * 60 * 60 * 1000;
const HEAL_COOLDOWN_MS = 12 * 1000;

let impit; // lazy
function getImpit() {
  if (impit === undefined) {
    try { const { Impit } = require('impit'); impit = new Impit({ ignoreTlsErrors: true }); } catch (_) { impit = null; }
  }
  return impit;
}
/** Resolve a child URI and inherit the parent's query params when missing. */
function resolveChild(line, baseUrl) {
  const child = new URL(line, baseUrl);
  try {
    const parent = new URL(baseUrl);
    parent.searchParams.forEach((val, key) => { if (!child.searchParams.has(key)) child.searchParams.set(key, val); });
  } catch (_) {}
  return child.toString();
}

const laxAgent = new Agent({ connect: { rejectUnauthorized: false, timeout: 10000 }, keepAliveTimeout: 15000 });

class HlsGateway {
  constructor({ sourceHealth }) {
    this.sourceHealth = sourceHealth;
    this.entries = new Map();       // key -> { upstream, referer, origin, source, updatedAt, healing, lastHealAt }
    this.playlistCache = new Map(); // key|url -> { body, expiresAt }
    this.stale = new Map();         // key|kind -> { body, at }
    this.inFlight = new Map();      // key|url -> Promise<body>
  }

  static encodeKey(obj) {
    return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
  }
  static decodeKey(key) {
    try {
      const o = JSON.parse(Buffer.from(String(key), 'base64url').toString('utf8'));
      return o && o.source && o.matchId != null && o.srcId != null ? o : null;
    } catch (_) { return null; }
  }

  /** Called by streams.js when a verified stream is handed to the client. */
  register(key, { upstream, referer, origin, source, relay }) {
    const prev = this.entries.get(key);
    this.entries.set(key, {
      upstream, referer: referer || '', origin: origin || '', source,
      relay: RELAY_SEGMENTS && relay !== false,
      updatedAt: Date.now(),
      healing: prev ? prev.healing : null,
      lastHealAt: prev ? prev.lastHealAt : 0
    });
    if (this.entries.size > 1000) this._evictEntries();
  }

  _evictEntries() {
    const now = Date.now();
    for (const [k, e] of this.entries) if (now - e.updatedAt > ENTRY_TTL_MS) this.entries.delete(k);
    if (this.entries.size > 1000) {
      const byAge = [...this.entries.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      for (let i = 0; i < byAge.length - 800; i++) this.entries.delete(byAge[i][0]);
    }
  }

  headersFor(entry, extra = {}) {
    const h = { 'User-Agent': UA, 'Accept': '*/*', ...extra };
    if (entry.referer) h['Referer'] = entry.referer;
    if (entry.origin) h['Origin'] = entry.origin;
    return h;
  }

  /**
   * Re-resolve the source behind a key through the normal mint+verify path
   * and point the entry at the fresh upstream. Coalesced + cooled down so a
   * burst of player polls triggers one re-mint.
   */
  async heal(key, reason) {
    const parsed = HlsGateway.decodeKey(key);
    if (!parsed) return null;
    let entry = this.entries.get(key);
    if (entry && entry.healing) return entry.healing;
    if (entry && Date.now() - entry.lastHealAt < HEAL_COOLDOWN_MS) return null;

    const work = (async () => {
      console.log(`[HlsGateway] re-minting ${parsed.source}/${parsed.srcId} (${reason || 'unknown'})`);
      try {
        const { remintForKey } = require('../streams');
        const list = await remintForKey(parsed);
        const pick = list[parsed.idx] || list[0];
        if (!pick) {
          if (this.sourceHealth) this.sourceHealth.notePlay(parsed.source, false);
          return null;
        }
        this.register(key, { ...pick, source: parsed.source, relay: pick.relay });
        this.entries.get(key).lastHealAt = Date.now();
        return this.entries.get(key);
      } catch (err) {
        console.warn(`[HlsGateway] heal failed for ${parsed.source}/${parsed.srcId}: ${err.message}`);
        return null;
      } finally {
        const e = this.entries.get(key);
        if (e) { e.healing = null; e.lastHealAt = Date.now(); }
      }
    })();

    if (!entry) {
      entry = { upstream: '', referer: '', origin: '', source: parsed.source, updatedAt: Date.now(), healing: work, lastHealAt: 0 };
      this.entries.set(key, entry);
    } else {
      entry.healing = work;
    }
    return work;
  }

  /** Current entry, resolving it from the key when the process restarted. */
  async getEntry(key) {
    const e = this.entries.get(key);
    if (e && e.upstream) return e;
    if (e && e.healing) { await e.healing; const n = this.entries.get(key); return n && n.upstream ? n : null; }
    await this.heal(key, 'cold start');
    const n = this.entries.get(key);
    return n && n.upstream ? n : null;
  }

  async fetchText(url, headers, timeoutMs = 8000) {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const client = getImpit();
        if (client) {
          const r = await Promise.race([
            client.fetch(url, { headers }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
          ]);
          return { status: r.status, body: await r.text() };
        }
        throw new Error('impit unavailable');
      } catch (e1) {
        try {
          const r = await request(url, { headers, dispatcher: laxAgent, headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
          return { status: r.statusCode, body: await r.body.text() };
        } catch (e2) {
          lastErr = e2;
          if (attempt === 0) await new Promise(r => setTimeout(r, 400));
        }
      }
    }
    throw lastErr || new Error('fetch failed');
  }

  /** Cached + coalesced playlist fetch. Throws on any non-playlist outcome. */
  async loadPlaylist(key, entry, url) {
    const ck = `${key}|${url}`;
    const cached = this.playlistCache.get(ck);
    if (cached && cached.expiresAt > Date.now()) return cached.body;
    let p = this.inFlight.get(ck);
    if (!p) {
      p = (async () => {
        const { status, body } = await this.fetchText(url, this.headersFor(entry));
        if (status >= 400) throw Object.assign(new Error(`upstream ${status}`), { status });
        if (!body.includes('#EXT')) throw Object.assign(new Error('upstream returned non-m3u8 body'), { status: 502 });
        this.playlistCache.set(ck, { body, expiresAt: Date.now() + PLAYLIST_TTL_MS });
        if (this.playlistCache.size > 500) {
          const now = Date.now();
          for (const [k, v] of this.playlistCache) if (v.expiresAt < now) this.playlistCache.delete(k);
        }
        return body;
      })().finally(() => this.inFlight.delete(ck));
      this.inFlight.set(ck, p);
    }
    return p;
  }

  /**
   * Fetch a playlist for the key, healing the entry once on failure and
   * falling back to the last good body while healing. `pickUrl(entry, master)`
   * returns the URL to fetch for the current entry.
   */
  async playlistWithHeal(key, kind, pickUrl) {
    let entry = await this.getEntry(key);
    if (!entry) throw Object.assign(new Error('unknown stream'), { status: 404 });
    const source = entry.source;

    const attempt = async (e) => {
      const url = await pickUrl(e);
      if (!url) throw Object.assign(new Error('no such variant'), { status: 404 });
      const body = await this.loadPlaylist(key, e, url);
      return { entry: e, url, body };
    };

    try {
      const out = await attempt(entry);
      this.stale.set(`${key}|${kind}`, { body: out.body, at: Date.now(), url: out.url });
      return out;
    } catch (err) {
      console.warn(`[HlsGateway] ${kind} failed for ${source}: ${err.message}; healing`);
      const healed = await this.heal(key, err.message);
      if (healed && healed.upstream) {
        try {
          const out = await attempt(healed);
          this.stale.set(`${key}|${kind}`, { body: out.body, at: Date.now(), url: out.url });
          if (this.sourceHealth) this.sourceHealth.notePlay(source, true);
          return out;
        } catch (err2) {
          console.warn(`[HlsGateway] ${kind} still failing after heal: ${err2.message}`);
        }
      }
      const stale = this.stale.get(`${key}|${kind}`);
      if (stale && Date.now() - stale.at < STALE_MAX_MS) {
        return { entry: this.entries.get(key) || entry, url: stale.url, body: stale.body, stale: true };
      }
      if (this.sourceHealth) this.sourceHealth.notePlay(source, false);
      throw err;
    }
  }

  // ── Playlist rewriting ────────────────────────────────────────────────────

  static isMaster(body) { return body.includes('#EXT-X-STREAM-INF'); }

  static variantUrls(body, baseUrl) {
    const out = [];
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j].trim();
        if (!l) continue;
        if (l.startsWith('#')) continue;
        try { out.push(resolveChild(l, baseUrl)); } catch (_) { out.push(null); }
        break;
      }
    }
    return out;
  }

  segUrl(key, abs) {
    return `/api/hls/${key}/seg?u=${encodeURIComponent(abs)}`;
  }

  rewriteMaster(body, key, masterUrl) {
    let v = 0;
    return body.split('\n').map(raw => {
      const line = raw.trim();
      if (!line) return raw;
      if (line.startsWith('#EXT-X-MEDIA') && line.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/, (_, u) => {
          let abs = u; try { abs = resolveChild(u, masterUrl); } catch (_) {}
          return `URI="/api/hls/${key}/sub.m3u8?u=${encodeURIComponent(abs)}"`;
        });
      }
      if (line.startsWith('#EXT-X-I-FRAME-STREAM-INF')) return ''; // trick-play playlists: not needed live
      if (line.startsWith('#EXT-X-SESSION-KEY') && line.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/, (_, u) => {
          let abs = u; try { abs = resolveChild(u, masterUrl); } catch (_) {}
          return `URI="${this.segUrl(key, abs)}"`;
        });
      }
      if (line.startsWith('#')) return raw;
      return `/api/hls/${key}/sub.m3u8?v=${v++}`;
    }).join('\n');
  }

  rewriteMedia(body, key, baseUrl, relay = RELAY_SEGMENTS) {
    return body.split('\n').map(raw => {
      const line = raw.trim();
      if (!line) return raw;
      if ((line.startsWith('#EXT-X-KEY') || line.startsWith('#EXT-X-MAP')) && line.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/, (_, u) => {
          let abs = u; try { abs = resolveChild(u, baseUrl); } catch (_) {}
          return `URI="${relay ? this.segUrl(key, abs) : abs}"`;
        });
      }
      if (line.startsWith('#')) return raw;
      let abs = line;
      try { abs = resolveChild(line, baseUrl); } catch (_) {}
      if (abs.includes('.m3u8')) return `/api/hls/${key}/sub.m3u8?u=${encodeURIComponent(abs)}`;
      return relay ? this.segUrl(key, abs) : abs;
    }).join('\n');
  }

  // ── HTTP handlers ─────────────────────────────────────────────────────────

  _playlistHeaders(res, stale) {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    if (stale) res.setHeader('X-Hls-Stale', '1');
  }

  async serveIndex(req, res) {
    const key = req.params.key;
    try {
      const out = await this.playlistWithHeal(key, 'index', async (e) => e.upstream);
      this._playlistHeaders(res, out.stale);
      const body = HlsGateway.isMaster(out.body)
        ? this.rewriteMaster(out.body, key, out.url)
        : this.rewriteMedia(out.body, key, out.url, out.entry.relay !== false);
      res.send(body);
    } catch (err) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(err.status === 404 ? 404 : 503).send(`Stream unavailable: ${err.message}`);
    }
  }

  async serveSub(req, res) {
    const key = req.params.key;
    const vIdx = req.query.v != null ? parseInt(req.query.v, 10) : null;
    const direct = req.query.u;
    try {
      const out = await this.playlistWithHeal(key, `sub:${vIdx != null ? vIdx : 'u'}`, async (e) => {
        if (direct) {
          // Rendition/nested playlist by absolute URL; if it belongs to a dead
          // upstream the fetch fails and the heal path re-resolves the master.
          return direct;
        }
        const master = await this.loadPlaylist(key, e, e.upstream);
        if (!HlsGateway.isMaster(master)) return e.upstream;
        const variants = HlsGateway.variantUrls(master, e.upstream);
        return variants[Math.min(Math.max(vIdx || 0, 0), variants.length - 1)] || null;
      });
      this._playlistHeaders(res, out.stale);
      res.send(HlsGateway.isMaster(out.body) ? this.rewriteMaster(out.body, key, out.url) : this.rewriteMedia(out.body, key, out.url, out.entry.relay !== false));
    } catch (err) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(err.status === 404 ? 404 : 503).send(`Variant unavailable: ${err.message}`);
    }
  }

  async serveSegment(req, res) {
    const key = req.params.key;
    const target = req.query.u;
    if (!target || !/^https?:\/\//.test(target)) return res.status(400).send('Missing u');
    const entry = this.entries.get(key) || { referer: '', origin: '', source: '' };
    const headers = this.headersFor(entry);
    if (req.headers.range) headers['Range'] = req.headers.range;

    let upstream;
    try {
      upstream = await request(target, { headers, dispatcher: laxAgent, headersTimeout: 10000, bodyTimeout: 25000 });
    } catch (err) {
      this.heal(key, `segment ${err.message}`);
      return res.status(503).send('Segment fetch failed');
    }
    if (upstream.statusCode >= 400) {
      try { upstream.body.destroy(); } catch (_) {}
      if (upstream.statusCode === 403 || upstream.statusCode === 404 || upstream.statusCode >= 500) this.heal(key, `segment ${upstream.statusCode}`);
      return res.status(upstream.statusCode >= 500 ? 503 : upstream.statusCode).send('Segment unavailable');
    }
    res.status(upstream.statusCode);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=30');
    const ct = upstream.headers['content-type'];
    res.setHeader('Content-Type', ct && !String(ct).includes('text/html') ? ct : 'video/mp2t');
    for (const h of ['content-length', 'content-range', 'accept-ranges']) {
      if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    }
    upstream.body.on('error', () => { try { res.destroy(); } catch (_) {} });
    req.on('close', () => { try { upstream.body.destroy(); } catch (_) {} });
    upstream.body.pipe(res);
  }

  stats() {
    return { entries: this.entries.size, playlistCache: this.playlistCache.size, relaySegments: RELAY_SEGMENTS };
  }
}

module.exports = HlsGateway;
module.exports.RELAY_SEGMENTS = RELAY_SEGMENTS;
