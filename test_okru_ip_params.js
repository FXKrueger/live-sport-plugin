const { request } = require('undici');
(async () => {
    const fakeIp = '8.8.8.8';
    const urlsToTest = [
        `https://ok.ru/videoembed/15746445478612?ip=${fakeIp}`,
        `https://ok.ru/videoembed/15746445478612?clientIp=${fakeIp}`,
        `https://ok.ru/videoembed/15746445478612?srcIp=${fakeIp}`,
        `https://ok.ru/videoembed/15746445478612?remote_ip=${fakeIp}`,
        `https://ok.ru/videoembed/15746445478612?client_ip=${fakeIp}`
    ];
    
    for (const url of urlsToTest) {
        console.log('\nTesting URL:', url);
        const { body } = await request(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const html = await body.text();
        const optionsMatch = html.match(/data-options="([^"]+)"/);
        if (!optionsMatch) {
            console.log('No data-options found');
            continue;
        }
        
        const options = JSON.parse(optionsMatch[1].replace(/&quot;/g, '"'));
        const meta = typeof options.flashvars.metadata === 'string' ? JSON.parse(options.flashvars.metadata) : options.flashvars.metadata;
        if (meta.videos && meta.videos.length > 0) {
            const videoUrl = new URL(meta.videos[0].url);
            console.log('-> srcIp returned:', videoUrl.searchParams.get('srcIp'));
        }
    }
})();
