const ReplayZoneProvider = require('./src/providers/ReplayZoneProvider.js');

async function test() {
    const provider = new ReplayZoneProvider();
    
    // First, let's see if we can get matches to find one with 'soccerfull.net'
    const matches = await provider.getMatches();
    let targetUrl = 'https://soccerfull.net/play/athletic-club-vs-atl-tico-madrid';
    
    // Check if the specific match is in the list
    const match = matches.find(m => m.id.includes('athletic-club-vs-atl-tico-madrid'));
    if (match) {
        const source = match.sources.find(s => s.url.includes('soccerfull.net'));
        if (source) {
            targetUrl = source.url;
        }
    }
    
    console.log(`Testing resolveStream for: ${targetUrl}`);
    const streams = await provider.resolveStream(targetUrl, 'football', 'Athletic Club');
    console.log('Resolved Streams:', JSON.stringify(streams, null, 2));
}

test();
