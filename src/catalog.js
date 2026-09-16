const container = require('./container');
const { getChannelLogo } = require('./services/ChannelLogoService');
const { prewarmMatch } = require('./streams');
const { BASE_URL } = require('./config');
const imageService = require('./services/ImageService');

function getKickoff(d) {
  if (!d) return 0;
  const n = Number(d);
  if (!isNaN(n)) return n;
  const time = new Date(d).getTime();
  return isNaN(time) ? 0 : time;
}

// How long an event can plausibly still be running after kickoff. Providers
// cache match status at fetch time, so status flags alone cannot tell us
// whether a fixture has finished; elapsed time against these windows can.
const SPORT_MAX_DURATION_MS = {
  cricket: 8 * 60 * 60 * 1000,
  mma: 6 * 60 * 60 * 1000,
  fighting: 6 * 60 * 60 * 1000,
  boxing: 5 * 60 * 60 * 1000,
  motorsport: 4 * 60 * 60 * 1000,
  american_football: 4 * 60 * 60 * 1000,
  baseball: 3.5 * 60 * 60 * 1000,
  basketball: 3 * 60 * 60 * 1000,
  tennis: 4 * 60 * 60 * 1000,
  golf: 6 * 60 * 60 * 1000,
  football: 2.5 * 60 * 60 * 1000,
  rugby: 2.5 * 60 * 60 * 1000,
  hockey: 3 * 60 * 60 * 1000,
  darts: 4 * 60 * 60 * 1000
};
const LIVE_LEAD_MS = 15 * 60 * 1000;
const DEFAULT_EVENT_DURATION_MS = 3 * 60 * 60 * 1000;

function getEventDurationMs(category) {
  return SPORT_MAX_DURATION_MS[category] || DEFAULT_EVENT_DURATION_MS;
}


/**
 * Accurately determines if an event is currently live right now.
 * 24/7 networks are always live.
 * Fixtures with a kickoff time are live starting 15 minutes before kickoff
 * up to the sport-specific max game duration.
 */
function isMatchLive(match) {
  if (!match) return false;
  if (match.category === 'networks') return true;

  // 1. Explicit finished / postponed / cancelled statuses are never live
  if (match.status === 'finished' || match.status === 'ended' || match.status === 'postponed' || match.status === 'cancelled') {
    return false;
  }

  // 2. Explicit live status from provider
  if (match.status === 'live' || match.status === 'in' || match.status === 'in_progress') {
    // The cached status flag goes stale: providers keep reporting 'live' after a
    // match has ended, so it cannot be trusted indefinitely. Previously the only
    // guard was a flat 12-hour window, which meant a ~2-hour football match kept
    // appearing as LIVE for up to 12 hours after the final whistle.
    // Bound it by the event's own plausible duration instead.
    if (match.date) {
        const kickoff = getKickoff(match.date);
        if (kickoff > 0) {
            const maxDuration = getEventDurationMs(match.category);
            const grace = 30 * 60 * 1000; // stoppage time / extra time / penalties
            if (Date.now() > kickoff + maxDuration + grace) return false;
        }
    }
    return true;
  }

  // 3. 'pre' means the provider says the match has NOT kicked off. WatchFooty
  //    refreshes this every sync and it is reliable, so it is trusted over the
  //    clock. This is what previously caused delayed fixtures (e.g. "Al Nahda vs
  //    Al Taawoun") to appear LIVE once their nominal kickoff time passed.
  // A stale cached flag must not hide a match that is genuinely under way: if
  // kickoff passed well before the last sync could refresh this, trust the clock.
  const PRE_STALE_MS = 20 * 60 * 1000;
  if (match.status === 'pre') {
    const ko = match.date ? getKickoff(match.date) : 0;
    if (ko > 0 && Date.now() > ko + PRE_STALE_MS) {
      // fall through: the flag is stale, let the time-based branch decide
    } else {
      return false; // provider says not started, and the flag is fresh
    }
  }

  // 4. 'upcoming' is NOT trustworthy for every provider: StreamSports99 reports
  //    it even for in-progress games. So it only means "not started" while the
  //    kickoff is genuinely still ahead; once kickoff has passed, fall through and
  //    let the clock decide, otherwise real live games would disappear.
  if (match.status === 'upcoming') {
    if (!match.date) return false;
    if (Date.now() < getKickoff(match.date)) return false;
    // kicked off -> fall through to the time-based branch
  }

  if (!match.date) return true;

  // 5. Time-based evaluation.
  const now = Date.now();
  const kickoff = match.date ? getKickoff(match.date) : 0;

  if (kickoff > 0) {
    if (now < kickoff) return false; // not started yet
    const maxDuration = getEventDurationMs(match.category);
    return now <= (kickoff + maxDuration);
  }

  return false;
}

