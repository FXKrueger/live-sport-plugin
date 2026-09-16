const { handleStream } = require('./src/streams'); handleStream('sf_newcastle-united-vs-leeds-united').then(res => console.log(JSON.stringify(res, null, 2))).catch(e => console.error(e));
