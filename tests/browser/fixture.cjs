// Loopback-only whole-page fixture using the shipped loader and CSS bytes.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin/haru-assets.json')));

async function startFixture() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push({ path: url.pathname, method: request.method });
    response.setHeader('Cache-Control', 'no-store');
    const send = (type, bytes) => { response.setHeader('Content-Type', type); response.end(bytes); };
    if (url.pathname === '/') {
      const character = (id) => ({ name: id === 'alpha' ? 'Alpha fixture' : 'Beta fixture',
        root: '/synthetic/resources/' + id + '/', file: 'fixture.model3.json', idle: 'idle',
        greetings: ['wave'], welcome: null, size: 180, offset: 0, credit: 'Synthetic test data' });
      const config = { version: 'synthetic-browser', termsVersion: 'synthetic-v1',
        terms: '/terms', core: '/synthetic/core.js', engine: '/synthetic/engine.js', shaders: '/synthetic/shaders/',
        mobileEnabled: url.searchParams.get('mobile') === '1', mobilePauseOnInput: true,
        characters: { alpha: character('alpha'), beta: character('beta') } };
      if (url.searchParams.get('dialogue') === '1') for (const [id, c] of Object.entries(config.characters)) {
        c.greetings = [];
        c.dialogue = Object.fromEntries(['welcome','click','return','morning','afternoon','evening'].map((event) => [event, {enabled:true,cooldown:15,lines:[id + ' <literal> ' + event]}]));
      }
      if (url.searchParams.get('period') === '1') for (const c of Object.values(config.characters)) c.dialogue.welcome.enabled = false;
      if (url.searchParams.has('long')) for (const c of Object.values(config.characters)) c.dialogue.click.lines = [url.searchParams.get('long') === 'zh' ? '欢迎阅读'.repeat(25) : 'W'.repeat(300)];
      return send('text/html; charset=utf-8', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mascot synthetic browser fixture</title><link rel="stylesheet" href="/assets/${manifest.css}"><style>body{font:16px/1.6 system-ui;margin:24px;max-width:68ch}input{font:inherit}dialog{max-width:min(420px,80vw)}.fixture-note{background:#eef4f9;padding:16px}</style></head><body><h1>Browser contract fixture</h1><p class="fixture-note">Synthetic engine and resources. No Cubism SDK, model rendering, real GPU or physical mobile acceptance.</p><label for="outside-input">External reader input</label><input id="outside-input"><button id="outside-button">Reader action</button><dialog id="reader-dialog"><p>Reading notes fixture</p></dialog><script>window.__mascotFixture={events:[],holdCreate:false,holdPlay:false,pendingCreates:[],pendingPlays:[],gpuQueries:0,noFrames:false};</script><script id="wzf-live2d-config" type="application/json">${JSON.stringify(config)}</script><script src="/assets/${manifest.loader}" defer></script></body></html>`);
    }
    if (url.pathname === '/assets/' + manifest.loader) return send('text/javascript', fs.readFileSync(path.join(root, 'plugin', manifest.loader)));
    if (url.pathname === '/assets/' + manifest.css) return send('text/css', fs.readFileSync(path.join(root, 'plugin', manifest.css)));
    if (url.pathname === '/synthetic/core.js') return send('text/javascript', '/* Synthetic marker, not Cubism Core. */ window.Live2DCubismCore={syntheticOnly:true};');
    if (url.pathname === '/synthetic/engine.js') return send('text/javascript', fs.readFileSync(path.join(__dirname, 'synthetic-engine.js')));
    if (/^\/synthetic\/resources\/(alpha|beta)\/catalog\.json$/.test(url.pathname)) return send('application/json', JSON.stringify({ motions: [{id:'idle',label:'Idle fixture'},{id:'wave',label:'Wave fixture'}], expressions: [{id:'smile',label:'Smile fixture'}] }));
    if (/^\/synthetic\/resources\/(alpha|beta)\/(fixture\.model3|motion\/(idle|wave)|expression\/smile)\.json$/.test(url.pathname)) return send('application/json', '{"syntheticOnly":true}');
    if (url.pathname === '/terms') return send('text/plain', 'Synthetic fixture terms only. No resource rights are granted.');
    response.statusCode = 404; response.end('Not found');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { origin: 'http://127.0.0.1:' + server.address().port, requests,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }) };
}
module.exports = { startFixture };
