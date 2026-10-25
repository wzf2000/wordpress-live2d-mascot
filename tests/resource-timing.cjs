// No SDK/model needed: exercise the actual bounded resource implementation.
const assert=require('node:assert/strict');
const {resource,decodeImage,bounded,RESOURCE_TIMEOUT_MS,textureResource,uploadTexture}=require(process.argv[2]);
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
let checks=0;
const trace=ordinal=>{const events=[];return {events,span:{ordinal,finish:(error,bodyBytes=null)=>events.push({code:error?.name==='AbortError'?'cancelled':error?.code||null,bodyBytes})}};};
(async()=>{
 const original={fetch:global.fetch,setTimeout:global.setTimeout,clearTimeout:global.clearTimeout,Image:global.Image};
 const timers=new Map();let sequence=0;
 global.setTimeout=(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;};
 global.clearTimeout=id=>timers.delete(id);
 const expire=()=>{const pending=[...timers.values()];timers.clear();for(const {fn} of pending)fn();};
 try {
  assert.equal(RESOURCE_TIMEOUT_MS,15000);
  const slow=deferred(),fast=deferred();global.fetch=url=>url==='slow'?slow.promise:fast.promise;
  const a=trace(1),b=trace(2),signal=new AbortController().signal;
  const pa=resource('slow',signal,'blob',a.span),pb=resource('fast',signal,'bytes',b.span);
  fast.resolve(new Response('abc'));await pb;assert.equal(a.events.length,0);assert.deepEqual(b.events,[{code:null,bodyBytes:3}]);
  slow.resolve(new Response('four'));await pa;assert.deepEqual(a.events,[{code:null,bodyBytes:4}]);checks++;
  const body=deferred();global.fetch=async()=>({ok:true,arrayBuffer:()=>body.promise});
  const hanging=trace(3),pending=resource('body',signal,'bytes',hanging.span);const rejected=assert.rejects(pending,e=>e.code==='timeout');await flush();
  assert.equal(hanging.events.length,0,'HTTP headers do not settle body timing');expire();await rejected;
  assert.deepEqual(hanging.events,[{code:'timeout',bodyBytes:null}]);body.resolve(new ArrayBuffer(25));await flush();assert.equal(hanging.events.length,1);checks++;
  global.fetch=async()=>new Response('bad',{status:503});const http=trace(4);
  await assert.rejects(resource('http',signal,'bytes',http.span),e=>e.code==='http');assert.deepEqual(http.events,[{code:'http',bodyBytes:null}]);checks++;
  global.fetch=async()=>{throw Error('private url/token');};const network=trace(5);
  await assert.rejects(resource('network',signal,'bytes',network.span),e=>e.code==='network');assert.deepEqual(network.events,[{code:'network',bodyBytes:null}]);checks++;
  global.fetch=async()=>new Response(new Uint8Array([0xff,0x61]));const text=trace(6);
  assert.equal(await resource('text',signal,'text',text.span),'\ufffda');assert.equal(text.events[0].bodyBytes,2,'count raw body bytes, not UTF-8 re-encoding');checks++;
  let image;global.Image=class{constructor(){image=this;}set src(value){this.source=value;}};
  const decoding=trace(7),decoded=decodeImage(new Blob(['png']),signal,decoding.span);const decodeRejected=assert.rejects(decoded,e=>e.code==='timeout');await flush();const late=image.onload;
  expire();await decodeRejected;assert.equal(decoding.events.length,1);assert.equal(decoding.events[0].code,'timeout');late();await flush();assert.equal(decoding.events.length,1);checks++;
  const active=new AbortController(),cancelled=trace(8),work=deferred();const cancellation=bounded(()=>work.promise,active.signal,15000,cancelled.span);const aborted=assert.rejects(cancellation,e=>e.name==='AbortError');await flush();active.abort();await aborted;work.resolve('late');await flush();assert.deepEqual(cancelled.events,[{code:'cancelled',bodyBytes:null}]);checks++;
  const already=new AbortController();already.abort();const early=trace(9);await assert.rejects(resource('never',already.signal,'bytes',early.span),e=>e.name==='AbortError');assert.equal(early.events.length,1);checks++;
  global.fetch=async()=>new Response('no observer');await resource('plain',signal);assert.equal(timers.size,0);checks++;
  global.fetch=async()=>new Response('ok');assert.equal(await resource('observer-throws',signal,'text',{ordinal:1,finish(){throw Error('bad observer');}}),'ok');checks++;
  const getter=trace(10);assert.equal(await bounded(async()=>42,signal,15000,getter.span,()=>{throw Error('bad metric getter');}),42);assert.deepEqual(getter.events,[{code:null,bodyBytes:null}]);checks++;
  const safe = code => error => error.name === 'ResourceError' && error.code === code && !/private|vendor|https:/.test(error.message);
  global.fetch=async()=>{throw Error('https://private/token');};
  await assert.rejects(textureResource('private',signal),safe('texture-download'));checks++;
  global.fetch=async()=>new Response('missing',{status:404});
  await assert.rejects(textureResource('private',signal),error=>safe('texture-download')(error)&&error.message.includes('missing'));checks++;
  global.fetch=async()=>new Response('busy',{status:503});
  await assert.rejects(textureResource('private',signal),error=>safe('texture-download')(error)&&error.message.includes('Retry later'));checks++;
  const bad=decodeImage(new Blob(['bad']),signal);const badRejected=assert.rejects(bad,safe('texture-decode'));await flush();image.onerror();await badRejected;checks++;
  const makeGL=(mode='ok')=>{
    const calls={created:0,deleted:0,uploaded:0,errors:0};let lost=mode==='lost';
    const gl={NO_ERROR:0,MAX_TEXTURE_SIZE:1,TEXTURE_2D:2,
      getParameter:()=>mode==='capability-throws'?(()=>{throw Error('vendor private');})():2048,
      isContextLost:()=>lost,
      getError:()=>{calls.errors++;return (mode==='stale-error'||(mode==='silent-error'&&calls.uploaded))?1285:0;},
      createTexture:()=>{calls.created++;if(mode==='create-null')return null;if(mode==='create-throws')throw Error('vendor private');return {};},
      deleteTexture:()=>calls.deleted++,bindTexture:()=>{},pixelStorei:()=>{},texParameteri:()=>{},
      texImage2D:()=>{calls.uploaded++;if(mode==='upload-throws')throw Error('vendor private');if(mode==='upload-lost')lost=true;},
    };return {gl,calls};
  };
  const valid={naturalWidth:2048,naturalHeight:1024,width:1,height:1};
  for(const mode of ['ok','lost','stale-error','silent-error','create-null','create-throws','upload-throws','upload-lost','capability-throws']) {
    const {gl,calls}=makeGL(mode);
    if(mode==='ok'){assert(uploadTexture(gl,valid,signal));assert.equal(calls.uploaded,1);assert.equal(calls.deleted,0);}
    else {assert.throws(()=>uploadTexture(gl,valid,signal),safe(mode.includes('lost')?'context-lost':'texture-upload'));assert.equal(calls.deleted,['silent-error','upload-throws','upload-lost'].includes(mode)?1:0);}
    assert(calls.errors<=2,'never drain driver errors in an unbounded loop');checks++;
  }
  for(const size of [{naturalWidth:2049,naturalHeight:1},{naturalWidth:1,naturalHeight:4096},{naturalWidth:0,naturalHeight:2},{naturalWidth:NaN,naturalHeight:2}]){
    const {gl,calls}=makeGL();assert.throws(()=>uploadTexture(gl,size,signal),safe(size.naturalWidth===0||Number.isNaN(size.naturalWidth)?'texture-decode':'texture-size'));assert.equal(calls.created,0);checks++;
  }
  const {gl,calls}=makeGL();const stop=new AbortController();gl.texImage2D=()=>stop.abort();
  assert.throws(()=>uploadTexture(gl,valid,stop.signal),e=>e.name==='AbortError');assert.equal(calls.deleted,1);checks++;
  console.log(JSON.stringify({complete:true,checks,resourceOnly:true,realRenderingTested:false}));
 }finally{Object.assign(global,original);}
})().catch(error=>{console.error(error);process.exitCode=1;});
