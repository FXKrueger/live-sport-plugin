const cron = require('node-cron');

// Catalog stale-while-revalidate window: once the cache is older than this,
// the next catalog/meta request triggers a background re-sync (see ensureFresh).
const REVALIDATE_AFTER_MS = parseInt(process.env.CATALOG_REVALIDATE_MS, 10) || 3 * 60 * 1000;
// Hard floor: a full re-sync at least this often even with zero traffic.
const SYNC_CRON = process.env.CATALOG_SYNC_CRON || '*/10 * * * *';
// Manual refresh (/api/refresh) is rate limited to protect upstreams.
const FORCE_MIN_INTERVAL_MS = 45 * 1000;

class CronService {
  constructor({ matchAggregator, streamResolveCache, cacheService }) {
    this.matchAggregator = matchAggregator;
    this.streamResolveCache = streamResolveCache;
    this.cacheService = cacheService;
    this.syncing = false;
    this.currentSync = null;
    this.lastSyncAt = 0;
    this.lastForceAt = 0;
    this.syncCount = 0;
    this.startedAt = Date.now();
  }

  async runSync() {
    if (this.syncing) return this.currentSync;
    this.syncing = true;
    this.currentSync = (async () => {
      try {
        const activeMatches = await this.matchAggregator.syncMatches();
        if (activeMatches !== null) {
          this.pruneStreamCache(activeMatches);
          this.lastSyncAt = Date.now();
          this.syncCount++;
        }
      } finally {
        this.syncing = false;
        this.currentSync = null;
      }
    })();
    return this.currentSync;
  }

  /**
   * Manual refresh from the dashboard / API. Rate limited; awaits the sync so
   * the caller can render fresh data right away.
   */
  async forceSync() {
    const now = Date.now();
    if (this.syncing) { await this.currentSync; return { started: false, reason: 'already-syncing' }; }
    const since = now - this.lastForceAt;
    if (since < FORCE_MIN_INTERVAL_MS) return { started: false, reason: 'rate-limited', waitMs: FORCE_MIN_INTERVAL_MS - since };
    this.lastForceAt = now;
    await this.runSync();
    return { started: true };
  }

  status() {
    const report = this.matchAggregator && typeof this.matchAggregator.getReport === 'function' ? this.matchAggregator.getReport() : null;
    return {
      syncing: this.syncing,
      lastSyncAt: this.lastSyncAt || null,
      ageMs: this.lastSyncAt ? Date.now() - this.lastSyncAt : null,
      syncCount: this.syncCount,
      uptimeMs: Date.now() - this.startedAt,
      revalidateAfterMs: REVALIDATE_AFTER_MS,
      syncCron: SYNC_CRON,
      report
    };
  }

  // Catalog stale-while-revalidate: serve the cached list immediately and
  // refresh in the background once the cache passes REVALIDATE_AFTER_MS.
  // Traffic-driven, so idle instances stay quiet; the 4-hour cron is the floor.
  ensureFresh() {
    try {
      if (this.syncing) return;
      if (!this.cacheService || !this.cacheService.isStale(REVALIDATE_AFTER_MS)) return;
      console.log('[CronService] Catalog stale, triggering background re-sync (SWR)...');
      this.runSync().catch((err) => console.error('[CronService] SWR sync failed:', err.message));
    } catch (err) {
      console.error('[CronService] ensureFresh error:', err.message);
    }
  }

  start() {
    console.log('[CronService] Starting background jobs...');
    
    // Full re-sync on a fixed cadence (default every 10 minutes)
    cron.schedule(SYNC_CRON, async () => {
      console.log('[CronService] Running match sync job...');
      try {
        await this.runSync();
      } catch (err) {
        console.error('[CronService] Match sync failed:', err.message);
      }
    });

    // Prewarm popular live matches - disabled for local home/tunnel hosting
    // to prevent hammering upstream streaming sites and keep network silent.
    // cron.schedule('*/3 * * * *', async () => {
    //   try {
    //     await this.prewarmPopular();
    //   } catch (err) {
    //     console.error('[CronService] Prewarm job failed:', err.message);
    //   }
    // });

    // Run first sync immediately on boot
    const externalUrl = process.env.RENDER_EXTERNAL_URL;
    if (externalUrl) {
      console.log(`[CronService] Keep-alive enabled for ${externalUrl}`);
      cron.schedule('*/14 * * * *', async () => {
        try {
          console.log(`[CronService] Pinging external URL to prevent sleep...`);
          const { request } = require('undici');
          await request(`${externalUrl}/health`);
        } catch (err) {
          console.error('[CronService] Keep-alive ping failed:', err.message);
        }
      });
    }

    // Run first sync immediately on boot
    setTimeout(async () => {
      try {
        console.log('[CronService] Running initial match sync...');
        await this.runSync();
      } catch(e) {
        console.error('[CronService] Match sync failed:', e.message);
      }
    }, 1000);
  }

  /** Drop stream-cache entries for matches that are no longer active. */
  pruneStreamCache(activeMatches) {
    try {
      if (!this.streamResolveCache) return;
      const ids = new Set((activeMatches || []).map(m => m && m.id).filter(Boolean));
      this.streamResolveCache.pruneEnded(ids);
    } catch (_) {}
  }

  /** Prewarm popular live matches so hot streams are "already running" when clicked. */
  async prewarmPopular() {
    try {
      // Lazy requires avoid a require cycle (catalog -> streams -> container -> this).
      const { isMatchLive } = require('../catalog');
      const { prewarmMatch } = require('../streams');
      const matches = this.cacheService ? this.cacheService.getMatches() : [];
      const hot = matches.filter(m => m.popular === '1' && isMatchLive(m));
      if (hot.length === 0) return;
      console.log(`[CronService] Prewarming ${Math.min(hot.length, 10)} popular live matches...`);
      await Promise.allSettled(hot.slice(0, 10).map(m => prewarmMatch(m, null)));
    } catch (err) {
      console.error('[CronService] Prewarm failed:', err.message);
    }
  }

}

module.exports = CronService;
