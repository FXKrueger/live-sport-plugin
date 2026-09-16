const container = require('./src/container');
const cache = container.resolve('cacheService');
const provider = container.resolve('streamFreeProvider');
const { handleStream } = require('./src/streams');

async function main() {
    console.log('Fetching catalog...');
    const matches = await provider.getMatches();
    cache.setMatches(matches); // force matches into cache
    console.log('Matches in cache: ' + matches.length);
    
    console.log('Handling stream for newcastle...');
    const res = await handleStream('tv', 'nuvio_sport_sf_newcastle-united-vs-leeds-united', {});
    console.log(JSON.stringify(res, null, 2));
}

main().catch(console.error);
