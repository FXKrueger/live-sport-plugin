const { request } = require('undici');
(async () => {
    const url = 'https://m.ok.ru/video/15746445478612';
    console.log('Fetching m.ok.ru...');
    const { body } = await request(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15' }
    });
    const html = await body.text();
    // Look for video tags or JSON in the mobile HTML
    const videoMatches = html.match(/<video[^>]*src="([^"]+)"/g);
    if (videoMatches) {
        console.log('Found video tags:', videoMatches);
    } else {
        const jsonMatch = html.match(/data-options="([^"]+)"/);
        if (jsonMatch) {
            console.log('Found data-options on mobile');
        } else {
            // Find any mp4 urls
            const mp4s = html.match(/https:\/\/[^"'\s]+\.mp4[^"'\s]*/g);
            if (mp4s) console.log('Found mp4s:', mp4s.slice(0,2));
            else console.log('No direct mp4 found on mobile HTML');
        }
    }
})();
