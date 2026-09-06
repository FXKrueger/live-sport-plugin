// Hardcoded CF proxy pool — add more URLs to multiply free-tier limits
const CF_PROXY_POOL = [];

// One keep-alive dispatcher for every provider fetch (was: a new Agent per call).
let sharedDispatcher = null;
function getDispatcher() {
  if (!sharedDispatcher) {
    const { Agent } = require('undici');
    sharedDispatcher = new Agent({ connect: { rejectUnauthorized: false, timeout: 15000 }, keepAliveTimeout: 10000 });
  }
  return sharedDispatcher;
}

// Lazy shared Impit client used as the TLS-fingerprint fallback.
let sharedImpit;
function getImpit() {
  if (sharedImpit === undefined) {
    try { const { Impit } = require('impit'); sharedImpit = new Impit(); } catch (_) { sharedImpit = null; }
  }
  return sharedImpit;
}

// Pick a random proxy from the pool
function getCfProxyUrl() {
  if (process.env.NODE_ENV === 'test') return null;
  if (CF_PROXY_POOL.length === 0) return null;
  return CF_PROXY_POOL[Math.floor(Math.random() * CF_PROXY_POOL.length)];
}

class BaseProvider {
  constructor({ circuitBreaker }) {
    this.circuitBreaker = circuitBreaker;
    this.name = 'BaseProvider';
  }

  /**
   * Fetch matches from the provider.
   * Should return an array of MatchEntity objects.
   */
  async getMatches() {
    throw new Error('getMatches() must be implemented by subclasses');
  }

  /**
   * Resolve a specific stream source.
   * Should return an array of StreamEntity objects.
   */
  async resolveStream(sourceId, matchCategory, matchTitle) {
    return [];
  }

  /**
   * Helper to normalize category strings across all providers
   */
  normalizeCategory(cat) {
    if (!cat) return 'other';
    if (typeof cat === 'object' && !Array.isArray(cat)) {
      cat = cat.name || cat.title || 'other';
    }
    cat = String(cat).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cat.includes('americanfootball') || cat.includes('nfl') || cat.includes('afl') || cat.includes('gridiron')) return 'american_football';
    if (cat.includes('soccer') || cat.includes('football')) return 'football';
    if (cat.includes('motor') || cat.includes('racing') || cat.includes('cycling') || cat.includes('f1')) return 'motorsport';
    if (cat.includes('fight') || cat.includes('mma') || cat.includes('boxing') || cat.includes('wrestling') || cat.includes('knuckle') || cat.includes('ufc')) return 'mma';
    if (cat.includes('basketball') || cat.includes('nba')) return 'basketball';
    if (cat.includes('golf')) return 'golf';
    if (cat.includes('rugby')) return 'rugby';
    if (cat.includes('cricket')) return 'cricket';
    if (cat.includes('tennis')) return 'tennis';
    if (cat.includes('hockey') || cat.includes('nhl')) return 'hockey';
    if (cat.includes('baseball') || cat.includes('mlb')) return 'baseball';
    if (cat.includes('darts')) return 'darts';
    if (cat.includes('liveshow') || cat.includes('uncategorized')) return 'other';
    return cat;
  }

  /**
   * Fetch wrapper that routes through Cloudflare proxy if configured
   */
  async proxyFetch(url, options = {}) {
    const cfProxyUrl = getCfProxyUrl();
    if (cfProxyUrl) {
      const proxyUrl = new URL(cfProxyUrl);
      proxyUrl.searchParams.set('url', url);
      
      if (options.headers) {
        let referer, origin;
        if (options.headers instanceof Headers) {
          referer = options.headers.get('referer') || options.headers.get('Referer');
          origin = options.headers.get('origin') || options.headers.get('Origin');
        } else {
          referer = options.headers.referer || options.headers.Referer;
          origin = options.headers.origin || options.headers.Origin;
        }
        
        if (referer) proxyUrl.searchParams.set('referer', referer);
        if (origin) proxyUrl.searchParams.set('origin', origin);
      }
      
      url = proxyUrl.toString();
    }
    
    const { request } = require('undici');
    try {
      const reqOptions = {
        method: options.method || 'GET',
        headers: options.headers || {},
        headersTimeout: 15000,
        bodyTimeout: 15000,
        signal: options.signal,
        dispatcher: getDispatcher()
        // NOTE: undici v8 rejects `maxRedirections` on request() ("use the redirect
        // interceptor"). Passing it made this branch throw on EVERY call, silently
        // routing all fetches through the Impit fallback. Redirects are followed
        // by the Impit fallback when the undici path fails.
      };
      
      if (options.body) reqOptions.body = options.body;
      
      const res = await request(url, reqOptions);
      const textData = await res.body.text();
      
      return {
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        text: async () => textData,
        json: async () => JSON.parse(textData)
      };
    } catch (err) {
      try {
        const impitClient = getImpit();
        if (!impitClient) throw new Error('impit unavailable');
        const res = await impitClient.fetch(url, {
          method: options.method || 'GET',
          headers: options.headers || {},
          body: options.body
        });
        const textData = await res.text();
        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          text: async () => textData,
          json: async () => JSON.parse(textData)
        };
      } catch (impitErr) {
        console.error(`[BaseProvider] Fetch error: ${err.message}`);
        throw err;
      }
    }
  }

  /**
   * Helper to normalize strings for fuzzy matching
   */
  normalizeStr(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

module.exports = BaseProvider;
module.exports.getCfProxyUrl = getCfProxyUrl;
