/* GPL-2.0-or-later with the additional permission in LICENSE. */
(() => {
  'use strict';
  const data=document.querySelector('#wzf-mascot-preview-data');
  if(!data)return;
  const config=JSON.parse(data.textContent), labels=config.labels, root=document.querySelector('.wzf-mascot-preview-root');
  const node=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
  const heading=node('h2',config.name), note=node('p',labels.idle), controls=node('div'), start=node('button',labels.start),stop=node('button',labels.stop),pause=node('button',labels.pause),select=node('select'),play=node('button',labels.try),line=node('p'),status=node('p'),capabilities=node('p');
  const terms=node('a',labels.terms);terms.href=config.terms;terms.target='_blank';terms.rel='noopener';
  const canvas=node('canvas');canvas.width=360;canvas.height=540;canvas.hidden=true;canvas.setAttribute('aria-label',config.name);
  controls.className='wzf-mascot-preview-controls';line.className='wzf-mascot-preview-line';status.setAttribute('role','status');status.setAttribute('aria-live','polite');select.setAttribute('aria-label',labels.title);
  for(const button of [start,stop,pause,play]){button.type='button';button.className=button===start?'button button-primary':'button';}
  note.className='wzf-mascot-preview-initial';
  const rows=[];
  for(const [event,rule] of Object.entries(config.dialogue||{})) {
    rows.push({name:event,key:event,rule});const option=node('option',config.eventLabels?.[event]||event);option.value=String(rows.length-1);select.append(option);
  }
  for(const preset of config.presets||[]){rows.push({name:preset.name,preset});const option=node('option',preset.name);option.value=String(rows.length-1);select.append(option);}
  const rules=node('details');rules.append(node('summary',labels.rules),node('p',labels.welcome),node('p',labels.chatter));
  root.append(heading,note,terms,node('p',`${labels.motions}: ${config.motionCount} · ${labels.expressions}: ${config.expressionCount}`),rules,controls,canvas,line,capabilities,status);
  controls.append(start,stop,pause,select,play);
  let engine=null,controller=null,generation=0,paused=false,playing=0;
  const rotations=new Map();
  const pick=(key,values)=>{if(!values?.length)return '';const index=rotations.get(key)||0;rotations.set(key,index+1);return values[index%values.length];};
  const paint=()=>{note.hidden=!!engine||!!controller;stop.disabled=!engine&&!controller;pause.disabled=!engine;play.disabled=!engine||paused||!rows.length;pause.textContent=paused?labels.resume:labels.pause;};
  const end=()=>{generation++;playing++;controller?.abort();controller=null;engine?.destroy();engine=null;paused=false;canvas.hidden=true;line.textContent='';capabilities.textContent='';status.textContent=labels.ended;paint();};
  const script=async(url,exists,signal)=>{
    if(signal.aborted)throw Error('cancelled');
    if(exists())return;
    const local=new AbortController(),abort=()=>local.abort(),timer=setTimeout(abort,15000);signal.addEventListener('abort',abort,{once:true});
    try {
      const response=await fetch(url,{signal:local.signal,credentials:'omit'});if(!response.ok)throw Error('resource');const source=await response.text();if(local.signal.aborted)throw Error('cancelled');
      await new Promise((resolve,reject)=>{const tag=node('script'),blob=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));let done=false;
        const finish=error=>{if(done)return;done=true;tag.onload=tag.onerror=null;local.signal.removeEventListener('abort',cancel);tag.remove();URL.revokeObjectURL(blob);error?reject(error):resolve();};
        const cancel=()=>finish(Error('cancelled'));tag.onload=()=>finish(exists()?null:Error('runtime'));tag.onerror=()=>finish(Error('runtime'));local.signal.addEventListener('abort',cancel,{once:true});tag.src=blob;document.head.append(tag);
      });
    }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
  };
  start.onclick=async()=>{
    end();const token=generation;controller=new AbortController();const signal=controller.signal;status.textContent=labels.loading;paint();
    try{await script(config.core,()=>!!window.Live2DCubismCore,signal);await script(config.engine,()=>!!window.WZFHaruEngine,signal);if(signal.aborted||token!==generation)return;
      const candidate=await window.WZFHaruEngine.create(canvas,config.root,config.shaders,config.options,signal);
      if(signal.aborted||token!==generation){candidate.destroy();return;}engine=candidate;controller=null;canvas.hidden=false;engine.resume();status.textContent=labels.ready;
      const supported=engine.capabilities();capabilities.textContent=`${labels.capabilities}: ${labels.gaze} ${supported.gazeParameters.length} · ${labels.hits} ${supported.hitAreas.length}`;paint();
      window.scrollTo(0,Math.max(0,window.scrollY+canvas.getBoundingClientRect().bottom-window.innerHeight+12));
    }catch{if(token===generation){end();status.textContent=labels.failed;}}
  };
  stop.onclick=end;pause.onclick=()=>{if(!engine)return;paused=!paused;playing++;engine.cancelPending('motion');engine.cancelPending('expression');paused?engine.pause():engine.resume();paint();};
  play.onclick=async()=>{
    if(!engine||paused)return;const row=rows[Number(select.value)],target=engine,token=++playing;
    target.cancelPending('motion');target.cancelPending('expression');line.textContent='';
    try{
      let motions=[], caption='';
      if(row.rule){
        let event=row.key,rule=row.rule;
        if(['welcome','morning','afternoon','evening'].includes(event)) {
          const welcome=config.dialogue.welcome;
          if(welcome?.enabled&&welcome.lines.length){event='welcome';rule=welcome;}
          else if(event==='welcome'){const hour=new Date().getHours();event=hour<12?'morning':hour<18?'afternoon':'evening';rule=config.dialogue[event];}
          if(config.options.welcome)motions=[config.options.welcome];
        } else if(event==='click')motions=config.options.greetings||[];
        else if(event==='idle')motions=rule.motions||[];
        if(!rule?.lines?.length){status.textContent=labels.empty;return;}
        if(!rule.enabled){status.textContent=labels.disabled;return;}
        line.textContent=pick('line:'+event,rule.lines);
        const motion=pick('motion:'+event,motions.filter(id=>target.catalog.motions.some(item=>item.id===id)));
        if(motion)await target.play('motion',motion);
        caption=(config.eventLabels?.[event]||event)+': '+(motion?labels.ready:labels.noMotion);
      } else {
        line.textContent=row.preset.line;
        await Promise.all(['motion','expression'].filter(type=>row.preset[type]).map(type=>target.play(type,row.preset[type])));
        caption=row.preset.motion||row.preset.expression?labels.ready:labels.noMotion;
      }
      if(target===engine&&token===playing)status.textContent=caption;
    }catch{if(target===engine&&token===playing)status.textContent=labels.failed;}
  };
  const renderFailure=event=>{event?.preventDefault();end();status.textContent=labels.failed;};
  canvas.addEventListener('webglcontextlost',renderFailure);canvas.addEventListener('mascoterror',renderFailure);
  window.addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='wzf-mascot-preview-stop')end();});
  window.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();parent.postMessage({type:'wzf-mascot-preview-close'},new URL(document.baseURI).origin);}});
  window.addEventListener('pagehide',end);document.addEventListener('visibilitychange',()=>{if(document.hidden)end();});paint();
})();
