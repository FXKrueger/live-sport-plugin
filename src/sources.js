/**
 * sources.js — Single source of truth for every stream provider the addon knows.
 *
 * Used by:
 *   - streams.js        (priority ordering, enabled-source filtering, labels)
 *   - index.js          (/api/sources for the configure UI)
 *   - manifest.js       (config field defaults)
 *
 * `kind` tells the user what to expect:
 *   direct  - resolves to an HLS (.m3u8) stream that plays inside Nuvio/Stremio
 *   mixed   - usually direct, sometimes falls back to a browser page
 *   web     - opens in the system browser (no native playback)
 */

const SOURCES = [
  { id: 'streamedpk',     label: 'Streamed',        icon: '🏟️', kind: 'direct', priority: 1,  defaultEnabled: true,  homepage: 'https://streamed.pk',       description: 'Largest aggregator. Native WASM decryption gives direct HLS streams for most events.' },
  { id: 'streamfree',     label: 'StreamFree',      icon: '⚡', kind: 'direct', priority: 2,  defaultEnabled: true,  homepage: 'https://streamfree.top',    description: 'Fast CDN streams up to 1080p/2160p with team logos and league data.' },
  { id: 'ppv',            label: 'PPV.ST',          icon: '🎟️', kind: 'direct', priority: 3,  defaultEnabled: true,  homepage: 'https://ppv.st',            description: 'Live events, US sports and 24/7 channels. Direct HLS via native extraction.' },
  { id: 'sportsindx',     label: 'SportsindX',      icon: '📡', kind: 'mixed',  priority: 4,  defaultEnabled: true,  homepage: 'https://sportsindx.st',     description: 'Multi-source schedule (also known as WatchSports). Direct where the upstream supports it.' },
  { id: 'watchfooty',     label: 'WatchFooty',      icon: '⚽', kind: 'direct', priority: 5,  defaultEnabled: true,  homepage: 'https://watchfooty.st',     description: '13+ sports with posters. Direct HLS through native SportsEmbed decryption.' },
  { id: 'ntv',            label: 'NTV',             icon: '📺', kind: 'direct', priority: 6,  defaultEnabled: true,  homepage: 'https://ntvs.cx',           description: 'Streamed mirror with posters. Keeps the catalog alive when streamed.pk is blocked.' },
  { id: 'timstreams',     label: 'TimStreams',      icon: '🎯', kind: 'mixed',  priority: 7,  defaultEnabled: true,  homepage: 'https://timstreams.st',     description: 'Live events plus replays. Native de-obfuscation gives direct HLS on most streams.' },
  { id: 'streamsports99', label: 'StreamSports99',  icon: '🏈', kind: 'mixed',  priority: 8,  defaultEnabled: true,  homepage: 'https://streamsports99.ru', description: 'VIP feed with all categories. Direct when the channel page can be decoded.' },
  { id: 'cdnlive',        label: 'CDNLiveTV',       icon: '🌐', kind: 'mixed',  priority: 9,  defaultEnabled: true,  homepage: 'https://cdnlivetv.tv',      description: 'Football-focused. Direct when the channel page can be decoded.' },
  { id: 'streamic',       label: 'Streamic',        icon: '🌍', kind: 'web',    priority: 10, defaultEnabled: false, homepage: 'https://streamic.st',       description: 'Multi-language embeds. Opens in the browser.' },
  { id: 'sportyhunter',   label: 'SportyHunter',    icon: '🔎', kind: 'web',    priority: 11, defaultEnabled: false, homepage: 'https://sportyhunter.xyz',  description: 'Browser-only player pages.' },
];

const BY_ID = Object.fromEntries(SOURCES.map(s => [s.id, s]));

// Internal helper providers that never appear in the UI but can emit streams
// on behalf of a user-facing source (WatchFooty -> EmbedIndia, PPV -> EmbedIndia).
const INTERNAL_SOURCE_IDS = ['embedst', 'embedindia', 'iptv-org'];

const ALL_SOURCE_IDS = SOURCES.map(s => s.id);
const DEFAULT_SOURCE_IDS = SOURCES.filter(s => s.defaultEnabled).map(s => s.id);

/**
 * Resolve the list of enabled user-facing source ids for a decoded config.
 *  - no config / no `sources` key  -> defaults
 *  - `sources: 'all'`               -> everything
 *  - `sources: 'none'`              -> nothing
 *  - `sources: 'a,b,c'`             -> those (unknown ids ignored)
 */
function enabledSourceIds(config) {
  if (!config || typeof config.sources !== 'string' || config.sources.trim() === '') return DEFAULT_SOURCE_IDS;
  const raw = config.sources.trim().toLowerCase();
  if (raw === 'all') return ALL_SOURCE_IDS;
  if (raw === 'none') return [];
  return raw.split(',').map(s => s.trim()).filter(id => BY_ID[id]);
}

function priorityOf(sourceId) {
  const s = BY_ID[sourceId];
  if (s) return s.priority;
  if (sourceId && sourceId.startsWith('yaml_')) return 50;
  return 40;
}

function labelOf(sourceId) {
  const s = BY_ID[sourceId];
  if (s) return s.label;
  if (sourceId === 'embedst') return 'Streamed';
  if (sourceId === 'embedindia') return 'EmbedIndia';
  if (sourceId === 'iptv-org') return 'Direct IPTV';
  if (sourceId && sourceId.startsWith('yaml_')) return sourceId.slice(5);
  return sourceId || 'Unknown';
}

module.exports = { SOURCES, BY_ID, ALL_SOURCE_IDS, DEFAULT_SOURCE_IDS, INTERNAL_SOURCE_IDS, enabledSourceIds, priorityOf, labelOf };
