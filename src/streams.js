/**
 * streams.js — Stream resolution for a match.
 *
 * Flow: selectSources (enabled + priority) -> resolveSource (provider) ->
 * verifyStreams (HLS pre-flight) -> cache -> label/sort -> Stremio payload.
 */

const container = require('./container');
const { enabledSourceIds, priorityOf, labelOf, INTERNAL_SOURCE_IDS } = require('./sources');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

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

/**
 * Ping each direct stream once and drop dead ones (404/403/5xx or a 200 body
 * without #EXT). Browser streams pass through untouched. Runs once per mint.
 */
async function verifyStreams(streams, cacheKey, m3u8Parser, resolveCache) {
  const impitClient = getVerifyImpitClient();

  const checked = await Promise.all(streams.map(async (s) => {
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let status = 0;
    let body = '';
    try {
      try {
        if (!impitClient) throw new Error('impit unavailable');
        const r = await impitClient.fetch(targetUrl, { method: 'GET', headers: reqHeaders, signal: controller.signal });
        status = r.status;
        body = await r.text();
      } catch (impitErr) {
        const { request } = require('undici');
        const r = await request(targetUrl, { method: 'GET', headers: reqHeaders, headersTimeout: 4000, bodyTimeout: 4000, signal: controller.signal, dispatcher: getLaxDispatcher() });
        status = r.statusCode;
        body = await r.body.text();
      }
    } catch (err) {
      clearTimeout(timer);
      console.log(`[Filter] Dropped unreachable stream: ${targetUrl.slice(0, 120)} - ${err.message}`);
      if (cacheKey) resolveCache.noteFailure(cacheKey);
      return null;
    }
    clearTimeout(timer);

    if (status === 404 || status === 403 || status >= 500) {
      console.log(`[Filter] Dropped dead stream (${status}): ${targetUrl.slice(0, 120)}`);
      if (cacheKey) resolveCache.noteFailure(cacheKey);
      return null;
    }
    if (!body.includes('#EXT')) {
      console.log(`[Filter] Dropped non-M3U8 body: ${targetUrl.slice(0, 120)}`);
      if (cacheKey) resolveCache.noteFailure(cacheKey);
      return null;
    }

    const parsed = m3u8Parser.parseManifestText(body);
    if (parsed) {
      if (parsed.qualityTag) s.quality = parsed.qualityTag;
      if (parsed.resolution) s.resolution = parsed.resolution;
      if (parsed.bitrateTag) s.bitrate = parsed.bitrateTag;
    }
    if (cacheKey) resolveCache.noteSuccess(cacheKey);
    return s;
  }));

  return checked.filter(Boolean);
}

async function mintVerifiedSources(src, match, config, cacheKey) {
  const resolveCache = container.resolve('streamResolveCache');
  const m3u8Parser = container.resolve('m3u8Parser');
  const minted = await resolveSource(src, match, config);
  return verifyStreams(minted, cacheKey, m3u8Parser, resolveCache);
}

// ─── Prewarm ─────────────────────────────────────────────────────────────────

async function prewarmMatch(match, config, topN = 3) {
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

  const parts = [`${icon} ${provider}`];
  if (hints.channel) parts.push(`📺 ${hints.channel}`);
  if (hints.language) parts.push(`🗣 ${hints.language}`);
  parts.push(isWeb ? '🌐 Opens in browser' : `🎞 ${quality}`);
  if (hints.viewers) parts.push(`👥 ${hints.viewers}`);

  s.name = isWeb ? '🌐 Web Stream' : '⚡ Direct Stream';
  s.title = parts.join('\n');

  s.behaviorHints = s.behaviorHints || {};
  s.behaviorHints.bingeGroup = `nuvio_sport_${match.id}`;

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

/** Drop exact duplicate targets (same upstream m3u8 or same external page). */
function dedupeStreams(streams) {
  const seen = new Set();
  return streams.filter(s => {
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

  const results = await Promise.allSettled(activeSources.map(async (src) => {
    const key = `${src.source}:${matchId}:${src.id}`;
    const minted = await resolveCache.getOrCreate(key, () => mintVerifiedSources(src, match, config, key));
    return minted.map((s) => ({ ...s, _cacheKey: key }));
  }));
  for (const r of results) if (r.status === 'fulfilled' && Array.isArray(r.value)) streams.push(...r.value);

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
        return resolved.map((s) => ({ ...s, _cacheKey: key, title: `StreamFree (${channel.title})` }));
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

  let out = dedupeStreams(streams).map(s => decorateStream(s, match));

  // Optional: hide browser-only streams entirely
  const directOnly = config && (config.directOnly === true || config.directOnly === 'true' || config.directOnly === '1');
  if (directOnly) out = out.filter(s => !!s.url);

  out.sort((a, b) => {
    const aDirect = a.url ? 1 : 0;
    const bDirect = b.url ? 1 : 0;
    if (aDirect !== bDirect) return bDirect - aDirect;
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    return priorityOf(a._source) - priorityOf(b._source);
  });

  // Strip internal fields before they reach the client
  out = out.map(({ _source, _cacheKey, score, resolution, bitrate, quality, ...rest }) => rest);

  return { streams: out, cacheMaxAge: 30, staleRevalidate: 30, staleError: 120 };
}

module.exports = { handleStream, prewarmMatch, selectSources };
