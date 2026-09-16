const { request } = require('undici');
(async () => {
    const { body } = await request('https://hgcloud.to/e/hb7sq8m5o1hh', {
        headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/127.0.0.0 Safari/537.36',
            'Referer': 'https://soccerfull.net/' 
        }
    });
    const html = await body.text();
    console.log('hgcloud html length:', html.length);
    
    // Look for video tags, jwplayer, videojs, m3u8, mp4
    const sources = html.match(/[\"']([^\"']+\.(?:m3u8|mp4)[^\"']*)[\"']/g);
    if (sources) {
        console.log('Sources found:', sources);
    } else {
        const jwplayer = html.match(/jwplayer\(/i);
        const scripts = html.match(/<script[^>]*>(.*?)<\/script>/gs);
        console.log('jwplayer init?', !!jwplayer);
        if (scripts) {
            const evalScripts = scripts.filter(s => s.includes('eval(') || s.includes('p,a,c,k,e,d'));
            console.log('Packed scripts found:', evalScripts.length);
            if (evalScripts.length > 0) {
                console.log(evalScripts[0].substring(0, 300) + '...');
            }
        }
    }
})();
