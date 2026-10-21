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
  const changed = (field) => field.dispatchEvent(new Event('change', {bubbles:true}));
  root.querySelectorAll('.wzf-mascot-drafts').forEach((controls) => {
    const data=JSON.parse(controls.querySelector('.wzf-mascot-draft-data').textContent);
    const select=controls.querySelector('select'), form=controls.closest('form');
    const sourceArea=controls.querySelector('.wzf-mascot-draft-sources');
    const sources=()=>{
      sourceArea.replaceChildren();
      if(data[select.value]?.note){const note=document.createElement('p');note.textContent=data[select.value].note;sourceArea.append(note);}
      for(const item of data[select.value]?.sources || []) {
        const link=document.createElement('a');
        try { const url=new URL(item.url);if(url.protocol!=='https:')continue;link.href=url.href; }catch{continue;}
        link.textContent=item.title;link.target='_blank';link.rel='noopener noreferrer';
        const line=document.createElement('p');line.append(link);sourceArea.append(line);
      }
    };
    select.addEventListener('change',sources);sources();
    controls.querySelector('button').addEventListener('click',()=>{
      for(const [event,lines] of Object.entries(data[select.value]?.lines || {})) {
        const text=form.elements.namedItem('dialogue['+event+'][lines]');
        if(!text || text.value.trim() || !lines.length)continue;
        text.value=lines.join('\n');changed(text);
        const enabled=form.elements.namedItem('dialogue['+event+'][enabled]');
        if(enabled){enabled.checked=true;changed(enabled);}
      }
      // The existing unsaved-change snapshot observes these edits; submission remains explicit.
      controls.querySelector('.wzf-mascot-draft-status').textContent=controls.dataset.filledMessage || '';
    });
  });
  root.querySelectorAll('.wzf-mascot-fill-presets').forEach(button=>button.addEventListener('click',()=>{
    const form=button.closest('form'),drafts=JSON.parse(button.dataset.drafts);
    let next=0;
    for(let index=0;index<8 && next<drafts.length;index++) {
      const field=key=>form.elements.namedItem('presets['+index+']['+key+']');
      if(['name','motion','expression','line'].some(key=>field(key)?.value.trim()))continue;
      const draft=drafts[next++];
      for(const key of ['name','line','motion']){const input=field(key);if(input && (key!=='motion' || [...input.options].some(option=>option.value===draft[key]))){input.value=draft[key];changed(input);}}
      field('name')?.closest('details')?.setAttribute('open','');
    }
  }));
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
