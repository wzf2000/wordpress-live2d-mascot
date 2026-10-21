// Zero-resource PHP output smoke. Real WordPress import/render checks are separate.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(process.argv[2] || 'plugin');
// Exercise the real favorites reader and click handler with storage/UI stubs.
// Hidden and temporarily unavailable IDs must survive a change to another favorite.
const fs = require('node:fs');
const assets = JSON.parse(fs.readFileSync(path.join(root, 'haru-assets.json')));
const loader = fs.readFileSync(path.join(root, assets.loader), 'utf8');
const translate = (message, ...values) => message.replace(/%([1-9]\d*)\$s/g, (match, index) => String(values[Number(index) - 1] ?? match));
const reader = loader.slice(loader.indexOf('const readFavorites ='), loader.indexOf('let favorites ='));
const click = loader.slice(loader.indexOf('favoriteButton.onclick ='), loader.indexOf('clearSearch.onclick ='));
const exerciseFavorites = new Function('localStorage', 'characters', `
  const t = ${translate.toString()};
  const favoritesKey = 'wzf-mascot-favorites';
  ${reader}
  let favorites = readFavorites(), favoritesNotice = '', loading = false;
  const pendingFavorites = new Map(), favoriteButton = {};
  const characterSelect = { value: 'second', options: [1] };
  const favoritesFilter = { checked: false };
  const syncCharacterOptions = () => {}, paint = () => {};
  ${click}
  favoriteButton.onclick();
  characterSelect.value = 'first';
  favoriteButton.onclick();
  return [...favorites];
`);
let favoriteBytes = JSON.stringify(['first', 'disabled', 'trash', 'unavailable', 5, '', '\n']);
const writes = [];
const favoriteResult = exerciseFavorites({
  getItem: () => favoriteBytes,
  setItem: (key, value) => { writes.push(key); favoriteBytes = value; },
}, { first: {}, second: {} });
assert.deepEqual(new Set(favoriteResult), new Set(['disabled', 'trash', 'unavailable', 'second']));
assert.deepEqual(JSON.parse(favoriteBytes), favoriteResult);
assert.deepEqual(writes, ['wzf-mascot-favorites', 'wzf-mascot-favorites']);
// Candidate thumbnails only request the selected local image after opening the panel.
const thumbnailCode = loader.slice(loader.indexOf('const candidatePreview ='), loader.indexOf('const syncFavoriteButton ='));
const imageRequests = [];
const thumbnailElements = [];
const thumbnailElement = (tag) => {
  const element = { append() {}, setAttribute() {}, removeAttribute() {} };
  if (tag === 'img') Object.defineProperty(element, 'src', { set: (value) => imageRequests.push(value) });
  thumbnailElements.push(element); return element;
};
const exerciseThumbnail = new Function('make', 'characters', 'characterSelect', 'panel', 'location', 'URL', 'assert', 'requests', `
  const t = ${translate.toString()};
  let panelOpen = false;
  ${thumbnailCode}
  syncThumbnail();
  assert.equal(requests.length, 0);
  panelOpen = true; panel.hidden = false;
  syncThumbnail();
  assert.equal(requests.length, 1);
  assert.equal(candidateImage.loading, 'eager');
  candidateImage.onerror();
  syncThumbnail();
  assert.equal(requests.length, 1);
  assert.equal(candidateInitials.hidden, false);
  characterSelect.value = 'external'; syncThumbnail();
  characterSelect.value = 'missing'; syncThumbnail();
  assert.equal(requests.length, 1);
  characterSelect.value = 'second'; syncThumbnail();
  assert.equal(requests.length, 2);
  assert.equal(candidateImage.alt, 'Thumbnail of Second');
  panelOpen = false; characterSelect.value = 'first'; syncThumbnail();
  assert.equal(requests.length, 2);
`);
exerciseThumbnail(thumbnailElement, {
  first: { name: 'First', thumbnail: 'https://example.invalid/uploads/wzf-mascot/thumbnail-' + 'a'.repeat(32) + '/image.png' },
  second: { name: 'Second', thumbnail: 'https://example.invalid/uploads/wzf-mascot/thumbnail-' + 'b'.repeat(32) + '/image.png' },
  external: { name: 'External', thumbnail: 'https://other.invalid/uploads/wzf-mascot/thumbnail-' + 'c'.repeat(32) + '/image.png' },
  missing: { name: 'Missing' },
}, { value: 'first' }, { hidden: true }, { origin: 'https://example.invalid' }, URL, assert, imageRequests);
assert.ok(imageRequests.every((url) => url.endsWith('/image.png')));
// Run the actual local diagnostics controller without a renderer or network.
const diagnosticCode = loader.slice(loader.indexOf('let diagnosticsEnabled ='), loader.indexOf('let button = document.querySelector'));
let clock = 100, frameCount = 100, drawAverage = 2, gpuQueries = 0, exportedBlob = null;
const timers = new Map(); let timerId = 0;
const testEngine = { gl: {
  getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }),
  getParameter: () => { gpuQueries++; return 'Synthetic SwiftShader'; },
}, state: () => ({ frames: frameCount, renderMsAvg: drawAverage, renderMsMax: 10, paused: false }) };
const makeElement = () => ({ append() {}, setAttribute() {}, click() {}, remove() {} });
const exerciseDiagnostics = new Function('make', 'document', 'engine', 'allowed', 'performance', 'setTimeout', 'clearTimeout', 'config', 'active', 'reduce', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'URL', 'fetch', 'crypto', 'assert', 'advance', 'gpuCount', 'runNextTimer', `
  const t = ${translate.toString()};
  let loading = false;
  ${diagnosticCode}
  diagnosticUpdate();
  assert.equal(gpuCount(), 0);
  assert.equal(diagnosticExport.disabled, true);
  diagnosticEnable.onclick();
  assert.equal(gpuCount(), 1);
  diagnosticSample.onclick();
  advance(3100, 160, 3);
  finishDiagnosticSample();
  assert.equal(diagnosticReport.sample.frameDelta, 60);
  assert.equal(diagnosticReport.sample.fps, 20);
  assert.equal(diagnosticReport.sample.interrupted, false);
  assert.equal(diagnosticReport.sample.cpuDrawMsAvg, 280 / 60);
  advance(4000, 160, 3);
  diagnosticSample.onclick();
  advance(4500, 170, 3);
  interruptDiagnostics('reading-suspension');
  assert.equal(diagnosticReport.sample.interrupted, true);
  assert.equal(diagnosticReport.sample.reason, 'reading-suspension');
  const savedFirstWindow = JSON.stringify(diagnosticWindows[0]);
  advance(5000, 0, 0);
  diagnosticBegin('failed-preview');
  diagnosticError({ code: 'http', category: 'texture', message: 'https://private.invalid/secret?cookie=never-export' });
  diagnosticBegin('fallback-character', true);
  active = 'fallback-character';
  diagnosticReady();
  assert.equal(currentLoad.readyMs, 0);
  assert.equal(currentLoad.firstFrameMs, null);
  advance(5100, 0, 0); runNextTimer();
  assert.equal(currentLoad.firstFrameMs, null);
  advance(5200, 1, 0); runNextTimer();
  assert.equal(currentLoad.firstFrameMs, 200);
  assert.equal(currentLoad.firstFrameStatus, 'observed');
  assert.equal(diagnosticReport.loadAttempts[0].status, 'failed');
  assert.equal(diagnosticReport.loadAttempts[0].error.characterId, 'failed-preview');
  assert.equal(diagnosticReport.loadAttempts[1].fallback, true);
  assert.equal(diagnosticReport.renderedCharacterId, 'fallback-character');
  assert.equal(diagnosticReport.sample.characterId, 'synthetic-character');
  assert.equal(JSON.stringify(diagnosticWindows[0]), savedFirstWindow);
  diagnosticExport.onclick();
  for (let i = 0; i < 25; i++) {
    diagnosticSample.onclick(); advance(10000 + i * 3001, 10 + i, 1); finishDiagnosticSample();
  }
  assert.equal(diagnosticWindows.length, 20);
  assert.equal(replacedWindows, 7);
  diagnosticEnable.onclick();
  assert.equal(diagnosticExportBatch.disabled, false);
  return diagnosticReport;
`);
const diagnosticResult = exerciseDiagnostics(makeElement, { body: { append() {} } }, testEngine, () => true,
  { now: () => clock }, (fn) => { timers.set(++timerId, fn); return timerId; }, (id) => timers.delete(id),
  { version: '3.6.0' }, 'synthetic-character', { matches: false }, 1200, 800, 1,
  { createObjectURL: (blob) => { exportedBlob = blob; return 'blob:local'; }, revokeObjectURL() {} },
  () => { throw Error('Diagnostics must not make network requests'); }, require('node:crypto').webcrypto, assert,
  (time, frames, average) => { clock = time; frameCount = frames; drawAverage = average; }, () => gpuQueries, () => { const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); });
