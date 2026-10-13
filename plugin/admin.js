/* GPL-2.0-or-later with the additional permission in LICENSE. */
(() => {
  'use strict';
  const root = document.querySelector('.wzf-mascot-admin');
  if (!root) return;
  const forms = [...root.querySelectorAll('form[method="post"]')];
  const snapshots = new Map();
  const snapshot = (form) => JSON.stringify([...form.elements].filter((field) =>
    field.name && !['hidden', 'submit', 'button'].includes(field.type),
  ).map((field) => [field.name, field.type === 'file'
    ? [...field.files].map((file) => [file.name, file.size, file.lastModified])
    : ['checkbox', 'radio'].includes(field.type) ? field.checked : field.value]));
  forms.forEach((form) => snapshots.set(form, snapshot(form)));
  let submitting = false;
  const dirty = (except) => forms.some((form) => form !== except && snapshot(form) !== snapshots.get(form));
  const message = root.dataset.unsavedMessage || 'You have unsaved changes. Leave this page?';
  // Submitting one valid form saves only that form. A second dirty form must
  // still prompt; cancelling preserves both its inputs and the upload selection.
  root.querySelectorAll('form').forEach((form) => form.addEventListener('submit', (event) => {
    if (dirty(form) && !window.confirm(message)) { event.preventDefault(); return; }
    submitting = true;
  }));
  window.addEventListener('beforeunload', (event) => {
    if (submitting || !dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });
})();
