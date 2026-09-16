const { request } = require('undici');
const fs = require('fs');

(async () => {
    const { body } = await request('https://hanerix.com/e/hb7sq8m5o1hh', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await body.text();
    
    // Find the eval(function(p,a,c,k,e,d) block
    const start = html.indexOf('eval(function(p,a,c,k,e,d)');
    if (start === -1) return console.log('Not found');
    
    const end = html.indexOf('</script>', start);
    const packed = html.substring(start, end).trim();
    
    // Replace 'eval' with nothing to just return the function
    const fnStr = packed.replace(/^eval/, '');
    
    // Evaluate the function to get the unpacked string
    const unpacked = eval(fnStr);
    
    fs.writeFileSync('hgcloud_unpacked.js', unpacked);
    console.log('Saved hgcloud_unpacked.js. Size:', unpacked.length);
    
    const urls = unpacked.match(/https?:\/\/[^\'\"]+/g);
    console.log('URLs found:', urls);
})();
