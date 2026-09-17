/**
 * ChannelLogoService.js
 *
 * Single source of truth for 24/7 sports channel -> logo mapping.
 * Uses high-speed jsDelivr Cloudflare CDN backed by the curated tv-logo repository.
 * Completely replaces broken Wikimedia thumbnail URLs (which return 400 Bad Request).
 *
 * Matching: exact normalized key first, then aliases, then longest substring wins.
 */

const CDN_BASE = 'https://cdn.jsdelivr.net/gh/tv-logo/tv-logos@main';

const CHANNEL_LOGOS = {
  // --- F1 & Motorsport ---
  "sky sports f1": `${CDN_BASE}/countries/united-kingdom/sky-sports-f1-uk.png`,
  "f1 tv": `${CDN_BASE}/countries/united-kingdom/sky-sports-f1-uk.png`,
  "formula 1": `${CDN_BASE}/countries/united-kingdom/sky-sports-f1-uk.png`,
  "rally tv": `${CDN_BASE}/countries/international/wrc-plus.png`,
  "motogp": `${CDN_BASE}/countries/international/motogp.png`,

  // --- Baseball (MLB) ---
  "mlb strike zone": `${CDN_BASE}/countries/united-states/mlb-network-strike-zone-us.png`,
  "mlb strikezone": `${CDN_BASE}/countries/united-states/mlb-network-strike-zone-us.png`,
  "mlb network": `${CDN_BASE}/countries/united-states/mlb-network-us.png`,

  // --- American Football (NFL) ---
  "nfl redzone": `${CDN_BASE}/countries/united-states/nfl-red-zone-us.png`,
  "nfl red zone": `${CDN_BASE}/countries/united-states/nfl-red-zone-us.png`,
  "redzone": `${CDN_BASE}/countries/united-states/nfl-red-zone-us.png`,
  "nfl network": `${CDN_BASE}/countries/united-states/nfl-network-us.png`,

  // --- Basketball (NBA) ---
  "nba tv": `${CDN_BASE}/countries/united-states/nba-tv-us.png`,

  // --- Hockey (NHL) ---
  "nhl network": `${CDN_BASE}/countries/united-states/nhl-network-us.png`,

  // --- Tennis ---
  "tennis channel": `${CDN_BASE}/countries/united-states/tennis-channel-us.png`,

  // --- Cricket ---
  "willow cricket": `${CDN_BASE}/countries/united-states/willow-us.png`,
  "willow": `${CDN_BASE}/countries/united-states/willow-us.png`,
  "fox cricket": `${CDN_BASE}/countries/australia/fox-sports-cricket-501-au.png`,
  "sky sports cricket": `${CDN_BASE}/countries/united-kingdom/sky-sports-cricket-uk.png`,
  "astro cricket": `${CDN_BASE}/countries/malaysia/astro-cricket-my.png`,

  // --- Sky Sports Suite (UK) ---
  "sky sports main event": `${CDN_BASE}/countries/united-kingdom/sky-sports-main-event-uk.png`,
  "sky sports premier league": `${CDN_BASE}/countries/united-kingdom/sky-sports-premier-league-uk.png`,
  "sky sports football": `${CDN_BASE}/countries/united-kingdom/sky-sports-football-uk.png`,
  "sky sports action": `${CDN_BASE}/countries/united-kingdom/sky-sports-action-uk.png`,
  "sky sports arena": `${CDN_BASE}/countries/united-kingdom/sky-sports-arena-uk.png`,
  "sky sports golf": `${CDN_BASE}/countries/united-kingdom/sky-sports-golf-uk.png`,
  "sky sports racing": `${CDN_BASE}/countries/united-kingdom/sky-sports-racing-uk.png`,
  "sky sports tennis": `${CDN_BASE}/countries/united-kingdom/sky-sports-tennis-uk.png`,
  "sky sports news": `${CDN_BASE}/countries/united-kingdom/sky-sports-news-uk.png`,
  "sky sports": `${CDN_BASE}/countries/united-kingdom/sky-sports-hz-uk.png`,

  // --- TNT Sports Suite (UK) ---
  "tnt sports 1": `${CDN_BASE}/countries/united-kingdom/tnt-sports-1-uk.png`,
  "tnt sports 2": `${CDN_BASE}/countries/united-kingdom/tnt-sports-2-uk.png`,
  "tnt sports 3": `${CDN_BASE}/countries/united-kingdom/tnt-sports-3-uk.png`,
  "tnt sports 4": `${CDN_BASE}/countries/united-kingdom/tnt-sports-4-uk.png`,
  "tnt sports": `${CDN_BASE}/countries/united-kingdom/tnt-sports-1-uk.png`,

  // --- Eurosport ---
  "eurosport 1": `${CDN_BASE}/countries/united-kingdom/eurosport-1-uk.png`,
  "eurosport 2": `${CDN_BASE}/countries/united-kingdom/eurosport-2-uk.png`,
  "eurosport": `${CDN_BASE}/countries/united-kingdom/eurosport-1-uk.png`,

  // --- ESPN Suite (US) ---
  "espn 2": `${CDN_BASE}/countries/united-states/espn-2-us.png`,
  "espn 3": `${CDN_BASE}/countries/united-states/espn-3-us.png`,
  "espnu": `${CDN_BASE}/countries/united-states/espn-u-us.png`,
  "espnews": `${CDN_BASE}/countries/united-states/espnews-us.png`,
  "espn deportes": `${CDN_BASE}/countries/united-states/espn-deportes-us.png`,
  "espn": `${CDN_BASE}/countries/united-states/espn-us.png`,

  // --- Fox Sports Suite (US & Australia) ---
  "fox sports 1": `${CDN_BASE}/countries/united-states/fox-sports-1-us.png`,
  "fox sports 2": `${CDN_BASE}/countries/united-states/fox-sports-2-us.png`,
  "fs1": `${CDN_BASE}/countries/united-states/fox-sports-1-us.png`,
  "fs2": `${CDN_BASE}/countries/united-states/fox-sports-2-us.png`,
  "fox deportes": `${CDN_BASE}/countries/united-states/fox-sports-deportes-us.png`,
  "fox league": `${CDN_BASE}/countries/australia/fox-sports-league-502-au.png`,
  "fox footy": `${CDN_BASE}/countries/australia/fox-footy-504-au.png`,
  "fox sports": `${CDN_BASE}/countries/united-states/fox-sports-us.png`,

  // --- CBS & NBC Sports ---
  "cbs sports network": `${CDN_BASE}/countries/united-states/cbs-sports-network-us.png`,
  "cbs sports golazo network": `${CDN_BASE}/countries/united-states/cbs-sports-golazo-network-us.png`,
  "cbs sports golazo": `${CDN_BASE}/countries/united-states/cbs-sports-golazo-network-us.png`,
  "golazo": `${CDN_BASE}/countries/united-states/cbs-sports-golazo-network-us.png`,
  "cbs sports": `${CDN_BASE}/countries/united-states/cbs-sports-network-us.png`,
  "nbc sports bay area": `${CDN_BASE}/countries/united-states/nbcsn-bay-area-us.png`,
  "nbc sports": `${CDN_BASE}/countries/united-states/nbc-sports-us.png`,

  // --- beIN Sports ---
  "bein sports usa": `${CDN_BASE}/countries/united-states/bein-sports-us.png`,
  "bein sports xtra": `${CDN_BASE}/countries/united-states/bein-sports-xtra-us.png`,
  "bein sports": `${CDN_BASE}/countries/france/bein-sports-fr.png`,

  // --- Canadian Networks ---
  "tsn 1": `${CDN_BASE}/countries/canada/tsn-1-ca.png`,
  "tsn 2": `${CDN_BASE}/countries/canada/tsn-2-ca.png`,
  "tsn 3": `${CDN_BASE}/countries/canada/tsn-3-ca.png`,
  "tsn 4": `${CDN_BASE}/countries/canada/tsn-4-ca.png`,
  "tsn 5": `${CDN_BASE}/countries/canada/tsn-5-ca.png`,
  "tsn": `${CDN_BASE}/countries/canada/tsn-ca.png`,
  "sportsnet ontario": `${CDN_BASE}/countries/canada/sportsnet-ontario-ca.png`,
  "sportsnet east": `${CDN_BASE}/countries/canada/sportsnet-east-ca.png`,
  "sportsnet pacific": `${CDN_BASE}/countries/canada/sportsnet-pacific-ca.png`,
  "sportsnet west": `${CDN_BASE}/countries/canada/sportsnet-west-ca.png`,
  "sportsnet one": `${CDN_BASE}/countries/canada/sportsnet-one-ca.png`,
  "sportsnet": `${CDN_BASE}/countries/canada/sportsnet-ca.png`,
  "fight network": `${CDN_BASE}/countries/canada/fight-network-ca.png`,

  // --- International / Regional Sports ---
  "super sport": `${CDN_BASE}/countries/south-africa/supersport-za.png`,
  "supersport grandstand": `${CDN_BASE}/countries/south-africa/supersport-grandstand-za.png`,
  "supersport": `${CDN_BASE}/countries/south-africa/supersport-za.png`,
  "star sports 1": `${CDN_BASE}/countries/india/star-sports-1-in.png`,
  "star sports": `${CDN_BASE}/countries/india/star-sports-1-in.png`,
  "optus sport": `${CDN_BASE}/countries/australia/optus-sport-au.png`,
  "bally sports": `${CDN_BASE}/countries/united-states/bally-sports-us.png`,
  "arena sport": `${CDN_BASE}/countries/croatia/arena-sport-1-hr.png`,
  "astro supersport": `${CDN_BASE}/countries/malaysia/screen-bug/astro-supersport-bug-my.png`,
};

