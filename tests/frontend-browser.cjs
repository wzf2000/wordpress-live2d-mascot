
const expandNavigation = async (page) => {
 for (const selector of ['.wzf-haru-character-settings', '.wzf-haru-more-settings']) {
  const details=page.locator(selector);if(!await details.evaluate(el=>el.open))await details.locator(':scope > summary').click();
 }
};
// Whole shipped loader/CSS in a real local browser. Synthetic engine contract;
// never a Cubism SDK/model, real GPU, physical mobile or licensing acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startFixture } = require('./browser/fixture.cjs');
const dependency = process.env.MASCOT_PLAYWRIGHT || 'playwright';
const { chromium } = require(dependency);
const playwrightVersion = require(require.resolve(dependency + '/package.json')).version;
assert.equal(playwrightVersion, '1.55.1', 'Use the lockfile-pinned Playwright 1.55.1');
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--out'), 'Usage: node tests/frontend-browser.cjs [--out DIRECTORY]');
const output = args.length ? path.resolve(args[1]) : null;
if (output) fs.mkdirSync(output, { recursive: true });

(async () => {
  const fixture = await startFixture();
  let browser;
  const checks = [], errors = [], externalRequests = [];
  const report = { schema: 1, syntheticOnly: true, realRenderingTested: false,
    visibilityEventSimulated: true, contextLossEventSimulated: true,
    mobileViewportOnly: true, browserExecutableOverridden: !!process.env.MASCOT_CHROMIUM, playwright: playwrightVersion, checks, complete: false };
  const shot = async (page, name) => { if (output) await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true }); };
  const wait = (page, values) => page.waitForFunction((expected) => {
    const state = window.WZFHaruStatus?.();
    return state && Object.entries(expected).every(([key, value]) => state[key] === value);
  }, values);
  const status = (page) => page.evaluate(() => window.WZFHaruStatus());
  const heavy = () => fixture.requests.filter((request) => request.path.startsWith('/synthetic/'));
  const loadPage = async (page, suffix = '') => {
    await page.goto(fixture.origin + '/' + suffix);
    await wait(page, { loading: false });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const show = async (page) => {
    await page.locator('.wzfl-mascot-toggle').click();
    await page.getByRole('dialog', { name: 'Show mascot' }).getByRole('button', { name: /^Accept terms/ }).click();
    await wait(page, { ready: true, loading: false, paused: false });
  };
  const interact = async (page) => {
    if (!(await status(page)).panelOpen) await page.getByRole('button', { name: 'Interact', exact: true }).click();await expandNavigation(page);
    await page.locator('#wzf-haru-panel').waitFor({ state: 'visible' });
  };
  const suspend = (page, source, suspended) => page.evaluate(({ source, suspended }) => {
    document.dispatchEvent(new CustomEvent('wzf-mascot-suspension', { detail: { source, suspended } }));
  }, { source, suspended });
  const command = async (page, request) => {
    await page.waitForTimeout(510); // Public API intentionally limits accepted commands to 500ms.
    return page.evaluate((value) => window.WZFMascot.command(value), request);
  };
  const run = async (name, action) => {
    await action(); assert.deepEqual(errors, [], 'Uncaught page errors');
    assert.deepEqual(externalRequests, [], 'Fixture must never request external services');
    checks.push(name); console.log('PASS ' + name);
  };
  try {
    browser = await chromium.launch({ headless: true,
      ...(process.env.MASCOT_CHROMIUM ? { executablePath: process.env.MASCOT_CHROMIUM } : {}) });
    report.chromium = browser.version();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference', serviceWorkers: 'block' });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(fixture.origin + '/')) return route.continue();
      externalRequests.push(new URL(url).protocol); return route.abort();
    });
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
    const page = await context.newPage(); page.setDefaultTimeout(7000);
    await run('guest diagnostics cannot be enabled by URL or local storage', async () => {
      await loadPage(page,'?diagnostics=1');
      await page.evaluate(()=>localStorage.setItem('wzf-mascot-diagnostics','enabled'));
      assert.equal(await page.locator('.wzf-haru-diagnostics').count(),0);
      assert.equal(await page.evaluate(()=>window.__mascotFixture.gpuQueries),0);
      await loadPage(page,'?role=subscriber');
      assert.equal(await page.locator('.wzf-haru-diagnostics').count(),0);
      assert.equal(await page.evaluate(()=>window.__mascotFixture.gpuQueries),0);
    });
    await run('consent gates all runtime requests; cancel consent keeps resources unloaded', async () => {
      await loadPage(page); assert.equal(heavy().length, 0);
      assert.equal(await page.evaluate(() => !!window.Live2DCubismCore || !!window.WZFHaruEngine), false);
      await page.locator('.wzfl-mascot-toggle').click();
      await page.getByRole('dialog', { name: 'Show mascot' }).getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(heavy().length, 0);
      await show(page); assert.equal((await status(page)).character, 'alpha');
      assert(heavy().some((request) => request.path.endsWith('/core.js')));
      assert(heavy().some((request) => request.path.endsWith('/engine.js')));
      assert(heavy().some((request) => request.path.endsWith('/alpha/fixture.model3.json')));
      assert.equal(await page.evaluate(() => localStorage.getItem('wzf-haru-terms')), 'synthetic-v1');
    });
    const failAlpha = async (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Synthetic missing model' });
    const alphaModel = '**/alpha/fixture.model3.json';
    const recoveryEntry = () => page.getByRole('button', { name: 'Choose another character', exact: true });
    const openRecovery = async () => {
      await recoveryEntry().focus(); await page.keyboard.press('Enter');
      assert.equal(await page.getByLabel('Choose character', { exact: true }).evaluate(el => el === document.activeElement), true);
      assert.equal(await page.locator('.wzf-haru-more-settings').isVisible(), false);
    };
    await run('first-load error exposes keyboard recovery while consent, reading, reduced motion and mobile gates remain effective', async () => {
      await page.route(alphaModel, failAlpha); await page.reload();
      await wait(page, { failed: true, ready: false, loading: false, committed: 'alpha' });
      const creates = await page.evaluate(() => window.__mascotFixture.events.filter(event => event.type === 'create-start').length);
      assert.equal(await recoveryEntry().isVisible(), true);
      await suspend(page, 'recovery-reader', true); assert.equal(await recoveryEntry().isVisible(), false);
      await suspend(page, 'recovery-reader', false); assert.equal(await recoveryEntry().isVisible(), true);
      await page.emulateMedia({ reducedMotion: 'reduce' }); await page.locator('.wzf-haru-panel-toggle').waitFor({ state: 'hidden' });
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await recoveryEntry().waitFor();
      await page.setViewportSize({ width: 390, height: 844 }); await page.locator('.wzf-haru-panel-toggle').waitFor({ state: 'hidden' });
      await page.setViewportSize({ width: 1440, height: 900 }); await recoveryEntry().waitFor();
      assert.equal(await page.evaluate(() => window.__mascotFixture.events.filter(event => event.type === 'create-start').length), creates);
      await openRecovery(); await shot(page, 'first-load-recovery');
      await page.unroute(alphaModel, failAlpha);
      await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
      assert.equal(await page.locator('.wzfl-mascot-toggle').evaluate(el => el === document.activeElement), true);
      await wait(page, { failed: false, ready: true, loading: false, character: 'alpha', committed: 'alpha', preview: false });
      assert.equal(await page.evaluate(() => localStorage.getItem('wzf-mascot-character')), null);
    });
    await run('first-load recovery uses normal preview, cancel and explicit confirmation without overwriting saved preferences', async () => {
      await page.route(alphaModel, failAlpha); await page.reload();
      await wait(page, { failed: true, ready: false, loading: false }); await openRecovery();
      await page.getByLabel('Choose character', { exact: true }).selectOption('beta');
      await page.getByRole('button', { name: 'Preview character', exact: true }).click();
      await wait(page, { failed: false, ready: true, loading: false, character: 'beta', committed: 'alpha', preview: true });
      assert.equal(await page.getByRole('button', { name: 'Use this character', exact: true }).evaluate(el => el === document.activeElement), true);
      assert.equal(await page.evaluate(() => localStorage.getItem('wzf-mascot-character')), null);
      await page.getByRole('button', { name: 'Cancel preview', exact: true }).click();
      await wait(page, { failed: true, ready: false, loading: false, character: 'alpha', committed: 'alpha', preview: false });
      assert.equal(await page.evaluate(() => localStorage.getItem('wzf-mascot-character')), null);
      await page.getByLabel('Choose character', { exact: true }).selectOption('beta');
      await page.getByRole('button', { name: 'Preview character', exact: true }).click();
      await wait(page, { ready: true, loading: false, character: 'beta', preview: true });
      await shot(page, 'recovery-character-preview');
      await page.getByRole('button', { name: 'Use this character', exact: true }).click();
      await wait(page, { committed: 'beta', preview: false });
      assert.equal(await page.evaluate(() => localStorage.getItem('wzf-mascot-character')), 'beta');
      await page.reload(); await wait(page, { ready: true, loading: false, character: 'beta', committed: 'beta' });
      await page.unroute(alphaModel, failAlpha);
      await page.evaluate(() => localStorage.removeItem('wzf-mascot-character'));
      await page.reload(); await wait(page, { ready: true, loading: false, character: 'alpha', committed: 'alpha' });
    });
    await run('cancelled recovery preview discards late candidates and cannot revive or replace the original saved character', async () => {
      await page.route(alphaModel, failAlpha); await page.reload();
      await wait(page, { failed: true, ready: false, loading: false }); await openRecovery();
      await page.getByLabel('Choose character', { exact: true }).selectOption('beta');
      await page.evaluate(() => { window.__mascotFixture.holdCreate = true; });
      await page.getByRole('button', { name: 'Preview character', exact: true }).click();
      await page.waitForFunction(() => window.__mascotFixture.pendingCreates.length === 1);
      await page.locator('.wzfl-mascot-toggle').click();
      await wait(page, { wanted: false, ready: false, loading: false, character: 'alpha', committed: 'alpha', preview: false });
      await page.unroute(alphaModel, failAlpha);
      await page.locator('.wzfl-mascot-toggle').click();
      await wait(page, { ready: true, loading: false, character: 'alpha' });
      const discarded = await page.evaluate(() => window.__mascotFixture.events.filter(event => event.type === 'destroy').length);
      await page.evaluate(() => window.__mascotFixture.pendingCreates.shift()());
      await page.waitForFunction(count => window.__mascotFixture.events.filter(event => event.type === 'destroy').length > count, discarded);
      await wait(page, { ready: true, loading: false, character: 'alpha', committed: 'alpha', preview: false });
      assert.equal(await page.evaluate(() => localStorage.getItem('wzf-mascot-character')), null);
      if ((await status(page)).panelOpen) await page.getByRole('button', { name: 'Close interaction', exact: true }).click();
    });
    await run('suspending a recovery preview keeps the failed original inactive after resume and late candidates never steal focus', async () => {
      await page.route(alphaModel, failAlpha); await page.reload();
      await wait(page, { failed: true, ready: false, loading: false }); await openRecovery();
      await page.getByLabel('Choose character', { exact: true }).selectOption('beta');
      await page.evaluate(() => { window.__mascotFixture.holdCreate = true; });
      await page.getByRole('button', { name: 'Preview character', exact: true }).click();
      await page.waitForFunction(() => window.__mascotFixture.pendingCreates.length === 1);
      assert.equal(await page.locator('.wzfl-mascot-toggle').evaluate(el => el === document.activeElement), true);
      await suspend(page, 'cancel-recovery', true);
      await wait(page, { failed: true, ready: false, loading: false, character: 'alpha', committed: 'alpha' });
      const creates = await page.evaluate(() => window.__mascotFixture.events.filter(event => event.type === 'create-start').length);
      await page.locator('#outside-button').focus();
      await suspend(page, 'cancel-recovery', false);
      await wait(page, { failed: true, ready: false, loading: false });
      const discarded = await page.evaluate(() => window.__mascotFixture.events.filter(event => event.type === 'destroy').length);
      await page.evaluate(() => window.__mascotFixture.pendingCreates.shift()());
      await page.waitForFunction(count => window.__mascotFixture.events.filter(event => event.type === 'destroy').length > count, discarded);
      assert.equal(await page.evaluate(() => window.__mascotFixture.events.filter(event => event.type === 'create-start').length), creates);
      assert.equal(await page.locator('#outside-button').evaluate(el => el === document.activeElement), true);
      await wait(page, { failed: true, ready: false, loading: false, committed: 'alpha' });
      assert.equal(await page.evaluate(() => localStorage.getItem('wzf-mascot-character')), null);
      await page.unroute(alphaModel, failAlpha);
      await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
      await wait(page, { failed: false, ready: true, loading: false, character: 'alpha', committed: 'alpha' });
    });
    await run('recovery after a shared runtime download failure obtains the runtime before previewing another character', async () => {
      const corePath = '**/synthetic/core.js';
      const failCore = route => route.fulfill({ status: 503, body: 'Synthetic runtime unavailable' });
      await page.route(corePath, failCore); await page.reload();
      await wait(page, { failed: true, ready: false, loading: false });
      assert.equal(await page.evaluate(() => !!window.WZFHaruEngine), false);
      await openRecovery(); await page.unroute(corePath, failCore);
      await page.getByLabel('Choose character', { exact: true }).selectOption('beta');
      await page.getByRole('button', { name: 'Preview character', exact: true }).click();
      await wait(page, { ready: true, loading: false, character: 'beta', committed: 'alpha', preview: true });
      assert.equal(await page.evaluate(() => localStorage.getItem('wzf-mascot-character')), null);
      await page.getByRole('button', { name: 'Cancel preview', exact: true }).click();
      await wait(page, { ready: true, loading: false, character: 'alpha', committed: 'alpha', preview: false });
    });
    await run('preview/cancel/commit and refresh preserve real browser selection and layout', async () => {
      await interact(page); await page.getByLabel('Choose character', { exact: true }).selectOption('beta');
      await page.getByRole('button', { name: 'Preview character', exact: true }).click();
      await wait(page, { character: 'beta', preview: true, loading: false });
      assert.equal(await page.evaluate(() => localStorage.getItem('wzf-mascot-character')), null);
      await page.getByRole('button', { name: 'Cancel preview', exact: true }).click();
      await wait(page, { character: 'alpha', preview: false, loading: false });
      await page.getByLabel('Choose character', { exact: true }).selectOption('beta');
      await page.getByRole('button', { name: 'Preview character', exact: true }).click();
      await wait(page, { character: 'beta', preview: true, loading: false });
      await page.getByRole('button', { name: 'Use this character', exact: true }).click();
      await wait(page, { character: 'beta', committed: 'beta', preview: false });
      await page.getByText('Position and size', { exact: true }).click();
      await page.getByLabel('Character position', { exact: true }).selectOption('left');
      await page.getByLabel('Character size', { exact: true }).fill('220');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('wzf-mascot-layouts')).beta.size), 220);
      await page.reload(); await wait(page, { character: 'beta', ready: true, loading: false });
      assert.equal(await page.evaluate(() => localStorage.getItem('wzf-mascot-character')), 'beta');
      await interact(page); await shot(page, 'desktop-interaction');
    });
    await run('real keyboard Escape respects IME composition and returns focus to interaction toggle', async () => {
      const search = page.getByRole('searchbox', { name: 'Search characters', exact: true });
      await search.fill('beta'); await search.focus();
      await search.dispatchEvent('compositionstart', { data: '測' });
      await page.keyboard.press('Escape'); assert.equal((await status(page)).panelOpen, true);
      await search.dispatchEvent('compositionend', { data: '測' });
      await search.dispatchEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true });
      assert.equal((await status(page)).panelOpen, true);
      await page.keyboard.press('Escape'); assert.equal((await status(page)).panelOpen,true);
      assert.equal(await page.locator('.wzf-haru-character-settings').evaluate(el=>el.open),false);
      await page.keyboard.press('Escape'); await wait(page, { panelOpen: false });
      assert.equal(await page.getByRole('button', { name: 'Interact', exact: true }).evaluate((node) => node === document.activeElement), true);
      assert.equal((await status(page)).committed, 'beta');
    });
    await run('PageNest docked comments preserve reading suspension across empty, hidden, dialog and overlapping states', async () => {
      const target = await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'no-preference',serviceWorkers:'block'});
      target.on('pageerror', error => errors.push(error.message));
      await target.route('**/*', route => {
        if(route.request().url().startsWith(fixture.origin + '/')) return route.continue();
        externalRequests.push(new URL(route.request().url()).protocol); return route.abort();
      });
      await target.goto(fixture.origin + '/?dialogue=1&mobile=1');
      await target.evaluate(() => {
        localStorage.setItem('wzfl-mascot','shown'); localStorage.setItem('wzf-haru-terms','synthetic-v1');
        localStorage.setItem('wzf-mascot-character','alpha'); localStorage.setItem('wzf-mascot-dialogue-v1','auto');
        localStorage.setItem('wzf-mascot-mobile-v1','enabled');
      });
      await target.reload(); await wait(target, {ready:true,loading:false,paused:false});
      assert.equal(await target.locator('.wzf-haru-bubble').textContent(), 'alpha <literal> welcome');
      // Match PageNest reading.php and Companion paragraph-comments.js, without loading either product.
      await target.evaluate(() => {
        const rail=document.createElement('aside'); rail.className='pagenest-reading-rail pagenest-panel-active';
        rail.innerHTML='<div class="pagenest-reading-panel" data-pagenest-reading-panel><section class="pagenest-pc-panel" hidden>Comment panel fixture</section></div>';
        document.body.append(rail);
      });
      await target.waitForTimeout(60); assert.equal((await status(target)).paused,false);
      await target.evaluate(() => document.querySelector('.pagenest-pc-panel').hidden=false);
      await wait(target,{suspended:true,paused:true}); await shot(target,'comments-docked-desktop');
      await target.evaluate(() => document.querySelector('[data-pagenest-reading-panel]').hidden=true);
      await wait(target,{suspended:false,paused:false});
      await target.evaluate(() => document.querySelector('[data-pagenest-reading-panel]').hidden=false);
      await wait(target,{paused:true});
      const resumes = () => target.evaluate(() => window.__mascotFixture.events.filter(e=>e.type==='resume').length);
      const before = await resumes();
      await target.evaluate(() => {
        const rail=document.querySelector('.pagenest-reading-rail'), slot=rail.querySelector('[data-pagenest-reading-panel]');
        const dialog=document.getElementById('reader-dialog'); dialog.append(slot.firstElementChild);
        rail.classList.remove('pagenest-panel-active'); slot.hidden=true; dialog.showModal();
      });
      await target.waitForTimeout(60); assert.equal((await status(target)).paused,true); assert.equal(await resumes(),before);
      await target.setViewportSize({width:390,height:844}); await shot(target,'comments-dialog-mobile');
      await target.evaluate(() => {
        const dialog=document.getElementById('reader-dialog'), rail=document.querySelector('.pagenest-reading-rail');
        const slot=rail.querySelector('[data-pagenest-reading-panel]');
        dialog.close(); slot.append(dialog.querySelector('.pagenest-pc-panel')); slot.hidden=false; rail.classList.add('pagenest-panel-active');
      });
      await target.waitForTimeout(60); assert.equal((await status(target)).paused,true); assert.equal(await resumes(),before);
      await suspend(target,'other-reader',true);
      await target.evaluate(() => {
        document.querySelector('.pagenest-reading-rail').classList.remove('pagenest-panel-active');
        document.querySelector('[data-pagenest-reading-panel]').hidden=true;
      });
      await target.waitForTimeout(60); assert.equal((await status(target)).paused,true);
      await suspend(target,'other-reader',false); await wait(target,{paused:false,suspended:false});
      assert.equal(await target.locator('.wzf-haru-bubble').textContent(),'');
      await target.evaluate(() => {
        const slot=document.querySelector('[data-pagenest-reading-panel]'); slot.replaceChildren(); slot.hidden=false;
        document.querySelector('.pagenest-reading-rail').classList.add('pagenest-panel-active');
      });
      await target.waitForTimeout(60); assert.equal((await status(target)).paused,false);
      await target.evaluate(() => {
        const rail=document.querySelector('.pagenest-reading-rail'); rail.className='pagenest-reading-rail llmn-show-notes';
        rail.innerHTML='<div class="pagenest-notes-slot"><section class="llmc-panel">Legacy comments fixture</section></div>';
      });
      await wait(target,{paused:true});
      await target.evaluate(() => document.querySelector('.llmc-panel').hidden=true);
      await wait(target,{paused:false});
      await target.close();
    });
    await run('reading DOM and multiple suspension sources compose; visibility/page lifecycle pause and resume', async () => {
      await page.evaluate(() => document.getElementById('reader-dialog').showModal());
      await wait(page, { suspended: true, paused: true });
      await suspend(page, 'notes', true); await suspend(page, 'notes', true); await suspend(page, 'comments', true);
      await page.evaluate(() => document.getElementById('reader-dialog').close());
      await page.waitForFunction(() => !window.WZFHaruStatus().suspensionSources.includes('reading-ui'));
      await suspend(page, 'notes', false); await wait(page, { suspended: true, paused: true });
      assert((await status(page)).suspensionSources.includes('event:comments'));
      assert.equal((await page.evaluate(() => window.WZFMascot.command({ action: 'motion', id: 'wave' }))).code, 'unavailable');
      await suspend(page, 'comments', false); await wait(page, { suspended: false, paused: false });
      // Headless visibility cannot represent a physical tab switch. Dispatch the
      // browser's actual DOM event with only the readonly state getter simulated.
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await wait(page, { paused: true }); assert.equal(await page.locator('#wzf-haru-character').isVisible(), false);
      await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
      await wait(page, { paused: false });
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await wait(page, { paused: true });
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow'))); await wait(page, { paused: false });
      assert.equal((await status(page)).committed, 'beta');
    });
    await run('manual motion/expression controls and local API honor independent channels, validation and cancellation', async () => {
      await interact(page); await page.getByLabel('Choose motion', { exact: true }).selectOption('wave');
      await page.getByRole('button', { name: 'Play motion', exact: true }).click(); await wait(page, { activeMotion: 'wave' });
      await page.getByRole('button', { name: 'Change expression', exact: true }).click(); await wait(page, { activeExpression: 'smile' });
      await page.getByRole('button', { name: 'Stop motion and return to idle', exact: true }).click();
      await wait(page, { activeMotion: 'idle', activeExpression: 'smile' });
      await page.getByRole('button', { name: 'Play motion', exact: true }).click(); await wait(page, { activeMotion: 'wave' });
      await page.getByRole('button', { name: 'Reset expression', exact: true }).click(); await wait(page, { activeMotion: 'wave', activeExpression: null });
      assert.equal((await command(page, { action: 'motion', id: 'unknown' })).code, 'unknown-id');
      assert.equal((await command(page, { action: 'motion', id: 'wave', url: '/other' })).code, 'invalid-request');
      assert.equal((await command(page, { action: 'motion', id: 'wave', caption: '<b>unsafe</b>' })).code, 'invalid-request');
      assert.equal((await command(page, { action: 'reset' })).code, 'reset');
      assert.equal((await command(page, { action: 'motion', id: 'wave', caption: 'Local caption' })).code, 'played');
      assert.equal(await page.locator('.wzf-haru-state').textContent(), 'Local caption');
      assert.equal((await page.evaluate(() => window.WZFMascot.command({ action: 'stop' }))).code, 'rate-limited');
      await page.waitForTimeout(510);
      await page.evaluate(() => { window.__mascotFixture.holdPlay = true; window.__pendingApi = window.WZFMascot.command({ action: 'expression', id: 'smile', caption: 'Late caption must not appear' }); });
      await page.waitForFunction(() => window.__mascotFixture.pendingPlays.length === 1);
      assert.equal((await page.evaluate(() => window.WZFMascot.command({ action: 'motion', id: 'wave' }))).code, 'busy');
      assert.equal((await page.evaluate(() => window.WZFMascot.cancel())).code, 'cancelled');
      await page.evaluate(() => window.__mascotFixture.pendingPlays.shift()());
      assert.equal((await page.evaluate(() => window.__pendingApi)).code, 'cancelled');
      assert.notEqual(await page.locator('.wzf-haru-state').textContent(), 'Late caption must not appear');
      assert.equal((await command(page, { action: 'stop' })).code, 'stopped');
      await page.waitForTimeout(510);
      await page.evaluate(() => { window.__mascotFixture.holdPlay = true; window.__pendingApi = window.WZFMascot.command({ action: 'motion', id: 'wave', caption: 'Suspended caption must not appear' }); });
      await page.waitForFunction(() => window.__mascotFixture.pendingPlays.length === 1);
      await suspend(page, 'api-lifecycle', true); await wait(page, { paused: true });
      await page.evaluate(() => window.__mascotFixture.pendingPlays.shift()());
      assert.equal((await page.evaluate(() => window.__pendingApi)).code, 'cancelled');
      await suspend(page, 'api-lifecycle', false); await wait(page, { paused: false });
      assert.notEqual(await page.locator('.wzf-haru-state').textContent(), 'Suspended caption must not appear');
    });
    await run('context-lost event exposes error, stops drawing and requires manual retry', async () => {
      const before = await page.evaluate(() => window.__mascotFixture.events.filter((event) => event.type === 'create-start').length);
      await interact(page); await page.getByRole('button', { name: 'Change expression', exact: true }).focus();
      await page.locator('#wzf-haru-character canvas').dispatchEvent('webglcontextlost', { cancelable: true });
      await wait(page, { failed: true, paused: true });
      assert.equal(await page.getByRole('button', { name: 'Retry loading', exact: true }).evaluate(el => el === document.activeElement), true);
      assert.equal(await page.locator('#wzf-haru-character').isVisible(), false);
      assert.match(await page.locator('.wzfl-mascot-toggle').textContent(), /graphics context was lost/);
      await shot(page, 'context-lost-simulated');
      assert.equal(await page.evaluate(() => window.__mascotFixture.events.filter((event) => event.type === 'create-start').length), before);
      await page.locator('.wzfl-mascot-toggle').click();
      await wait(page, { ready: true, failed: false, loading: false, character: 'beta', paused: false });
      assert.equal(await page.evaluate(() => window.__mascotFixture.events.filter((event) => event.type === 'create-start').length), before + 1);
    });
    await run('aborted initial/preview loads cannot revive late candidates or overwrite newer selection', async () => {
      await page.locator('.wzfl-mascot-toggle').click(); await wait(page, { wanted: false });
      // Existing ready engine remains cached; reload hidden to test initial creation.
      await loadPage(page); await page.evaluate(() => { window.__mascotFixture.holdCreate = true; });
      await page.locator('.wzfl-mascot-toggle').click();
      await page.waitForFunction(() => window.__mascotFixture.pendingCreates.length === 1);
      await wait(page, { loading: true }); await page.locator('.wzfl-mascot-toggle').click();
      await wait(page, { loading: false, ready: false, wanted: false });
      await page.evaluate(() => window.__mascotFixture.pendingCreates.shift()());
      await page.waitForFunction(() => window.__mascotFixture.events.some((event) => event.type === 'destroy'));
      assert.equal((await status(page)).ready, false); assert.equal(await page.locator('#wzf-haru-character').isVisible(), false);
      await page.locator('.wzfl-mascot-toggle').click(); await wait(page, { ready: true, loading: false, character: 'beta' });
      await interact(page); await page.getByLabel('Choose character', { exact: true }).selectOption('alpha');
      await page.evaluate(() => { window.__mascotFixture.holdCreate = true; });
      await page.getByRole('button', { name: 'Preview character', exact: true }).click();
      await page.waitForFunction(() => window.__mascotFixture.pendingCreates.length === 1);
      await suspend(page, 'cancel-preview', true); await wait(page, { loading: false, ready: false, character: 'beta' });
      await suspend(page, 'cancel-preview', false); await wait(page, { ready: true, loading: false, committed: 'beta', character: 'beta' });
      const returned = await page.evaluate(() => window.__mascotFixture.events.filter((event) => event.type === 'destroy').length);
      await page.evaluate(() => window.__mascotFixture.pendingCreates.shift()());
      await page.waitForFunction((count) => window.__mascotFixture.events.filter((event) => event.type === 'destroy').length > count, returned);
      await wait(page, { ready: true, loading: false, character: 'beta', committed: 'beta', preview: false });
    });
    await run('mobile default is off; explicit mobile consent is separate and external input pauses only mobile', async () => {
      await page.evaluate(() => localStorage.setItem('wzfl-mascot', 'shown'));
      await page.setViewportSize({ width: 390, height: 844 });
      const before = heavy().length; await loadPage(page);
      await wait(page, { mobileEnabled: false, mobileOptIn: false, ready: false });
      assert.equal(heavy().length, before); assert.equal(await page.locator('.wzfl-mascot-toggle').isVisible(), false);
      await loadPage(page, '?mobile=1');
      assert.equal(heavy().length, before); assert.equal((await status(page)).mobileOptIn, false);
      await show(page); await wait(page, { mobileOptIn: true, paused: false });
      assert.equal(await page.evaluate(() => localStorage.getItem('wzf-mascot-mobile-v1')), 'enabled');
      assert.equal(await page.evaluate(() => localStorage.getItem('wzfl-mascot')), 'shown');
      await interact(page); await page.getByRole('searchbox', { name: 'Search characters', exact: true }).focus();
      await wait(page, { suspended: false, paused: false }); await shot(page, 'mobile-interaction');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, 'Mobile fixture must not overflow horizontally');
      await page.locator('#outside-input').focus(); await wait(page, { suspended: true, paused: true });
      assert((await status(page)).suspensionSources.includes('mobile-input')); await shot(page, 'mobile-input-paused');
      await page.locator('#outside-button').click(); await wait(page, { suspended: false, paused: false });
      await page.locator('.wzfl-mascot-toggle').click(); await wait(page, { mobileOptIn: false });
      assert.equal(await page.evaluate(() => localStorage.getItem('wzfl-mascot')), 'shown');
      await page.reload(); await wait(page, { mobileOptIn: false, ready: false });
      assert.equal(await page.evaluate(() => localStorage.getItem('wzf-mascot-mobile-v1')), 'disabled');
    });
    const openDiagnostics = async (target) => {
      const details = target.locator('.wzf-haru-diagnostics');
      if (!(await details.evaluate((node) => node.open))) await details.locator('summary').click();
    };
    const diagnosticDownload = async (target, name) => {
      const [download] = await Promise.all([target.waitForEvent('download'), target.getByRole('button', { name, exact: true }).click()]);
      return JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    };
    await run('resource traces follow load ownership, caps, recording stops and first frame', async () => {
      const p = await context.newPage();
      await p.goto(fixture.origin + '/?role=administrator');
      if (!(await status(p)).wanted) { await p.locator('.wzfl-mascot-toggle').click(); await wait(p,{ready:true,loading:false}); }
      else await wait(p,{ready:true,loading:false});
      assert.equal(await p.evaluate(()=>typeof window.__mascotFixture.resourceObservers[0]),'undefined');
      await p.locator('.wzfl-mascot-toggle').click();
      await p.reload(); await wait(p,{loading:false});
      await openDiagnostics(p); await p.getByRole('button',{name:'Enable local diagnostics',exact:true}).click();
      await p.evaluate(()=>{window.__mascotFixture.noFrames=true;});
      await p.locator('.wzfl-mascot-toggle').click(); await wait(p,{ready:true,loading:false});
      await p.evaluate(()=>{
        const fixture=window.__mascotFixture;
        fixture.oldObserver=fixture.resourceObservers.at(-1);
        const first=fixture.oldObserver('texture','download'), second=fixture.oldObserver('texture','download');
        fixture.textureOrdinal=first.ordinal;
        second.finish(undefined,12); first.finish(undefined,24);
        fixture.oldObserver('texture','decode',first.ordinal).finish();
        fixture.pendingSpan=fixture.oldObserver('motion','download');
      });
      let report=await diagnosticDownload(p,'Download diagnostic JSON');
      assert.equal(report.load.resources.endedBy,null,'normal load/destroy must retain trace owner');
      const textures=report.load.resources.events.filter(row=>row.category==='texture');
      assert.deepEqual(textures.map(row=>row.bodyBytes),[12,24,null]);
      assert.equal(textures[1].ordinal,textures[2].ordinal);
      const before=report.load.resources.events.length+1;
      await p.evaluate(()=>{for(let i=0;i<140;i++)window.__mascotFixture.oldObserver('shader','download')?.finish(undefined,1);});
      report=await diagnosticDownload(p,'Download diagnostic JSON');
      assert.equal(report.load.resources.events.length,127);assert.equal(report.load.resources.dropped,before+140-128);
      await p.getByRole('button',{name:'Stop recording',exact:true}).click();
      const stopped=await diagnosticDownload(p,'Download diagnostic JSON');
      assert.equal(stopped.load.resources.events.length,128);assert.equal(stopped.load.resources.endedBy,'stopped');
      await p.evaluate(()=>{window.__mascotFixture.pendingSpan.finish(undefined,900);window.__mascotFixture.oldObserver('model','download')?.finish(undefined,900);});
      assert.deepEqual(await diagnosticDownload(p,'Download diagnostic JSON'),stopped);
      await p.getByRole('button',{name:'Enable local diagnostics',exact:true}).click();
      await interact(p);await p.getByLabel('Choose character',{exact:true}).selectOption('beta');
      await p.getByRole('button',{name:'Preview character',exact:true}).click();await wait(p,{ready:true,loading:false,character:'beta'});
      await p.getByRole('button',{name:'Close interaction',exact:true}).click();await openDiagnostics(p);
      await p.evaluate(()=>{window.__mascotFixture.oldObserver('model','download')?.finish(undefined,900);window.__mascotFixture.resourceObservers.at(-1)('catalog','download')?.finish(undefined,7);});
      report=await diagnosticDownload(p,'Download diagnostic JSON');
      assert.equal(report.load.resources.events.length,1);assert.equal(report.load.resources.events[0].bodyBytes,7);
      await p.evaluate(()=>{window.__mascotFixture.noFrames=false;});await p.waitForTimeout(100);
      const finished=await diagnosticDownload(p,'Download diagnostic JSON');assert.equal(finished.load.resources.endedBy,'first-frame');
      await p.evaluate(()=>window.__mascotFixture.resourceObservers.at(-1)('moc','download')?.finish(undefined,900));
      assert.deepEqual(await diagnosticDownload(p,'Download diagnostic JSON'),finished);
      await p.close();
    });
    await run('runtime resource failures use the same fixed code as loading errors', async () => {
      for (const code of ['network','http']) {
        const p=await context.newPage();
        await p.addInitScript(()=>localStorage.setItem('wzfl-mascot','hidden'));
        await loadPage(p,'?role=administrator');await openDiagnostics(p);
        await p.getByRole('button',{name:'Enable local diagnostics',exact:true}).click();
        await p.route('**/synthetic/core.js',route=>code==='network'?route.abort('failed'):route.fulfill({status:503,body:'unavailable'}));
        await p.locator('.wzfl-mascot-toggle').click();await wait(p,{failed:true,loading:false});
        const report=await diagnosticDownload(p,'Download diagnostic JSON');
        assert.equal(report.error.code,code);
        const event=report.load.resources.events.find(row=>row.category==='core'&&row.operation==='download');
        assert.equal(event.errorCode,code);assert.equal(event.status,'failed');assert.equal(event.bodyBytes,null);
        await p.close();
      }
    });
    let diagnosticPage, initialBatch;
    await run('diagnostic opt-in, 3-window sequence, immutable snapshots and pause/switch/user-stop cancellation', async () => {
      await page.evaluate(() => localStorage.setItem('wzfl-mascot', 'hidden'));
      diagnosticPage = await context.newPage(); diagnosticPage.setDefaultTimeout(7000);
      await diagnosticPage.clock.install(); await loadPage(diagnosticPage, '?role=administrator');
      assert.equal(await diagnosticPage.evaluate(() => window.__mascotFixture.gpuQueries), 0);
      await openDiagnostics(diagnosticPage);
      await diagnosticPage.getByRole('button', { name: 'Enable local diagnostics', exact: true }).click();
      await diagnosticPage.locator('.wzfl-mascot-toggle').click();
      await wait(diagnosticPage, { ready: true, loading: false });
      await diagnosticPage.clock.runFor(100);
      assert((await diagnosticPage.evaluate(() => window.__mascotFixture.gpuQueries)) > 0);
      await diagnosticPage.getByRole('button', { name: 'Sample 3 windows', exact: true }).click();
      // Give the three 3000ms windows enough virtual-clock advancement to settle.
      await diagnosticPage.clock.runFor(9100);
      assert.match(await diagnosticPage.locator('.wzf-haru-diagnostic-body [role="status"]').textContent(), /3 of 3 windows saved/);
      initialBatch = await diagnosticDownload(diagnosticPage, 'Download all saved windows');
      assert.equal(initialBatch.kind, 'wzf-mascot-diagnostic-batch'); assert.equal(initialBatch.windows.length, 3);
      assert(initialBatch.windows.every((window) => window.sample.durationMs >= 3000 && window.sample.durationMs < 3100), 'Each completed window keeps its 3-second sampling interval');
      assert.equal(new Set(initialBatch.windows.map((window) => window.windowId)).size, 3);
      assert.equal(new Set(initialBatch.windows.map((window) => window.loadSessionId)).size, 1);
      assert(initialBatch.windows.every((window) => !window.sample.interrupted && window.load.firstFrameStatus === 'observed'));
      await shot(diagnosticPage, 'diagnostics-desktop');
      await diagnosticPage.getByRole('button', { name: 'Sample 3 windows', exact: true }).click();
      await diagnosticPage.clock.runFor(1000); await suspend(diagnosticPage, 'diagnostic-pause', true);
      await suspend(diagnosticPage, 'diagnostic-pause', false); await diagnosticPage.clock.runFor(10000);
      let after = await diagnosticDownload(diagnosticPage, 'Download all saved windows');
      assert.equal(after.windows.length, 4); assert.equal(after.windows.at(-1).sample.interrupted, true);
      assert.deepEqual(after.windows.slice(0, 3), initialBatch.windows);
      await diagnosticPage.getByRole('button', { name: 'Sample 3 windows', exact: true }).click();
      await diagnosticPage.clock.runFor(1000); await interact(diagnosticPage);
      const other = (await status(diagnosticPage)).character === 'alpha' ? 'beta' : 'alpha';
      await diagnosticPage.getByLabel('Choose character', { exact: true }).selectOption(other);
      await diagnosticPage.getByRole('button', { name: 'Preview character', exact: true }).click();
      await wait(diagnosticPage, { character: other, loading: false });
      await diagnosticPage.getByRole('button', { name: 'Close interaction', exact: true }).click();
      await openDiagnostics(diagnosticPage); await diagnosticPage.clock.runFor(10000);
      after = await diagnosticDownload(diagnosticPage, 'Download all saved windows');
      assert.equal(after.windows.length, 5); assert.equal(after.windows.at(-1).sample.interrupted, true);
      assert.deepEqual(after.windows.slice(0, 3), initialBatch.windows);
      await diagnosticPage.getByRole('button', { name: 'Sample 3 windows', exact: true }).click();
      await diagnosticPage.clock.runFor(1000);
      await diagnosticPage.getByRole('button', { name: 'Stop sampling', exact: true }).click();
      await diagnosticPage.clock.runFor(10000);
      await diagnosticPage.getByRole('button', { name: 'Stop recording', exact: true }).click();
      after = await diagnosticDownload(diagnosticPage, 'Download all saved windows');
      assert.equal(after.windows.length, 6); assert.equal(after.windows.at(-1).sample.reason, 'user-stopped-sampling');
      assert.notEqual(after.windows.at(-1).loadSessionId, initialBatch.windows[0].loadSessionId);
      assert.deepEqual(await diagnosticDownload(diagnosticPage, 'Download diagnostic JSON'), after.windows.at(-1));
      const queries = await diagnosticPage.evaluate(() => window.__mascotFixture.gpuQueries);
      await diagnosticPage.clock.runFor(1000);
      assert.equal(await diagnosticPage.evaluate(() => window.__mascotFixture.gpuQueries), queries);
      assert(fixture.requests.every((request) => request.method === 'GET'), 'Diagnostics must never upload a report');
    });
    await run('new diagnostic batches reset windows; only 20 retained; old timers never restart sampling', async () => {
      await diagnosticPage.getByRole('button', { name: 'Enable local diagnostics', exact: true }).click();
      await diagnosticPage.getByRole('button', { name: 'Sample 3 windows', exact: true }).click();
      await diagnosticPage.clock.runFor(1000);
      await diagnosticPage.getByRole('button', { name: 'Stop recording', exact: true }).click();
      await diagnosticPage.getByRole('button', { name: 'Enable local diagnostics', exact: true }).click();
      await diagnosticPage.clock.runFor(10000);
      assert.equal(await diagnosticPage.getByRole('button', { name: 'Download all saved windows', exact: true }).isDisabled(), true);
      for (let index = 0; index < 21; index++) {
        await diagnosticPage.getByRole('button', { name: 'Sample for 3 seconds', exact: true }).click();
        await diagnosticPage.clock.runFor(3010);
      }
      await diagnosticPage.getByRole('button', { name: 'Stop recording', exact: true }).click();
      const batch = await diagnosticDownload(diagnosticPage, 'Download all saved windows');
      assert.equal(batch.windows.length, 20); assert.equal(batch.replacedWindows, 1);
      assert.equal(batch.windows[0].windowId, 2); assert.equal(batch.windows.at(-1).windowId, 21);
      assert.notEqual(batch.batchId, initialBatch.batchId);
      assert.equal(new Set(batch.windows.map((window) => window.windowId)).size, 20);
      await diagnosticPage.setViewportSize({ width: 390, height: 844 });
      // Mobile display requires its independent choice. This context has opted
      // out, so capture the diagnostic controls before switching the viewport.
      await diagnosticPage.setViewportSize({ width: 1440, height: 900 });
    });
    await run('missing first frame remains absent in saved windows after later frames and mobile diagnostics fit', async () => {
      await diagnosticPage.evaluate(() => { localStorage.setItem('wzfl-mascot', 'hidden'); localStorage.setItem('wzf-mascot-mobile-v1', 'enabled'); });
      const target = await context.newPage(); target.setDefaultTimeout(7000);
      await target.setViewportSize({ width: 390, height: 844 }); await target.clock.install();
      // Mobile opt-in is explicitly seeded from this context's previous consent;
      // this is a controller fixture, never a physical phone measurement.
      await loadPage(target, '?mobile=1&role=administrator');
      await target.locator('.wzfl-mascot-toggle').click(); // Hide cached mobile character.
      await target.reload(); await wait(target, { ready: false });
      await target.evaluate(() => { window.__mascotFixture.noFrames = true; });
      await openDiagnostics(target); await target.getByRole('button', { name: 'Enable local diagnostics', exact: true }).click();
      await target.locator('.wzfl-mascot-toggle').click();
      await target.getByRole('dialog', { name: 'Show mascot' }).getByRole('button', { name: /^Accept terms/ }).click();
      await wait(target, { ready: true, loading: false });
      await target.getByRole('button', { name: 'Sample for 3 seconds', exact: true }).click();
      await target.clock.runFor(3010);
      const before = await diagnosticDownload(target, 'Download all saved windows');
      assert.equal(before.windows[0].sample.frameDelta, 0);
      assert.equal(before.windows[0].load.firstFrameMs, null);
      assert.equal(before.windows[0].load.firstFrameStatus, 'not-observed');
      await target.evaluate(() => { window.__mascotFixture.noFrames = false; }); await target.clock.runFor(100);
      assert.deepEqual((await diagnosticDownload(target, 'Download all saved windows')).windows, before.windows);
      assert.deepEqual(await diagnosticDownload(target, 'Download diagnostic JSON'), before.windows[0]);
      assert.equal(await target.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await shot(target, 'diagnostics-mobile');
      await target.close(); await diagnosticPage.close();
    });
    await run('dialogue is plain text, bounded in time, independent of motions and cleared across lifecycle', async () => {
      const target = await context.newPage(); await target.clock.install();
      await target.evaluate(() => {});
      await target.goto(fixture.origin + '/?dialogue=1&mobile=1');
      await target.evaluate(() => { localStorage.setItem('wzfl-mascot','shown'); localStorage.setItem('wzf-haru-terms','synthetic-v1'); localStorage.setItem('wzf-mascot-character','alpha'); });
      await target.reload(); await wait(target, {ready:true,loading:false});
      const bubble = target.locator('.wzf-haru-bubble');
      assert.equal(await bubble.textContent(), 'alpha <literal> welcome'); assert.equal(await bubble.locator('literal').count(),0);
      await shot(target, 'dialogue-desktop');
      await suspend(target, 'dialogue-test', true); assert.equal(await bubble.textContent(),'');
      await suspend(target, 'dialogue-test', false); await target.clock.runFor(16000);
      assert.equal(await bubble.textContent(),'');
      await target.getByRole('button', {name:'Tap Alpha fixture to greet',exact:true}).click();
      assert.equal(await bubble.textContent(),'alpha <literal> click');
      await target.clock.runFor(4600); assert.equal(await bubble.textContent(),'');
      await interact(target); await target.getByText('Dialogue preferences', {exact:true}).click();
      await target.getByLabel('Dialogue mode', {exact:true}).selectOption('silent');
      assert.equal(await target.getByRole('button', {name:'Tap Alpha fixture to greet',exact:true}).isVisible(),false);
      await target.getByLabel('Dialogue mode', {exact:true}).selectOption('active');
      await target.clock.runFor(16000); await target.getByRole('button', {name:'Tap Alpha fixture to greet',exact:true}).click();
      assert.equal(await bubble.textContent(),'alpha <literal> click');
      await target.getByLabel('Choose character', {exact:true}).selectOption('beta');
      await target.getByRole('button', {name:'Preview character',exact:true}).click(); await wait(target,{character:'beta',loading:false});
      assert.equal(await bubble.textContent(),''); await target.clock.runFor(10000); assert.equal(await bubble.textContent(),'');
      await target.setViewportSize({width:390,height:844});
      await target.evaluate(() => { localStorage.setItem('wzf-mascot-mobile-v1','enabled'); });
      await target.reload(); await wait(target,{ready:true,loading:false});
      await target.clock.runFor(16000); await target.getByRole('button', {name:'Tap Alpha fixture to greet',exact:true}).click();
      await shot(target,'dialogue-mobile'); assert.equal(await target.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
      await target.close();
    });
    await run('guest loading stages filter unknown and stale callbacks; close and Escape retain visible keyboard focus', async () => {
      const isolated = await browser.newContext({viewport:{width:1440,height:900}});
      const p = await isolated.newPage();
      try {
        await p.goto(fixture.origin + '/?mobile=1');
        let core; const coreRequested = new Promise(resolve => p.route('**/synthetic/core.js', r => {core=r;resolve();}));
        await p.locator('.wzfl-mascot-toggle').click();
        await p.getByRole('button',{name:/^Accept terms/}).click(); await coreRequested;
        assert.equal(await p.locator('.wzf-haru-loading-status').textContent(),'Preparing runtime…');
        assert.equal(await p.getByRole('button',{name:'Cancel loading',exact:true}).isVisible(),true);
        await shot(p,'loading-runtime-desktop');
        await p.evaluate(()=>{window.__mascotFixture.holdCreate=true;});
        await core.continue();
        await p.waitForFunction(()=>window.__mascotFixture.pendingCreates.length===1);
        assert.equal(await p.locator('.wzf-haru-loading-status').textContent(),'Reading character…');
        await p.evaluate(()=>window.__mascotFixture.stageCallbacks[0]('texture'));
        assert.equal(await p.locator('.wzf-haru-loading-status').textContent(),'Preparing display…');
        await p.evaluate(()=>window.__mascotFixture.stageCallbacks[0]('/private/not-a-stage'));
        assert.equal(await p.locator('.wzf-haru-loading-status').textContent(),'Preparing display…');
        await p.getByRole('button',{name:'Cancel loading',exact:true}).click();
        await p.getByRole('button',{name:'Show mascot',exact:true}).click();
        await wait(p,{ready:true,loading:false});
        await p.evaluate(()=>{window.__mascotFixture.stageCallbacks[0]('model');window.__mascotFixture.pendingCreates.shift()();});
        await p.waitForFunction(()=>window.__mascotFixture.events.some(e=>e.type==='destroy'&&e.id===1));
        assert.equal(await p.locator('.wzf-haru-loading-status').isVisible(),false);
        for (const close of ['button','escape']) {
          await p.getByRole('button',{name:'Interact',exact:true}).click();
          if(!await p.locator('.wzf-haru-character-settings').evaluate(el=>el.open))await p.locator('.wzf-haru-character-settings > summary').click();
          await p.getByLabel('Choose character',{exact:true}).selectOption('beta');
          await p.evaluate(()=>{window.__mascotFixture.holdCreate=true;});
          await p.getByRole('button',{name:'Preview character',exact:true}).click();
          await p.waitForFunction(()=>window.__mascotFixture.pendingCreates.length===1);
          assert.equal(await p.locator('.wzf-haru-loading-status').isVisible(),false,'open panel is the single loading status');
          if(close==='button') await p.getByRole('button',{name:'Close interaction',exact:true}).click();
          else {await p.locator('.wzf-haru-state').evaluate(el=>{el.tabIndex=-1;el.focus();});await p.keyboard.press('Escape');}
          assert.equal(await p.getByRole('button',{name:'Cancel loading',exact:true}).evaluate(el=>document.activeElement===el),true);
          await p.keyboard.press('Tab');
          assert.equal(await p.evaluate(()=>document.activeElement!==document.querySelector('.wzf-haru-panel-toggle')),true);
          await p.evaluate(()=>window.__mascotFixture.pendingCreates.shift()());await wait(p,{ready:true,loading:false});
          await p.getByRole('button',{name:'Hide mascot',exact:true}).click();
          await p.getByRole('button',{name:'Show mascot',exact:true}).click();await wait(p,{ready:true,loading:false});
        }
        assert.equal(await p.locator('.wzf-haru-diagnostics').count(),0);
      } finally {await isolated.close();}
    });
    await run('desktop, mobile and consent rejected writes remain visible through loading and Ready', async () => {
      for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:1000,height:900}]) {
        const isolated=await browser.newContext({viewport});const p=await isolated.newPage();
        try {
          await p.goto(fixture.origin+'/?mobile=1');
          await p.evaluate((termsOnly)=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if((termsOnly?['wzf-haru-terms']:['wzfl-mascot','wzf-mascot-mobile-v1','wzf-haru-terms']).includes(key))throw Error('denied');return original.call(this,key,value);};window.__mascotFixture.holdCreate=true;},viewport.width===1000);
          await p.locator('.wzfl-mascot-toggle').click();await p.getByRole('button',{name:/^Accept terms/}).click();
          await p.waitForFunction(()=>window.__mascotFixture.pendingCreates.length===1);
          const notice=p.locator('.wzf-haru-preference-status');
          assert.equal(await notice.textContent(),'This preference applies only to this page; after refreshing, you may need to choose again.');
          assert.equal(await notice.isVisible(),true);await shot(p,'storage-rejected-loading-'+viewport.width);
          await p.evaluate(()=>window.__mascotFixture.pendingCreates.shift()());await wait(p,{ready:true,loading:false});
          assert.equal(await notice.isVisible(),true);await shot(p,'storage-rejected-ready-'+viewport.width);
          await p.getByRole('button',{name:'Hide mascot',exact:true}).click();assert.equal(await notice.isVisible(),true);
          assert.equal(await p.evaluate(()=>localStorage.getItem('wzf-haru-terms')),null);
          await p.reload();assert.equal((await status(p)).ready,false);
          await p.locator('.wzfl-mascot-toggle').click();assert.equal(await p.getByRole('dialog').isVisible(),true);
        } finally {await isolated.close();}
      }
    });
    await run('quick interaction choices save, cancel, empty selection, reset and refresh at desktop and 390px', async () => {
      for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
        const isolated=await browser.newContext({viewport});const p=await isolated.newPage();p.setDefaultTimeout(7000);
        try {
          await loadPage(p,'?quick=1&mobile=1');await show(p);await interact(p);
          const quick=p.locator('.wzf-haru-quick-settings'), boxes=quick.locator('input[type=checkbox]');
          assert.equal(await quick.evaluate(el=>el.open),false);
          assert.deepEqual(await p.locator('#wzf-haru-panel > .wzf-haru-presets button').evaluateAll(es=>es.map(e=>e.dataset.presetId)),['one','two','three']);
          await quick.locator('summary').click();assert.equal(await boxes.locator(':scope').count(),5);
          assert.equal(await boxes.nth(3).isDisabled(),true);
          await boxes.nth(0).uncheck();await boxes.nth(3).check();
          await quick.getByRole('button',{name:'Cancel changes',exact:true}).click();assert.equal(await boxes.nth(0).isChecked(),true);assert.equal(await boxes.nth(3).isChecked(),false);
          await boxes.nth(0).uncheck();await boxes.nth(3).check();await quick.getByRole('button',{name:'Save quick interactions',exact:true}).click();
          assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('wzf-mascot-quick-presets-v1')).alpha),['two','three','four']);
          await shot(p,'quick-choices-saved-'+viewport.width);
          await p.reload();await wait(p,{ready:true,loading:false});await interact(p);
          assert.deepEqual(await p.locator('#wzf-haru-panel > .wzf-haru-presets button').evaluateAll(es=>es.map(e=>e.dataset.presetId)),['two','three','four']);
          await quick.locator('summary').click();for(let i=0;i<5;i++)if(await boxes.nth(i).isChecked())await boxes.nth(i).uncheck();
          await quick.getByRole('button',{name:'Save quick interactions',exact:true}).click();assert.equal(await p.locator('#wzf-haru-panel > .wzf-haru-presets').isVisible(),false);
          assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('wzf-mascot-quick-presets-v1')).alpha),[]);
          assert.equal(await p.locator('.wzf-haru-advanced-controls > .wzf-haru-presets button').count(),5);
          await p.reload();await wait(p,{ready:true,loading:false});await interact(p);assert.equal(await p.locator('#wzf-haru-panel > .wzf-haru-presets').isVisible(),false);
          await quick.locator('summary').click();await quick.getByRole('button',{name:'Restore default interactions',exact:true}).click();
          assert.equal(await p.evaluate(()=>Object.hasOwn(JSON.parse(localStorage.getItem('wzf-mascot-quick-presets-v1')),'alpha')),false);
          assert.equal(await p.locator('#wzf-haru-panel > .wzf-haru-presets button').count(),3);
        } finally {await isolated.close();}
      }
    });
    await run('quick choices isolate roles, discard switched draft and filter removed IDs and malformed storage',async()=>{
      const isolated=await browser.newContext({viewport:{width:1440,height:900}});const p=await isolated.newPage();p.setDefaultTimeout(7000);
      try {
        await loadPage(p,'?quick=1');await show(p);await interact(p);
        const quick=p.locator('.wzf-haru-quick-settings');await quick.locator('summary').click();
        await quick.locator('input[value=one]').uncheck();await quick.locator('input[value=five]').check();await quick.getByRole('button',{name:'Save quick interactions',exact:true}).click();
        await quick.locator('input[value=two]').uncheck();
        await p.getByLabel('Choose character',{exact:true}).selectOption('beta');await p.getByRole('button',{name:'Preview character',exact:true}).click();await wait(p,{character:'beta',loading:false});
        assert.equal(await quick.evaluate(el=>el.open),false);assert.deepEqual(await p.locator('#wzf-haru-panel > .wzf-haru-presets button').evaluateAll(es=>es.map(e=>e.dataset.presetId)),['one','two','three']);
        await quick.locator('summary').click();await quick.getByRole('button',{name:'Save quick interactions',exact:true}).click();
        await p.getByRole('button',{name:'Cancel preview',exact:true}).click();await wait(p,{character:'alpha',loading:false});
        await quick.locator('summary').click();assert.equal(await quick.locator('input[value=two]').isChecked(),true);
        await p.goto(fixture.origin+'/?quick=1&removePreset=five');await wait(p,{ready:true,loading:false});await interact(p);
        assert.deepEqual(await p.locator('#wzf-haru-panel > .wzf-haru-presets button').evaluateAll(es=>es.map(e=>e.dataset.presetId)),['two','three']);
        for(const raw of ['{broken','null','[]','{"__proto__":["one"],"constructor":["one"],"alpha":"one"}','{"alpha":["one","two","three","four"]}','{"alpha":["constructor"]}']) {
          await p.evaluate(raw=>localStorage.setItem('wzf-mascot-quick-presets-v1',raw),raw);await p.goto(fixture.origin+'/?quick=1');await wait(p,{ready:true,loading:false});await interact(p);
          assert.deepEqual(await p.locator('#wzf-haru-panel > .wzf-haru-presets button').evaluateAll(es=>es.map(e=>e.dataset.presetId)),['one','two','three']);
        }
      } finally {await isolated.close();}
    });
    await run('quick saves merge other tabs and retain temporarily unavailable roles',async()=>{
      const isolated=await browser.newContext({viewport:{width:1440,height:900}});const p=await isolated.newPage(),q=await isolated.newPage();
      try {
        await loadPage(p,'?quick=1');await show(p);await interact(p);await loadPage(q,'?quick=1');await wait(q,{ready:true,loading:false});await interact(q);
        await q.getByLabel('Choose character',{exact:true}).selectOption('beta');await q.getByRole('button',{name:'Preview character',exact:true}).click();await wait(q,{character:'beta',loading:false});
        const pq=p.locator('.wzf-haru-quick-settings'),qq=q.locator('.wzf-haru-quick-settings');await pq.locator('summary').click();await qq.locator('summary').click();
        await pq.locator('input[value=one]').uncheck();await pq.locator('input[value=four]').check();await pq.getByRole('button',{name:'Save quick interactions',exact:true}).click();
        await qq.locator('input[value=two]').uncheck();await qq.locator('input[value=five]').check();await qq.getByRole('button',{name:'Save quick interactions',exact:true}).click();
        assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('wzf-mascot-quick-presets-v1'))),{alpha:['two','three','four'],beta:['one','three','five']});
        await p.goto(fixture.origin+'/?quick=1&omitBeta=1');await wait(p,{ready:true,loading:false});await interact(p);await pq.locator('summary').click();await pq.getByRole('button',{name:'Restore default interactions',exact:true}).click();
        assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('wzf-mascot-quick-presets-v1')).beta),['one','three','five']);
        await p.goto(fixture.origin+'/?quick=1');await wait(p,{ready:true,loading:false});await interact(p);
        await p.getByLabel('Choose character',{exact:true}).selectOption('beta');await p.getByRole('button',{name:'Preview character',exact:true}).click();await wait(p,{character:'beta',loading:false});
        assert.deepEqual(await p.locator('#wzf-haru-panel > .wzf-haru-presets button').evaluateAll(es=>es.map(e=>e.dataset.presetId)),['one','three','five']);
      } finally {await isolated.close();}
    });
    await run('quick storage rejection keeps page choices and notice through interaction',async()=>{
      const isolated=await browser.newContext({viewport:{width:390,height:844}});const p=await isolated.newPage();
      try {
        await loadPage(p,'?quick=1&mobile=1');await show(p);await interact(p);const quick=p.locator('.wzf-haru-quick-settings');await quick.locator('summary').click();
        await p.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='wzf-mascot-quick-presets-v1')throw Error('denied');return original.call(this,key,value);};});
        await quick.locator('input[value=one]').uncheck();await quick.getByRole('button',{name:'Save quick interactions',exact:true}).click();
        await p.locator('#wzf-haru-panel > .wzf-haru-presets button').first().click();
        assert.match(await quick.getByRole('status').textContent(),/only on this page/);assert.equal(await p.evaluate(()=>localStorage.getItem('wzf-mascot-quick-presets-v1')),null);
        await shot(p,'quick-storage-rejected-390');await p.reload();await wait(p,{ready:true,loading:false});await interact(p);
        assert.equal(await p.locator('#wzf-haru-panel > .wzf-haru-presets button').count(),3);
      } finally {await isolated.close();}
    });
    await run('texture failure retries first load and failed switch target while cancellation discards late events',async()=>{
      const isolated=await browser.newContext({viewport:{width:1440,height:900}});const p=await isolated.newPage();p.setDefaultTimeout(7000);
      try {
        await loadPage(p,'?quick=1');await p.evaluate(()=>{window.__mascotFixture.failTexture='texture-upload';});
        await p.locator('.wzfl-mascot-toggle').click();await p.getByRole('button',{name:/^Accept terms/}).click();await wait(p,{failed:true,loading:false});
        assert.match(await p.locator('.wzfl-mascot-toggle').textContent(),/Texture:.*could not be displayed/);
        await p.locator('.wzfl-mascot-toggle').click();await wait(p,{ready:true,loading:false});await interact(p);
        await p.evaluate(()=>{window.__mascotFixture.failTexture='texture-upload';window.__mascotFixture.failTextureRole='beta';});
        await p.getByLabel('Choose character',{exact:true}).selectOption('beta');await p.getByRole('button',{name:'Preview character',exact:true}).click();await wait(p,{character:'alpha',loading:false,ready:true,failed:false});
        assert.equal(await p.locator('.wzf-haru-load-failure').isVisible(),true);assert.equal(await p.getByRole('button',{name:'Retry loading',exact:true}).isVisible(),true);
        await shot(p,'texture-switch-fallback-desktop');
        await p.getByRole('button',{name:'Retry loading',exact:true}).click();await wait(p,{character:'beta',loading:false,ready:true});
        assert.equal(await p.locator('.wzf-haru-load-failure').isVisible(),false);
        await p.getByRole('button',{name:'Cancel preview',exact:true}).click();await wait(p,{character:'alpha',loading:false});
        await p.getByLabel('Choose character',{exact:true}).selectOption('beta');await p.evaluate(()=>{window.__mascotFixture.holdCreate=true;});
        await p.getByRole('button',{name:'Preview character',exact:true}).click();await p.waitForFunction(()=>window.__mascotFixture.pendingCreates.length===1);
        await p.locator('.wzfl-mascot-toggle').click();await wait(p,{loading:false});
        await p.evaluate(()=>{document.querySelector('#wzf-haru-character canvas')?.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));window.__mascotFixture.pendingCreates.shift()();});
        await p.waitForFunction(()=>window.__mascotFixture.events.some(e=>e.type==='destroy'&&e.id===6));
        assert.equal((await status(p)).failed,false);
      } finally {await isolated.close();}
    });
    await context.close(); report.complete = checks.length === 28;
    assert.equal(report.complete, true);
  } catch (error) {
    report.failure = String(error.message); throw error;
  } finally {
    try {
      if (browser) await browser.close();
      report.browserClosed = true;
    } finally {
      await fixture.close(); report.serverClosed = true;
      if (output) fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    }
  }
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
