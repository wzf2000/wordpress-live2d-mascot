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
  let box=await handle.boundingBox();await page.mouse.move(box.x+20,box.y+18);await page.mouse.down();await page.mouse.move(70,500,{steps:5});await page.mouse.up();
  let saved=await stored();assert.equal(saved.alpha.anchor.x,0);assert(saved.alpha.anchor.y>=0&&saved.alpha.anchor.y<=1);
  let position=await host.boundingBox();assert(position.x>=5&&position.x<10&&position.y>=6);
  await page.reload();await ready();position=await host.boundingBox();assert(position.x<10);
  await handle.focus();await page.keyboard.press('ArrowRight');saved=await stored();assert.equal(saved.alpha.anchor.x,1);
  const previousY=saved.alpha.anchor.y;await page.keyboard.press('ArrowUp');assert((await stored()).alpha.anchor.y<previousY);
  const before=await stored();await page.setViewportSize({width:390,height:844});await page.waitForTimeout(50);assert.deepEqual(await stored(),before);
  position=await host.boundingBox();assert(position.x>=0&&position.y>=0&&position.x+position.width<=390&&position.y+position.height<=844);
  if(out)await page.screenshot({path:path.join(out,'movement-mobile.png')});
  await handle.focus();await page.keyboard.press('Escape');assert.equal((await stored()).alpha.anchor,undefined);
  await page.getByRole('button',{name:'Interact',exact:true}).click();
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
  assert.deepEqual(errors,[]);console.log(JSON.stringify({complete:true,checks:6,syntheticOnly:true,realRenderingTested:false}));
 }finally{await context.close();await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
