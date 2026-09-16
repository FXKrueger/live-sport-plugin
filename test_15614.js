const undici = require('undici');
(async () => {
    const html = await (await undici.request('https://soccerfull.net/play/15614', {headers:{'User-Agent':'Mozilla/5.0'}})).body.text();
    console.log('HTML length:', html.length);
    const m3 = html.match(/var\s+m3u8Url\s*=\s*["']([^"']+)["']/i);
    console.log('m3u8VarMatch:', m3 ? m3[1] : 'null');
    
    const ifm = html.match(/<iframe[^>]+src="([^"]+)"/i);
    console.log('iframe:', ifm ? ifm[1] : 'null');
    
    if (ifm) {
        const iUrl = ifm[1].replace('hgcloud.to','hanerix.com');
        console.log('Fetching iframe:', iUrl);
        const iHtml = await (await undici.request(iUrl, {headers:{Referer:'https://soccerfull.net/','User-Agent':'Mozilla/5.0'}})).body.text();
        console.log('iframe html len:', iHtml.length);
        
        const start = iHtml.indexOf('eval(function(p,a,c,k,e,d)');
        if (start !== -1) {
            const end = iHtml.indexOf('</script>', start);
            const unpacked = eval(iHtml.substring(start, end).replace(/^eval/, ''));
            const mMatch = unpacked.match(/file:"([^"]+\.m3u8[^"]*)"/);
            console.log('m3u8 extracted:', mMatch ? mMatch[1] : 'null');
        } else {
            console.log('eval not found');
        }
    }
})();
