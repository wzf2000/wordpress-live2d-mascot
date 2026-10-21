// Actual admin dirty-form controller and frontend translation boundary regression.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const forms = [
  { elements: [{ name: 'name', type: 'text', value: 'Original' }] },
  { elements: [{ name: 'resource', type: 'file', files: [] }] },
  { elements: [{ name: 'page', type: 'hidden', value: 'wzf-mascot' }] },
];
forms.forEach((form) => { form.handlers = {}; form.addEventListener = (name, fn) => { form.handlers[name] = fn; }; });
const windowHandlers = {};
let confirmations = 0, approved = false;
const root = { dataset: { unsavedMessage: '有尚未保存的修改。' }, querySelectorAll: (selector) => selector.includes('wzf-mascot-') ? [] : selector.includes('method') ? forms.slice(0, 2) : forms };
vm.runInNewContext(fs.readFileSync('plugin/admin.js', 'utf8'), {
  document: { querySelector: () => root },
  window: { confirm: (message) => { confirmations++; assert.equal(message, root.dataset.unsavedMessage); return approved; }, addEventListener: (name, fn) => { windowHandlers[name] = fn; } },
});
const event = () => ({ prevented: false, preventDefault() { this.prevented = true; } });
let e = event(); windowHandlers.beforeunload(e); assert.equal(e.prevented, false);
forms[0].elements[0].value = 'Edited';
e = event(); windowHandlers.beforeunload(e); assert.equal(e.prevented, true);
e = event(); forms[2].handlers.submit(e); assert.equal(e.prevented, true); assert.equal(confirmations, 1);
forms[1].elements[0].files = [{ name: 'model.zip', size: 123, lastModified: 1 }];
e = event(); forms[0].handlers.submit(e); assert.equal(e.prevented, true); assert.equal(confirmations, 2);
forms[1].elements[0].files = [];
e = event(); forms[0].handlers.submit(e); assert.equal(e.prevented, false); assert.equal(confirmations, 2);
e = event(); windowHandlers.beforeunload(e); assert.equal(e.prevented, false);
// The actual translator preserves values verbatim and has an English local fallback.
const loader = fs.readFileSync('src/loader.js', 'utf8');
const translator = loader.slice(loader.indexOf('  const t ='), loader.indexOf('  const start ='));
const evaluate = new Function('config', translator + '\nreturn t;');
const fallback = evaluate({});
assert.equal(fallback('Using %1$s', '测试角色'), 'Using 测试角色');
const localized = evaluate({ i18n: { 'Using %1$s': '已使用 %1$s', 'Show mascot': '<plain text>' } });
assert.equal(localized('Using %1$s', 'name %2$s'), '已使用 name %2$s');
assert.equal(localized('Show mascot'), '<plain text>');
assert.equal(evaluate({ i18n: { 'Show mascot': {} } })('Show mascot'), 'Show mascot');
console.log('Admin dirty-form and frontend translation tests passed.');
