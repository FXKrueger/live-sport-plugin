const { request } = require('undici');

(async () => {
    console.log('1. Finding match...');
    const { body: catBody } = await request('http://127.0.0.1:7000/catalog/tv/nuvio_sports_replays.json');
    const catalog = await catBody.json();
    const match = catalog.metas.find(m => m.name.toLowerCase().includes('united'));
    
    if (!match) { console.error('Match not found'); process.exit(1); }
    
    console.log('2. Fetching streams...');
    const { body: strBody } = await request(`http://127.0.0.1:7000/stream/tv/${match.id}.json`);
    const streams = await strBody.json();
    const url = streams.streams[0].url;
    console.log('Stream URL:', url);
    
    console.log('\n3. Fetching proxy manifest...');
    const res = await request(url);
    const m3u8 = await res.body.text();
    console.log(m3u8.substring(0, 500));
    
    const innerMatch = m3u8.match(/\/api\/manifest\?[^\s]+/);
    if (innerMatch) {
        console.log('\n4. Fetching inner proxy manifest...');
        const innerUrl = 'http://127.0.0.1:7000' + innerMatch[0];
        const res2 = await request(innerUrl);
        const m3u8_inner = await res2.body.text();
        console.log(m3u8_inner.substring(0, 500));
        
        const tsMatch = m3u8_inner.match(/\/api\/hlschunk\?[^\s]+/);
        if (tsMatch) {
            console.log('\n5. Fetching TS chunk via proxy...');
            const tsUrl = 'http://127.0.0.1:7000' + tsMatch[0];
            console.log('TS URL:', tsUrl);
            const res3 = await request(tsUrl, { headers: { Range: 'bytes=0-100' } });
            console.log('TS Status:', res3.statusCode);
        } else {
            console.log('No /api/hlschunk found in inner m3u8!');
        }
    }
})();