assert.equal(diagnosticResult.environment.softwareRenderer, true);
exportedBlob.text().then((text) => {
  const report = JSON.parse(text);
  assert.equal(report.error, null);
  assert.equal(report.load, null);
  assert.equal(report.sample.characterId, 'synthetic-character');
  assert.equal(report.sample.interrupted, true);
  assert.equal(report.windowId, 2);
  assert.equal(report.loadAttempts.length, 0);
  assert.equal(text.includes('private.invalid'), false);
  assert.equal(text.includes('secret'), false);
});
const child = spawn('php', ['-r', `
  define('ABSPATH', '/stub/');
  function add_action(...$args) {}
  function add_filter(...$args) {}
  function plugin_basename($file) { return "live2d-show/live2d-show.php"; }
  function is_admin() { return false; }
  function is_user_logged_in() { return false; }
  function get_option($key, $default) { return $default; }
  require getenv('CANDIDATE_PLUGIN') . '/live2d-show.php';
  wzf_haru_output();
`], { env: { ...process.env, CANDIDATE_PLUGIN: root } });
let output = '', error = '';
child.stdout.on('data', (data) => { output += data; });
child.stderr.on('data', (data) => { error += data; });
child.on('error', (cause) => { throw cause; });
child.on('close', (code) => {
  assert.equal(code, 0, error);
  assert.equal(error, '');
  assert.equal(output, '');
  console.log('Zero-resource plugin emits no frontend markup or assets.');
});

