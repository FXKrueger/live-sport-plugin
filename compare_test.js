const path = require('path');

const LOCAL = 'http://127.0.0.1:7000';
const PUBLIC = 'https://nuvio.moaqeel6679.my.id';

const get = async (url, ms = 30000) => {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    const text = await r.text();
    return { status: r.status, text, ms: Date.now() - t0, headers: r.headers };
  } catch (e) {
    return { error: e.message, ms: Date.now() - t0 };
  }
};

const findMatch = (arr) => (arr || []).find(m => /atletico|atlético/i.test(String(m.title)) && /osasuna/i.test(String(m.title)))
                      || (arr || []).find(m => /osasuna/i.test(String(m.title)));

(async () => {
  console.log('=== reachability ===');
  for (const [name, base] of [['LOCAL ', LOCAL], ['PUBLIC', PUBLIC]]) {
    const r = await get(base + '/manifest.json', 20000);
    if (r.error) { console.log(`  ${name} ${base} -> UNREACHABLE (${r.error}, ${r.ms}ms)`); continue; }
    let ver = '';
    try { ver = JSON.parse(r.text).version || ''; } catch (_) {}
    console.log(`  ${name} ${base} -> HTTP ${r.status} in ${r.ms}ms  version=${ver}`);
  }

  console.log('\n=== locate the match on each ===');
  const found = {};
  for (const [name, base] of [['LOCAL ', LOCAL], ['PUBLIC', PUBLIC]]) {
    const r = await get(base + '/api/matches', 45000);
    if (r.error) { console.log(`  ${name} /api/matches -> ${r.error}`); continue; }
    let arr;
    try { arr = JSON.parse(r.text); } catch (e) { console.log(`  ${name} -> non-JSON (${r.status})`); continue; }
    const m = findMatch(arr);
    found[name.trim()] = m;
    if (!m) { console.log(`  ${name} -> match NOT FOUND (${arr.length} matches total)`); continue; }
    console.log(`  ${name} -> ${m.id}`);
    console.log(`        title=${JSON.stringify(String(m.title).slice(0, 60))}`);
    console.log(`        category=${m.category} status=${JSON.stringify(m.status)}`);
    console.log(`        date=${m.date ? new Date(Number(m.date)).toISOString() : '-'}`);
    console.log(`        sources=[${(m.sources || []).map(s => s.source).join(', ')}]`);
  }

  // Resolve + probe on both
  for (const [name, base] of [['LOCAL', LOCAL], ['PUBLIC', PUBLIC]]) {
    const m = found[name];
    console.log(`\n${'='.repeat(70)}\n${name} — stream resolution\n${'='.repeat(70)}`);
    if (!m) { console.log('  (no match)'); continue; }

    const sr = await get(`${base}/stream/tv/nuvio_sport_${m.id}.json`, 120000);
    if (sr.error) { console.log('  /stream error:', sr.error); continue; }
    let sj;
    try { sj = JSON.parse(sr.text); } catch (e) { console.log('  non-JSON:', sr.text.slice(0, 120)); continue; }
    const streams = sj.streams || [];
    console.log(`  resolved in ${sr.ms}ms -> ${streams.length} stream(s)`);
    streams.forEach((s, i) => {
      console.log(`   [${i}] ${s.name}`);
      console.log(`       ${String(s.title || '').replace(/\n/g, ' / ').slice(0, 76)}`);
      console.log(`       ${String(s.url || s.externalUrl || '').slice(0, 120)}`);
    });

    // Target the streamed.pk stream specifically, ignoring viewer count
    let targetStream = streams.find(s => s.url && !s.url.includes('/watch?') && String(s.title).toLowerCase().includes('streamed'));
    if (!targetStream) {
      targetStream = streams.find(s => s.url && !s.url.includes('/watch?'));
    }

    if (targetStream) {
      console.log(`\n  -> Probing stream: ${String(targetStream.title).replace(/\n/g, ' / ')}`);
      const proxyPath = targetStream.url.replace(/^https?:\/\/[^/]+/, '');
      const mr = await get(base + proxyPath, 40000);
      if (mr.error) {
        console.log(`  MANIFEST -> ERROR ${mr.error} (${mr.ms}ms)`);
      } else {
        const uris = mr.text.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).length;
        const seqM = /#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(mr.text);
        console.log(`  MANIFEST -> HTTP ${mr.status} in ${mr.ms}ms  bytes=${mr.text.length}  media-entries=${uris}  seq=${seqM ? seqM[1] : '-'}`);
        // first segment
        const seg = mr.text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))[0];
        if (seg) {
          const segUrl = seg.startsWith('http') ? seg : base + (seg.startsWith('/') ? seg : '/' + seg);
          const s0 = Date.now();
          try {
            const r2 = await fetch(segUrl, { signal: AbortSignal.timeout(30000) });
            const buf = Buffer.from(await r2.arrayBuffer());
            const ms = Date.now() - s0;
            console.log(`  SEGMENT  -> HTTP ${r2.status} ${(buf.length / 1024).toFixed(0)}KB in ${ms}ms = ${(buf.length / 1024 / (ms / 1000)).toFixed(0)} KB/s  ts=${buf[0] === 0x47}`);
          } catch (e) { console.log('  SEGMENT  -> ERR', e.message); }
        }
      }
    } else {
      console.log('  (no direct stream to probe)');
    }
  }

  process.exit(0);
})();
