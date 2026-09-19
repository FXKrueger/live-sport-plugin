/**
 * NtvProvider.js — ntvs.cx (NTV) schedule.
 *
 * NTV exposes a Streamed-compatible catalog with posters at
 *   https://ntvs.cx/api/get-matches?server=kobra&type=both
 * Sources are the familiar admin/echo/delta/golf Streamed backends, which
 * this addon already decrypts natively through embed.st (EmbedStProvider).
 *
 * Value: keeps the catalog and direct streams working when streamed.pk's own
 * API is rate-limited or blocked from the hosting region.
 */

const BaseProvider = require('./BaseProvider');
const MatchEntity = require('../domain/MatchEntity');

const SITE = 'https://ntvs.cx';
const API = `${SITE}/api/get-matches?server=kobra&type=both`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

class NtvProvider extends BaseProvider {
  constructor(opts) {
    super(opts);
    this.name = 'NTV';
    this.embedStProvider = opts.embedStProvider;

    this.fetchList = this.circuitBreaker.wrap(`${this.name}_fetchList`, async () => {
      const res = await this.proxyFetch(API, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': SITE + '/' },
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !data.success || !Array.isArray(data.all)) throw new Error('unexpected payload');
      return data;
    });
  }

  async getMatches() {
    const matches = [];
    try {
      const data = await this.fetchList.fire();
      if (!data) return matches;
      const now = Date.now();

      for (const item of data.all) {
        if (!item.id || !item.title) continue;
        const kickoff = Number(item.date) || 0;
        const is247 = kickoff <= 0;
        // NTV lists finished fixtures for a while; drop anything older than 6h.
        if (!is247 && kickoff + 6 * 60 * 60 * 1000 < now && !item.live) continue;

        const sources = (item.sources || [])
          .filter(s => s && s.source && s.id)
          .map(s => ({ source: 'ntv', id: item.id, streamSource: s.source, streamId: s.id }));
        if (sources.length === 0) continue;

        const poster = item.poster ? (item.poster.startsWith('http') ? item.poster : `${SITE}${item.poster}`) : '';
        const badge = (b) => b ? `https://streamed.pk/api/images/badge/${b}.webp` : null;

        matches.push(new MatchEntity({
          id: `ntv_${item.id}`,
          title: item.title,
          category: this.normalizeCategory(item.category),
          status: is247 ? '' : (item.live ? 'live' : (kickoff > now ? 'upcoming' : '')),
          date: is247 ? '' : String(kickoff),
          popular: item.popular ? '1' : '0',
          poster,
          background: poster,
          team1: item.teams && item.teams.home ? { name: item.teams.home.name, logo: badge(item.teams.home.badge) } : null,
          team2: item.teams && item.teams.away ? { name: item.teams.away.name, logo: badge(item.teams.away.badge) } : null,
          sources
        }));
      }
    } catch (err) {
      console.error(`[${this.name}] Failed to get matches:`, err.message);
    }
    return matches;
  }

  async resolveStream(sourceId, matchCategory, matchTitle, src = {}) {
    if (!this.embedStProvider || !src.streamSource || !src.streamId) return [];
    const embedUrl = `https://embed.st/embed/${encodeURIComponent(src.streamSource)}/${encodeURIComponent(src.streamId)}/1`;
    try {
      const streams = await this.embedStProvider.resolveStream(embedUrl, matchCategory, matchTitle, { embedUrl, referer: 'https://embed.st/' });
      for (const s of streams) {
        s.name = 'NTV';
        s.title = 'NTV';
      }
      return streams;
    } catch (err) {
      console.error(`[${this.name}] resolveStream failed for ${sourceId}:`, err.message);
      return [];
    }
  }
}

module.exports = NtvProvider;
