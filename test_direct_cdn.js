const { request } = require('undici');
(async () => {
    // Re-extract a fresh token right now
    const embedUrl = 'https://ok.ru/videoembed/15746445478612';
    const { body } = await request(embedUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
            'Referer': 'https://ok.ru/',
            'Origin': 'https://ok.ru',
        }
    });
    const html = await body.text();
    const optionsMatch = html.match(/data-options="([^"]+)"/);
    if (!optionsMatch) return console.log('No data-options');
    
    const options = JSON.parse(optionsMatch[1].replace(/&quot;/g, '"'));
    const meta = typeof options.flashvars.metadata === 'string' ? JSON.parse(options.flashvars.metadata) : options.flashvars.metadata;
    
    const hdVideo = meta.videos.find(v => v.name === 'full') || meta.videos[meta.videos.length - 1];
    const url = hdVideo.url;
    console.log('CDN URL (truncated):', url.slice(0, 100));
    console.log('srcIp in token:', new URL(url).searchParams.get('srcIp'));
    
    console.log('\n--- GET with Range header ---');
    const r = await request(url, {
        headers: {
            'Range': 'bytes=0-100',
            'Referer': 'https://ok.ru/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
            'Origin': 'https://ok.ru'
        }
    });
    console.log('Status:', r.statusCode);
    console.log('Content-Type:', r.headers['content-type']);
    console.log('Content-Range:', r.headers['content-range']);
    const buf = Buffer.from(await r.body.arrayBuffer());
    console.log('Bytes received:', buf.length);
    console.log('Magic (hex):', buf.slice(0, 20).toString('hex'));
    console.log('Is ftyp MP4:', buf.slice(4, 8).toString() === 'ftyp');
})();
