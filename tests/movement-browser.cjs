
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
  // Long panels respect the actual top stack without raising controls above navigation.
  const openLongPanel=async(role='')=>{
    await page.goto(fixture.origin+'/?mobile=1&explicitButtons=1&role='+role);await ready();
    await page.getByRole('button',{name:'Interact',exact:true}).click();await expandNavigation(page);
    await page.locator('#wzf-haru-panel details').evaluateAll(elements=>elements.forEach(el=>el.open=true));
  };
  await openLongPanel();
  const panel=page.locator('#wzf-haru-panel');
  const topAction=page.getByRole('button',{name:'Say hello',exact:true});
  const panelAt=async(expected)=>{
    await page.waitForFunction(y=>Math.abs(document.querySelector('#wzf-haru-panel').getBoundingClientRect().top-y)<2,expected);
    assert(await panel.evaluate(el=>el.scrollHeight>el.clientHeight));
    await panel.evaluate(el=>el.scrollTop=0);
    await topAction.click({timeout:3000});
  };
  await panelAt(16);
  const installHeader=()=>page.evaluate(()=>{
    const header=document.createElement('header');header.className='pagenest-header';header.textContent='Synthetic sticky navigation';
    header.style.cssText='position:sticky;top:0;height:76px;z-index:1000;background:#fff;border-bottom:1px solid #999;box-sizing:border-box';
    document.body.prepend(header);document.body.style.margin='0';document.body.style.minHeight='2400px';
  });
  await installHeader();await panelAt(92);
  if(out)await page.screenshot({path:path.join(out,'panel-anonymous-header.png')});
  await openLongPanel('administrator');await installHeader();
  await page.evaluate(()=>{
    const bar=document.createElement('div');bar.id='wpadminbar';bar.textContent='Synthetic administrator toolbar';
    bar.style.cssText='position:fixed;top:0;left:0;right:0;height:32px;z-index:99999;background:#222;color:white';document.body.prepend(bar);
    document.querySelector('.pagenest-header').style.top='32px';document.body.style.paddingTop='32px';
  });
  await panelAt(124);
  if(out)await page.screenshot({path:path.join(out,'panel-administrator-header.png')});
  await page.locator('.pagenest-header').evaluate(el=>el.style.height='110px');await panelAt(158);
  await page.evaluate(()=>window.scrollTo(0,400));await panelAt(158);
  await page.locator('.pagenest-header').evaluate(el=>el.style.visibility='hidden');await panelAt(48);
  await page.locator('.pagenest-header').evaluate(el=>{el.style.visibility='visible';el.style.position='fixed';el.style.top='200px';});await panelAt(48);
  await page.locator('.pagenest-header').evaluate(el=>{el.style.top='32px';el.style.left='900px';el.style.width='200px';});await panelAt(48);
  await page.evaluate(()=>{document.querySelector('#wpadminbar').remove();document.querySelector('.pagenest-header').remove();window.scrollTo(0,0);});await panelAt(16);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{
    const header=document.createElement('header');header.className='pagenest-header';header.textContent='Synthetic mobile navigation';
    header.style.cssText='position:fixed;top:0;left:0;right:0;height:64px;z-index:1000;background:white';document.body.prepend(header);
  });
  await panelAt(80);
  await page.locator('.pagenest-header').evaluate(el=>el.className='fixture-unregistered-header');await panelAt(16);
  await page.locator('.fixture-unregistered-header').evaluate(el=>el.className='pagenest-header');await panelAt(80);
  const mobilePanel=await panel.boundingBox(),mobileDock=await page.locator('.wzf-haru-dock').boundingBox();
  assert(mobilePanel.x>=16&&mobilePanel.x+mobilePanel.width<=374);assert(mobilePanel.y+mobilePanel.height<=mobileDock.y-7);
  if(out)await page.screenshot({path:path.join(out,'panel-mobile-header.png')});
  await page.setViewportSize({width:1440,height:900});
  await page.clock.install();await page.goto(fixture.origin+'/?mobile=1&dialogue=1&long=en');await ready();
  await handle.focus();for(let i=0;i<25;i++)await page.keyboard.press('Shift+ArrowUp');
  await page.clock.runFor(16000);await page.getByRole('button',{name:'Tap Alpha fixture to greet',exact:true}).click();
  let text=await page.locator('.wzf-haru-bubble').boundingBox();assert(text.y>=0);
  await page.setViewportSize({width:844,height:390});await page.waitForTimeout(80);await page.clock.runFor(50);
  text=await page.locator('.wzf-haru-bubble').boundingBox();assert(text.y>=0&&text.y+text.height<=390,JSON.stringify(text));
  await page.locator('.wzf-haru-bubble').focus();await page.keyboard.press('End');await page.clock.runFor(200);
  assert(await page.locator('.wzf-haru-bubble').evaluate(el=>el.scrollTop>0));
  await page.locator('.wzf-haru-bubble').dispatchEvent('wheel',{deltaY:80});
  await page.clock.runFor(31000);assert.equal(await page.locator('.wzf-haru-bubble').isVisible(),true);
  const readingBox=await page.locator('.wzf-haru-bubble').boundingBox(),moveBox=await handle.boundingBox();
  assert(moveBox.x+moveBox.width<=readingBox.x||moveBox.x>=readingBox.x+readingBox.width||moveBox.y+moveBox.height<=readingBox.y||moveBox.y>=readingBox.y+readingBox.height,JSON.stringify({readingBox,moveBox}));
  if(out)await page.screenshot({path:path.join(out,'dialogue-landscape-scroll.png')});
  await page.setViewportSize({width:390,height:390});await page.waitForTimeout(80);await page.clock.runFor(50);
  await page.locator('.wzf-haru-bubble').focus();await page.keyboard.press('End');await page.clock.runFor(100);
  const priorScroll=await page.locator('.wzf-haru-bubble').evaluate(el=>el.scrollTop);assert(priorScroll>0);
  await page.getByRole('button',{name:'Interact',exact:true}).click();
  const afterMove=await page.locator('.wzf-haru-bubble').evaluate(el=>({scroll:el.scrollTop,max:el.scrollHeight-el.clientHeight}));
  assert(afterMove.max>0);assert(Math.abs(afterMove.scroll-Math.min(priorScroll,afterMove.max))<=1,JSON.stringify({priorScroll,afterMove}));
  if(out)await page.screenshot({path:path.join(out,'dialogue-mobile-retained-scroll.png')});

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
  // Simulated visual viewport contraction (not a physical keyboard test).
  await page.setViewportSize({width:390,height:844});
  await page.goto(fixture.origin+'/?mobile=1');await ready();
  await page.getByRole('button',{name:'Interact',exact:true}).click();await expandNavigation(page);
  await page.evaluate(()=>{const v=visualViewport;Object.defineProperties(v,{height:{configurable:true,value:390},offsetTop:{configurable:true,value:80},width:{configurable:true,value:280},offsetLeft:{configurable:true,value:65}});v.dispatchEvent(new Event('resize'));});
  await page.waitForFunction(()=>{const p=document.querySelector('#wzf-haru-panel').getBoundingClientRect();return p.top>=96&&p.bottom<=470;});
  for(const side of ['left','right']) {
    await page.getByLabel('Character position',{exact:true}).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('change'));},side);
    for(const selector of ['#wzf-haru-panel','.wzf-haru-dock']) {
      const bounds=await page.locator(selector).boundingBox();assert(bounds.x>=81&&bounds.x+bounds.width<=329,JSON.stringify({selector,bounds}));
    }
  }
  await search.fill('beta');await page.getByLabel('Choose character',{exact:true}).selectOption('beta');
  await page.getByRole('button',{name:'Preview character',exact:true}).click();await ready();
  assert.equal(await page.getByRole('button',{name:'Use this character',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.getByRole('button',{name:'Use this character',exact:true}).scrollIntoViewIfNeeded();
  const confirm=await page.getByRole('button',{name:'Use this character',exact:true}).boundingBox();assert(confirm.y>=80&&confirm.y+confirm.height<=470,JSON.stringify(confirm));
  position=await host.boundingBox();assert(position.y>=80&&position.y+position.height<=470);
  if(out)await page.screenshot({path:path.join(out,'visual-viewport-contraction.png')});
  // A delayed current preview may hand focus back only if the user did not leave its stable loading entry.
  await page.getByRole('button',{name:'Cancel preview',exact:true}).click();await ready();
  await page.evaluate(()=>{window.__mascotFixture.holdCreate=true;});
  await page.getByLabel('Choose character',{exact:true}).selectOption('beta');await page.getByRole('button',{name:'Preview character',exact:true}).click();
  await page.waitForFunction(()=>window.__mascotFixture.pendingCreates.length>0);
  await page.locator('#outside-button').focus();await page.evaluate(()=>{window.__mascotFixture.holdCreate=false;window.__mascotFixture.pendingCreates.splice(0).forEach(fn=>fn());});await ready();
  assert.equal(await page.locator('#outside-button').evaluate(el=>el===document.activeElement),true);
  // First panel focus prefers available actions over the closed character section.
  await page.goto(fixture.origin+'/?mobile=1&idle=1&noGreeting=1');await ready();await page.getByRole('button',{name:'Interact',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Chat once',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.goto(fixture.origin+'/?mobile=1&presets=1&noGreeting=1');await ready();await page.getByRole('button',{name:'Interact',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Quick greeting',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.goto(fixture.origin+'/?mobile=1&noGreeting=1');await ready();await page.getByRole('button',{name:'Interact',exact:true}).click();
  assert.equal(await page.getByText('Change character',{exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.goto(fixture.origin+'/?mobile=1&presets=1');await ready();
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw Error('denied')};});
  await page.getByRole('button',{name:'Interact',exact:true}).click();await expandNavigation(page);
  await page.getByText('Dialogue preferences',{exact:true}).click();await page.getByLabel('Dialogue mode',{exact:true}).selectOption('active');
  const notice='This preference applies only to this page; the browser did not allow saving.';
  assert.equal(await page.locator('.wzf-haru-state').textContent(),notice);
  await page.getByText('Pointer interactions',{exact:true}).click();await page.getByLabel('Follow pointer gently',{exact:true}).check();
  assert.equal(await page.locator('.wzf-haru-state').textContent(),notice);
  await page.goto(fixture.origin+'/?mobile=1&idle=1');await ready();await page.getByRole('button',{name:'Interact',exact:true}).click();await expandNavigation(page);await page.getByText('Dialogue preferences',{exact:true}).click();
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw Error('denied')};});await page.getByLabel('Occasional chatter',{exact:true}).check();
  assert.equal(await page.locator('.wzf-haru-state').textContent(),notice);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({complete:true,checks:26,syntheticOnly:true,realRenderingTested:false}));
 }finally{await context.close();await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
