
const expandNavigation = async (page) => {
 for (const selector of ['.wzf-haru-character-settings', '.wzf-haru-more-settings']) {
  const details=page.locator(selector);if(!await details.evaluate(el=>el.open))await details.locator(':scope > summary').click();
 }
};
// Whole shipped loader with a synthetic engine, no model/SDK rendering acceptance.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {startFixture}=require('./browser/fixture.cjs');const {chromium}=require(process.env.MASCOT_PLAYWRIGHT||'playwright');
(async()=>{
 const fixture=await startFixture(),browser=await chromium.launch({headless:true,executablePath:process.env.MASCOT_CHROMIUM});
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),out=process.argv[2];if(out)fs.mkdirSync(out,{recursive:true});
 await context.addInitScript(()=>{localStorage.setItem('wzfl-mascot','shown');localStorage.setItem('wzf-haru-terms','synthetic-v1');localStorage.setItem('wzf-mascot-mobile-v1','enabled');if(!localStorage.getItem('wzf-mascot-favorites'))localStorage.setItem('wzf-mascot-favorites',JSON.stringify(['alpha','beta','temporarily-disabled']));if(!localStorage.getItem('wzf-mascot-recent-v1'))localStorage.setItem('wzf-mascot-recent-v1',JSON.stringify(['temporarily-disabled']));});
 const ready=()=>page.waitForFunction(()=>window.WZFHaruStatus?.().ready&&!window.WZFHaruStatus().loading),button=name=>page.getByRole('button',{name,exact:true}),heavy=()=>fixture.requests.filter(row=>row.path.startsWith('/synthetic/')).length;
 const recent=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('wzf-mascot-recent-v1'))),candidate=()=>page.getByLabel('Choose character',{exact:true}),random=()=>button('Random favorite candidate');
 const panel=async()=>{if(!await page.evaluate(()=>window.WZFHaruStatus().panelOpen))await button('Interact').click();await expandNavigation(page);};
 const preview=async(id)=>{await candidate().selectOption(id);await button('Preview character').click();await page.waitForFunction(expected=>window.WZFHaruStatus().character===expected&&!window.WZFHaruStatus().loading,id);};
 const errors=[];page.on('pageerror',error=>errors.push(error.message));let checks=0;
 try{
  await page.goto(fixture.origin+'/?mobile=1');await ready();await panel();const initialHeavy=heavy(),draws=[];
  for(let i=0;i<8;i++){await random().click();draws.push(await candidate().inputValue());}
  for(let i=0;i<8;i+=2)assert.notEqual(draws[i],draws[i+1]);for(let i=2;i<8;i+=2)assert.notEqual(draws[i],draws[i-1]);
  assert.equal(heavy(),initialHeavy);assert.equal(await page.evaluate(()=>window.WZFHaruStatus().committed),'alpha');assert.deepEqual(await recent(),['temporarily-disabled']);checks++;
  await page.getByLabel('Search characters',{exact:true}).fill('Alpha');await random().click();assert.equal(await candidate().inputValue(),'alpha');
  await page.getByLabel('Search characters',{exact:true}).fill('No match');assert.equal(await random().isDisabled(),true);await button('Clear character search').click();
  await candidate().selectOption('alpha');await page.locator('.wzf-haru-favorite-toggle').click();await random().click();assert.equal(await candidate().inputValue(),'beta');
  await page.locator('.wzf-haru-favorite-toggle').click();assert.equal(await random().isDisabled(),true);checks++;
  await page.evaluate(()=>localStorage.setItem('wzf-mascot-favorites',JSON.stringify(['alpha','beta','temporarily-disabled'])));await page.reload();await ready();await panel();
  await preview('beta');assert.deepEqual(await recent(),['temporarily-disabled']);await button('Cancel preview').click();await ready();assert.deepEqual(await recent(),['temporarily-disabled']);
  await page.route('**/beta/fixture.model3.json',route=>route.fulfill({status:503,body:'Synthetic model failure'}));await candidate().selectOption('beta');await button('Preview character').click();await page.waitForFunction(()=>!window.WZFHaruStatus().loading&&window.WZFHaruStatus().character==='alpha');assert.deepEqual(await recent(),['temporarily-disabled']);await page.unroute('**/beta/fixture.model3.json');checks++;
  await preview('beta');await button('Use this character').click();assert.deepEqual(await recent(),['beta','temporarily-disabled']);await preview('alpha');await button('Use this character').click();assert.deepEqual(await recent(),['alpha','beta','temporarily-disabled']);
  await page.getByText('Recent characters',{exact:true}).click();const history=page.getByLabel('Recent confirmed characters',{exact:true}),beforeHistory=heavy();await history.selectOption('beta');assert.equal(await candidate().inputValue(),'beta');assert.equal(heavy(),beforeHistory);assert.equal(await page.evaluate(()=>window.WZFHaruStatus().committed),'alpha');checks++;
  await preview('beta');await page.evaluate(()=>{window.__storageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='wzf-mascot-recent-v1')throw Error('Synthetic history storage refusal');return window.__storageSet.call(this,key,value);};});await button('Use this character').click();assert.equal(await page.evaluate(()=>window.WZFHaruStatus().committed),'beta');assert.match(await page.locator('.wzf-haru-state').textContent(),/Recent choices apply only/);assert.deepEqual(await recent(),['alpha','beta','temporarily-disabled']);assert.equal(await history.locator('option[value="beta"]').count(),1);checks++;
  if(out)await page.screenshot({path:path.join(out,'selection-desktop.png')});await page.setViewportSize({width:390,height:844});if(out)await page.screenshot({path:path.join(out,'selection-mobile.png')});assert.deepEqual(errors,[]);console.log(JSON.stringify({complete:true,checks,syntheticOnly:true,realRenderingTested:false}));
 }finally{await context.close();await browser.close();await fixture.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