/**
 * Determines whether a match should be presented as a replay (a past event whose
 * coverage is still available) rather than a live or upcoming fixture.
 *
 * Shared by the catalog replay filter and the meta-preview mapper so the two can
 * never drift apart. 24/7 networks are never replays.
 */
function isReplayMatch(match) {
  if (!match) return false;
  if (match.category === 'networks') return false;
  if (match.status === 'postponed' || match.status === 'cancelled') return false;

  const kickoff = match.date ? getKickoff(match.date) : 0;

  // Without a usable kickoff time, only an explicit terminal status qualifies.
  if (kickoff === 0) {
    return match.status === 'finished' || match.status === 'ended';
  }

  // An explicit terminal status is authoritative.
  if (match.status === 'finished' || match.status === 'ended') {
    return kickoff <= Date.now();
  }

  // Otherwise the event is a replay only once its live window has fully passed.
  // Using "is not currently live" alone was the bug: a provider that still
  // reported a match as "upcoming" after kickoff made an in-progress game look
  // like a finished one, so it was filed under replays while carrying only live
  // sources (streamedpk / streamsports99) and no replay feed.
  return Date.now() > kickoff + getEventDurationMs(match.category);
}

function normalizeImageUrl(url, defaultHost = 'https://streamfree.top') {
  if (!url || typeof url !== 'string') return null;
  let u = url.trim();
  if (!u) return null;
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  if (u.startsWith('/')) return `${defaultHost}${u}`;
  return `${defaultHost}/${u}`;
}

