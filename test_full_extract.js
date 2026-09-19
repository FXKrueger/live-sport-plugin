const { request } = require('undici');

async function extractHgCloud(url) {
    try {
        console.log('Fetching', url);
        // Step 1: soccerfull.net iframe
        let res = await request(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        let html = await res.body.text();
        const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        if (!iframeMatch) return null;
        
        let iframeUrl = iframeMatch[1];
        if (iframeUrl.startsWith('//')) iframeUrl = 'https:' + iframeUrl;
        console.log('Iframe:', iframeUrl);
        
        // Step 2: bypass JS redirect
        const finalUrl = iframeUrl.replace('hgcloud.to', 'hanerix.com');
        console.log('Final URL:', finalUrl);
        
        res = await request(finalUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        html = await res.body.text();
        
        // Step 3: Extract packed script
        const start = html.indexOf('eval(function(p,a,c,k,e,d)');
        if (start === -1) {
            console.log('Eval not found in HTML');
            return null;
        }
        
        const end = html.indexOf('</script>', start);
        const packed = html.substring(start, end).trim();
        
        // Replace eval with return to get unpacked string
        const fnStr = packed.replace(/^eval/, '');
        const unpacked = eval(fnStr);
        
        // Find m3u8 in unpacked code
        const m3u8Match = unpacked.match(/https?:\/\/[^\'\"]+\.m3u8[^\'\"]*/);
        if (m3u8Match) {
            return m3u8Match[0];
        } else {
            console.log('m3u8 not found in unpacked');
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
    return null;
}

extractHgCloud('https://soccerfull.net/play/15711').then(url => {
    if (url) console.log('\nSUCCESS:', url);
});
