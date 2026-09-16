const undici = require('undici');
const { unpack } = require('./deanEdwardsUnpack');
const { BASE_URL: CONFIG_BASE_URL } = require('../config');

class ReplayZoneProvider {
    constructor() {
        this.sourceName = 'replayzone';
        this.replaysUrl = 'https://replay.adityapangshe.workers.dev/replays.txt';
    }

    async getMatches() {
        try {
            const { body } = await undici.request(this.replaysUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const text = await body.text();
            
            const matches = [];
            const blocks = text.split('\n\n').filter(b => b.trim());

            for (const block of blocks) {
                const lines = block.split('\n').map(l => l.trim()).filter(l => l);
                if (lines.length < 3) continue;

                if (!lines[0].startsWith('#')) continue;
                const title = lines[0].replace(/^#\s*/, '').trim();

                if (!lines[1].startsWith('~')) continue;
                const metaParts = lines[1].replace(/^~\s*/, '').split('\t');
                const category = (metaParts[0] || 'football').toLowerCase();
                const league = metaParts[1] || '';
                const thumbnail = metaParts[2] || '';
                const dateStr = metaParts[3] || '';

                const sources = [];
                for (let i = 2; i < lines.length; i++) {
                    const parts = lines[i].split('\t');
                    if (parts.length < 3) continue;
                    const label = (parts[0] || '').trim();
                    // Upstream line format: "<label>\t<type>\t<url>", where type is
                    // "iframe" or "hls". The middle field was previously discarded; it
                    // distinguishes a page embed from a direct media URL, which
                    // resolveStream needs. Keep it (defaulting to iframe).
                    const type = (parts[1] || '').trim().toLowerCase();
                    const sourceUrl = (parts[2] || '').trim();
                    if (!/^https?:\/\//i.test(sourceUrl)) continue;
                    sources.push({
                        source: this.sourceName,
                        id: sourceUrl, // URL doubles as the resolveStream key
                        name: label,
                        url: sourceUrl,
                        type: type || 'iframe'
                    });
                }

                if (sources.length > 0) {
                    const idSafe = title.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Buffer.from(dateStr).toString('hex');
                    matches.push({
                        id: `rz_${idSafe}`,
                        title,
                        category,
                        league,
                        date: dateStr, 
                        status: 'finished',
                        thumbnail_url: thumbnail,
                        sources
                    });
                }
            }

            console.log(`[ReplayZone] Extracted ${matches.length} matches`);
            return matches;
        } catch (error) {
            console.error('[ReplayZone] Error fetching matches:', error.message);
            return [];
        }
    }

    async resolveStream(url, category, team, srcObj) {
        const streams = [];
        let rawName = (srcObj && srcObj.name) ? srcObj.name : '';
        const partName = rawName ? rawName.replace(/\([^)]+\)/g, '').trim() + '\n' : '';

        // Callers pass the source URL directly, but fall back to the source object
        // so the id/url pair cannot silently resolve to nothing.
        url = url || (srcObj && srcObj.url) || '';
        if (!url) return streams;

        if (url.includes('ok.ru')) {
            try {
                const { body } = await undici.request(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
                        'Referer': 'https://ok.ru/',
                        'Origin': 'https://ok.ru',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9'
                    }
                });
                
                const html = await body.text();
                
                let videos = [];
                const optionsMatch = html.match(/data-options="([^"]+)"/);
                if (optionsMatch) {
                    try {
                        const optionsStr = optionsMatch[1].replace(/&quot;/g, '"');
                        const options = JSON.parse(optionsStr);
                        if (options.flashvars && options.flashvars.metadata) {
                            const meta = typeof options.flashvars.metadata === 'string' ? JSON.parse(options.flashvars.metadata) : options.flashvars.metadata;
                            if (meta.videos) {
                                videos = meta.videos;
                            }
                        }
                    } catch(err) {
                        console.error('[ReplayZone] Failed parsing data-options:', err.message);
                    }
                }

                if (videos.length > 0) {
                    const qMap = {
                        mobile: '144p',
                        lowest: '240p',
                        low: '360p',
                        sd: '480p',
                        hd: '720p',
                        full: '1080p',
                        quad: '1440p',
                        ultra: '4k'
                    };
                    
                    const allowedQualities = ['hd', 'full', 'quad', 'ultra'];
                    let filteredVideos = videos.filter(v => allowedQualities.includes(v.name));
                    
                    // Fallback: if match only has SD, serve best available to avoid 0 streams
                    if (filteredVideos.length === 0) {
                        filteredVideos = [videos[videos.length - 1]];
                    }

                    for (const v of filteredVideos) {
                        if (!v.url) continue;
                        const qName = qMap[v.name] || v.name;
                        // Route ok.ru playback through the addon's parallel-range
                        // proxy. Measured: ok.ru throttles a SINGLE connection to
                        // ~226 KB/s (~1.8 Mbps) but not per IP — 1/2/4/8 parallel
                        // connections gave 226/451/887/1792 KB/s (~7.9x at 8).
                        // Returning the raw CDN URL (as before) left the player on
                        // one throttled connection, which is too slow for 1080p and
                        // is what made replays buffer. The proxy is ordered, so
                        // playback stays correct byte-for-byte.
                        const isOkRu = /okcdn\.ru|vkuser\.net|mycdn\.me|\.ok\.ru/i.test(v.url);
                        const playUrl = isOkRu
                            ? `${CONFIG_BASE_URL}/api/fastmp4?url=${encodeURIComponent(v.url)}&referer=${encodeURIComponent('https://ok.ru/')}`
                            : v.url;
                        streams.push({
                            name: 'ReplayZone',
                            title: partName.trim() || 'Stream',
                            resolution: qName,
                            url: playUrl,
                            behaviorHints: {
                                notWebReady: false,
                                proxyHeaders: {
                                    request: {
                                        'Referer': 'https://ok.ru/',
                                        'Origin': 'https://ok.ru',
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
                                    }
                                }
                            }
                        });
                    }
                } else {
                    console.error('[ReplayZone] videos array not found in ok.ru response');
                }
            } catch (error) {
                console.error('[ReplayZone] Error fetching ok.ru:', error.message);
            }
        } else if (this._isDirectMediaUrl(url)) {
            // Already a playable media URL (m3u8/mp4) — e.g. a "hls" source line
            // pointing at soccerfull.net/hls/... — so proxy it straight through
            // instead of scraping it as an HTML page.
            streams.push(this._buildProxiedStream(url, partName));
        } else if (url.includes('soccerfull.net')) {
            try {
                const streamUrl = await this.extractSoccerfull(url);
                if (streamUrl) {
                    streams.push(this._buildProxiedStream(streamUrl, partName));
                }
            } catch (error) {
                console.error('[ReplayZone] Error in soccerfull extraction:', error.message);
            }
        } else {
            // For dailymotion or others, push as external
            streams.push({
                name: 'RZ (External)',
                title: 'Watch in Browser',
                externalUrl: url
            });
        }

