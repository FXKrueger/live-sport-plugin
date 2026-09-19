const { request } = require('undici');
(async () => {
    try {
        const testIp = '8.8.8.8';
        console.log('Testing X-Forwarded-For spoofing with IP:', testIp);
        
        // 1. Get iframe
        let res = await request('https://soccerfull.net/play/15711');
        let html = await res.body.text();
        const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        let finalUrl = iframeMatch[1].replace('hgcloud.to', 'hanerix.com');
        if (finalUrl.startsWith('//')) finalUrl = 'https:' + finalUrl;
        
        // 2. Fetch hanerix with XFF
        res = await request(finalUrl, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0',
                'X-Forwarded-For': testIp,
                'X-Real-IP': testIp,
                'Client-IP': testIp
            } 
        });
        html = await res.body.text();
        
        const start = html.indexOf('eval(function');
        const packed = html.substring(start, html.indexOf('</script>', start)).trim();
        const unpacked = eval(packed.replace(/^eval/, ''));
        
        const urlMatch = unpacked.match(/https?:\/\/[^\'\"]+\.m3u8[^\'\"]*/);
        console.log('Generated URL:', urlMatch[0]);
        
        // Let's check the hash parameter in the $.get call to see what IP it locked to
        const hashMatch = unpacked.match(/hash=([^&]+)/);
        if (hashMatch) {
            console.log('Hash parameter:', hashMatch[1]);
        }
    } catch(e) { console.error(e); }
})();
