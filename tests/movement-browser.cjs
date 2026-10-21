
const expandNavigation = async (page) => {
 for (const selector of ['.wzf-haru-character-settings', '.wzf-haru-more-settings']) {
  const details=page.locator(selector);if(!await details.evaluate(el=>el.open))await details.locator(':scope > summary').click();
 }
};
// Whole shipped controller with a synthetic engine; desktop/mobile viewport only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {startFixture}=require('./browser/fixture.cjs');
const {chromium}=require(process.env.MASCOT_PLAYWRIGHT||'playwright');
(async()=>{
 const fixture=await startFixture(),browser=await chromium.launch({headless:true,executablePath:process.env.MASCOT_CHROMIUM});
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 const out=process.argv[2];if(out)fs.mkdirSync(out,{recursive:true});
 await context.addInitScript(()=>{localStorage.setItem('wzfl-mascot','shown');localStorage.setItem('wzf-haru-terms','synthetic-v1');localStorage.setItem('wzf-mascot-mobile-v1','enabled');});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const ready=()=>page.waitForFunction(()=>window.WZFHaruStatus?.().ready&&!window.WZFHaruStatus().loading);
 const host=page.locator('#wzf-haru-character'),handle=page.getByRole('button',{name:'Move mascot: drag, use arrow keys, or Escape to reset',exact:true});
 const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('wzf-mascot-layouts')||'{}'));
 try{
  await page.goto(fixture.origin+'/?mobile=1');await ready();
  const outsideCanvas=async()=>{const a=await handle.boundingBox(),b=await host.boundingBox();assert.equal(a.width,44);assert.equal(a.height,44);assert(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,JSON.stringify({a,b}));};
  await outsideCanvas();
  await page.getByRole('button',{name:'Interact',exact:true}).click();
  assert.equal(await page.locator('.wzf-haru-character-settings').evaluate(el=>el.open),false);
  assert.equal(await page.locator('.wzf-haru-more-settings').evaluate(el=>el.open),false);
  assert.equal(await page.getByLabel('Search characters',{exact:true}).isVisible(),false);
  assert.equal(await page.getByRole('button',{name:'Say hello',exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'Close interaction',exact:true}).click();
  let box=await handle.boundingBox();await page.mouse.move(box.x+20,box.y+18);await page.mouse.down();await page.mouse.move(70,500,{steps:5});await page.mouse.up();
  let saved=await stored();assert.equal(saved.alpha.anchor.x,0);assert(saved.alpha.anchor.y>=0&&saved.alpha.anchor.y<=1);
  let position=await host.boundingBox();assert(position.x>=5&&position.x<10&&position.y>=6);
  await page.reload();await ready();position=await host.boundingBox();assert(position.x<10);
  await handle.focus();await page.keyboard.press('ArrowRight');saved=await stored();assert.equal(saved.alpha.anchor.x,1);
  const previousY=saved.alpha.anchor.y;await page.keyboard.press('ArrowUp');assert((await stored()).alpha.anchor.y<previousY);
  const before=await stored();await page.setViewportSize({width:390,height:844});await page.waitForTimeout(50);assert.deepEqual(await stored(),before);
  await outsideCanvas();
  position=await host.boundingBox();assert(position.x>=0&&position.y>=0&&position.x+position.width<=390&&position.y+position.height<=844);
  if(out)await page.screenshot({path:path.join(out,'movement-mobile.png')});
  const savedNarrow=await stored();
  for(const viewport of [{width:120,height:150},{width:390,height:200}]){await page.setViewportSize(viewport);await page.waitForTimeout(50);await outsideCanvas();const b=await host.boundingBox();assert(Math.abs(b.height/b.width-1.5)<0.02);assert(b.y+b.height<=viewport.height);assert.deepEqual(await stored(),savedNarrow);}
  await page.setViewportSize({width:390,height:844});
  await handle.focus();await page.keyboard.press('Escape');assert.equal((await stored()).alpha.anchor,undefined);
  await page.getByRole('button',{name:'Interact',exact:true}).click();await expandNavigation(page);
  const search=page.getByLabel('Search characters',{exact:true});await search.fill('alpha');await search.press('ArrowLeft');assert.equal((await stored()).alpha.anchor,undefined);
  await page.getByRole('button',{name:'Close interaction',exact:true}).click();
  box=await handle.boundingBox();await page.mouse.move(box.x+20,box.y+18);await page.mouse.down();await page.mouse.move(30,300,{steps:3});
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('wzf-mascot-suspension',{detail:{source:'movement',suspended:true}})));
  await page.mouse.up();assert.equal(await handle.isVisible(),false);assert.equal((await stored()).alpha.anchor,undefined);
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('wzf-mascot-suspension',{detail:{source:'movement',suspended:false}})));
  await page.setViewportSize({width:1440,height:900});if(out)await page.screenshot({path:path.join(out,'movement-desktop.png')});
  await page.clock.install();await page.goto(fixture.origin+'/?mobile=1&dialogue=1&long=en');await ready();
  await handle.focus();for(let i=0;i<25;i++)await page.keyboard.press('Shift+ArrowUp');
  await page.clock.runFor(16000);await page.getByRole('button',{name:'Tap Alpha fixture to greet',exact:true}).click();
  let text=await page.locator('.wzf-haru-bubble').boundingBox();assert(text.y>=0);
  await page.setViewportSize({width:844,height:390});await page.waitForTimeout(80);await page.clock.runFor(50);
  text=await page.locator('.wzf-haru-bubble').boundingBox();assert(text.y>=0&&text.y+text.height<=390,JSON.stringify(text));
  await page.locator('.wzf-haru-bubble').focus();await page.keyboard.press('End');await page.clock.runFor(200);
  assert(await page.locator('.wzf-haru-bubble').evaluate(el=>el.scrollTop>0));
  if(out)await page.screenshot({path:path.join(out,'dialogue-landscape-scroll.png')});
  await page.setViewportSize({width:1440,height:900});await page.goto(fixture.origin+'/?mobile=1&presets=1&hits=1');await ready();
  await page.mouse.move(200,180);assert.equal(await page.evaluate(()=>window.__mascotFixture.events.filter(e=>e.type==='gaze').length),0);
  await page.getByRole('button',{name:'Interact',exact:true}).click();await expandNavigation(page);await page.getByText('Pointer interactions',{exact:true}).click();
  await page.getByLabel('Follow pointer gently',{exact:true}).check();await page.mouse.move(300,200);
  assert(await page.evaluate(()=>window.__mascotFixture.events.some(e=>e.type==='gaze')));
  const count=await page.evaluate(()=>window.__mascotFixture.events.filter(e=>e.type==='gaze').length);
  box=await handle.boundingBox();await page.mouse.move(box.x+20,box.y+18);await page.mouse.down();
  const dragCount=await page.evaluate(()=>window.__mascotFixture.events.filter(e=>e.type==='gaze').length);
  await page.mouse.move(1200,450);assert.equal(await page.evaluate(()=>window.__mascotFixture.events.filter(e=>e.type==='gaze').length),dragCount);await page.mouse.up();
  const touch=page.getByRole('button',{name:'Tap Alpha fixture to greet',exact:true});
  box=await touch.boundingBox();await touch.click({position:{x:box.width/2,y:box.height/4}});
  assert.equal(await page.locator('.wzf-haru-bubble').textContent(),'alpha preset line');
  await page.clock.runFor(1100);box=await touch.boundingBox();await touch.click({position:{x:box.width/2,y:box.height*0.75}});
  assert.equal(await page.locator('.wzf-haru-bubble').textContent(),'alpha text only');
  await page.getByRole('button',{name:'Stop motion and return to idle',exact:true}).click();await touch.press('Enter');
  await page.waitForFunction(()=>window.WZFHaruStatus().touchCount===1);
  await page.getByLabel('Choose character',{exact:true}).selectOption('beta');await page.getByRole('button',{name:'Preview character',exact:true}).click();await page.waitForFunction(()=>window.WZFHaruStatus().character==='beta'&&!window.WZFHaruStatus().loading);
  assert.deepEqual(await page.evaluate(()=>window.WZFHaruStatus().engineCapabilities.hitAreas),[]);
  assert.equal(await page.getByText('No model hit areas; normal greeting is used.',{exact:true}).isVisible(),true);
  await page.getByLabel('Follow pointer gently',{exact:true}).evaluate(el=>{el.checked=false;el.dispatchEvent(new Event('change'));});const gazeCount=await page.evaluate(()=>window.__mascotFixture.events.filter(e=>e.type==='gaze').length);await page.mouse.move(500,450);assert.equal(await page.evaluate(()=>window.__mascotFixture.events.filter(e=>e.type==='gaze').length),gazeCount);
  if(out)await page.screenshot({path:path.join(out,'pointer-capabilities.png')});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({complete:true,checks:9,syntheticOnly:true,realRenderingTested:false}));
 }finally{await context.close();await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
