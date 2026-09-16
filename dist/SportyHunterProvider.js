const BaseProvider = require('./BaseProvider');
const MatchEntity = require('../domain/MatchEntity');
const StreamEntity = require('../domain/StreamEntity');
const { safeFetch } = require('../impitClient');
const { BASE_URL } = require('../config');
const cheerio = require('cheerio');

/**
 * SportyHunterProvider — SportyHunter / SportsindX
 *
 * The upstream was rebuilt: it is no longer a Next.js app, so the previous
 * __NEXT_DATA__ extraction silently returned zero matches on every sync (the
 * site now serves server-rendered HTML under the "SportsindX" brand). The
 * scraper below targets the current markup.
 *
 * Each fixture is an <a class="match-row"> carrying structured data attributes:
 *   data-title / data-home / data-away / href="/match/<slug>"
 * and a <span class="match-time" data-timestamp="<epoch ms>">.
 *
 * Sport is taken from the page path — the site exposes one page per sport
 * (/football, /cricket, ...), which is more reliable than inferring it.
 */
class SportyHunterProvider extends BaseProvider {
  constructor(opts) {
    super(opts);
    this.name = 'SportyHunter';
    this.baseUrl = 'https://sportyhunter.xyz';

    // Verified live: these paths return 200 with fixtures. Paths not listed here
    // (basketball, tennis, mma, ...) currently 404, so they are not requested.
    this.sportPages = [
      ['/football', 'football'],
      ['/cricket', 'cricket'],
      ['/baseball', 'baseball'],
      ['/hockey', 'hockey'],
      ['/rugby', 'rugby'],
      ['/american-football', 'american_football'],
      ['/other', 'other']
    ];

    this.fetchData = this.circuitBreaker.wrap(`${this.name}_fetch`, async (path) => {
      const res = await this.proxyFetch(this.baseUrl + path, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(15000)
      });
      // A 404 just means that sport page does not exist; it must not count as a
      // breaker failure, otherwise one missing page would trip the provider.
      if (res.status === 404) return '';
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    });
  }

  /** Parse one sport page into MatchEntity objects. */
  _parsePage(html, category) {
    const out = [];
    if (!html) return out;
    let $;
    try { $ = cheerio.load(html); } catch (e) { return out; }

    $('.match-row').each((_, el) => {
      try {
        const $el = $(el);
        const href = $el.attr('href') || '';
        if (!href.startsWith('/match/')) return;

        const title = ($el.attr('data-title') || $el.text() || '').replace(/\s+/g, ' ').trim();
        if (!title) return;

        const home = $el.attr('data-home') || ($el.find('.team-name').eq(0).text() || '').trim();
        const away = $el.attr('data-away') || ($el.find('.team-name').eq(1).text() || '').trim();

        // Only real fixtures are wanted. The sport pages also list NAMED CHANNELS
        // (Willow, Fox Cricket, Fox League, NFL Network) which carry no second
        // team and a synthetic shared timestamp. Treating those as fixtures put
        // them at the top of "Live Now" ahead of genuine matches, so require two
        // distinct team names before accepting a row.
        if (!home || !away || home === away) return;

        const $time = $el.find('.match-time').first();
        const rawTs = $time.attr('data-timestamp');
        const ts = rawTs ? Number(rawTs) : NaN;
        const kickoff = Number.isFinite(ts) && ts > 0 ? ts : null;

        const live = !$el.find('.match-live-tag').attr('hidden');

        out.push(new MatchEntity({
          id: `sporty_${href.replace('/match/', '')}`,
          title,
          category,
          timestamp: kickoff,
          date: kickoff ? String(kickoff) : null,
          status: live ? 'live' : 'upcoming',
          popular: '0',
          team1: home ? { name: home } : null,
          team2: away ? { name: away } : null,
          sources: [{ source: 'sportyhunter', id: href, url: this.baseUrl + href }]
        }));
      } catch (_) {
        // One malformed row must not discard the whole page.
      }
    });
    return out;
  }

  async getMatches() {
    const matches = [];
    const seen = new Set();

    // Sequential: keeps memory flat and avoids hammering the origin with 7
    // parallel page loads every sync.
    for (const [path, category] of this.sportPages) {
      try {
        const html = await this.fetchData.fire(path);
        for (const m of this._parsePage(html, category)) {
          if (seen.has(m.id)) continue;   // a fixture can appear on several pages
          seen.add(m.id);
          matches.push(m);
        }
      } catch (err) {
        console.error(`[${this.name}] ${path} failed:`, err.message);
      }
    }

    if (matches.length === 0) {
      console.warn(`[${this.name}] No fixtures parsed from ${this.sportPages.length} sport pages.`);
    }
    return matches;
  }

  async resolveStream(sourceId, matchCategory, matchTitle) {
    // Fixtures are server-rendered pages whose player is an iframe; the addon
    // cannot extract a direct m3u8 reliably, so surface the web player.
    const path = String(sourceId || '').startsWith('/match/')
      ? sourceId
      : (String(sourceId || '').startsWith('sporty_') ? '/match/' + String(sourceId).slice(7) : `/match/${sourceId}`);

    const watchUrl = `${this.baseUrl}${path}`;
    return [new StreamEntity({
      name: 'Nuvio Web Player',
      title: `SportyHunter (Web)`,
      externalUrl: `${BASE_URL}/watch?url=${encodeURIComponent(watchUrl)}&title=${encodeURIComponent(matchTitle || 'Live Event')}`
    })];
  }
}

module.exports = SportyHunterProvider;
