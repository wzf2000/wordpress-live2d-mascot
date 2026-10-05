// Runs only against an extracted candidate. PHP uses WordPress function stubs:
// this checks output portability, not a real WordPress install/activation.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(process.argv[2] || '');
const { chromium } = require(process.argv[3] || 'playwright');
let server, browser;
(async () => {
  assert.ok(process.argv[2], 'pass an extracted live2d-show directory');
  const registry = JSON.parse(await fs.readFile(path.join(root, 'characters.json')));
  assert.equal(Object.keys(registry).length, 22);
  assert.equal(registry['misaka-summer'], undefined);
  const html = execFileSync('php', [], {
    env: { ...process.env, CANDIDATE_PLUGIN: root },
    input: `<?php
    define('ABSPATH', '/isolated/');
    function add_action(...$args) {}
    function is_admin() { return false; }
    function is_user_logged_in() { return false; }
    function plugins_url($path, $file) { return '/nested/wp-content/plugins/live2d-show'; }
    function esc_url($url) { return htmlspecialchars($url, ENT_QUOTES); }
    function wp_json_encode($value, $flags) { return json_encode($value, $flags); }
    require getenv('CANDIDATE_PLUGIN').'/live2d-show.php';
    wzf_haru_output();`,
    encoding: 'utf8',
  });
  const config = JSON.parse(html.match(/<script id="wzf-live2d-config"[^>]*>(.*?)<\/script>/s)[1]);
  assert.equal(Object.keys(config.characters).length, 22);
  assert.notEqual(config.termsVersion, '2026-09-15-collection-v3');
  const errors = [],
    requests = [];
  server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(
          '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,">' + html,
        );
      }
      const prefix = '/nested/wp-content/plugins/live2d-show/';
      assert.ok(pathname.startsWith(prefix));
      const file = path.resolve(root, decodeURIComponent(pathname.slice(prefix.length)));
      assert.ok(file.startsWith(root + path.sep));
      res.setHeader(
        'Content-Type',
        {
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.png': 'image/png',
          '.html': 'text/html; charset=utf-8',
        }[path.extname(file)] || 'application/octet-stream',
      );
      res.end(await fs.readFile(file));
    } catch {
      res.writeHead(404);
      res.end('missing');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  console.log('Isolated package server ready');
  browser = await chromium.launch({
    executablePath: process.env.LIVE2D_CHROMIUM || undefined,
    headless: true,
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
  console.log('Chromium ready');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(response.url() + ': ' + response.status());
  });
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(origin);
  assert.ok(
    !requests.some((url) => /moc3|texture_|cubism-core/.test(url)),
    'first visit must not fetch model/Core',
  );
  await page.locator('.wzfl-mascot-toggle').click();
  const consentText = await page.locator('dialog[open]').innerText();
  assert.ok(consentText.includes('官方样例'));
  assert.ok(!/同人|AIGC|御坂/.test(consentText));
  await page.getByRole('button', { name: '同意条款并显示', exact: true }).click();
  const ready = (id) =>
    page.waitForFunction(
      (id) => {
        const s = window.WZFHaruStatus?.();
        return s?.ready && !s.loading && !s.failed && s.character === id && s.frames > 0;
      },
      id,
      { timeout: 65000 },
    );
  await ready('haru');
  console.log('Rendered haru');
  await page.locator('.wzf-haru-panel-toggle').click();
  const select = page.locator('select').first();
  assert.equal(await select.locator('option').count(), 22);
  for (const id of ['mao', 'ren']) {
    await select.selectOption(id);
    await page.getByRole('button', { name: '预览角色', exact: true }).click();
    await ready(id);
    console.log('Rendered ' + id);
  }
  assert.equal(await page.locator('canvas').count(), 1);
  assert.deepEqual(errors, []);
  assert.ok(!requests.some((url) => /misaka|wzf2000\.top/.test(url)));
  const report = {
    passed: true,
    scope: 'extracted ZIP + PHP frontend stubs, not WordPress activation',
    characters: 22,
    rendered: ['haru', 'mao', 'ren'],
    chromium: browser.version(),
    errors,
    requests: requests.length,
  };
  await fs.writeFile(path.join(root, '..', 'smoke.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  });
