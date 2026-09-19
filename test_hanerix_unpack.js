const { request } = require('undici');
const fs = require('fs');

(async () => {
    const { body } = await request('https://hanerix.com/e/hb7sq8m5o1hh', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await body.text();
    const scripts = html.match(/<script type='text\/javascript'>eval\(function\(p,a,c,k,e,d\).*?<\/script>/s);
    if (scripts) {
        const unpackLogic = scripts[0].match(/eval\((function\(p,a,c,k,e,d\).+?)\)<\/script>/s);
        if (unpackLogic) {
            const unpacked = eval(`(${unpackLogic[1]})`);
            fs.writeFileSync('hgcloud_decoded.js', unpacked);
            console.log('Saved hgcloud_decoded.js');
        } else {
            console.log('No unpackLogic match');
        }
    } else {
        console.log('No scripts match');
    }
})();
