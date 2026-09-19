const { asValue } = require('awilix');
const container = require('./src/container');
const { handleCatalog } = require('./src/catalog');

const now = Date.now();
const mockMatches = [
  { id: '1', title: 'Network', category: 'networks' },
  { id: '2', title: 'Upcoming 1', category: 'football', date: now + 1000000 },
  { id: '3', title: 'Upcoming 2', category: 'football', date: now + 2000000 },
  { id: '4', title: 'Live Now', category: 'football', date: now - 1000, status: 'live' },
  { id: '5', title: 'Replay 1 (Older)', category: 'football', date: now - 10000000, status: 'finished' },
  { id: '6', title: 'Replay 2 (Newer)', category: 'football', date: now - 5000000, status: 'finished' },
  { id: '7', title: 'Missing Date Replay', category: 'football', status: 'finished' }, // edge case: finished without date
];

container.register({
  cronService: asValue({ ensureFresh: () => {} }),
  cacheService: asValue({ getMatches: () => mockMatches })
});

async function run() {
  const defaultRes = await handleCatalog('tv', 'nuvio_sports_football', {});
  console.log('--- Default (Live & Upcoming) ---');
  defaultRes.metas.forEach(m => console.log(m.name, '| Released:', m.releaseInfo, m.description.split('\n').pop()));

  const replayRes = await handleCatalog('tv', 'nuvio_sports_football', { genre: 'Replays' });
  console.log('\n--- Replays ---');
  replayRes.metas.forEach(m => console.log(m.name, '| Released:', m.releaseInfo, m.description.split('\n').pop()));
}

run().catch(console.error);
