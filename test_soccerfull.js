const { fetch } = require('undici');

async function extractSoccerfull(url) {
    try {
        console.log('Fetching', url);
        const res = await fetch(url);
        const html = await res.text();
        const iframeMatch = html.match(/<iframe[^>]+src="([^"]+)"/i);
        if (!iframeMatch) {
            console.log('No iframe found in html');
            console.log(html.substring(0, 300));
            return null;
        }
        
        let iframeUrl = iframeMatch[1];
        console.log('Iframe URL:', iframeUrl);
        if (iframeUrl.includes('hgcloud.to')) {
            iframeUrl = iframeUrl.replace('hgcloud.to', 'hanerix.com');
        }
        
        console.log('Fetching', iframeUrl);
        const iframeRes = await fetch(iframeUrl, {
            headers: {
                'Referer': 'https://soccerfull.net/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
            }
        });
        const iframeHtml = await iframeRes.text();
        
        if (iframeHtml.includes('sandbox not allowed') || iframeHtml.includes('Access denied')) {
            console.log('Access denied / sandbox not allowed block!');
            return null;
        }

        const start = iframeHtml.indexOf('eval(function(p,a,c,k,e,d)');
        if (start === -1) {
            console.log('eval not found in iframeHtml');
            return null;
        }
        
        const end = iframeHtml.indexOf('</script>', start);
        const packed = iframeHtml.substring(start, end).trim();
        const fnStr = packed.replace(/^eval/, '');
        const unpacked = eval(fnStr);
        
        const m3u8Match = unpacked.match(/file:"([^"]+\.m3u8[^"]*)"/);
        if (m3u8Match) {
            return m3u8Match[1];
        } else {
            console.log('m3u8 not found in unpacked');
            return null;
        }
    } catch (error) {
        console.error('Error:', error.message);
        return null;
    }
}

extractSoccerfull('https://soccerfull.net/play/15612').then(console.log);