        return streams;
    }

    /** True when the URL is already a playable media file rather than a page. */
    _isDirectMediaUrl(url) {
        return /\.(m3u8|mp4)(?:[?#]|$)/i.test(url);
    }

    /** Builds the internal-proxy stream entry used for hanerix-family sources. */
    _buildProxiedStream(streamUrl, partName) {
        // global.BASE_URL is never assigned anywhere in this codebase, so the
        // old fallback always fired and hardcoded 127.0.0.1:7000 — which is wrong
        // on every machine except a default local dev box. Use the real config
        // value, and only fall back to loopback when it is genuinely unavailable.
        const BASE_URL = CONFIG_BASE_URL || 'http://127.0.0.1:7000';
        const referer = 'https://hanerix.com/';
        const origin = 'https://hanerix.com';
        const proxyUrl = `${BASE_URL}/api/manifest?url=${encodeURIComponent(streamUrl)}&referer=${encodeURIComponent(referer)}&origin=${encodeURIComponent(origin)}&proxyChunks=1`;
        return {
            name: 'ReplayZone',
            title: partName.trim() || 'Stream',
            url: proxyUrl,
            behaviorHints: {
                notWebReady: false
            }
        };
    }

    async extractSoccerfull(url) {
        try {
            const res = await undici.request(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const html = await res.body.text();
            
            // Case 1: Direct Artplayer embed (videas.fr etc)
            const m3u8VarMatch = html.match(/var\s+m3u8Url\s*=\s*["']([^"']+)["']/i);
            if (m3u8VarMatch) {
                return new URL(m3u8VarMatch[1], url).toString();
            }

            // Case 2: hgcloud.to iframe
            const iframeMatch = html.match(/<iframe[^>]+src="([^"]+)"/i);
            if (!iframeMatch) return null;
            
            let iframeUrl = new URL(iframeMatch[1], url).toString();
            if (iframeUrl.includes('hgcloud.to')) {
                iframeUrl = iframeUrl.replace('hgcloud.to', 'hanerix.com');
            }
            
            const iframeRes = await undici.request(iframeUrl, {
                headers: {
                    'Referer': new URL(url).origin + '/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
                }
            });
            const iframeHtml = await iframeRes.body.text();
            
            if (iframeHtml.includes('sandbox not allowed') || iframeHtml.includes('Access denied')) {
                console.error('[ReplayZone] Access denied block hit for hanerix');
                return null;
            }

            const start = iframeHtml.indexOf('eval(function(p,a,c,k,e,d)');
            if (start === -1) return null;

            const end = iframeHtml.indexOf('</script>', start);
            if (end === -1) return null;
            const packed = iframeHtml.substring(start, end).trim();

            // Unpack via a pure string transform. This payload is fetched from a
            // third-party host and must never be evaluated as JavaScript.
            const unpacked = unpack(packed);
            if (!unpacked) {
                console.error('[ReplayZone] Failed to safely unpack player payload');
                return null;
            }

            // The player expression is normally a links.hls4||hls3||hls2 chain,
            // so the "file:" key rarely holds a literal URL. Prefer it when it is one,
            // otherwise take the first real playlist URL from the payload.
            const fileMatch = unpacked.match(/file\s*:\s*["']([^"']+)["']/);
            const direct = fileMatch && fileMatch[1].trim().startsWith('http') ? fileMatch[1].trim() : null;
            const embedded = unpacked.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);
            const resolved = direct || (embedded && embedded[0]);

            if (resolved) {
                return new URL(resolved, iframeUrl).toString();
            }
            return null;
        } catch (error) {
            console.error('[ReplayZone] Error extracting soccerfull:', error.message);
            return null;
        }
    }
}

module.exports = ReplayZoneProvider;
