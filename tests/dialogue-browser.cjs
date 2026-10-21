// Whole shipped loader/CSS, synthetic engine only; clock/visibility are simulated.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startFixture } = require('./browser/fixture.cjs');
const { chromium } = require(process.env.MASCOT_PLAYWRIGHT || 'playwright');
(async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({headless:true,executablePath:process.env.MASCOT_CHROMIUM});
  const output = process.argv[2]; if (output) fs.mkdirSync(output,{recursive:true});
  const context = await browser.newContext({viewport:{width:1440,height:900}});
  await context.addInitScript(() => {
    localStorage.setItem('wzfl-mascot','shown'); localStorage.setItem('wzf-haru-terms','synthetic-v1');
    localStorage.setItem('wzf-mascot-mobile-v1','enabled'); localStorage.setItem('wzf-mascot-character','alpha');
  });
  let checks = 0;
  const ready = (p) => p.waitForFunction(() => window.WZFHaruStatus?.().ready && !window.WZFHaruStatus().loading);
  const visibility = (p, hidden) => p.evaluate((value) => {Object.defineProperty(document,'hidden',{configurable:true,value});document.dispatchEvent(new Event('visibilitychange'));},hidden);
  const bubble = (p) => p.locator('.wzf-haru-bubble');
  try {
    const page = await context.newPage(); await page.clock.install();
    await page.goto(fixture.origin+'/?dialogue=1'); await ready(page);
    assert.equal(await bubble(page).textContent(),'alpha <literal> welcome');
    await visibility(page,true); await page.clock.runFor(59000); await visibility(page,false);
    assert.equal(await bubble(page).textContent(),'');
    await visibility(page,true); await page.clock.runFor(61000); await visibility(page,false);
    assert.equal(await bubble(page).textContent(),'alpha <literal> return');
    await visibility(page,true); await page.clock.runFor(61000); await visibility(page,false);
    assert.equal(await bubble(page).textContent(),'alpha <literal> return'); checks++;
    await page.getByRole('button',{name:'Interact',exact:true}).click();
    await page.getByText('Dialogue preferences',{exact:true}).click();
    await page.getByLabel('Dialogue mode',{exact:true}).selectOption('active');
    await page.reload(); await ready(page); assert.equal(await bubble(page).textContent(),'');
    await visibility(page,true); await page.clock.runFor(61000); await visibility(page,false);
    assert.equal(await bubble(page).textContent(),''); checks++;
    await page.evaluate(() => localStorage.setItem('wzf-mascot-dialogue-v1','auto'));
    await page.goto(fixture.origin+'/?dialogue=1&period=1'); await ready(page);
    assert.match(await bubble(page).textContent(),/^alpha <literal> (morning|afternoon|evening)$/); checks++;
    for (const language of ['en','zh']) {
      await page.goto(fixture.origin+'/?dialogue=1&mobile=1&long='+language); await ready(page);
      await page.clock.runFor(16000);
      await page.getByRole('button',{name:'Tap Alpha fixture to greet',exact:true}).click();
      for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
        await page.setViewportSize(viewport);
        const box=await bubble(page).boundingBox(); assert(box && box.x>=0 && box.y>=0 && box.x+box.width<=viewport.width && box.y+box.height<=viewport.height);
        assert.equal(await bubble(page).evaluate((el)=>el.scrollHeight>el.clientHeight),false);
        if(output) await page.screenshot({path:path.join(output,language+'-'+viewport.width+'.png')});
      }
      await page.setViewportSize({width:1440,height:900});
    } checks++;
    await page.goto(fixture.origin+'/?presets=1&mobile=1'); await ready(page);
    await page.getByRole('button',{name:'Interact',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Invalid preset',exact:true}).count(),0);
    await page.evaluate(() => {window.__mascotFixture.holdPlay=true;});
    await page.getByRole('button',{name:'Quick greeting',exact:true}).click();
    assert.equal(await bubble(page).textContent(),'alpha preset line');
    await page.waitForFunction(() => window.__mascotFixture.pendingPlays.length===1);
    const starts=await page.evaluate(() => window.__mascotFixture.events.filter((e)=>e.type==='play-start').map((e)=>e.channel));
    assert.deepEqual(starts,['motion','expression']);
    await page.waitForFunction(() => window.__mascotFixture.events.some((e)=>e.type==='play-complete'));
    await page.getByRole('button',{name:'Text only',exact:true}).click();
    assert.equal(await bubble(page).textContent(),'alpha text only');
    await page.evaluate(() => window.__mascotFixture.pendingPlays.splice(0).forEach((fn)=>fn()));
    await page.clock.runFor(20); assert.equal(await bubble(page).textContent(),'alpha text only'); checks++;
    await page.getByRole('button',{name:'Reset expression',exact:true}).click();
    await page.evaluate(() => {window.__mascotFixture.holdPlay=true;window.__mascotFixture.holdPlayChannel='expression';});
    await page.getByRole('button',{name:'Quick greeting',exact:true}).click();
    await page.waitForFunction(() => window.__mascotFixture.pendingPlays.length===1);
    await page.getByRole('button',{name:'Text only',exact:true}).click();
    await page.evaluate(() => window.__mascotFixture.pendingPlays.splice(0).forEach((fn)=>fn()));
    await page.clock.runFor(30); assert.equal(await page.evaluate(()=>window.WZFHaruStatus().activeExpression),null);
    assert.equal(await bubble(page).textContent(),'alpha text only');
    await page.route('**/expression/smile.json',route=>route.fulfill({status:503,body:'Synthetic failure'}));
    await page.getByRole('button',{name:'Quick greeting',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.wzf-haru-state').textContent==='Some interactions could not load. Try again.');
    assert.equal(await bubble(page).textContent(),'alpha preset line');
    await page.unroute('**/expression/smile.json'); checks++;
    await page.getByLabel('Choose character',{exact:true}).selectOption('beta');
    await page.getByRole('button',{name:'Preview character',exact:true}).click(); await page.waitForFunction(()=>window.WZFHaruStatus?.().character==='beta'&&!window.WZFHaruStatus().loading);
    assert.equal(await bubble(page).textContent(),'');
    await page.getByRole('button',{name:'Quick greeting',exact:true}).click(); assert.equal(await bubble(page).textContent(),'beta preset line');
    for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      if(output) await page.screenshot({path:path.join(output,'presets-'+viewport.width+'.png')});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    await page.evaluate(()=>document.dispatchEvent(new CustomEvent('wzf-mascot-suspension',{detail:{source:'preset-test',suspended:true}})));
    assert.equal(await bubble(page).textContent(),'');
    assert.equal(await page.getByRole('button',{name:'Quick greeting',exact:true}).isVisible(),false); checks++;
    assert.equal((await page.evaluate(()=>window.WZFMascot.notify({event:'help'}))).code,'unavailable');
    await page.evaluate(()=>document.dispatchEvent(new CustomEvent('wzf-mascot-suspension',{detail:{source:'preset-test',suspended:false}})));
    assert.equal((await page.evaluate(()=>window.WZFMascot.notify({event:'help'}))).code,'unavailable');
    await page.getByRole('button',{name:'Cancel preview',exact:true}).click();await page.waitForFunction(()=>window.WZFHaruStatus().character==='alpha'&&!window.WZFHaruStatus().loading);
    for(const value of [{event:'arbitrary'},{event:'help',url:'https://example.invalid'},{event:'help',caption:'<b>markup</b>'},{event:'help',caption:'a'.repeat(301)},{event:'tool-complete',presetId:'missing'}]){
      assert.equal((await page.evaluate((request)=>window.WZFMascot.notify(request),value)).ok,false);
    }
    let result=await page.evaluate(()=>window.WZFMascot.notify({event:'tool-complete',caption:'Local tool complete'}));assert.equal(result.ok,true);
    assert.equal(await bubble(page).textContent(),'Local tool complete');
    assert.equal((await page.evaluate(()=>window.WZFMascot.notify({event:'action-complete'}))).code,'rate-limited');
    await page.evaluate(()=>window.WZFMascot.cancel());assert.equal(await bubble(page).textContent(),'');
    await page.clock.runFor(31000);await page.evaluate(()=>document.dispatchEvent(new CustomEvent('wzf-mascot-event',{detail:{event:'action-complete',caption:'Explicit local event'}})));
    assert.equal(await bubble(page).textContent(),'Explicit local event');
    await page.clock.runFor(31000);await page.getByText('Interaction help',{exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.wzf-haru-bubble').textContent.startsWith('Use Interact'));
    assert.equal(await page.getByText('Use Interact to preview characters and play quick interactions. The move handle supports dragging and arrow keys.',{exact:true}).first().isVisible(),true);
    if(output)await page.screenshot({path:path.join(output,'semantic-help.png')});checks++;
    await page.clock.runFor(31000);await page.evaluate(()=>{window.__mascotFixture.holdPlay=true;window.__mascotFixture.holdPlayChannel='expression';});
    await page.evaluate(()=>{window.__semanticResult=window.WZFMascot.notify({event:'tool-complete',presetId:'greet'});});
    await page.waitForFunction(()=>window.__mascotFixture.pendingPlays.length===1);
    await page.evaluate(()=>window.WZFMascot.cancel());await page.evaluate(()=>window.__mascotFixture.pendingPlays.splice(0).forEach(fn=>fn()));
    assert.equal((await page.evaluate(()=>window.__semanticResult)).code,'cancelled');assert.equal(await bubble(page).textContent(),'');checks++;
    console.log(JSON.stringify({complete:true,checks,syntheticOnly:true,realRenderingTested:false}));
  } finally {await context.close();await browser.close();await fixture.close();}
})().catch((e)=>{console.error(e);process.exitCode=1;});
