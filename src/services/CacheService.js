class CacheService {
  constructor() {
    this.cachedMatches = [];
    this.lastFetchTime = 0;
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  }

  // Deep-ish clone: handlers downstream mutate individual stream/source objects
  // (s.score, s._source, s.name, s.url, behaviorHints), so a shallow array copy
  // would leak state between requests. Structured clone is not available for
  // these plain JSON shapes on every runtime, so clone explicitly.
  _clone(matches) {
    return (matches || []).map((m) => {
      const c = { ...m };
      if (Array.isArray(m.sources)) {
        c.sources = m.sources.map((s) => (s && typeof s === 'object'
          ? { ...s, behaviorHints: s.behaviorHints ? { ...s.behaviorHints } : s.behaviorHints }
          : s));
      }
      if (m.team1 && typeof m.team1 === 'object') c.team1 = { ...m.team1 };
      if (m.team2 && typeof m.team2 === 'object') c.team2 = { ...m.team2 };
      return c;
    });
  }

  getMatches() {
    return this._clone(this.cachedMatches);
  }

  setMatches(matches) {
    this.cachedMatches = this._clone(matches);
    this.lastFetchTime = Date.now();
  }

  isStale(ttlMs = this.CACHE_TTL) {
    return (Date.now() - this.lastFetchTime) > ttlMs;
  }
}

module.exports = CacheService;
