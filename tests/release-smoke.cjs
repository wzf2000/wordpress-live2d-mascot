// Zero-resource PHP output smoke. Real WordPress import/render checks are separate.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(process.argv[2] || 'plugin');
const child = spawn('php', ['-r', `
  define('ABSPATH', '/stub/');
  function add_action(...$args) {}
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
