/**
 * streams.js — Stream resolution for a match.
 *
 * Flow: selectSources (enabled + priority) -> resolveSource (provider) ->
 * verifyStreams (HLS pre-flight) -> cache -> label/sort -> Stremio payload.
 */

const container = require('./container');
const HlsGateway = require('./services/HlsGateway');
const { enabledSourceIds, priorityOf, labelOf, INTERNAL_SOURCE_IDS } = require('./sources');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

// How long a /stream request waits for slow sources before answering with
// what is ready. Remaining sources finish in the background. If nothing is
// ready at the deadline the request keeps waiting for the first result up to
// STREAM_HARD_DEADLINE_MS so the user never sees an empty list on first open.
const STREAM_DEADLINE_MS = parseInt(process.env.STREAM_DEADLINE_MS, 10) || 10000;
const STREAM_HARD_DEADLINE_MS = parseInt(process.env.STREAM_HARD_DEADLINE_MS, 10) || 25000;
const VERIFY_MAX_PER_SOURCE = 8;
const VERIFY_CONCURRENCY = 3;

// Which provider (container key) handles a given source id.
const PROVIDER_KEYS = {
  streamfree: 'streamFreeProvider',
  timstreams: 'timStreamsProvider',
  sportyhunter: 'sportyHunterProvider',
  watchfooty: 'watchFootyProvider',
  cdnlive: 'cdnLiveProvider',
  streamsports99: 'streamSports99Provider',
  streamic: 'streamicProvider',
  embedindia: 'embedIndiaProvider',
  embedst: 'embedStProvider',
  streamedpk: 'streamedPkProvider',
  ppv: 'ppvProvider',
  ntv: 'ntvProvider',
  sportsindx: 'sportsindxProvider'
};

// Referer each provider's raw (non-proxied) m3u8 needs when the client fetches it.
const DIRECT_REFERERS = {
  streamedpk: 'https://embed.st/',
  ntv: 'https://embed.st/',
  watchfooty: 'https://watchfooty.st/',
  cdnlive: 'https://cdnlivetv.tv/',
  streamic: 'https://streamic.st/',
  streamsports99: 'https://streamsports99.fun/',
  sportyhunter: 'https://sportyhunter.xyz/'
};

const SPORT_ICONS = {
  football: '⚽', cricket: '🏏', motorsport: '🏎️', basketball: '🏀', american_football: '🏈',
  rugby: '🏉', hockey: '🏒', baseball: '⚾', mma: '🥊', golf: '⛳', tennis: '🎾', darts: '🎯',
  college: '🎓', networks: '📺'
};

// ─── Source selection ────────────────────────────────────────────────────────

function selectSources(matchSources, config) {
  const enabled = new Set(enabledSourceIds(config));
  const picked = (matchSources || []).filter(src => {
    if (!src || !src.source) return false;
    if (src.source.startsWith('yaml_')) return true;
    if (INTERNAL_SOURCE_IDS.includes(src.source)) return true; // legacy entries
    return enabled.has(src.source);
  });
  return picked.sort((a, b) => priorityOf(a.source) - priorityOf(b.source));
}

// ─── Per-source resolution ───────────────────────────────────────────────────

async function resolveSource(src, match, config) {
  const streamScorer = container.resolve('streamScorer');
  const sourceName = src.source;
  let resStreams = [];

  try {
    if (sourceName === 'iptv-org') {
      const proxyHeaders = {};
      if (src.user_agent) proxyHeaders['User-Agent'] = src.user_agent;
      if (src.referrer) proxyHeaders['Referer'] = src.referrer;
      resStreams = [{
        name: 'Nuvio Direct',
        title: `24/7 TV (${src.quality || 'Auto'})`,
        url: src.url,
        resolution: src.quality,
        behaviorHints: { proxyHeaders: { request: proxyHeaders } }
      }];
    } else if (sourceName.startsWith('yaml_')) {
      const provider = container.resolve('yamlProviders').find(p => p.name === sourceName.slice(5));
      if (provider) resStreams = await provider.resolveStream(src.id, match.category, match.title);
    } else if (PROVIDER_KEYS[sourceName]) {
      const provider = container.resolve(PROVIDER_KEYS[sourceName]);
      const category = sourceName === 'streamfree' ? (src.original_category || match.category) : match.category;
      resStreams = await provider.resolveStream(src.id, category, match.title, src);
    }

    for (const s of resStreams || []) {
      s.score = streamScorer.calculateScore(s, sourceName);
      s._source = sourceName;
    }
  } catch (e) {
    console.warn(`[streams.js] Error resolving ${sourceName} for ${src.id}:`, e.message);
    resStreams = [];
  }

  return resStreams || [];
}

