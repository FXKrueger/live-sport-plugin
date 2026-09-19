const { request } = require('undici');

(async () => {
    try {
        console.log('1. Fetching replays.txt...');
        const res = await request('https://replay.adityapangshe.workers.dev/replays.txt');
        const text = await res.body.text();
        
        let matchData = null;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('Athletic Club vs Atlético Madrid')) {
                const parts = lines[i+2].split('|'); // Data is on line i+2
                matchData = { url: parts[0], sourcesStr: parts[1] };
                break;
            }
        }
        
        if (!matchData) {
            console.log('Match not found');
            return;
        }
        
        console.log('Match URL:', matchData.url);
        
        const sources = [];
        const sourceEntries = matchData.sourcesStr.split(';');
        for (const entry of sourceEntries) {
            const [lang, url] = entry.split(',');
            if (url) sources.push({ lang, url });
        }
        
        console.log('Sources:', sources);
        
        for (const source of sources) {
            console.log('\n--- Checking source:', source.url);
            try {
                const sRes = await request(source.url, { maxRedirections: 5 });
                console.log('Status:', sRes.statusCode);
                console.log('Final URL:', sRes.headers.location || 'none');
                const html = await sRes.body.text();
                
                if (source.url.includes('soccerfull.net')) {
                    const iframeMatch = html.match(/<iframe[^>]+src="([^"]+)"/i);
                    console.log('Iframe match:', iframeMatch ? iframeMatch[1] : 'None');
                } else if (source.url.includes('ok.ru')) {
                    const dataOptionsMatch = html.match(/data-options="([^"]+)"/);
                    console.log('OK.RU data-options:', dataOptionsMatch ? 'Found' : 'Not Found');
                } else {
                    console.log('Unknown source type');
                }
            } catch (e) {
                console.log('Error fetching source:', e.message);
            }
        }
        
    } catch (e) {
        console.error(e);
    }
})();
