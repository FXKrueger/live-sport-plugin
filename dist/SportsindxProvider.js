/**
 * SportsindxProvider.js — sportsindx.st / watchsports.st schedule scraper.
 *
 * Home page:  <details data-category="football"> ... <a class="match-row"
 *             href="/match/slug" data-title data-home data-away>
 *             <span class="match-time" data-timestamp data-ends>
 * Match page: <button class="match-row" data-sources="[...json...]">
 *             entries are either Streamed backends {source,id} (decrypted
 *             natively via embed.st) or third-party {embedUrl} iframes.
 */

const cheerio = require('cheerio');
const BaseProvider = require('./BaseProvider');
const MatchEntity = require('../domain/MatchEntity');
const StreamEntity = require('../domain/StreamEntity');

const MIRRORS = ['https://sportsindx.st', 'https://watchsports.st'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

class SportsindxProvider extends BaseProvider {
  constructor(opts) {
    super(opts);
    this.name = 'SportsindX';
    this.embedStProvider = opts.embedStProvider;
    this.embedIndiaProvider = opts.embedIndiaProvider;
    this.embedResolver = opts.embedResolver;
    this.baseUrl = MIRRORS[0];

    this.fetchHome = this.circuitBreaker.wrap(`${this.name}_fetchHome`, async () => {
      let lastErr;
      for (const base of MIRRORS) {
        try {
          const res = await this.proxyFetch(base + '/', { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, signal: AbortSignal.timeout(15000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const html = await res.text();
          if (!html.includes('match-row')) throw new Error('unexpected markup');
          this.baseUrl = base;
          return html;
        } catch (err) { lastErr = err; }
      }
      throw lastErr || new Error('all mirrors failed');
    });

    this.fetchMatchPage = this.circuitBreaker.wrap(`${this.name}_fetchMatch`, async (slug) => {
      const res = await this.proxyFetch(`${this.baseUrl}/match/${slug}`, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Referer': this.baseUrl + '/' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    });
  }

  mapCategory(cat) {
    const c = String(cat || '').toLowerCase();
    if (c === 'tv-channels') return 'networks';
    if (c === 'popular') return null; // duplicates of other sections
    if (c === 'fight') return 'mma';
    if (c === 'afl') return 'other';
    return this.normalizeCategory(c);
  }

  async getMatches() {
    const matches = [];
    try {
      const html = await this.fetchHome.fire();
      if (!html) return matches;
      const $ = cheerio.load(html);
      const now = Date.now();
      const seen = new Set();

      $('details.category-card').each((_, card) => {
        const category = this.mapCategory($(card).attr('data-category'));
        if (!category) return;

        $(card).find('a.match-row').each((__, a) => {
          const href = $(a).attr('href') || '';
          const slug = href.replace(/^\/match\//, '').trim();
          const title = ($(a).attr('data-title') || '').trim();
          if (!slug || !title || seen.has(slug)) return;
          seen.add(slug);

          const timeEl = $(a).find('.match-time');
          const ts = Number(timeEl.attr('data-timestamp')) || 0;
          const ends = Number(timeEl.attr('data-ends')) || 0;
          const liveTag = $(a).find('.match-live-tag');
          const explicitLive = liveTag.length > 0 && liveTag.attr('hidden') === undefined;
          const is247 = category === 'networks' || ts <= 0;

          if (!is247 && ends && ends + 60 * 60 * 1000 < now) return; // finished

          const home = ($(a).attr('data-home') || '').trim();
          const away = ($(a).attr('data-away') || '').trim();

          matches.push(new MatchEntity({
            id: `sx_${slug}`,
            title,
            category,
            status: is247 ? '' : (explicitLive ? 'live' : (ts > now ? 'upcoming' : '')),
            date: is247 ? '' : String(ts),
            popular: '0',
            team1: home ? { name: home } : null,
            team2: away ? { name: away } : null,
            sources: [{ source: 'sportsindx', id: slug }]
          }));
        });
      });
    } catch (err) {
      console.error(`[${this.name}] Failed to get matches:`, err.message);
    }
    return matches;
  }

  parseSources(html) {
    try {
      const $ = cheerio.load(html);
      const raw = $('button.match-row[data-sources]').first().attr('data-sources');
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }

  async resolveStream(sourceId, matchCategory, matchTitle) {
    const streams = [];
    try {
      const html = await this.fetchMatchPage.fire(sourceId);
      if (!html) return streams;
      const entries = this.parseSources(html);

      // Streamed backends first (native decryption, most reliable)
      const backends = entries.filter(e => e && e.source && e.id);
      const embeds = entries.filter(e => e && typeof e.embedUrl === 'string' && e.embedUrl.startsWith('http'));

      const tasks = [];
      for (const b of backends.slice(0, 4)) {
        if (!this.embedStProvider) break;
        const embedUrl = `https://embed.st/embed/${encodeURIComponent(b.source)}/${encodeURIComponent(b.id)}/1`;
        tasks.push(
          this.embedStProvider.resolveStream(embedUrl, matchCategory, matchTitle, { embedUrl, referer: 'https://embed.st/' })
            .then(list => list.filter(s => s.url).map(s => { s.name = 'SportsindX'; s.title = 'SportsindX'; return s; }))
            .catch(() => [])
        );
      }
      for (const e of embeds.slice(0, 4)) {
        const label = e.name || e.provider || 'Embed';
        const lang = e.language || e.lang || '';
        const title = `SportsindX (${label}${lang ? ' ' + lang : ''})`;
        tasks.push((async () => {
          const out = [];
          let host = '';
          try { host = new URL(e.embedUrl).hostname; } catch (_) { return out; }
          if (/embedindia|embedsport\.xyz/.test(host) && this.embedIndiaProvider) {
            const list = await this.embedIndiaProvider.resolveStream(e.embedUrl, matchCategory, title, { embedUrl: e.embedUrl, referer: new URL(e.embedUrl).origin + '/' });
            for (const s of list) { s.name = 'SportsindX'; if (s.url) s.title = title; out.push(s); }
            return out;
          }
          if (this.embedResolver) {
            const resolved = await this.embedResolver.resolve(e.embedUrl, { referer: this.baseUrl + '/', title: matchTitle });
            if (resolved) {
              const EmbedResolver = require('../services/EmbedResolver');
              out.push(new StreamEntity({ name: 'SportsindX', title, url: EmbedResolver.proxyUrl(resolved), behaviorHints: { notWebReady: true }, resolution: 'HD' }));
              return out;
            }
          }
          out.push(new StreamEntity({
            name: 'SportsindX',
            title: `${title} (Web Player)`,
            externalUrl: `/watch?url=${encodeURIComponent(e.embedUrl)}&title=${encodeURIComponent(matchTitle || 'Live Event')}`
          }));
          return out;
        })().catch(() => []));
      }

      const results = await Promise.allSettled(tasks);
      for (const r of results) if (r.status === 'fulfilled') streams.push(...r.value);
    } catch (err) {
      console.error(`[${this.name}] resolveStream failed for ${sourceId}:`, err.message);
    }
    return streams;
  }
}

module.exports = SportsindxProvider;
