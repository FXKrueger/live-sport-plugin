const { request } = require('undici');
(async () => {
    const url = 'https://ok.ru/videoembed/15746445478612';
    const { body } = await request(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/127.0.0.0 Safari/537.36' }
    });
    const html = await body.text();
    const optionsMatch = html.match(/data-options="([^"]+)"/);
    if (!optionsMatch) return console.log('No data-options');
    
    const options = JSON.parse(optionsMatch[1].replace(/&quot;/g, '"'));
    const meta = typeof options.flashvars.metadata === 'string' ? JSON.parse(options.flashvars.metadata) : options.flashvars.metadata;
    
    console.log('Manifest URL:', meta.hlsManifestUrl);
    
    const { body: m3u8Body } = await request(meta.hlsManifestUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const m3u8Text = await m3u8Body.text();
    console.log('\nMaster Playlist:\n', m3u8Text.split('\n').slice(0, 5).join('\n'));
    
    const lines = m3u8Text.split('\n');
    const firstSub = lines.find(l => l && !l.startsWith('#'));
    
    const subUrl = new URL(firstSub, meta.hlsManifestUrl).toString();
    console.log('\nFetching sub-playlist:', subUrl);
    
    const { body: subBody } = await request(subUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const subText = await subBody.text();
    console.log('\nSub Playlist:\n', subText.split('\n').slice(0, 10).join('\n'));
})();
