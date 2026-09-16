const undici = require('undici');
async function test() {
    try {
        const url = 'https://soccerfull.net/play/athletic-club-vs-atl-tico-madrid';
        const res = await undici.request(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await res.body.text();
        console.log('HTML size:', html.length);
        console.log('HTML:', html);
    } catch (err) {
        console.error(err);
    }
}
test();
