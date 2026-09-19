const { request } = require('undici');

(async () => {
    try {
        const { body: catBody } = await request('http://127.0.0.1:7000/catalog/tv/nuvio_sports_replays.json');
        const catalog = await catBody.json();
        const match = catalog.metas.find(m => m.name.toLowerCase().includes('united'));
        
        const { body: strBody } = await request(`http://127.0.0.1:7000/stream/tv/${match.id}.json`);
        const streams = await strBody.json();
        const url = streams.streams[0].url;
        console.log('Got URL:', url);
        
        // Let's test with no User-Agent
        console.log('\n--- No Headers ---');
        let res = await request(url);
        console.log('Status:', res.statusCode);
        console.log(await res.body.text());
        
        // Let's test with Chrome User-Agent
        console.log('\n--- Chrome User-Agent ---');
        res = await request(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36' } });
        console.log('Status:', res.statusCode);
        console.log(await res.body.text());
        
        // Test extracting a chunk from the m3u8
        if (res.statusCode === 200) {
             const m3u8 = await res.body.text();
             // Not really testing chunks yet
        }
    } catch (e) {
        console.error(e);
    }
})();
