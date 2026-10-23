/* GPL-2.0-or-later with the additional permission in LICENSE. */
(() => {
  'use strict';
  const root = document.querySelector('.wzf-mascot-admin');
  if (!root) return;
  // Inventory options affect only a read-only scan, not saved settings.
  const inventoryAction = form => [...form.elements].find(field => field.type === 'hidden' &&
    ['mascot_inventory', 'mascot_inventory_export'].includes(field.name) && field.value === '1')?.name;
  const forms = [...root.querySelectorAll('form[method="post"]')].filter(form => !inventoryAction(form));
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
  // Preview is a separate POST and document, never a submission of the dirty form.
  let previewDialog=null, previewRequest=null, previewSequence=0, previewTimer=null, previewOpener=null;
  const closePreview=()=>{previewSequence++;clearTimeout(previewTimer);previewTimer=null;previewRequest?.abort();previewRequest=null;
    previewDialog?.querySelector('iframe')?.contentWindow?.postMessage({type:'wzf-mascot-preview-stop'},location.origin);
    previewDialog?.remove();previewDialog=null;};
  root.querySelectorAll('.wzf-mascot-preview-draft').forEach(button=>button.addEventListener('click',async()=>{
    closePreview();const form=button.closest('form'),draft={};
    if(form.elements.namedItem('action')?.value==='wzf_mascot_interaction'){
      draft.dialogue={};
      for(const event of ['welcome','click','morning','afternoon','evening','return','idle']){
        const get=key=>form.elements.namedItem('dialogue['+event+']['+key+']');
        draft.dialogue[event]={enabled:!!get('enabled')?.checked,cooldown:Number(get('cooldown')?.value),lines:(get('lines')?.value||'').split(/\r\n|\r|\n/)};
        if(event==='idle'){const motions=form.elements.namedItem('dialogue[idle][motions][]');if(motions)draft.dialogue[event].motions=[...motions.selectedOptions].map(option=>option.value);}
      }
    }else{
      draft.presets=[];
      for(let index=0;index<8;index++){const row={};for(const key of ['id','name','motion','expression','line'])row[key]=form.elements.namedItem('presets['+index+']['+key+']')?.value||'';draft.presets.push(row);}
    }
    const dialog=document.createElement('dialog'),title=document.createElement('h2'),close=document.createElement('button'),frame=document.createElement('iframe'),state=document.createElement('p');
    dialog.className='wzf-mascot-preview-dialog';state.textContent=button.dataset.loading;title.textContent=button.dataset.title;title.id='wzf-mascot-preview-title';dialog.setAttribute('aria-labelledby',title.id);close.type='button';close.className='button';close.textContent=button.dataset.close;frame.title=button.dataset.title;frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-popups');state.setAttribute('role','status');
    close.onclick=()=>{closePreview();button.focus();};dialog.addEventListener('cancel',event=>{event.preventDefault();close.onclick();});dialog.append(title,close,state,frame);root.append(dialog);previewDialog=dialog;previewOpener=button;dialog.showModal();close.focus();
    const sequence=previewSequence,controller=new AbortController();previewRequest=controller;previewTimer=setTimeout(()=>controller.abort(),15000);
    try{const response=await fetch(button.dataset.endpoint,{method:'POST',credentials:'same-origin',signal:controller.signal,body:new URLSearchParams({action:'wzf_mascot_interaction_preview',_wpnonce:button.dataset.nonce,character:form.elements.namedItem('character').value,version:form.elements.namedItem('version').value,draft:JSON.stringify(draft)})});
      if(!response.ok){const error=await response.json().catch(()=>null);throw Object.assign(Error('preview'),{safeMessage:typeof error?.data?.message==='string'?error.data.message:button.dataset.failed});}const html=await response.text();if(sequence!==previewSequence)return;state.textContent='';frame.srcdoc=html;
    }catch(error){if(sequence===previewSequence)state.textContent=error.safeMessage||button.dataset.failed;}
    finally{if(sequence===previewSequence){clearTimeout(previewTimer);previewTimer=null;previewRequest=null;}}
  }));
  window.addEventListener('message',event=>{if(event.source===previewDialog?.querySelector('iframe')?.contentWindow&&event.data?.type==='wzf-mascot-preview-close'){const button=previewOpener;closePreview();button?.focus();}});
  window.addEventListener('pagehide',closePreview);
  document.addEventListener?.('visibilitychange',()=>{if(document.hidden)closePreview();});
  let submitting = false;
  const dirty = (except) => forms.some((form) => form !== except && snapshot(form) !== snapshots.get(form));
  const message = root.dataset.unsavedMessage || 'You have unsaved changes. Leave this page?';
  // Submitting one valid form saves only that form. A second dirty form must
  // still prompt; cancelling preserves both its inputs and the upload selection.
  root.querySelectorAll('form').forEach((form) => form.addEventListener('submit', (event) => {
    if (dirty(form) && !window.confirm(message)) { event.preventDefault(); return; }
    // JSON downloads keep this page open, so retain warnings for resource edits.
    submitting = inventoryAction(form) !== 'mascot_inventory_export';
  }));
  window.addEventListener('beforeunload', (event) => {
    if (submitting || !dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });
})();
