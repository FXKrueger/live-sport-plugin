const { request } = require('undici');

(async () => {
    const url = 'https://ok.ru/videoembed/15746445478612';
    const fakeIp = '8.8.8.8'; // Google DNS, guaranteed to be different from our WARP IP
    
    console.log('Fetching ok.ru with X-Forwarded-For:', fakeIp);
    const { body } = await request(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/127.0.0.0 Safari/537.36',
            'Referer': 'https://ok.ru/',
            'Origin': 'https://ok.ru',
            'X-Forwarded-For': fakeIp,
            'X-Real-IP': fakeIp,
            'Client-IP': fakeIp
        }
    });
    
    const html = await body.text();
    const optionsMatch = html.match(/data-options="([^"]+)"/);
    if (!optionsMatch) {
        console.log('Could not find data-options');
        return;
    }
    
    const optionsStr = optionsMatch[1].replace(/&quot;/g, '"');
    const options = JSON.parse(optionsStr);
    const meta = typeof options.flashvars.metadata === 'string' ? JSON.parse(options.flashvars.metadata) : options.flashvars.metadata;
    
    if (meta.videos && meta.videos.length > 0) {
        const urlStr = meta.videos[0].url;
        console.log('Video URL snippet:', urlStr.substring(0, 200));
        
        // Parse the URL to find the clientIp or srcIp parameter
        const urlObj = new URL(urlStr);
        console.log('\nQuery Params:');
        for (const [key, val] of urlObj.searchParams.entries()) {
            if (key.toLowerCase().includes('ip')) {
                console.log(` -> ${key}: ${val}`);
            }
        }
    }
})();