// ─── Health verification ─────────────────────────────────────────────────────

let laxDispatcher = null;
function getLaxDispatcher() {
  if (!laxDispatcher) {
    const { Agent } = require('undici');
    laxDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }
  return laxDispatcher;
}

let sharedVerifyImpit; // lazy singleton; null once it failed to load
function getVerifyImpitClient() {
  if (sharedVerifyImpit === undefined) {
    try {
      const { Impit } = require('impit');
      // Some sports CDNs run on expired/self-signed certificates; the player
      // goes through our proxy anyway, so TLS validation only causes false drops.
      sharedVerifyImpit = new Impit({ ignoreTlsErrors: true });
    } catch (e) {
      console.warn('[streams.js] Impit unavailable, verification will use undici:', e.message);
      sharedVerifyImpit = null;
    }
  }
  return sharedVerifyImpit;
}

/** GET a text resource with the stream's headers. Returns { status, body }. */
async function probeText(url, headers, timeoutMs) {
  const impitClient = getVerifyImpitClient();
  // Impit (browser TLS fingerprint) first with half the budget, undici with
  // the other half. Each leg has its own deadline covering headers AND body.
  const half = Math.max(2000, Math.floor(timeoutMs / 2));
  if (impitClient) {
    try {
      const r = await Promise.race([
        (async () => { const res = await impitClient.fetch(url, { method: 'GET', headers }); return { status: res.status, body: await res.text() }; })(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('impit timeout')), half))
      ]);
      return r;
    } catch (_) { /* fall through to undici */ }
  }
  const { request } = require('undici');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), half);
  try {
    const r = await request(url, { method: 'GET', headers, headersTimeout: half, bodyTimeout: half, signal: controller.signal, dispatcher: getLaxDispatcher() });
    return { status: r.statusCode, body: await r.body.text() };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch only the first bytes of a media segment; returns the HTTP status. */
async function probeSegment(url, headers, timeoutMs) {
  const { request } = require('undici');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await request(url, {
      method: 'GET',
      headers: { ...headers, 'Range': 'bytes=0-4095' },
      headersTimeout: timeoutMs, bodyTimeout: timeoutMs,
      signal: controller.signal,
      dispatcher: getLaxDispatcher()
    });
    // Read one chunk to confirm bytes actually flow, then drop the connection.
    let gotBytes = false;
    for await (const chunk of r.body) { if (chunk && chunk.length) { gotBytes = true; } break; }
    try { r.body.destroy(); } catch (_) {}
    return { status: r.statusCode, gotBytes };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a playlist child URI against its parent and inherit the parent's
 * query parameters when the child has none of them (StreamFree, some CDN
 * edges sign the master and expect the same token on every child).
 */
function resolveChild(line, baseUrl) {
  const child = new URL(line, baseUrl);
  try {
    const parent = new URL(baseUrl);
    parent.searchParams.forEach((val, key) => { if (!child.searchParams.has(key)) child.searchParams.set(key, val); });
  } catch (_) {}
  return child.toString();
}

function hostOf(u) { try { return new URL(u).hostname; } catch (_) { return ''; } }

function firstUri(body, baseUrl, { segments }) {
  const lines = body.split('\n').map(l => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l || l.startsWith('#')) continue;
    // In a media playlist a URI line follows #EXTINF; in a master it follows #EXT-X-STREAM-INF
    const prev = lines.slice(Math.max(0, i - 3), i).join(' ');
    if (segments && !prev.includes('#EXTINF')) continue;
    if (!segments && !prev.includes('#EXT-X-STREAM-INF')) continue;
    try { return resolveChild(l, baseUrl); } catch (_) { return null; }
  }
  return null;
}

/**
 * Pre-flight each direct stream once and drop dead ones. Checks three levels:
 * master playlist -> first variant playlist -> first media segment. A stream
 * that only passes the master check is exactly the kind that "loads forever"
 * in the player, so all three must succeed. Browser streams pass through.
 */
async function verifyStreams(streams, cacheKey, m3u8Parser, resolveCache, match) {
  // Only live matches say something about source reliability; an upcoming
  // match with no stream yet is not the source's fault.
  let matchIsLive = true;
  try { if (match && match.date) matchIsLive = require('./catalog').isMatchLive(match); } catch (_) {}
  // Providers often return the same upstream several times (mirrors of one
  // channel). Probe each upstream once and cap the batch so one source cannot
  // fire 15 probes at a CDN that then throttles all of them into timeouts.
  const seenUp = new Set();
  const unique = [];
  for (const s of streams) {
    if (!s.url || s.url.includes('/watch?')) { unique.push(s); continue; }
    let k = s.url;
    try { if (k.includes('/api/manifest')) k = new URL(k, 'http://localhost').searchParams.get('url') || k; } catch (_) {}
    k = k.replace(/\/secure\/[^/]+\//, '/secure/_/').replace(/[?&](_t|_e|_n|token|gid)=[^&]*/g, '');
    if (seenUp.has(k)) continue;
    seenUp.add(k);
    unique.push(s);
  }
  const direct = unique.filter(s => s.url && !s.url.includes('/watch?')).slice(0, VERIFY_MAX_PER_SOURCE);
  const web = unique.filter(s => !s.url || s.url.includes('/watch?'));

  let cursor = 0;
  const verifyOne = async (s) => {
    if (!s.url || s.url.includes('/watch?')) return s;

    let targetUrl = s.url;
    let referer = '';
    let origin = '';
    if (targetUrl.includes('/api/manifest')) {
      try {
        const u = new URL(targetUrl, 'http://localhost');
        targetUrl = u.searchParams.get('url') || targetUrl;
        referer = u.searchParams.get('referer') || '';
        origin = u.searchParams.get('origin') || '';
      } catch (_) {}
    }
    if (!referer && s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request) {
      referer = s.behaviorHints.proxyHeaders.request.Referer || '';
    }
    if (!origin && referer) { try { origin = new URL(referer).origin; } catch (_) {} }

    const reqHeaders = { 'User-Agent': UA };
    if (referer) reqHeaders['Referer'] = referer;
    if (origin) reqHeaders['Origin'] = origin;

    const health = container.resolve('sourceHealth');
    const drop = (why) => {
      console.log(`[Filter] Dropped ${why}: ${targetUrl.slice(0, 120)}`);
      if (cacheKey) resolveCache.noteFailure(cacheKey);
      if (matchIsLive) health.noteVerify(s._source, false);
      health.remember({ source: s._source, key: cacheKey, live: matchIsLive, outcome: 'dropped', why, host: hostOf(targetUrl) });
      return null;
    };

    // Level 1: playlist the player will request
    let status = 0;
    let body = '';
    try {
      ({ status, body } = await probeText(targetUrl, reqHeaders, 8000));
    } catch (err) {
      return drop(`unreachable stream (${err.message})`);
    }
    if (status === 404 || status === 403 || status >= 500) return drop(`dead stream (${status})`);
    if (!body.includes('#EXT')) return drop('non-M3U8 body');

    // Level 2: variant playlist (masters only). A variant the server cannot
    // read (403/5xx = datacenter IP blocked) is not necessarily dead for the
    // viewer's own IP, so the stream is kept in "raw" mode: the player gets
    // the original URL and fetches everything itself, as before.
    s._mode = 'relay';
    let mediaBody = body;
    let mediaUrl = targetUrl;
    if (body.includes('#EXT-X-STREAM-INF')) {
      const variantUrl = firstUri(body, targetUrl, { segments: false });
      if (variantUrl) {
        try {
          const v = await probeText(variantUrl, reqHeaders, 8000);
          if (v.status < 400 && v.body.includes('#EXT')) {
            mediaBody = v.body;
            mediaUrl = variantUrl;
          } else {
            return drop(`dead variant (${v.status})`);
          }
        } catch (err) {
          return drop(`unreachable variant (${err.message})`);
        }
      }
    }

    // Level 3: first media segment. Blocked for the server -> segments are
    // handed to the player directly (playlists still go through the gateway).
    if (s._mode === 'relay') {
      if (!mediaBody.includes('#EXTINF')) return drop('playlist without segments');
      const segUrl = firstUri(mediaBody, mediaUrl, { segments: true });
      if (segUrl) {
        // The segment path identifies the actual feed: several aggregators
        // (Streamed, NTV, PPV, ...) often hand out the very same upstream feed
        // under different playlist hosts. Used to de-duplicate the picker.
        try { const su = new URL(segUrl); s._sig = su.host + su.pathname; } catch (_) {}
        // Two attempts: live edges occasionally 5xx on the newest segment.
        let segOk = false, segWhy = '';
        for (let attempt = 0; attempt < 2 && !segOk; attempt++) {
          try {
            const seg = await probeSegment(segUrl, reqHeaders, 8000);
            if (seg.status === 416 || (seg.status < 400 && seg.gotBytes)) segOk = true;
            else segWhy = `segment ${seg.status}${seg.status < 400 ? ' (no bytes)' : ''}`;
          } catch (err) {
            segWhy = `segment ${err.message}`;
          }
          if (!segOk && attempt === 0) await new Promise(r => setTimeout(r, 700));
        }
        if (!segOk) return drop(`dead ${segWhy}`);
      }
    }
    if (s._mode !== 'relay') console.log(`[Filter] ${s._source} kept in ${s._mode} mode: ${targetUrl.slice(0, 100)}`);

    const parsed = m3u8Parser.parseManifestText(body);
    if (parsed) {
      if (parsed.qualityTag) s.quality = parsed.qualityTag;
      if (parsed.resolution) s.resolution = parsed.resolution;
      if (parsed.bitrateTag) s.bitrate = parsed.bitrateTag;
    }
    if (cacheKey) resolveCache.noteSuccess(cacheKey);
    if (matchIsLive) health.noteVerify(s._source, s._mode === 'relay');
    health.remember({ source: s._source, key: cacheKey, live: matchIsLive, outcome: 'ok', mode: s._mode, host: hostOf(targetUrl), quality: s.resolution || s.quality || '' });
    return s;
  };

  const results = new Array(direct.length).fill(null);
  const workers = Array.from({ length: Math.min(VERIFY_CONCURRENCY, direct.length) }, async () => {
    while (cursor < direct.length) {
      const i = cursor++;
      try { results[i] = await verifyOne(direct[i]); } catch (_) { results[i] = null; }
    }
  });
  await Promise.all(workers);
  return [...results.filter(Boolean), ...web];
}

async function mintVerifiedSources(src, match, config, cacheKey) {
  const resolveCache = container.resolve('streamResolveCache');
  const m3u8Parser = container.resolve('m3u8Parser');
  const minted = await resolveSource(src, match, config);
  return verifyStreams(minted, cacheKey, m3u8Parser, resolveCache, match);
}

// ─── Upstream mapping / re-mint (used by HlsGateway) ─────────────────────────

/** Extract { upstream, referer, origin } from a verified direct stream. */
function toUpstream(s) {
  if (!s || !s.url) return null;
  let upstream = s.url, referer = '', origin = '';
  if (upstream.includes('/api/manifest')) {
    try {
      const u = new URL(upstream, 'http://localhost');
      upstream = u.searchParams.get('url') || upstream;
      referer = u.searchParams.get('referer') || '';
      origin = u.searchParams.get('origin') || '';
    } catch (_) {}
  }
  if (!referer && s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request) {
    referer = s.behaviorHints.proxyHeaders.request.Referer || '';
  }
  if (!referer) referer = DIRECT_REFERERS[s._source] || '';
  if (!origin && referer) { try { origin = new URL(referer).origin; } catch (_) {} }
  if (!/^https?:\/\//.test(upstream)) return null;
  return { upstream, referer, origin, relay: s._mode !== 'direct-segments' };
}

/**
 * Drop the cached mint for one source and resolve + verify it again.
 * Returns the fresh upstream list in the same order as the original mint, so
 * HlsGateway can keep serving the n-th stream under the same key.
 */
async function remintForKey({ source, matchId, srcId }) {
  const resolveCache = container.resolve('streamResolveCache');
  const key = `${source}:${matchId}:${srcId}`;
  let src, match;
  if (matchId === '__channel__') {
    src = { source, id: srcId, original_category: 'cricket' };
    match = { id: matchId, category: 'cricket', title: String(srcId) };
  } else {
    match = container.resolve('cacheService').getMatches().find(m => m.id === matchId);
    if (!match) return [];
    src = (match.sources || []).find(x => x.source === source && String(x.id) === String(srcId));
    if (!src) return [];
  }
  resolveCache.entries.delete(key);
  const minted = await resolveCache.getOrCreate(key, () => mintVerifiedSources(src, match, null, key));
  return minted.map(toUpstream).filter(Boolean);
}

/** Give a verified direct stream its permanent gateway URL. */
function toGatewayUrl(s, matchId) {
  const up = toUpstream(s);
  if (!up || !s._cacheKey) return null;
  const parts = s._cacheKey.split(':');
  const source = parts[0];
  const srcId = parts.slice(2).join(':');
  const key = HlsGateway.encodeKey({ source, matchId: parts[1], srcId, idx: s._idx || 0 });
  container.resolve('hlsGateway').register(key, { ...up, source });
  const { BASE_URL } = require('./config');
  return `${BASE_URL}/api/hls/${key}/index.m3u8`;
}

// ─── Prewarm ─────────────────────────────────────────────────────────────────

async function prewarmMatch(match, config, topN = 8) {
  try {
    if (!match || !match.sources || !match.sources.length) return;
    const resolveCache = container.resolve('streamResolveCache');
    const targets = selectSources(match.sources, config || null).slice(0, topN);
    if (targets.length === 0) return;
    console.log(`[Prewarm] minting ${targets.length} sources for ${match.id}`);
    await Promise.allSettled(targets.map(src => {
      const key = `${src.source}:${match.id}:${src.id}`;
      if (resolveCache.get(key)) return Promise.resolve(null);
      return resolveCache.getOrCreate(key, () => mintVerifiedSources(src, match, config || null, key));
    }));
  } catch (err) {
    console.warn('[Prewarm] failed:', err.message);
  }
}

// ─── Labelling ───────────────────────────────────────────────────────────────

function qualityLabel(s) {
  let q = s.resolution || s.quality || '';
  q = String(q);
  if (q.includes('x')) q = q.split('x')[1] + 'p';
  if (!q || /^(auto|hd|sd)$/i.test(q)) return q ? q.toUpperCase() : 'Auto';
  return q;
}

/** Pull "(channel)" / "👥 N Viewers" hints out of a provider's raw title. */
function extractHints(rawTitle) {
  const out = { channel: '', viewers: '', language: '' };
  if (!rawTitle) return out;
  const v = rawTitle.match(/👥\s*(\d+)\s*Viewers/i);
  if (v) out.viewers = `${v[1]} watching`;
  const paren = rawTitle.match(/\(([^)]+)\)/);
  if (paren && paren[1]) {
    const inner = paren[1].trim();
    if (!/^\d{3,4}p$/i.test(inner) && !/^(auto|web player|web|extract|live|direct)$/i.test(inner) && !/^stream/i.test(inner)) {
      if (/^(english|spanish|french|german|italian|portuguese|arabic|hindi|turkish|russian|dutch|polish|[a-z]{2})$/i.test(inner)) out.language = inner;
      else out.channel = inner;
    }
  }
  return out;
}

function decorateStream(s, match) {
  const icon = SPORT_ICONS[match.category] || '📡';
  const provider = labelOf(s._source);
  const isWeb = !s.url && !!s.externalUrl;
  const hints = extractHints(s.title);
  const quality = qualityLabel(s);
  const health = container.resolve('sourceHealth');
  const healthLabel = isWeb ? '' : health.label(s._source);

  const parts = [`${icon} ${provider}${healthLabel ? ' · ' + healthLabel : ''}`];
  if (hints.channel) parts.push(`📺 ${hints.channel}`);
  if (hints.language) parts.push(`🗣 ${hints.language}`);
  parts.push(isWeb ? '🌐 Opens in browser' : `🎞 ${quality}`);
  if (hints.viewers) parts.push(`👥 ${hints.viewers}`);

  s.name = isWeb ? '🌐 Web Stream' : '⚡ Direct Stream';
  s.title = parts.join('\n');

  s.behaviorHints = s.behaviorHints || {};
  s.behaviorHints.bingeGroup = `nuvio_sport_${match.id}`;

  // Direct streams go through the self-healing HLS gateway: stable URL,
  // server-side headers, segment relay, automatic re-mint on failure. Streams
  // the server itself cannot read ("raw" mode) keep the original client path.
  if (s.url && s._source !== 'iptv-org' && s._mode !== 'raw') {
    const gw = toGatewayUrl(s, match.id);
    if (gw) {
      const up = toUpstream(s);
      s.url = gw;
      s.behaviorHints.notWebReady = true;
      if (up && up.referer) {
        s.behaviorHints.proxyHeaders = { request: { 'Referer': up.referer, 'Origin': up.origin || up.referer.replace(/\/$/, ''), 'User-Agent': UA } };
      } else {
        delete s.behaviorHints.proxyHeaders;
      }
      return s;
    }
  }

  // Raw (non-proxied) m3u8: the player must send the upstream's referer.
  if (s.url && s.url.includes('.m3u8') && !s.url.includes('/api/manifest')) {
    if (s._source !== 'iptv-org') s.behaviorHints.notWebReady = true;
    const referer = DIRECT_REFERERS[s._source];
    if (referer && !s.behaviorHints.proxyHeaders) {
      s.behaviorHints.proxyHeaders = { request: { 'Referer': referer, 'Origin': referer.replace(/\/$/, ''), 'User-Agent': UA } };
    }
  }

  if (s._source === 'iptv-org' && s.url) {
    s.title = `📺 ${hints.channel || '24/7 Live Network'}\n🎞 ${quality}`;
  }
  return s;
}

/** Drop duplicate feeds (same first segment, same upstream m3u8 or same external page). */
function dedupeStreams(streams) {
  const seen = new Set();
  return streams.filter(s => {
    if (s._sig) {
      if (seen.has('sig:' + s._sig)) return false;
      seen.add('sig:' + s._sig);
    }
    let key = s.url || s.externalUrl || '';
    try {
      if (key.includes('/api/manifest')) key = new URL(key, 'http://localhost').searchParams.get('url') || key;
      // Same upstream stream minted twice by different providers differs only by token.
      key = key.replace(/\/secure\/[^/]+\//, '/secure/_/').replace(/[?&](_t|_e|_n|token|gid)=[^&]*/g, '');
    } catch (_) {}
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Handler ─────────────────────────────────────────────────────────────────

async function handleStream(type, id, config) {
  if (type !== 'tv' || !id.startsWith('nuvio_sport_')) return { streams: [] };

  const matchId = id.replace('nuvio_sport_', '');
  const match = container.resolve('cacheService').getMatches().find(m => m.id === matchId);
  if (!match || !match.sources || match.sources.length === 0) return { streams: [] };

  const resolveCache = container.resolve('streamResolveCache');
  const streamScorer = container.resolve('streamScorer');
  const activeSources = selectSources(match.sources, config);
  const streams = [];

  // Every source resolves in parallel, but the response is sent after
  // STREAM_DEADLINE_MS with whatever finished so far. Slow sources keep
  // resolving in the background (single-flight cache) and show up on the
  // next request, which the short cacheMaxAge below triggers quickly.
  let partial = false;
  const works = activeSources.map((src) => {
    const key = `${src.source}:${matchId}:${src.id}`;
    const work = resolveCache.getOrCreate(key, () => mintVerifiedSources(src, match, config, key))
      .then((minted) => minted.map((s, i) => ({ ...s, _cacheKey: key, _idx: i })))
      .catch(() => []);
    return { work, done: false, value: [] };
  });
  works.forEach(w => w.work.then(v => { w.done = true; w.value = v; }));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const started = Date.now();
  const allDone = () => works.every(w => w.done);
  const anyStream = () => works.some(w => w.done && w.value.length > 0);
  await Promise.race([Promise.all(works.map(w => w.work)), sleep(STREAM_DEADLINE_MS)]);
  while (!allDone() && !anyStream() && Date.now() - started < STREAM_HARD_DEADLINE_MS) {
    await Promise.race([Promise.all(works.map(w => w.work)), sleep(500)]);
  }
  partial = !allDone();
  for (const w of works) if (w.done) streams.push(...w.value);

  // 24/7 cricket networks from StreamFree, when enabled
  const enabled = enabledSourceIds(config);
  if (match.category === 'cricket' && enabled.includes('streamfree')) {
    try {
      const extraChannels = [{ id: 'willow', title: 'Willow TV' }, { id: 'skycricket', title: 'Sky Sports Cricket' }];
      const warmed = await Promise.all(extraChannels.map(async (channel) => {
        const key = `streamfree:__channel__:${channel.id}`;
        const resolved = await resolveCache.getOrCreate(key, () => mintVerifiedSources(
          { source: 'streamfree', id: channel.id, original_category: 'cricket' },
          { category: 'cricket', title: channel.title }, config, key));
        return resolved.map((s, i) => ({ ...s, _cacheKey: key, _idx: i, title: `StreamFree (${channel.title})` }));
      }));
      warmed.flat().forEach((s) => {
        s.score = streamScorer.calculateScore(s, 'streamfree');
        s._source = 'streamfree';
        streams.push(s);
      });
    } catch (e) {
      console.warn('[streams.js] Error injecting 24/7 cricket channels:', e.message);
    }
  }

  const health = container.resolve('sourceHealth');
  const heightOf = (s) => { const m = String(s.resolution || s.quality || '').match(/(\d{3,4})p?$/); return m ? parseInt(m[1], 10) : 0; };

  let out = dedupeStreams(streams).map(s => decorateStream(s, match));

  // Deterministic order: direct first, then source reliability (bucketed so
  // small score drifts do not reshuffle), then resolution, then source priority.
  out.sort((a, b) => {
    const aDirect = a.url ? 1 : 0;
    const bDirect = b.url ? 1 : 0;
    if (aDirect !== bDirect) return bDirect - aDirect;
    const ha = Math.round(health.score(a._source) * 5), hb = Math.round(health.score(b._source) * 5);
    if (ha !== hb) return hb - ha;
    const ra = heightOf(a), rb = heightOf(b);
    if (ra !== rb) return rb - ra;
    const pa = priorityOf(a._source), pb = priorityOf(b._source);
    if (pa !== pb) return pa - pb;
    return (a._idx || 0) - (b._idx || 0);
  });

  // Quality gate: unreliable sources are hidden while at least two healthier
  // direct streams exist. Browser streams only appear when there is no direct
  // stream at all (or never, with directOnly).
  const directOnly = config && (config.directOnly === true || config.directOnly === 'true' || config.directOnly === '1');
  const maxStreams = Math.max(1, Math.min(20, parseInt(config && config.maxStreams, 10) || 6));
  let direct = out.filter(s => !!s.url);
  const healthy = direct.filter(s => health.score(s._source) >= 0.35 || health.samples(s._source) < 10);
  if (healthy.length >= 2) direct = healthy;
  direct = direct.slice(0, maxStreams);
  const web = (direct.length > 0 || directOnly) ? [] : out.filter(s => !s.url).slice(0, 4);
  out = [...direct, ...web];

  // Strip internal fields before they reach the client
  out = out.map(({ _source, _cacheKey, _idx, _mode, _sig, score, resolution, bitrate, quality, ...rest }) => rest);

  return partial
    ? { streams: out, partial: true, cacheMaxAge: 5, staleRevalidate: 5, staleError: 30 }
    : { streams: out, cacheMaxAge: 30, staleRevalidate: 30, staleError: 120 };
}

module.exports = { handleStream, prewarmMatch, selectSources, remintForKey };
