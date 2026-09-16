const container = require('./src/container');
const streams = require('./src/streams');
const catalog = require('./src/catalog');
const aggregator = container.resolve('matchAggregator');

async function test() {
    console.log('Fetching replays catalog...');
    // We must ensure the matches are in cache first
    await aggregator.syncMatches();
    
    const replays = await catalog.handleCatalog('tv', 'nuvio_sports_replays');
    
    const targetMatch = replays.metas.find(m => m.name && m.name.includes('Penrith Panthers') && m.name.includes('Sydney Roosters'));
    
    if (!targetMatch) {
        console.log('Target match not found in catalog');
        return;
    }
    
    console.log(`Found match: ${targetMatch.id} - ${targetMatch.name}`);
    
    console.log(`Resolving stream for ${targetMatch.id}...`);
    const result = await streams.handleStream('tv', targetMatch.id);
    
    console.log(JSON.stringify(result, null, 2));
}

test().catch(console.error);
