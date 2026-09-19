// Debug: directly call ReplayZoneProvider.resolveStream
const ReplayZoneProvider = require('./src/providers/ReplayZoneProvider');
process.env.PORT = '7000';

(async () => {
  const p = new ReplayZoneProvider();
  console.log('Calling resolveStream on ok.ru URL...');
  const streams = await p.resolveStream('https://ok.ru/videoembed/15746445478612', 'rugby', 'NRL');
  console.log('Streams returned:', streams.length);
  streams.forEach(s => console.log(' -', s.name, '|', (s.url || s.externalUrl || 'NO URL').slice(0, 100)));
})().catch(e => console.error('ERROR:', e.message, e.stack));