// Execute the actual mobile display gate and save routing, independently of desktop state.
const mobileGate = loader.slice(loader.indexOf('const displayWanted ='), loader.indexOf('const paint ='));
const mobileSave = loader.slice(loader.indexOf('const save ='), loader.indexOf('agree.onclick ='));
new Function('assert', 'localStorage', `
  const desktop = {matches:false}, reduce = {matches:false}, config = {};
  const document = {hidden:false}, suspensions = new Set();
  let wanted=true, mobileOptIn=false, accepted=true, failed=false, pageHidden=false;
  ${mobileGate}
  ${mobileSave}
  assert.equal(allowed(),false);
  config.mobileEnabled=true; assert.equal(allowed(),false);
  mobileOptIn=true; assert.equal(allowed(),true); save();
  reduce.matches=true; assert.equal(allowed(),false); reduce.matches=false;
  accepted=false; assert.equal(allowed(),false); accepted=true;
  suspensions.add('reader'); assert.equal(allowed(),false); suspensions.clear();
  document.hidden=true; assert.equal(allowed(),false); document.hidden=false;
  config.mobileEnabled=false; assert.equal(allowed(),false);
  desktop.matches=true; assert.equal(allowed(),true); save();
`)(assert, {setItem:(key,value)=>writes.push([key,value])});
assert.deepEqual(writes.slice(-2), [['wzf-mascot-mobile-v1','enabled'],['wzfl-mascot','shown']]);
// API acceptance never shows/loads/switches the mascot and rejects unknown or malformed commands.
const apiCode = loader.slice(loader.indexOf('let externalPending ='), loader.indexOf('const setSuspension ='));
const exerciseAPI = new Function('assert', 'performance', 'setTimeout', 'clearTimeout', `
  let permitted=false, engine=null, loading=false, touchPending=false, active='test', generation=1, operation=0, welcomeConsumed=false;
  const manualPending=new Set(), window={}, state={}, calls=[];
  // The extracted legacy command boundary now also installs semantic/help hooks.
  // Their full behavior is covered by the whole-page dialogue browser suite.
  const helpButton={addEventListener:()=>{}},document={addEventListener:()=>{}};
  const pendingPreset=null,cancelPreset=()=>{},clearDialogue=()=>{};
  const allowed=()=>permitted, cancelWelcome=()=>{};
  let resolvePlay=null, asyncPlay=false;
  const target={state:()=>({paused:false}), catalog:{motions:[{id:'01'}], expressions:[{id:'smile'}]},
    play:(type,id)=>{calls.push([type,id]);return asyncPlay ? new Promise((resolve)=>resolvePlay=resolve) : Promise.resolve(true);},
    cancelPending:(type)=>calls.push(['cancel',type]), idleNow:()=>calls.push(['idle']),resetExpression:()=>calls.push(['reset'])};
  ${apiCode}
  return (async()=>{
    const api=window.WZFMascot;
    assert.equal(api.version,1); assert.ok(Object.isFrozen(api));
    assert.equal((await api.command({action:'motion',id:'01'})).code,'unavailable');
    engine=target; permitted=true;
    for(const req of [{action:'show'},{action:'motion',id:'https://external.invalid/a'}, {action:'motion',id:'01',url:'x'}, {action:'reset',id:'01'},{action:'stop',channel:'all'}, {action:'motion',id:'01',caption:'<script>'}, {action:'motion',id:'01',caption:'x'.repeat(121)}]) {
      assert.equal((await api.command(req)).ok,false);
    }
    const getter={}; Object.defineProperty(getter,'action',{get(){throw Error('getter ran');}});
    assert.equal((await api.command(getter)).code,'invalid-request');
    assert.equal(calls.length,0);
    assert.equal((await api.command({action:'motion',id:'01',caption:'Hello'})).code,'played');
    assert.equal(state.textContent,'Hello');
    assert.equal((await api.command({action:'reset'})).code,'rate-limited');
    performance.advance(600);
    manualPending.add('motion'); assert.equal((await api.command({action:'reset'})).code,'busy'); manualPending.clear();
    asyncPlay=true;
    const pending=api.command({action:'expression',id:'smile',caption:'Late'});
    assert.equal((await api.command({action:'stop'})).code,'busy');
    assert.equal(api.cancel().code,'cancelled'); resolvePlay(true);
    assert.equal((await pending).code,'cancelled'); assert.notEqual(state.textContent,'Late');
    performance.advance(600);
    assert.equal((await api.command({action:'reset',channel:'expression'})).code,'reset');
    assert.ok(calls.some((item)=>item[0]==='reset'));
    permitted=false;
    assert.equal((await api.command({action:'stop'})).code,'unavailable');
    assert.equal(active,'test');
  })();
`);
let apiTime=1000;
exerciseAPI(assert,{now:()=>apiTime,advance:(delta)=>apiTime+=delta},()=>1,()=>{}).catch((error)=>{console.error(error);process.exitCode=1;});

// External mobile inputs suspend; the mascot's own search/select widgets do not.
const inputCode = loader.slice(loader.indexOf('const syncMobileInput ='), loader.indexOf("document.addEventListener('focusin'"));
new Function('assert', `
  const input={matches:()=>true}, ownInput={matches:()=>true};
  const panel={contains:(node)=>node===ownInput}, controlsDock={contains:()=>false}, host=null, consent={contains:()=>false};
  const document={activeElement:input}, desktop={matches:false}, config={mobileEnabled:true}; let mobileOptIn=true, suspended=false;
  const setSuspension=(source,value)=>{assert.equal(source,'mobile-input');suspended=value;};
  ${inputCode}
  syncMobileInput(); assert.equal(suspended,true);
  document.activeElement=ownInput; syncMobileInput(); assert.equal(suspended,false);
  document.activeElement=input; config.mobilePauseOnInput=false;syncMobileInput();assert.equal(suspended,false);
  config.mobilePauseOnInput=true;desktop.matches=true;syncMobileInput();assert.equal(suspended,false);
`)(assert);
