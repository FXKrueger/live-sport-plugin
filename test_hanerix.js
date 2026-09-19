const { request } = require('undici');
(async () => {
    const { body } = await request('https://hanerix.com/e/hb7sq8m5o1hh', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await body.text();
    const md5Match = html.match(/\/pass_md5\/[^\']+/);
    if (md5Match) {
        console.log('Found token URL:', md5Match[0]);
    } else {
        console.log('No pass_md5 token found.');
        const urls = html.match(/["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi);
        console.log('URLs:', urls);
        
        console.log('Checking for function calls like $.get(');
        const getCalls = html.match(/\$\.get\([^)]+\)/g);
        console.log('getCalls:', getCalls);
        
        console.log('\nLast 2000 chars:');
        console.log(html.slice(-2000));
    }
})();
