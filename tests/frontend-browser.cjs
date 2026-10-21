
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
      await page.locator('#wzf-haru-character canvas').dispatchEvent('webglcontextlost', { cancelable: true });
      await wait(page, { failed: true, paused: true });
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
    await context.close(); report.complete = checks.length === 13;
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
