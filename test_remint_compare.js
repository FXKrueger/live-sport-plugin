const { request } = require('undici');

const LOCAL_BASE = 'http://127.0.0.1:7000';
const PUBLIC_BASE = 'https://nuvio.moaqeel6679.my.id';

async function getVariantUrl(baseUrl, proxyUrl) {
    const candidateMaster = baseUrl + proxyUrl.substring(proxyUrl.indexOf('/api/manifest'));
    const res = await request(candidateMaster);
    if (res.statusCode !== 200) return null;
    const m3u8 = await res.body.text();
    const lines = m3u8.split('\n');
    for (const line of lines) {
        if (line.startsWith('/api/manifest')) {
            return baseUrl + line.trim();
        }
    }
    return null;
}

(async () => {
    try {
        console.log('[Compare] 1. Finding live match on local catalog...');
        const { body: catBody } = await request(`${LOCAL_BASE}/catalog/tv/nuvio_sports_live.json`);
        const catalog = await catBody.json();
        
        let localVariant = null;
        let publicVariant = null;
        let matchName = '';
        
        for (const match of catalog.metas) {
            console.log(`[Compare] 2. Checking streams for: ${match.name}...`);
            const { body: localBody } = await request(`${LOCAL_BASE}/stream/tv/${match.id}.json`);
            const localStreams = await localBody.json();
            
            const { body: publicBody } = await request(`${PUBLIC_BASE}/stream/tv/${match.id}.json`);
            const publicStreams = await publicBody.json();
            
            // Find a stream that exists on both and goes through the manifest proxy
            for (let i = 0; i < localStreams.streams.length; i++) {
                const ls = localStreams.streams[i];
                if (!ls.url || !ls.url.includes('/api/manifest')) continue;
                
                // Try to find the exact same stream on public (match by title/source)
                const ps = publicStreams.streams.find(s => s.title === ls.title && s.url && s.url.includes('/api/manifest'));
                if (!ps) continue;
                
                localVariant = await getVariantUrl(LOCAL_BASE, ls.url);
                publicVariant = await getVariantUrl(PUBLIC_BASE, ps.url);
                
                if (localVariant && publicVariant) {
                    matchName = match.name;
                    break;
                }
            }
            if (localVariant && publicVariant) break;
        }
        
        if (!localVariant || !publicVariant) {
            console.error('[Compare] Could not find a stream with variant playlists on both instances.');
            process.exit(1);
        }
        
        console.log('\n[Compare] Found Synchronized Stream!');
        console.log(`Target: ${matchName}`);
        console.log(`Local Variant:  ${localVariant.substring(0, 80)}...`);
        console.log(`Public Variant: ${publicVariant.substring(0, 80)}...`);
        
        console.log('\n[Compare] Starting 30-minute side-by-side poll...');
        
        const POLLING_INTERVAL_MS = 5000;
        const TEST_DURATION_MS = 30 * 60 * 1000;
        const startTime = Date.now();
        
        let iteration = 0;
        
        while (Date.now() - startTime < TEST_DURATION_MS) {
            iteration++;
            
            // Force token expiration on poll 5
            if (iteration === 5) {
                console.log('\n\n[Compare] ⚠️ SIMULATING TOKEN EXPIRATION (corrupting upstream URL)...');
                localVariant = localVariant.replace(/secure%2F[a-zA-Z0-9_-]+%2F/, 'secure%2FEXPIRED_TOKEN_XYZ%2F');
                publicVariant = publicVariant.replace(/secure%2F[a-zA-Z0-9_-]+%2F/, 'secure%2FEXPIRED_TOKEN_XYZ%2F');
            }
            
            const p1 = (async () => {
                const s = Date.now();
                try {
                    const r = await request(localVariant);
                    const t = await r.body.text();
                    const d = Date.now() - s;
                    if (r.statusCode === 200 && t.includes('#EXTINF')) return `OK (${d}ms)`;
                    return `FAIL (HTTP ${r.statusCode} / No EXTINF)`;
                } catch(e) { return `ERR (${e.message})`; }
            })();
            
            const p2 = (async () => {
                const s = Date.now();
                try {
                    const r = await request(publicVariant);
                    const t = await r.body.text();
                    const d = Date.now() - s;
                    if (r.statusCode === 200 && t.includes('#EXTINF')) return `OK (${d}ms)`;
                    return `FAIL (HTTP ${r.statusCode} / No EXTINF)`;
                } catch(e) { return `ERR (${e.message})`; }
            })();
            
            const [locRes, pubRes] = await Promise.all([p1, p2]);
            
            // Clear line and overwrite
            process.stdout.write(`\r[Poll ${iteration}] Local: ${locRes.padEnd(20)} | Public: ${pubRes.padEnd(20)}       `);
            
            await new Promise(r => setTimeout(r, POLLING_INTERVAL_MS));
        }
        
        console.log('\n\n[Compare] 30-Minute Test Complete!');
        
    } catch (e) {
        console.error('\n[Compare] Fatal test error:', e);
    }
})();
