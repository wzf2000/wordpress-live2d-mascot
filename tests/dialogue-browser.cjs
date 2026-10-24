
const expandNavigation = async (page) => {
 for (const selector of ['.wzf-haru-character-settings', '.wzf-haru-more-settings']) {
  const details=page.locator(selector);if(!await details.evaluate(el=>el.open))await details.locator(':scope > summary').click();
 }
};
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
    // Independent channel failures remain visible, while cancelled work cannot
    // overwrite a newer action or leave an error in the downloaded diagnostics.
    for (const [type, action, source = 'picker'] of [
      ['motion','other-reset'], ['expression','other-reset'],
      ['motion','same-reset'], ['expression','same-reset'],
      ['motion','same-play'], ['motion','hide'], ['expression','suspend'],
      ['motion','switch'],
      ...['greeting','touch'].flatMap(source=>['other-reset','hide','suspend'].map(action=>['motion',action,source])),
    ]) {
      const p=await context.newPage();const pageErrors=[];
      p.on('pageerror',error=>pageErrors.push(error.message));
      await p.goto(fixture.origin+'/?presets=1&role=administrator');await ready(p);
      await p.getByText('Local diagnostics',{exact:true}).click();
      await p.getByRole('button',{name:'Enable local diagnostics',exact:true}).click();
      await p.getByRole('button',{name:'Interact',exact:true}).click();await expandNavigation(p);
      const play=p.getByRole('button',{name:source==='greeting'?'Say hello':source==='touch'?'Tap Alpha fixture to greet':type==='motion'?'Play motion':'Change expression',exact:true});
      if(type==='motion')await p.getByLabel('Choose motion',{exact:true}).selectOption('wave');
      let held;let requested;
      const request=new Promise(resolve=>{requested=resolve;});
      const route='**/'+type+'/'+(type==='motion'?'wave':'smile')+'.json';
      await p.route(route,r=>{held=r;requested();},{times:1});
      await play.click();await request;
      if(action==='other-reset'||action==='same-reset') {
        const resetType=action==='same-reset'?type:type==='motion'?'expression':'motion';
        await p.getByRole('button',{name:resetType==='motion'?'Stop motion and return to idle':'Reset expression',exact:true}).click();
      } else if(action==='same-play') {
        await p.getByLabel('Choose motion',{exact:true}).selectOption('intro');await play.click();
        await p.waitForFunction(()=>window.WZFHaruStatus().activeMotion==='intro');
      } else if(action==='hide') {
        await p.getByRole('button',{name:'Hide mascot',exact:true}).click();
        await p.getByRole('button',{name:'Show mascot',exact:true}).click();
      } else if(action==='suspend') {
        await p.evaluate(()=>document.dispatchEvent(new CustomEvent('wzf-mascot-suspension',{detail:{source:'test',suspended:true}})));
        await p.evaluate(()=>document.dispatchEvent(new CustomEvent('wzf-mascot-suspension',{detail:{source:'test',suspended:false}})));
      } else {
        await p.getByLabel('Choose character',{exact:true}).selectOption('beta');
        await p.getByRole('button',{name:'Preview character',exact:true}).click();await ready(p);
      }
      const before=await p.locator('.wzf-haru-state').textContent();
      if(action==='hide'||action==='suspend')assert.equal(before,'Cancelled');
      await held.fulfill({status:503,body:'Synthetic failure'});
      if(action==='other-reset')await p.waitForFunction(()=>!document.querySelector('.wzf-haru-state').textContent.includes('reset')&&!document.querySelector('.wzf-haru-state').textContent.includes('returned'));
      else await p.waitForTimeout(100);
      const after=await p.locator('.wzf-haru-state').textContent();
      if(action==='other-reset')assert.notEqual(after,before,type+' independent failure must be shown');
      else assert.equal(after,before,type+' cancelled failure must stay silent');
      const downloadPromise=p.waitForEvent('download');
      await p.getByRole('button',{name:'Download diagnostic JSON',exact:true,includeHidden:true}).evaluate(el=>el.click());
      const stream=await (await downloadPromise).createReadStream();let json='';
      for await(const chunk of stream)json+=chunk;
      const report=JSON.parse(json);
      if(action==='other-reset')assert.equal(report.error.category,type);
      else assert.equal(report.error,null,'cancelled request must not be logged');
      assert.deepEqual(pageErrors,[]);await p.close();checks++;
    }
    // Restore all interaction channels together, including stale success/error
    // continuations, without changing reader preferences or replaying welcome.
    for(const source of ['motion','expression','preset','external','greeting','welcome','caption']) {
      const p=await context.newPage();await p.clock.install();
      await p.goto(fixture.origin+'/?presets=1&explicitButtons=1&mobile=1');await ready(p);
      if(source==='welcome') {
        await p.evaluate(()=>{window.__mascotFixture.holdPlay=true;});
        await p.clock.runFor(1500);
        await p.waitForFunction(()=>window.__mascotFixture.pendingPlays.length===1);
      }
      await p.getByRole('button',{name:'Interact',exact:true}).click();await expandNavigation(p);
      const before=await p.evaluate(()=>({mode:localStorage.getItem('wzf-mascot-dialogue-v1'),idle:localStorage.getItem('wzf-mascot-idle-v1'),mobile:localStorage.getItem('wzf-mascot-mobile-v1'),shown:localStorage.getItem('wzfl-mascot')}));
      if(!['welcome','caption'].includes(source))await p.evaluate(()=>{window.__mascotFixture.holdPlay=true;});
      if(source==='motion'){await p.getByLabel('Choose motion',{exact:true}).selectOption('wave');await p.getByRole('button',{name:'Play motion',exact:true}).click();}
      if(source==='expression')await p.getByRole('button',{name:'Change expression',exact:true}).click();
      if(source==='preset')await p.getByRole('button',{name:'Quick greeting',exact:true}).click();
      if(source==='greeting')await p.getByRole('button',{name:'Say hello',exact:true}).click();
      if(source==='external')await p.evaluate(()=>{window.__restoreResult=window.WZFMascot.command({action:'motion',id:'wave',caption:'stale API caption'});});
      if(source==='caption')assert.equal((await p.evaluate(()=>window.WZFMascot.command({action:'expression',id:'smile',caption:'old completed caption'}))).ok,true);
      else await p.waitForFunction(()=>window.__mascotFixture.pendingPlays.length===1);
      await p.getByRole('button',{name:'Restore natural state',exact:true}).click();
      const restored='Returned to idle and default expression';
      assert.equal(await p.locator('.wzf-haru-state').textContent(),restored);
      assert.equal(await bubble(p).textContent(),'');
      if(source!=='caption')await p.evaluate(()=>window.__mascotFixture.pendingPlays.shift()());
      await p.clock.runFor(7000);
      const state=await p.evaluate(()=>window.WZFHaruStatus());
      assert.equal(state.activeMotion,'idle');assert.equal(state.activeExpression,null);
      assert.equal(await p.locator('.wzf-haru-state').textContent(),restored,source+' late result');
      assert.equal(await bubble(p).textContent(),'');
      if(source==='external')assert.equal((await p.evaluate(()=>window.__restoreResult)).code,'cancelled');
      assert.deepEqual(await p.evaluate(()=>({mode:localStorage.getItem('wzf-mascot-dialogue-v1'),idle:localStorage.getItem('wzf-mascot-idle-v1'),mobile:localStorage.getItem('wzf-mascot-mobile-v1'),shown:localStorage.getItem('wzfl-mascot')})),before);
      if(source==='preset'&&output){await p.screenshot({path:path.join(output,'restore-natural-desktop.png'),fullPage:true});await p.setViewportSize({width:390,height:844});await p.screenshot({path:path.join(output,'restore-natural-mobile.png'),fullPage:true});}
      const count=()=>p.evaluate(()=>window.__mascotFixture.events.filter(e=>e.type==='cancel').length);
      await p.getByRole('button',{name:'Hide mascot',exact:true}).click();let cancellations=await count();
      await p.getByRole('button',{name:'Restore natural state',exact:true,includeHidden:true}).evaluate(el=>el.onclick());assert.equal(await count(),cancellations);
      await p.getByRole('button',{name:'Show mascot',exact:true}).click();
      await p.evaluate(()=>document.dispatchEvent(new CustomEvent('wzf-mascot-suspension',{detail:{source:'restore-test',suspended:true}})));cancellations=await count();
      await p.getByRole('button',{name:'Restore natural state',exact:true,includeHidden:true}).evaluate(el=>el.onclick());assert.equal(await count(),cancellations);
      await p.evaluate(()=>document.dispatchEvent(new CustomEvent('wzf-mascot-suspension',{detail:{source:'restore-test',suspended:false}})));
      await p.clock.runFor(4000);assert.equal(await bubble(p).textContent(),'');
      await p.close();checks++;
    }
    // Muted presets reject native keyboard, direct handlers and same-page API,
    // while mixed presets keep their motion/expression and opt-in stays saved.
    for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
      const p=await context.newPage();await p.setViewportSize(viewport);
      await p.goto(fixture.origin+'/?presets=1&idle=1&mobile=1');await ready(p);
      await p.getByRole('button',{name:'Interact',exact:true}).click();await expandNavigation(p);
      await p.getByText('Dialogue preferences',{exact:true}).click();
      const mode=p.getByLabel('Dialogue mode',{exact:true}), text=p.getByRole('button',{name:'Text only',exact:true});
      await mode.selectOption('silent');assert.equal(await text.isDisabled(),true);
      assert.equal(await p.locator('#wzf-haru-preset-notice').isVisible(),true);
      await text.evaluate(el=>{document.activeElement.blur();el.focus();});
      assert.equal(await text.evaluate(el=>document.activeElement===el),false);await p.keyboard.press('Enter');
      assert.equal(await bubble(p).textContent(),'');
      assert.deepEqual(await p.evaluate(()=>window.WZFMascot.notify({event:'tool-complete',presetId:'text'})),{ok:false,code:'muted'});
      await text.evaluate(el=>el.onclick());
      assert.equal(await p.locator('.wzf-haru-state').textContent(),'Text-only interactions are unavailable in silent mode.');
      await p.getByRole('button',{name:'Quick greeting',exact:true}).click();
      await p.waitForFunction(()=>window.WZFHaruStatus().activeMotion==='wave'&&window.WZFHaruStatus().activeExpression==='smile');
      assert.equal(await bubble(p).textContent(),'');
      await mode.selectOption('active');await p.getByLabel('Occasional chatter',{exact:true}).check();
      assert.equal(await p.locator('#wzf-haru-idle-notice').isVisible(),true);
      assert.equal(await p.evaluate(()=>window.WZFHaruStatus().idleScheduled),false);
      assert.equal(await p.evaluate(()=>localStorage.getItem('wzf-mascot-idle-v1')),'enabled');
      if(output)await p.screenshot({path:path.join(output,'feedback-active-'+viewport.width+'.png')});
      await mode.selectOption('silent');
      if(output){await p.locator('#wzf-haru-preset-notice').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(output,'feedback-silent-'+viewport.width+'.png')});}
      await mode.selectOption('auto');assert.equal(await p.locator('#wzf-haru-idle-notice').isVisible(),false);
      assert.equal(await text.isEnabled(),true);await text.click();assert.equal(await bubble(p).textContent(),'alpha text only');
      await p.evaluate(()=>{localStorage.removeItem('wzf-mascot-idle-v1');localStorage.removeItem('wzf-mascot-dialogue-v1');});
      await p.close();checks++;
    }
    // Explicit buttons respond during welcome cooldown and pending manual work.
    for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
      const buttonsPage=await context.newPage();await buttonsPage.setViewportSize(viewport);await buttonsPage.clock.install();
      const hello=buttonsPage.getByRole('button',{name:'Say hello',exact:true});
      const chat=buttonsPage.getByRole('button',{name:'Chat once',exact:true});
      const events=()=>buttonsPage.evaluate(()=>window.__mascotFixture.events);
      const starts=async()=> (await events()).filter(e=>e.type==='play-start'&&e.channel==='motion');
      const status=()=>buttonsPage.evaluate(()=>window.WZFHaruStatus());
      const hold=()=>buttonsPage.evaluate(()=>{window.__mascotFixture.holdPlay=true;});
      const held=()=>buttonsPage.waitForFunction(()=>window.__mascotFixture.pendingPlays.length===1);
      const release=()=>buttonsPage.evaluate(()=>window.__mascotFixture.pendingPlays.splice(0).forEach(fn=>fn()));
      const panel=async()=>{await buttonsPage.getByRole('button',{name:'Interact',exact:true}).click();};
      await buttonsPage.goto(fixture.origin+'/?explicitButtons=1&mobile=1');await ready(buttonsPage);
      assert.equal(await bubble(buttonsPage).textContent(),'alpha welcome');
      await panel();await hold();await chat.click();await held();
      assert.match(await bubble(buttonsPage).textContent(),/^idle /,'chat responds immediately after welcome');
      await hello.click();await release();
      await buttonsPage.waitForFunction(()=>window.WZFHaruStatus().activeMotion==='wave');
      assert.equal((await events()).filter(e=>e.type==='play-complete'&&e.channel==='motion').length,1,'old chatter request stays cancelled');
      await buttonsPage.reload();await ready(buttonsPage);
      await panel();await hold();await hello.click();await held();
      assert.match(await bubble(buttonsPage).textContent(),/^alpha hello /);
      await chat.click();const first=await bubble(buttonsPage).textContent();assert.match(first,/^idle /);
      await chat.click();assert.notEqual(await bubble(buttonsPage).textContent(),first);
      assert.equal((await starts()).length,1,'chat text must not replace a loading greeting');
      await release();await buttonsPage.waitForFunction(()=>window.WZFHaruStatus().activeMotion==='wave');
      await buttonsPage.clock.runFor(1000);
      assert.equal((await starts()).some(e=>e.resource==='intro'),false,'cancel scheduled welcome');
      await buttonsPage.evaluate(()=>window.WZFMascot.command({action:'expression',id:'smile'}));
      await hello.click();await buttonsPage.waitForFunction(()=>window.__mascotFixture.events.filter(e=>e.type==='play-complete'&&e.channel==='motion').length===2);
      assert.equal((await status()).activeExpression,'smile');
      assert.equal((await starts()).length,2,'explicit greeting replaces an active greeting');
      const secondHello=await bubble(buttonsPage).textContent();
      await hello.click();assert.notEqual(await bubble(buttonsPage).textContent(),secondHello);
      await buttonsPage.waitForFunction(()=>window.__mascotFixture.events.filter(e=>e.type==='play-complete'&&e.channel==='motion').length===3);
      // Both public commands and the motion picker must lose to a newer greeting.
      await buttonsPage.clock.runFor(501);await hold();await buttonsPage.evaluate(()=>{window.__oldCommand=window.WZFMascot.command({action:'motion',id:'intro',caption:'Stale caption'});});await held();
      await hello.click();await release();
      assert.equal((await buttonsPage.evaluate(()=>window.__oldCommand)).code,'cancelled');
      await buttonsPage.waitForFunction(()=>window.WZFHaruStatus().activeMotion==='wave');
      assert.equal((await events()).some(e=>e.type==='play-complete'&&e.resource==='intro'),false);
      assert.notEqual(await buttonsPage.locator('.wzf-haru-state').textContent(),'Stale caption');
      await expandNavigation(buttonsPage);
      await buttonsPage.getByLabel('Choose motion',{exact:true}).selectOption('intro');
      await hold();await buttonsPage.getByRole('button',{name:'Play motion',exact:true}).click();await held();
      await chat.click();assert.match(await bubble(buttonsPage).textContent(),/^idle /);
      await hello.click();await release();
      await buttonsPage.waitForFunction(()=>window.WZFHaruStatus().activeMotion==='wave');
      assert.equal((await events()).some(e=>e.type==='play-complete'&&e.resource==='intro'),false);
      assert.equal((await status()).activeExpression,'smile');
      if(output)await buttonsPage.screenshot({path:path.join(output,'explicit-buttons-'+viewport.width+'.png')});
      await buttonsPage.close();checks++;
    }
    const pendingPage=await context.newPage();await pendingPage.clock.install();
    await pendingPage.goto(fixture.origin+'/?explicitButtons=1');await ready(pendingPage);
    await pendingPage.evaluate(()=>{window.__mascotFixture.holdPlay=true;});await pendingPage.clock.runFor(700);
    await pendingPage.waitForFunction(()=>window.__mascotFixture.pendingPlays.length===1);
    await pendingPage.getByRole('button',{name:'Interact',exact:true}).click();
    await pendingPage.getByRole('button',{name:'Say hello',exact:true}).click();
    await pendingPage.evaluate(()=>window.__mascotFixture.pendingPlays.splice(0).forEach(fn=>fn()));
    await pendingPage.waitForFunction(()=>window.WZFHaruStatus().activeMotion==='wave');
    assert.equal(await pendingPage.evaluate(()=>window.__mascotFixture.events.some(e=>e.type==='play-complete'&&e.resource==='intro')),false);
    // Explicit chat cancels neither a pending greeting nor its current expression.
    await pendingPage.evaluate(()=>window.WZFMascot.command({action:'stop'}));
    await pendingPage.getByRole('button',{name:'Chat once',exact:true}).click();
    await pendingPage.waitForFunction(()=>window.WZFHaruStatus().activeMotion==='wave');
    // Silent still permits configured greeting motions, and disables text-only buttons.
    await expandNavigation(pendingPage);
    await pendingPage.getByText('Dialogue preferences',{exact:true}).click();
    await pendingPage.getByLabel('Dialogue mode',{exact:true}).selectOption('silent');
    assert.equal(await pendingPage.getByRole('button',{name:'Chat once',exact:true}).isDisabled(),true);
    await pendingPage.getByRole('button',{name:'Say hello',exact:true}).click();assert.equal(await bubble(pendingPage).textContent(),'');
    await pendingPage.goto(fixture.origin+'/?explicitButtons=1&noGreeting=1');await ready(pendingPage);
    await pendingPage.getByRole('button',{name:'Interact',exact:true}).click();
    assert.equal(await pendingPage.getByRole('button',{name:'Say hello',exact:true}).isDisabled(),true);
    await pendingPage.evaluate(()=>localStorage.setItem('wzf-mascot-dialogue-v1','auto'));
    await pendingPage.goto(fixture.origin+'/?explicitButtons=1');await ready(pendingPage);
    const touch=pendingPage.getByRole('button',{name:'Tap Alpha fixture to greet',exact:true});
    const motionStarts=()=>pendingPage.evaluate(()=>window.__mascotFixture.events.filter(e=>e.type==='play-start'&&e.channel==='motion').length);
    await touch.click();await pendingPage.waitForFunction(()=>window.WZFHaruStatus().activeMotion==='wave');
    assert.equal(await bubble(pendingPage).textContent(),'alpha welcome','model touch keeps automatic dialogue cooldown');
    await pendingPage.evaluate(()=>window.WZFMascot.command({action:'stop'}));await touch.click();
    assert.equal(await motionStarts(),1,'model touch keeps the eight-second motion cooldown');
    await pendingPage.clock.runFor(8100);await touch.click();
    await pendingPage.waitForFunction(()=>window.__mascotFixture.events.filter(e=>e.type==='play-complete'&&e.channel==='motion').length===2);
    assert.equal(await bubble(pendingPage).textContent(),'','model touch still respects global dialogue cooldown');
    await pendingPage.clock.runFor(8100);await pendingPage.evaluate(()=>window.WZFMascot.command({action:'stop'}));await touch.click();
    assert.match(await bubble(pendingPage).textContent(),/^alpha hello /);
    await pendingPage.close();checks++;
    const page = await context.newPage(); await page.clock.install();
    await page.goto(fixture.origin+'/?dialogue=1'); await ready(page);
    assert.equal(await bubble(page).textContent(),'alpha <literal> welcome');
    await visibility(page,true); await page.clock.runFor(59000); await visibility(page,false);
    assert.equal(await bubble(page).textContent(),'');
    await visibility(page,true); await page.clock.runFor(61000); await visibility(page,false);
    assert.equal(await bubble(page).textContent(),'alpha <literal> return');
    await visibility(page,true); await page.clock.runFor(61000); await visibility(page,false);
    assert.equal(await bubble(page).textContent(),'alpha <literal> return');
    await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await page.clock.runFor(61000);await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
    assert.equal(await bubble(page).textContent(),'alpha <literal> return');checks++;
    await page.getByRole('button',{name:'Interact',exact:true}).click();await expandNavigation(page);
    if(!await page.getByText('Dialogue preferences',{exact:true}).evaluate(el=>el.parentElement.open))await page.getByText('Dialogue preferences',{exact:true}).click();
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
        // Resize events arrive independently of the simulated dialogue clock.
        // Wait for the shipped resize handler to place the bubble before measuring.
        await page.waitForFunction(({width,height}) => {
          const box=document.querySelector('.wzf-haru-bubble')?.getBoundingClientRect();
          return innerWidth===width && innerHeight===height && box && box.x>=0 && box.y>=0 && box.right<=width && box.bottom<=height;
        },viewport,{timeout:5000});
        const box=await bubble(page).boundingBox(); assert(box && box.x>=0 && box.y>=0 && box.x+box.width<=viewport.width && box.y+box.height<=viewport.height,JSON.stringify({box,viewport}));
        assert.equal(await bubble(page).evaluate((el)=>el.scrollHeight>el.clientHeight),false);
        if(output) await page.screenshot({path:path.join(output,language+'-'+viewport.width+'.png')});
      }
      // Both scripts need more than the former 4.5 second Chinese timeout.
      await page.clock.runFor(8000);assert.equal(await bubble(page).isVisible(),true);
      await bubble(page).focus();await page.keyboard.press('End');
      await bubble(page).dispatchEvent('wheel',{deltaY:120});
      await page.clock.runFor(31000);assert.equal(await bubble(page).isVisible(),true);
      assert.equal(await bubble(page).evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
      await page.getByRole('button',{name:'Interact',exact:true}).click();
      // Keep the bubble focused while the responsive layout moves it between containers.
      await bubble(page).focus();
      await page.setViewportSize({width:1440,height:900});
      await page.waitForFunction(()=>document.activeElement===document.querySelector('.wzf-haru-bubble') && document.activeElement.parentElement.id==='wzf-haru-character');
      await page.setViewportSize({width:390,height:844});
      await page.waitForFunction(()=>document.activeElement===document.querySelector('.wzf-haru-bubble') && document.activeElement.parentElement.id==='wzf-haru-panel');
      await page.clock.runFor(31000);assert.equal(await bubble(page).isVisible(),true);
      await page.evaluate(()=>document.dispatchEvent(new CustomEvent('wzf-mascot-suspension',{detail:{source:'reading-test',suspended:true}})));
      assert.equal(await bubble(page).isVisible(),false);
      assert.notEqual(await page.evaluate(()=>document.activeElement?.className),'wzf-haru-bubble');
      await page.evaluate(()=>document.dispatchEvent(new CustomEvent('wzf-mascot-suspension',{detail:{source:'reading-test',suspended:false}})));
      await page.setViewportSize({width:1440,height:900});
    } checks++;
    // Hover and touch scrolling preserve the same full reading window on release.
    await page.goto(fixture.origin+'/?dialogue=1&mobile=1');await ready(page);
    await bubble(page).hover();await page.clock.runFor(31000);assert.equal(await bubble(page).isVisible(),true);
    await page.mouse.move(0,0);await page.clock.runFor(4600);assert.equal(await bubble(page).isVisible(),false);
    await page.clock.runFor(16000);await page.getByRole('button',{name:'Tap Alpha fixture to greet',exact:true}).click();
    await bubble(page).dispatchEvent('pointerdown',{pointerType:'touch'});
    await page.clock.runFor(31000);assert.equal(await bubble(page).isVisible(),true);
    await bubble(page).dispatchEvent('pointercancel',{pointerType:'touch'});
    await page.clock.runFor(4600);assert.equal(await bubble(page).isVisible(),false);checks++;

    await page.goto(fixture.origin+'/?presets=1&mobile=1'); await ready(page);
    await page.getByRole('button',{name:'Interact',exact:true}).click();await expandNavigation(page);
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
    // Optional chatter uses one cancellable timer and never catches up missed windows.
    await page.setViewportSize({width:1440,height:900});
    await page.goto(fixture.origin+'/?idle=1&presets=1&mobile=1');await ready(page);
    await page.evaluate(()=>{Math.random=()=>0;window.__mascotFixture.freezeDrawing=true;});await page.clock.runFor(30);
    const idleState=()=>page.evaluate(()=>window.WZFHaruStatus());
    assert.equal((await idleState()).idleEnabled,false);assert.equal((await idleState()).idleScheduled,false);
    await page.clock.runFor(500000);assert.equal((await idleState()).idleScheduled,false);
    await page.getByRole('button',{name:'Interact',exact:true}).click();await expandNavigation(page);
    if(!await page.getByText('Dialogue preferences',{exact:true}).evaluate(el=>el.parentElement.open))await page.getByText('Dialogue preferences',{exact:true}).click();
    await page.getByLabel('Occasional chatter',{exact:true}).check();assert.equal((await idleState()).idleScheduled,false);
    await page.getByRole('button',{name:'Close interaction',exact:true}).click();assert.equal((await idleState()).idleScheduled,true);
    await page.evaluate(()=>{window.__idleLines=[];new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){const text=node.textContent;if(text.startsWith('idle '))window.__idleLines.push(text);}}).observe(document.querySelector('.wzf-haru-bubble'),{childList:true});});
    const seen=()=>page.evaluate(()=>window.__idleLines);
    for(let i=0;i<3;i++){await page.clock.runFor(90100);assert.equal((await seen()).length,i+1,JSON.stringify(await seen()));}
    assert.equal(new Set(await seen()).size,3);
    await page.clock.runFor(90100);assert.equal((await seen()).length,3);
    await visibility(page,true);assert.equal((await idleState()).idleScheduled,false);
    await page.clock.runFor(700000);await visibility(page,false);assert.equal((await idleState()).idleScheduled,true);
    await page.clock.runFor(80000);assert.equal(await bubble(page).textContent(),'');
    await page.locator('#outside-input').focus();await page.clock.runFor(10100);assert.equal(await bubble(page).textContent(),'');
    assert.equal((await idleState()).idleScheduled,true);await page.locator('#outside-button').focus();
    await page.clock.runFor(90100);assert.equal((await seen()).length,4);
    // Manual busy work cancels the waiting timer and starts a full new wait on completion.
    await page.evaluate(()=>{window.__mascotFixture.holdPlay=true;window.__idleCommand=window.WZFMascot.command({action:'motion',id:'wave'});});
    await page.waitForFunction(()=>window.__mascotFixture.pendingPlays.length===1);
    assert.equal((await idleState()).idleScheduled,false);
    await page.clock.runFor(85000);await page.evaluate(()=>{window.__mascotFixture.holdPlay=false;window.__mascotFixture.pendingPlays.splice(0).forEach(fn=>fn());});
    await page.evaluate(()=>window.__idleCommand);assert.equal((await idleState()).idleScheduled,true);
    await page.clock.runFor(5000);assert.equal(await bubble(page).textContent(),'');
    await page.getByRole('button',{name:'Interact',exact:true}).click();await expandNavigation(page);
    if(!await page.getByText('Dialogue preferences',{exact:true}).evaluate(el=>el.parentElement.open))await page.getByText('Dialogue preferences',{exact:true}).click();await page.getByLabel('Dialogue mode',{exact:true}).selectOption('active');
    assert.equal((await idleState()).idleScheduled,false);await page.clock.runFor(16000);
    await page.setViewportSize({width:390,height:844});await page.clock.runFor(50);
    await page.getByRole('button',{name:'Chat once',exact:true}).click();assert.match(await bubble(page).textContent(),/^idle /);
    assert.equal(await bubble(page).evaluate(el=>el.parentElement.id),'wzf-haru-panel');
    assert.equal(await page.locator('.wzf-haru-drag-handle').isVisible(),false);
    const bubbleBox=await bubble(page).boundingBox(),panelBox=await page.locator('#wzf-haru-panel').boundingBox();
    assert(bubbleBox.x>=panelBox.x && bubbleBox.x+bubbleBox.width<=panelBox.x+panelBox.width);
    if(output)await page.screenshot({path:path.join(output,'mobile-chat-inline.png')});
    await page.getByLabel('Dialogue mode',{exact:true}).selectOption('silent');assert.equal(await page.getByRole('button',{name:'Chat once',exact:true}).isDisabled(),true);
    assert.equal((await idleState()).idleScheduled,false);checks++;
    // Chatter uses guarded motion channels; text survives failures and manual work wins.
    await page.setViewportSize({width:1440,height:900});
    await page.addInitScript(()=>{Math.random=()=>0;});
    const startChatter = async () => {
      await page.evaluate(()=>{localStorage.setItem('wzf-mascot-dialogue-v1','auto');localStorage.setItem('wzf-mascot-idle-v1','enabled');});
      await page.goto(fixture.origin+'/?idle=1&chatterMotions=1&noGreeting=1');await ready(page);
      await page.evaluate(()=>{Math.random=()=>0;window.__mascotFixture.holdPlay=true;window.__mascotFixture.freezeDrawing=true;});
      await page.clock.runFor(90100);
      await page.waitForFunction(()=>window.__mascotFixture.pendingPlays.length===1);
      assert.match(await bubble(page).textContent(),/^idle /);
    };
    const releaseChatter = async () => {
      await page.evaluate(()=>window.__mascotFixture.pendingPlays.splice(0).forEach(fn=>fn()));
      await page.clock.runFor(20);
    };
    const completed = () => page.evaluate(()=>window.__mascotFixture.events.filter(e=>e.type==='play-complete'));
    for (const cancel of ['stop','expression','pause','hidden','disable','mode']) {
      await startChatter();
      if (cancel==='stop'||cancel==='expression') {
        const result=await page.evaluate(action=>window.WZFMascot.command(action==='stop'?{action:'stop'}:{action:'expression',id:'smile'}),cancel);
        assert.equal(result.ok,true);
      } else if(cancel==='pause')await page.evaluate(()=>document.dispatchEvent(new CustomEvent('wzf-mascot-suspension',{detail:{source:'test',suspended:true}})));
      else if(cancel==='hidden')await visibility(page,true);
      else {
        await page.getByRole('button',{name:'Interact',exact:true}).click();await expandNavigation(page);
        if(!await page.getByText('Dialogue preferences',{exact:true}).evaluate(el=>el.parentElement.open))await page.getByText('Dialogue preferences',{exact:true}).click();
        if(cancel==='disable')await page.getByLabel('Occasional chatter',{exact:true}).uncheck();
        else await page.getByLabel('Dialogue mode',{exact:true}).selectOption('active');
      }
      await releaseChatter();
      assert.equal((await completed()).filter(e=>e.channel==='motion').length,0,cancel);
    }checks++;
    await startChatter();await releaseChatter();assert.equal((await completed()).filter(e=>e.channel==='motion').length,1);
    // Still playing motion is never preempted by the next automatic line.
    await page.clock.runFor(90100);assert.equal((await completed()).filter(e=>e.channel==='motion').length,1);checks++;
    await page.route('**/motion/wave.json',route=>route.fulfill({status:503,body:'Synthetic failure'}));
    await page.goto(fixture.origin+'/?idle=1&chatterMotions=1&noGreeting=1');await ready(page);
    await page.evaluate(()=>{Math.random=()=>0;window.__mascotFixture.freezeDrawing=true;});await page.clock.runFor(90100);
    await page.waitForFunction(()=>document.querySelector('.wzf-haru-state').textContent.includes('Some interactions'));
    assert.match(await bubble(page).textContent(),/^idle /);assert.equal((await idleState()).ready,true);checks++;
    await page.unroute('**/motion/wave.json');
    // Actual administrator DOM helper: suggestions edit only blank fields and never submit.
    const {execFileSync}=require('node:child_process');
    const phpModule=path.resolve(__dirname,'../plugin/includes/interaction-settings.php');
    const drafts=JSON.parse(execFileSync('php',['-r',"define('ABSPATH','/stub/');function __($s,$d=null){return $s;}function add_action(...$x){}require "+JSON.stringify(phpModule)+";echo json_encode(wzf_mascot_dialogue_drafts());"],{encoding:'utf8'}));
    const adminPage=await context.newPage();
    const fields=['welcome','click','morning','afternoon','evening','return','idle'].map(event=>`<input type="checkbox" name="dialogue[${event}][enabled]"><textarea name="dialogue[${event}][lines]">${event==='welcome'?'Handwritten welcome':''}</textarea>`).join('');
    const slots=Array.from({length:8},(_,i)=>`<details><summary>Preset ${i}</summary><input name="presets[${i}][name]" value="${i===0?'Handwritten preset':''}"><input name="presets[${i}][line]"><select name="presets[${i}][motion]"><option value=""></option><option value="wave">Known greeting</option></select><select name="presets[${i}][expression]"><option value=""></option></select></details>`).join('');
    await adminPage.setContent(`<div class="wzf-mascot-admin"><form method="post"><div class="wzf-mascot-drafts"><select>${Object.entries(drafts).map(([key,row])=>`<option value="${key}">${row.name}</option>`).join('')}</select><button type="button">Fill</button><div class="wzf-mascot-draft-sources"></div><p class="wzf-mascot-draft-status"></p><script class="wzf-mascot-draft-data" type="application/json">${JSON.stringify(drafts)}</script></div>${fields}</form><form method="post"><button type="button" class="wzf-mascot-fill-presets">Fill presets</button>${slots}</form></div>`);
    await adminPage.locator('.wzf-mascot-fill-presets').evaluate(el=>el.dataset.drafts=JSON.stringify([{name:'Hello',line:'Draft hello',motion:'wave'},{name:'Rest',line:'Draft rest',motion:''},{name:'Read',line:'Draft reading',motion:''}]));
    await adminPage.evaluate(()=>{window.__draftSubmits=0;document.addEventListener('submit',event=>{event.preventDefault();window.__draftSubmits++;});});
    await adminPage.addScriptTag({content:fs.readFileSync(path.resolve(__dirname,'../plugin/admin.js'),'utf8')});
    await adminPage.locator('.wzf-mascot-drafts select').selectOption('character-misaka-summer');
    assert.equal(await adminPage.locator('.wzf-mascot-draft-sources a').getAttribute('href'),'https://toaru-project.com/railgun_t/chara/mikoto.html');
    await adminPage.locator('.wzf-mascot-drafts button').click();
    assert.equal(await adminPage.locator('[name="dialogue[welcome][lines]"]').inputValue(),'Handwritten welcome');
    assert.equal(await adminPage.locator('[name="dialogue[welcome][enabled]"]').isChecked(),false);
    assert.equal((await adminPage.locator('[name="dialogue[idle][lines]"]').inputValue()).split('\n').length,6);
    assert.equal(await adminPage.locator('[name="dialogue[idle][enabled]"]').isChecked(),true);
    const originalIdle=await adminPage.locator('[name="dialogue[idle][lines]"]').inputValue();
    await adminPage.locator('.wzf-mascot-drafts select').selectOption('character-ni-j');
    assert.equal(await adminPage.locator('.wzf-mascot-draft-sources a').count(),0);
    await adminPage.locator('.wzf-mascot-drafts button').click();
    assert.equal(await adminPage.locator('[name="dialogue[idle][lines]"]').inputValue(),originalIdle);
    await adminPage.locator('.wzf-mascot-fill-presets').click();
    assert.equal(await adminPage.locator('[name="presets[0][name]"]').inputValue(),'Handwritten preset');
    assert.equal(await adminPage.locator('[name="presets[0][line]"]').inputValue(),'');
    assert.equal(await adminPage.locator('[name="presets[1][motion]"]').inputValue(),'wave');
    assert.equal(await adminPage.evaluate(()=>window.__draftSubmits),0);
    assert.equal(await adminPage.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),true);
    await adminPage.close();checks++;
    console.log(JSON.stringify({complete:true,checks,syntheticOnly:true,realRenderingTested:false}));
  } finally {await context.close();await browser.close();await fixture.close();}
})().catch((e)=>{console.error(e);process.exitCode=1;});
