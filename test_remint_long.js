const { request } = require('undici');

(async () => {
    try {
        console.log('[Test] 1. Finding live match...');
        const { body: catBody } = await request('http://127.0.0.1:7000/catalog/tv/nuvio_sports_live.json');
        const catalog = await catBody.json();
        
        let variantUrl = null;
        let masterUrl = null;
        
        for (const match of catalog.metas) {
            console.log(`[Test] 2. Fetching streams for: ${match.name}...`);
            const { body: strBody } = await request(`http://127.0.0.1:7000/stream/tv/${match.id}.json`);
            const streams = await strBody.json();
            
            for (const s of streams.streams) {
                if (s.url && s.url.includes('/api/manifest')) {
                    const candidateMaster = 'http://127.0.0.1:7000' + s.url.substring(s.url.indexOf('/api/manifest'));
                    const res = await request(candidateMaster);
                    if (res.statusCode === 200) {
                        const m3u8 = await res.body.text();
                        const lines = m3u8.split('\n');
                        for (const line of lines) {
                            if (line.startsWith('/api/manifest')) {
                                variantUrl = 'http://127.0.0.1:7000' + line.trim();
                                masterUrl = candidateMaster;
                                break;
                            }
                        }
                    }
                }
                if (variantUrl) break;
            }
            if (variantUrl) break;
        }
        
        if (!variantUrl) {
            console.error('No working proxied stream with a variant playlist found in the entire catalog.');
            process.exit(1);
        }
        
        console.log('[Test] Found Working Stream!');
        console.log('Master URL:', masterUrl);
        
        console.log('\n[Test] 4. Starting 30-minute poll on Variant Playlist...');
        console.log('Variant URL:', variantUrl);
        
        const POLLING_INTERVAL_MS = 5000;
        const TEST_DURATION_MS = 30 * 60 * 1000;
        const startTime = Date.now();
        
        let iteration = 0;
        let successCount = 0;
        let failCount = 0;
        
        while (Date.now() - startTime < TEST_DURATION_MS) {
            iteration++;
            try {
                const startFetch = Date.now();
                const vRes = await request(variantUrl);
                const vText = await vRes.body.text();
                const duration = Date.now() - startFetch;
                
                if (vRes.statusCode === 200 && vText.includes('#EXTINF')) {
                    successCount++;
                    process.stdout.write(`\r[Poll ${iteration}] OK - HTTP 200 - Fetched in ${duration}ms (Success: ${successCount}, Fail: ${failCount})   `);
                } else {
                    failCount++;
                    console.log(`\n[Poll ${iteration}] FAIL - HTTP ${vRes.statusCode}`);
                    console.log(`[Poll ${iteration}] Response preview:`, vText.substring(0, 100).replace(/\n/g, ' '));
                }
            } catch (err) {
                failCount++;
                console.log(`\n[Poll ${iteration}] ERROR - ${err.message}`);
            }
            
            await new Promise(r => setTimeout(r, POLLING_INTERVAL_MS));
        }
        
        console.log('\n\n[Test] 30-Minute Test Complete!');
        console.log(`Total Polls: ${iteration}`);
        console.log(`Success: ${successCount}`);
        console.log(`Failed: ${failCount}`);
        
    } catch (e) {
        console.error('Fatal test error:', e);
    }
})();
