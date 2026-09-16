// Test MP4 direct download from ok.ru with proper browser headers
const undici = require('undici');

(async () => {
  console.log('--- Step 1: Extract ok.ru embed ---');
  const res = await undici.request('https://ok.ru/videoembed/15746445478612', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
      'Referer': 'https://ok.ru/',
      'Origin': 'https://ok.ru',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  const html = await res.body.text();
  const match = html.match(/data-options="([^"]+)"/);
  const data = JSON.parse(match[1].replace(/&quot;/g, '"'));
  const meta = typeof data.flashvars.metadata === 'string'
    ? JSON.parse(data.flashvars.metadata)
    : data.flashvars.metadata;

  console.log('Videos available:', meta.videos.map(v => v.name));
  const srcIp = (meta.hlsManifestUrl.match(/srcIp=([^&]+)/) || [])[1];
  console.log('srcIp in token:', srcIp);

  // Test each MP4 quality with proper headers
  for (const v of meta.videos) {
    try {
      const r = await undici.request(v.url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
          'Referer': 'https://ok.ru/',
          'Origin': 'https://ok.ru',
        }
      });
      // Consume body
      await r.body.dump();
      const cl = r.headers['content-length'];
      const ct = r.headers['content-type'];
      console.log(`[${v.name}] Status: ${r.statusCode} | Content-Type: ${ct} | Size: ${cl ? Math.round(cl/1024/1024)+'MB' : 'unknown'}`);
    } catch(e) {
      console.log(`[${v.name}] Error: ${e.message}`);
    }
  }

  // Test HLS segment directly
  console.log('\n--- Step 2: Check if HLS segments are accessible ---');
  const hlsRes = await undici.request(meta.hlsManifestUrl, {
    headers: {
      'Referer': 'https://ok.ru/',
      'Origin': 'https://ok.ru',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
    }
  });
  const hlsBody = await hlsRes.body.text();
  // Extract first segment URL from manifest
  const lines = hlsBody.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  if (lines.length > 0) {
    const firstSegmentUrl = lines[0].trim();
    console.log('First segment URL:', firstSegmentUrl.slice(0, 100));
    const segRes = await undici.request(firstSegmentUrl, {
      method: 'HEAD',
      headers: {
        'Referer': 'https://ok.ru/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
      }
    });
    await segRes.body.dump();
    console.log('Segment status:', segRes.statusCode);
    console.log('Segment content-type:', segRes.headers['content-type']);
  }
})().catch(e => console.error('ERROR:', e.message));
