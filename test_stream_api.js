const { request } = require('undici');
(async () => {
    // Let's get the catalog first to find the exact ID for manchester united
    const { body: catBody } = await request('http://127.0.0.1:7000/catalog/tv/nuvio_sports_replays.json');
    const catalog = await catBody.json();
    const match = catalog.metas.find(m => m.name.toLowerCase().includes('manchester united'));
    if (!match) return console.log('Match not found');
    
    console.log('Found match ID:', match.id);
    
    // Now request streams
    const { body: strBody } = await request(`http://127.0.0.1:7000/stream/tv/${match.id}.json`);
    const streams = await strBody.json();
    console.log('Streams:', JSON.stringify(streams, null, 2));
})();
