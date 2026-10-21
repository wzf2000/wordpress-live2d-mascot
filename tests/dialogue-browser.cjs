
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
