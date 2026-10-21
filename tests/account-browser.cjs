
const expandNavigation = async (page) => {
 for (const selector of ['.wzf-haru-character-settings', '.wzf-haru-more-settings']) {
  const details=page.locator(selector);if(!await details.evaluate(el=>el.open))await details.locator(':scope > summary').click();
 }
};
// Real shipped controller, synthetic account HTTP responses and engine only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {startFixture}=require('./browser/fixture.cjs');const {chromium}=require(process.env.MASCOT_PLAYWRIGHT||'playwright');
(async()=>{
 const fixture=await startFixture(),browser=await chromium.launch({headless:true,executablePath:process.env.MASCOT_CHROMIUM});
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),out=process.argv[2];if(out)fs.mkdirSync(out,{recursive:true});
 await context.addInitScript(()=>{localStorage.setItem('wzfl-mascot','shown');localStorage.setItem('wzf-haru-terms','synthetic-v1');});
 const prefs=(character)=>({character,favorites:['beta','temporarily-disabled'],layouts:[{id:'beta',position:'left',size:200,anchor:{x:0,y:0.5}}]});
 let remote={revision:3,preferences:prefs('beta')},requests=[],hold=false,signedIn=true;
 await page.route('**/account',async route=>{
  const body=new URLSearchParams(route.request().postData());requests.push(Object.fromEntries(body));
  if(hold)return;
  const send=(success,data,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Cache-Control':'private, no-store'},body:JSON.stringify({success,data})});
  if(!signedIn)return send(false,{code:'sign-in-required'},401);
  if(body.get('operation')==='bootstrap')return send(true,{nonce:'synthetic-nonce',state:remote});
  if(Number(body.get('revision'))!==remote.revision)return send(false,{code:'conflict',state:remote},409);
  remote={revision:remote.revision+1,preferences:JSON.parse(body.get('preferences'))};return send(true,{state:remote});
 });
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const ready=()=>page.waitForFunction(()=>window.WZFHaruStatus?.().ready&&!window.WZFHaruStatus().loading);
 const button=(name)=>page.getByRole('button',{name,exact:true}),read=()=>button('Read account preferences'),use=()=>button('Use account preferences'),save=()=>button('Save browser preferences to account');
 const storage=()=>page.evaluate(()=>['wzf-mascot-character','wzf-mascot-favorites','wzf-mascot-layouts'].map(key=>[key,localStorage.getItem(key)]));
 const readDone=async()=>{await read().click();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='Read account preferences').disabled);};
 const suspend=(value)=>page.evaluate(suspended=>document.dispatchEvent(new CustomEvent('wzf-mascot-suspension',{detail:{source:'account-test',suspended}})),value);
 let checks=0;
 try{
  await page.clock.install();await page.goto(fixture.origin+'/');await ready();assert.equal(requests.length,0);
  await button('Interact').click();await expandNavigation(page);await page.getByText('Account preferences',{exact:true}).click();
  const before=await storage();await readDone();assert.equal(requests.length,1);assert.deepEqual(await storage(),before);
  assert.equal(await page.evaluate(()=>window.WZFHaruStatus().character),'alpha');
  await button('Keep browser preferences').click();assert.equal(requests.length,1);assert.deepEqual(await storage(),before);checks++;
  await use().click();await page.waitForFunction(()=>window.WZFHaruStatus().committed==='beta'&&!window.WZFHaruStatus().preview);
  assert.equal(await page.evaluate(()=>localStorage.getItem('wzf-mascot-character')),'beta');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('wzf-mascot-favorites'))),remote.preferences.favorites);
  assert.equal(await page.evaluate(()=>localStorage.getItem('wzf-haru-terms')),'synthetic-v1');assert.equal(await page.evaluate(()=>localStorage.getItem('wzf-mascot-mobile-v1')),null);checks++;
  remote={revision:4,preferences:prefs('alpha')};await save().click();await page.getByText(/^The account changed elsewhere/).waitFor();assert.equal(remote.revision,4);
  await save().click();await page.getByText(/^Account preferences saved\. Any later/).waitFor();assert.equal(remote.revision,5);assert.equal(remote.preferences.character,'beta');checks++;
  const stable=await storage();remote={revision:6,preferences:prefs('alpha')};await readDone();
  await page.route('**/alpha/fixture.model3.json',route=>route.fulfill({status:503,body:'Synthetic model failure'}));
  await use().click();await page.getByText('The account character could not load. Browser preferences were not changed.',{exact:true}).waitFor();assert.deepEqual(await storage(),stable);
  assert.equal(await page.evaluate(()=>window.WZFHaruStatus().committed),'beta');await page.unroute('**/alpha/fixture.model3.json');checks++;
  remote={revision:7,preferences:prefs('alpha')};await readDone();await page.evaluate(()=>{window.__mascotFixture.holdCreate=true;});await use().click();
  await page.waitForFunction(()=>window.__mascotFixture.pendingCreates.length===1);await suspend(true);await page.evaluate(()=>window.__mascotFixture.pendingCreates.splice(0).forEach(fn=>fn()));await page.clock.runFor(30);await suspend(false);await ready();
  assert.deepEqual(await storage(),stable);assert.equal(await page.evaluate(()=>window.WZFHaruStatus().committed),'beta');checks++;
  await page.getByLabel('Choose character',{exact:true}).selectOption('alpha');await button('Preview character').click();await page.waitForFunction(()=>window.WZFHaruStatus().preview&&!window.WZFHaruStatus().loading);
  assert.equal(await use().isDisabled(),true);await use().evaluate(el=>el.onclick());assert.deepEqual(await storage(),stable);
  await button('Cancel preview').click();await page.waitForFunction(()=>window.WZFHaruStatus().character==='beta'&&!window.WZFHaruStatus().loading);checks++;
  await readDone();await page.evaluate(()=>{window.__originalStorageSet=Storage.prototype.setItem;window.__storageFailed=false;Storage.prototype.setItem=function(key,value){if(key==='wzf-mascot-layouts'&&!window.__storageFailed){window.__storageFailed=true;throw Error('Synthetic single write failure');}return window.__originalStorageSet.call(this,key,value);};});
  await use().click();await page.getByText('The browser did not allow saving account preferences locally. Current preferences are retained.',{exact:true}).waitFor();assert.deepEqual(await storage(),stable);assert.equal(await page.evaluate(()=>window.WZFHaruStatus().committed),'beta');
  await page.evaluate(()=>{Storage.prototype.setItem=window.__originalStorageSet;});checks++;
  await readDone();await page.evaluate(()=>{window.__originalStorageSet=Storage.prototype.setItem;window.__storageFailed=false;Storage.prototype.setItem=function(key,value){if(window.__storageFailed||key==='wzf-mascot-layouts'){window.__storageFailed=true;throw Error('Synthetic persistent write failure');}return window.__originalStorageSet.call(this,key,value);};});
  await use().click();await page.getByText(/^This page keeps its previous preferences/).waitFor();assert.equal(await page.evaluate(()=>window.WZFHaruStatus().committed),'beta');
  await page.evaluate((values)=>{Storage.prototype.setItem=window.__originalStorageSet;for(const [key,value]of values)value===null?localStorage.removeItem(key):localStorage.setItem(key,value);},stable);checks++;
  remote={revision:8,preferences:prefs('temporarily-disabled')};await readDone();await use().click();await page.getByText(/^Account preferences saved in this browser/).waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('wzf-mascot-character')),'temporarily-disabled');assert.equal(await page.evaluate(()=>window.WZFHaruStatus().character),'beta');checks++;
  const other=await context.newPage();other.on('pageerror',error=>errors.push(error.message));await other.goto(fixture.origin+'/');await other.waitForFunction(()=>window.WZFHaruStatus?.().ready&&!window.WZFHaruStatus().loading);
  await page.evaluate(()=>{window.__storageEvents=[];window.addEventListener('storage',event=>window.__storageEvents.push(event.key));});
  await readDone();await other.evaluate(()=>localStorage.setItem('unrelated-test-key','unchanged-account-state'));
  await page.waitForFunction(()=>window.__storageEvents.includes('unrelated-test-key'));assert.equal(await save().isDisabled(),false);
  await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'wzf-mascot-favorites',newValue:'[]',storageArea:sessionStorage})));assert.equal(await save().isDisabled(),false);
  await other.evaluate(()=>localStorage.setItem('wzf-mascot-character','alpha'));
  await page.getByText(/^Browser preferences changed in another tab/).waitFor();assert.equal(await save().isDisabled(),true);assert.equal(await use().isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.WZFHaruStatus().committed),'beta');
  await readDone();await save().click();await page.getByText(/^Account preferences saved\. Any later/).waitFor();
  assert.equal(remote.preferences.character,'temporarily-disabled','Page snapshot must not mix the other tab character with this page collections');checks++;
  await other.evaluate(()=>localStorage.setItem('wzf-mascot-layouts',JSON.stringify({alpha:{position:'right',size:160},beta:{position:'left',size:200}})));
  await page.getByText(/^Browser preferences changed in another tab/).waitFor();
  await page.getByText('Position and size',{exact:true}).click();await page.getByLabel('Character size',{exact:true}).fill('210');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('wzf-mascot-layouts')).alpha),{position:'right',size:160});
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wzf-mascot-layouts')).beta.size),210);
  await page.evaluate(()=>{window.__originalStorageGet=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key==='wzf-mascot-layouts')throw Error('Synthetic layout read denied');return window.__originalStorageGet.call(this,key);};});
  await page.getByLabel('Character size',{exact:true}).fill('220');await page.getByText('Layout applies only to this page; the browser did not allow saving.',{exact:true}).waitFor();
  await page.evaluate(()=>{Storage.prototype.getItem=window.__originalStorageGet;});assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wzf-mascot-layouts')).beta.size),210);
  await page.evaluate(()=>{window.__originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='wzf-mascot-layouts')throw Error('Synthetic layout write denied');return window.__originalStorageSet.call(this,key,value);};});
  await page.getByLabel('Character size',{exact:true}).fill('230');await page.getByText('Layout applies only to this page; the browser did not allow saving.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wzf-mascot-layouts')).beta.size),210);
  await page.evaluate(()=>{Storage.prototype.setItem=window.__originalStorageSet;});await page.getByLabel('Character size',{exact:true}).fill('240');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wzf-mascot-layouts')).beta.size),240);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wzf-mascot-layouts')).alpha.size),160);checks++;
  for(const [raw,size]of [['{broken','250'],['null','260'],['[]','240']]){
   await other.evaluate(value=>localStorage.setItem('wzf-mascot-layouts',value),raw);await page.getByLabel('Character size',{exact:true}).fill(size);
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wzf-mascot-layouts')).beta.size),Number(size),'Explicit layout edits repair readable malformed values');
  }
  await other.evaluate(()=>localStorage.setItem('wzf-mascot-layouts',JSON.stringify({alpha:{position:'right',size:160},beta:{position:'left',size:240}})));checks++;
  remote={revision:20,preferences:prefs('alpha')};await readDone();await page.evaluate(()=>{window.__mascotFixture.holdCreate=true;});await use().click();
  await page.waitForFunction(()=>window.__mascotFixture.pendingCreates.length===1);await other.evaluate(()=>localStorage.setItem('wzf-mascot-favorites',JSON.stringify(['alpha'])));
  await page.getByText(/^Browser preferences changed in another tab/).waitFor();const changedDuringUse=await storage();
  await page.evaluate(()=>window.__mascotFixture.pendingCreates.splice(0).forEach(fn=>fn()));await page.waitForFunction(()=>window.WZFHaruStatus().committed==='beta'&&window.WZFHaruStatus().character==='beta'&&!window.WZFHaruStatus().preview&&!window.WZFHaruStatus().loading);
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='Read account preferences').disabled);
  assert.deepEqual(await storage(),changedDuringUse);assert.equal(await save().isDisabled(),true);assert.equal(await use().isDisabled(),true);checks++;
  await readDone();const beforeReadDenied=await storage();await page.evaluate(()=>{window.__mascotFixture.holdCreate=true;});await use().click();
  await page.waitForFunction(()=>window.__mascotFixture.pendingCreates.length===1);
  await page.evaluate(()=>{window.__originalStorageGet=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key==='wzf-mascot-favorites')throw Error('Synthetic read denied before account apply');return window.__originalStorageGet.call(this,key);};window.__mascotFixture.pendingCreates.splice(0).forEach(fn=>fn());});
  await page.getByText('The browser did not allow saving account preferences locally. Current preferences are retained.',{exact:true}).waitFor();
  await page.evaluate(()=>{Storage.prototype.getItem=window.__originalStorageGet;});assert.deepEqual(await storage(),beforeReadDenied);assert.equal(await save().isDisabled(),true);assert.equal(await use().isDisabled(),true);checks++;
  await readDone();const beforeClear=await storage();const visibleBefore=await page.evaluate(()=>({character:window.WZFHaruStatus().character,committed:window.WZFHaruStatus().committed,accepted:window.WZFHaruStatus().accepted,wanted:window.WZFHaruStatus().wanted}));
  await other.evaluate(()=>localStorage.clear());await page.waitForFunction(()=>window.__storageEvents.includes(null));
  await page.getByText(/^Browser preferences changed in another tab/).waitFor();assert.equal(await save().isDisabled(),true);assert.equal(await use().isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>({character:window.WZFHaruStatus().character,committed:window.WZFHaruStatus().committed,accepted:window.WZFHaruStatus().accepted,wanted:window.WZFHaruStatus().wanted})),visibleBefore);
  assert.deepEqual(await storage(),beforeClear.map(([key])=>[key,null]));
  await other.evaluate(values=>{for(const[key,value]of values)value===null?localStorage.removeItem(key):localStorage.setItem(key,value);localStorage.setItem('wzfl-mascot','shown');localStorage.setItem('wzf-haru-terms','synthetic-v1');},beforeClear);await other.close();checks++;
  signedIn=false;await readDone();await page.getByText('Sign in to read or save account preferences.',{exact:true}).waitFor();assert.equal(await use().isDisabled(),true);assert.equal(await save().isDisabled(),true);checks++;
  signedIn=true;hold=true;await read().click();await page.clock.runFor(10050);await page.getByText(/^The request timed out/).waitFor();assert.equal(await read().isDisabled(),false);assert.equal(await save().isDisabled(),true);hold=false;await readDone();assert.equal(await save().isDisabled(),false);
  hold=true;await save().click();await page.clock.runFor(10050);await page.getByText(/^The request timed out/).waitFor();assert.equal(await save().isDisabled(),true);hold=false;checks++;
  await page.evaluate(()=>localStorage.setItem('wzf-mascot-mobile-v1','enabled'));await page.setViewportSize({width:390,height:844});await page.goto(fixture.origin+'/?mobile=1');await ready();await button('Interact').click();await expandNavigation(page);await page.getByText('Account preferences',{exact:true}).click();await readDone();if(out)await page.screenshot({path:path.join(out,'account-mobile.png')});await page.setViewportSize({width:1440,height:900});if(out)await page.screenshot({path:path.join(out,'account-desktop.png')});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({complete:true,checks,syntheticOnly:true,realRenderingTested:false}));
 }finally{await context.close();await browser.close();await fixture.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