function mapMatchToMetaPreview(match, config = {}) {
  const isLive = isMatchLive(match);
  const isReplay = !isLive && isReplayMatch(match);
  const titleStr = match.title || (isLive ? 'Live Match' : 'Upcoming Match');
  const safeTitle = encodeURIComponent(Array.from(titleStr).slice(0, 30).join(''));
  
  // Dynamic Sport-Specific Posters
  const categoryColors = {
    football: '10b981', // green
    basketball: 'f97316', // orange
    motorsport: 'ef4444', // red
    cricket: '0ea5e9', // light blue
    tennis: 'a3e635', // lime
    rugby: '8b5cf6', // purple
    american_football: '0369a1', // dark blue
    baseball: 'f43f5e', // rose
    hockey: '06b6d4', // cyan
    golf: '22c55e', // emerald
    darts: 'eab308', // yellow
    mma: 'dc2626', // crimson red
    networks: '64748b', // slate
    college: 'd946ef' // fuchsia
  };
  const color = categoryColors[match.category] || '333333';
  
  // Channel logos come from the unified ChannelLogoService (tv-logos CDN + Wikimedia).

  // Generate a clean, readable fallback poster using the match title
  let posterText = match.title;
  if (match.team1 && match.team2 && match.team1.name && match.team2.name) {
      posterText = `${match.team1.name}\nvs\n${match.team2.name}`;
  } else if (isReplay) {
      // Replay titles are session titles ("A @ B - League - Full Game Replay -
      // September 14, 2026"), not "X vs Y" fixtures. Split on the first dash so
      // the card leads with the teams instead of the raw upstream title.
      posterText = posterText.replace(/ [-\u2013\u2014] /, '\n-\n');
  } else {
      posterText = posterText.replace(/ vs /i, '\nvs\n').replace(/ - /i, '\n-\n');
  }
  
  if (posterText.length > 50) {
      posterText = match.category.toUpperCase();
  }
  
  // Self-hosted fallback poster (replaces the external placehold.co dependency)
  const fallbackPoster = imageService.placeholderUrl(BASE_URL, posterText, color);

  // Self-hosted image proxy: serves the upstream image from cache and falls
  // back to a generated placeholder when the source is dead, so the client
  // never sees a broken image.
  const buildImg = (sourceUrl, fbText, c) =>
    imageService.proxyUrl(BASE_URL, sourceUrl, { text: fbText, color: c });

  let poster = fallbackPoster;
  const channelLogo = getChannelLogo(match.title);
  const team1Logo = match.team1 && match.team1.logo ? normalizeImageUrl(match.team1.logo) : null;
  const matchPoster = match.poster ? normalizeImageUrl(match.poster) : null;
  const matchThumb = match.thumbnail_url ? normalizeImageUrl(match.thumbnail_url) : null;
  const matchLogo = match.logo ? normalizeImageUrl(match.logo) : null;

  let logo = matchLogo || team1Logo || channelLogo || null;

  if (matchPoster) {
    poster = buildImg(matchPoster, posterText, color) || fallbackPoster;
  } else if (channelLogo) {
    poster = buildImg(channelLogo, match.title, '161616') || fallbackPoster;
    logo = channelLogo;
  } else if (matchThumb) {
    const isLogo = match.category === 'networks' || matchThumb.toLowerCase().includes('logo') || matchThumb.toLowerCase().includes('icon');
    poster = buildImg(matchThumb, posterText, color) || fallbackPoster;
    if (isLogo && !logo) {
      logo = matchThumb;
    }
  } else if (team1Logo) {
    poster = buildImg(team1Logo, posterText, color) || fallbackPoster;
    if (!logo) logo = team1Logo;
  }

  if (logo) {
    logo = buildImg(logo, match.title || 'TV', '161616') || logo;
  }
  
  const matchBackground = match.background ? normalizeImageUrl(match.background) : null;
  let background = matchBackground ? (buildImg(matchBackground, posterText, color) || poster) : poster;

  let timeString = match.category === 'networks' ? '24/7 Stream' : 'Live Now';
  let relativeTimeStr = '';
  let releasedIso = null;
  
  if (match.date && !isNaN(getKickoff(match.date)) && getKickoff(match.date) > 0) {
     const dateObj = new Date(getKickoff(match.date));
     releasedIso = dateObj.toISOString();
     const options = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }; // 24-hour format (00-23), never AM/PM
     
     if (config && config.timezone) {
       options.timeZone = config.timezone;
     }
     
     timeString = dateObj.toLocaleTimeString('en-US', options) + (options.timeZone ? ` (${options.timeZone})` : '');
     
     const now = Date.now();
     const diff = dateObj.getTime() - now;
     if (diff > 0 && !isLive) {
       const hours = Math.floor(diff / (1000 * 60 * 60));
       const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
       if (hours > 24) {
         relativeTimeStr = ` (in ${Math.floor(hours / 24)} days)`;
       } else if (hours > 0) {
         relativeTimeStr = ` (in ${hours}h ${minutes}m)`;
       } else {
         relativeTimeStr = ` (in ${minutes} mins)`;
       }
     }
  }

  const is247 = match.category === 'networks' || !match.date;
  const prefix = isReplay ? '⏪ ' : (isLive ? (is247 ? '📺 ' : '🔴 LIVE: ') : '⏱️ ');
  const cast = [];
  if (match.team1 && match.team1.name) cast.push(match.team1.name);
  if (match.team2 && match.team2.name) cast.push(match.team2.name);

  const leagueStr = match.league ? `🏆 League: ${match.league}\n` : '';
  const statusStr = is247
    ? '24/7 Live Network'
    : (isLive
        ? '🔴 LIVE NOW'
        : (isReplay ? `⏪ Replay from ${timeString}` : `⏱️ Kickoff at ${timeString}${relativeTimeStr}`));
  const desc = `${leagueStr}📅 Category: ${match.category.toUpperCase()}\n⏰ Status: ${statusStr}`;

  const metaPreview = {
    id: `nuvio_sport_${match.id}`,
    type: 'tv',
    name: `${prefix}${match.title}`,
    genres: [match.category.toUpperCase()],
    poster: poster,
    posterShape: 'landscape',
    background: background,
    logo: logo,
    releaseInfo: isReplay ? 'REPLAY' : (isLive ? (is247 ? '24/7' : 'LIVE') : timeString),
    description: desc,
    cast: cast,
    behaviorHints: {
      defaultVideoId: `nuvio_sport_${match.id}`
    }
  };

  if (releasedIso) {
    metaPreview.released = releasedIso;
  }

  return metaPreview;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleCatalog(type, id, extra, config) {
  if (type !== 'tv') return { metas: [] };

  if (!id.startsWith('nuvio_sports_')) {
    return { metas: [] };
  }

  // Fire-and-forget stale-while-revalidate: return the cached list now and let
  // CronService refresh it in the background once it passes the revalidate window.
  container.resolve('cronService').ensureFresh();
  
  const conf = config || (extra && extra.config) || {};

  const categoryMatch = id.replace('nuvio_sports_', '');
  
  // Use CacheService instead of hitting APIs on demand
  const cacheService = container.resolve('cacheService');
  const matches = cacheService.getMatches();
  
  let filteredMatches = matches;

  if (categoryMatch === 'live') {
    filteredMatches = matches.filter(m => isMatchLive(m));
  } else if (categoryMatch === 'upcoming') {
    const now = Date.now();
    filteredMatches = matches.filter(m => !isMatchLive(m) && (getKickoff(m.date) || 0) > now);
  } else if (categoryMatch === 'replays') {
    filteredMatches = matches;
  } else if (categoryMatch === 'teams') {
    if (typeof conf.teams === 'string' && conf.teams.trim()) {
      const favoriteTeams = conf.teams.toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
      filteredMatches = matches.filter(m => {
        const titleWords = m.title.toLowerCase();
        return favoriteTeams.some(team => titleWords.includes(team));
      });
    } else {
      filteredMatches = []; // If no config, return empty
    }
  } else if (categoryMatch === 'other') {
    const topLevelCats = ['football', 'cricket', 'basketball', 'motorsport', 'hockey', 'baseball', 'mma', 'golf', 'tennis', 'rugby', 'american_football', 'darts', 'networks', 'college'];
    filteredMatches = matches.filter(m => !topLevelCats.includes(m.category));
  } else if (categoryMatch !== 'catalog') {
    filteredMatches = matches.filter(m => {
      if (m.category === categoryMatch) return true;
      // Also include 24/7 networks specifically matching the sport category
      if (m.category === 'networks') {
        const titleLower = m.title.toLowerCase();
        if (categoryMatch === 'cricket' && titleLower.includes('cricket')) return true;
        if (categoryMatch === 'tennis' && titleLower.includes('tennis')) return true;
        if (categoryMatch === 'motorsport' && (titleLower.includes('f1') || titleLower.includes('racing') || titleLower.includes('moto') || titleLower.includes('motorsport'))) return true;
        if (categoryMatch === 'basketball' && (titleLower.includes('nba') || titleLower.includes('basketball'))) return true;
        if (categoryMatch === 'football' && (titleLower.includes('football') || titleLower.includes('soccer') || titleLower.includes('golazo') || titleLower.includes('laliga') || titleLower.includes('premier league') || titleLower.includes('bein sports'))) return true;
        if (categoryMatch === 'rugby' && (titleLower.includes('rugby') || titleLower.includes('league') || titleLower.includes('nrl'))) return true;
        if (categoryMatch === 'american_football' && (titleLower.includes('nfl') || titleLower.includes('american football'))) return true;
        if (categoryMatch === 'baseball' && (titleLower.includes('mlb') || titleLower.includes('baseball'))) return true;
        if (categoryMatch === 'hockey' && (titleLower.includes('nhl') || titleLower.includes('hockey'))) return true;
        if (categoryMatch === 'golf' && (titleLower.includes('golf') || titleLower.includes('pga'))) return true;
      }
      return false;
    });
  }

  if (typeof conf.sports === 'string' && conf.sports !== 'all') {
    const allowedSports = conf.sports.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    // Don't filter out networks (24/7 TV) since they aren't tied to a specific sport
    filteredMatches = filteredMatches.filter(m => m.category === 'networks' || allowedSports.includes(m.category));
  }

  const isReplayMode = (extra && extra.genre === 'Replays') || categoryMatch === 'replays';

  filteredMatches = filteredMatches.filter(m => {
    const isReplay = isReplayMatch(m);

    if (isReplayMode && m.sources && m.sources.some(s => s.source === 'timstreams')) return false;
    if (isReplayMode) return isReplay;
    return !isReplay; // Live & Upcoming mode (default) hides replays
  });

  filteredMatches = [...filteredMatches].sort((a, b) => {
    const aIsLive = isMatchLive(a) ? 1 : 0;
    const bIsLive = isMatchLive(b) ? 1 : 0;
    if (aIsLive !== bIsLive) return bIsLive - aIsLive; // Live matches first

    // In "Live Now", actual in-progress fixtures must outrank eternal 24/7
    // channels. A 24/7 network is always "live", so it otherwise sorts as a
    // live event and floods the top of the list. Two tests are needed:
    //   1. category !== 'networks'
    //   2. has a kickoff time — the injected 24/7 channels (Willow, Fox Cricket,
    //      Fox League, Tennis) carry no date, whereas real fixtures do.
    // Together these push real matches up while leaving genuine channel-only
    // networks at the bottom.
    const isRealFixture = (m) => (m.category !== 'networks' && !!m.date) ? 1 : 0;
    const aFix = isRealFixture(a);
    const bFix = isRealFixture(b);
    if (aFix !== bFix) return bFix - aFix; // Real fixtures before 24/7 channels

    // Featured / Popular matches first
    const aPop = a.popular === '1' ? 1 : 0;
    const bPop = b.popular === '1' ? 1 : 0;
    if (aPop !== bPop) return bPop - aPop;
    
    const dateA = a.date ? getKickoff(a.date) : 0;
    const dateB = b.date ? getKickoff(b.date) : 0;
    
    // Sort upcoming by closest kickoff first, replays and live by newest first
    if (dateA > 0 && dateB > 0) {
      if (isReplayMode || aIsLive) {
        return dateB - dateA;
      } else {
        return dateA - dateB;
      }
    } else if (dateA > 0 && dateB === 0) {
      return -1; // A (with date) comes before B (without date)
    } else if (dateA === 0 && dateB > 0) {
      return 1; // B (with date) comes before A (without date)
    }
    return 0;
  });

  let metas = filteredMatches.map(m => mapMatchToMetaPreview(m, conf));

  // ── Genre filter (Replays / Live Now / Upcoming) ──────────────────────────
  // These catalogs expose a genre selector so they can be browsed
  // sport-by-sport instead of as one long list. Genre values are display
  // labels, so they are mapped back to canonical categories here.
  const GENRE_TO_CATEGORY = {
    'football': 'football',
    'soccer': 'football',
    'cricket': 'cricket',
    'basketball': 'basketball',
    'motorsport': 'motorsport',
    'f1 & motor': 'motorsport',
    'formula 1': 'motorsport',
    'tennis': 'tennis',
    'baseball': 'baseball',
    'hockey': 'hockey',
    'rugby': 'rugby',
    'american football': 'american_football',
    'mma': 'mma',
    'golf': 'golf',
    'darts': 'darts',
    'college': 'college',
    'other': 'other'
  };
  const GENRE_FILTERABLE = { replays: 1, live: 1, upcoming: 1 };
  if (GENRE_FILTERABLE[categoryMatch] && extra && typeof extra.genre === 'string' && extra.genre.trim()) {
    const wanted = GENRE_TO_CATEGORY[extra.genre.trim().toLowerCase()] || null;
    if (wanted) {
      if (wanted === 'other') {
        const known = new Set(Object.values(GENRE_TO_CATEGORY));
        metas = metas.filter(m => {
          const cat = String((m.genres && m.genres[0]) || '').toLowerCase();
          return cat && !known.has(cat);
        });
      } else {
        const label = wanted.toUpperCase();
        metas = metas.filter(m => (m.genres || []).some(g => String(g).toUpperCase() === label));
      }
    }
  }
  if (extra && extra.search) {
    const q = extra.search.toLowerCase();
    metas = metas.filter(m => 
      m.name.toLowerCase().includes(q) || 
      (m.description && m.description.toLowerCase().includes(q)) ||
      (m.cast && m.cast.some(c => c.toLowerCase().includes(q)))
    );
  }

  return { metas };
}

async function handleMeta(type, id, config) {
  if (type !== 'tv' || !id.startsWith('nuvio_sport_')) {
    return { meta: null };
  }

  // Fire-and-forget stale-while-revalidate, same as handleCatalog.
  container.resolve('cronService').ensureFresh();

  const matchId = id.replace('nuvio_sport_', '');
  const cacheService = container.resolve('cacheService');
  const matches = cacheService.getMatches();
  const match = matches.find(m => m.id === matchId);

  if (!match) {
    return { meta: null };
  }

  // Prewarm: mint tokens for this match's top sources while the user is still
  // on the detail page, so the eventual click is near-instant. Fire-and-forget.
  try { prewarmMatch(match, config || {}).catch(() => {}); } catch (_) {}

  return { meta: mapMatchToMetaPreview(match, config || {}) };
}

module.exports = {
  handleCatalog,
  handleMeta,
  isMatchLive,
  isReplayMatch,
  mapMatchToMetaPreview
};