// Aliases for common alternative channel spellings and feed titles
const CHANNEL_ALIASES = {
  "sky f1": "sky sports f1",
  "skysports f1": "sky sports f1",
  "strike zone": "mlb strike zone",
  "strikezone": "mlb strike zone",
  "mlb strike": "mlb strike zone",
  "nfl red zone": "nfl redzone",
  "red zone": "nfl redzone",
  "willow tv": "willow",
  "willow hd": "willow",
  "sky cricket": "sky sports cricket",
  "sky football": "sky sports football",
  "sky premier league": "sky sports premier league",
  "sky main event": "sky sports main event",
  "tnt 1": "tnt sports 1",
  "tnt 2": "tnt sports 2",
};

// Longest keys first so "sky sports cricket" beats "sky sports"
const SORTED_KEYS = Object.entries(CHANNEL_LOGOS).sort((a, b) => b[0].length - a[0].length);

function cleanChannelTitle(raw) {
  if (!raw) return '';
  return String(raw)
    .toLowerCase()
    .replace(/\b(24\/7|live|stream|hd|fhd|4k|uhd|raw|en|us|uk)\b/gi, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getChannelLogo(title) {
  if (!title) return null;
  const rawLower = String(title).toLowerCase().trim();
  const cleaned = cleanChannelTitle(title);

  // 1. Direct exact match
  if (CHANNEL_LOGOS[rawLower]) return CHANNEL_LOGOS[rawLower];
  if (CHANNEL_LOGOS[cleaned]) return CHANNEL_LOGOS[cleaned];

  // 2. Direct alias match
  if (CHANNEL_ALIASES[rawLower] && CHANNEL_LOGOS[CHANNEL_ALIASES[rawLower]]) {
    return CHANNEL_LOGOS[CHANNEL_ALIASES[rawLower]];
  }
  if (CHANNEL_ALIASES[cleaned] && CHANNEL_LOGOS[CHANNEL_ALIASES[cleaned]]) {
    return CHANNEL_LOGOS[CHANNEL_ALIASES[cleaned]];
  }

  // 3. Substring match against cleaned and raw titles (longest key wins)
  for (const [key, logoUrl] of SORTED_KEYS) {
    if (cleaned.includes(key) || rawLower.includes(key)) {
      return logoUrl;
    }
  }

  return null;
}

module.exports = {
  getChannelLogo,
  CHANNEL_LOGOS,
  CDN_BASE
};
