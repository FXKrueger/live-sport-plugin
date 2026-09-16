const child_process = require('child_process');
const Provider = require('./src/providers/ReplayZoneProvider.js');
const undici = require('undici');

(async () => {
    const server = child_process.spawn('node', ['./src/index.js'], {
        env: { ...process.env, PORT: '7015', BASE_URL: 'http://127.0.0.1:7015' }
    });
    server.stdout.on('data', d => console.log('SERVER:', d.toString().trim()));
    server.stderr.on('data', d => console.error('SERVER ERR:', d.toString().trim()));

    await new Promise(r => setTimeout(r, 4000));

    // Force BASE_URL to local instance since ReplayZoneProvider requires it
    Object.keys(require.cache).forEach(k => delete require.cache[k]);
    process.env.BASE_URL = 'http://127.0.0.1:7015';

    const p = new Provider();
    console.log('Resolving stream...');
    const streams = await p.resolveStream('https://ok.ru/video/15746445478612', 'football', '');
    
    console.log('Got streams:', streams.length);
    if (streams.length === 0) {
        console.error('No streams resolved.');
        server.kill();
        return;
    }
    
    const targetUrl = streams[0].url;
    console.log('Testing proxy URL:', targetUrl);
    
    try {
        const res = await undici.request(targetUrl, {
            headers: { range: 'bytes=0-100' }
        });
        console.log('Status:', res.statusCode);
        console.log('CT:', res.headers['content-type']);
        
        const buf = await res.body.arrayBuffer();
        console.log('Bytes:', Buffer.from(buf).slice(0, 20).toString('hex'));
    } catch(err) {
        console.error(err);
    }
    
    server.kill();
    process.exit(0);
})();
