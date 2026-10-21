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
    console.log(JSON.stringify({complete:true,checks,syntheticOnly:true,realRenderingTested:false}));
  } finally {await context.close();await browser.close();await fixture.close();}
})().catch((e)=>{console.error(e);process.exitCode=1;});
