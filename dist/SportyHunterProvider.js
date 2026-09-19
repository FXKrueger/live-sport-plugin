const { request } = require('undici');
const cheerio = require('cheerio');
const BaseProvider = require('./BaseProvider');
const MatchEntity = require('../domain/MatchEntity');
const StreamEntity = require('../domain/StreamEntity');

class SportyHunterProvider extends BaseProvider {
  constructor(opts) {
    super(opts);
    this.name = 'SportyHunter';
    this.embedResolver = opts.embedResolver;
    this.baseUrl = 'https://sportyhunter.xyz';
    
    this.fetchData = this.circuitBreaker.wrap(`${this.name}_fetch`, async () => {
      const res = await this.proxyFetch(this.baseUrl, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    });
  }

  async getMatches() {
    const matches = [];
    try {
      const html = await this.fetchData.fire();
      if (!html) return [];

      const $ = cheerio.load(html);
      
      // Next.js injects page data into a script tag
      const nextDataJson = $('#__NEXT_DATA__').html();
      if (nextDataJson) {
        const nextData = JSON.parse(nextDataJson);
        const pageProps = nextData?.props?.pageProps || {};
        const matchesData = pageProps?.matches || [];
        
        matchesData.forEach((m, index) => {
          matches.push(new MatchEntity({
            id: `sporty_${m.id || index}`,
            title: m.title || m.name || `Sporty Match ${index}`,
            category: this.normalizeCategory(m.sport),
            date: m.timestamp || m.date || null,
            popular: '0',
            sources: [{ source: 'sportyhunter', id: m.id || index, url: m.url || m.streamUrl }]
          }));
        });
      } else {
        // Fallback: If they moved away from pages router to app router, __NEXT_DATA__ won't exist.
        // We just return empty array gracefully.
      }
      
    } catch (error) {
      console.error(`[${this.name}] Error fetching matches:`, error.message);
    }
    return matches;
  }

  async resolveStream(sourceId, matchCategory, matchTitle, src = {}) {
    const pageUrl = (src && src.url && String(src.url).startsWith('http')) ? src.url : `${this.baseUrl}/match/${sourceId}`;
    if (this.embedResolver) {
      const EmbedResolver = require('../services/EmbedResolver');
      const resolved = await this.embedResolver.resolve(pageUrl, { referer: this.baseUrl + '/', title: matchTitle }).catch(() => null);
      if (resolved) {
        return [new StreamEntity({ name: 'SportyHunter', title: 'SportyHunter', url: EmbedResolver.proxyUrl(resolved), behaviorHints: { notWebReady: true }, resolution: 'HD' })];
      }
    }
    return [new StreamEntity({
      name: 'SportyHunter',
      title: 'SportyHunter (Web Player)',
      externalUrl: pageUrl
    })];
  }
}

module.exports = SportyHunterProvider;
