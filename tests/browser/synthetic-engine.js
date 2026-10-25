// Public synthetic browser contract only. This is NOT Cubism SDK/Core/model code
// and does not exercise WebGL, model parsing, visual quality or real GPU failures.
(() => {
  const fixture = window.__mascotFixture;
  const record = (event) => fixture.events.push(event);
  let sequence = 0;
  window.WZFHaruEngine = {
    async create(canvas, root, shaders, character, signal) {
      const id = ++sequence;
      (fixture.resourceObservers ||= []).push(character.onDiagnosticResource);
      record({ type: 'create-start', id, root });
      (fixture.stageCallbacks ||= []).push(character.onDiagnosticStage);
      character.onDiagnosticStage?.('model');
      const catalog = await fetch(root + 'catalog.json', { signal }).then((response) => response.json());
      await fetch(root + character.file, { signal }).then((response) => response.json());
      // Deliberately return a late candidate despite abort, so the real loader
      // must discard/destroy it. Test control cannot modify loader state.
      if (fixture.holdCreate) {
        fixture.holdCreate = false;
        await new Promise((resolve) => fixture.pendingCreates.push(resolve));
      }
      if (fixture.failTexture && (!fixture.failTextureRole || root.includes('/'+fixture.failTextureRole+'/'))) {
        const code = fixture.failTexture; fixture.failTexture = null;
        throw Object.assign(new Error('The character texture could not be displayed. Retry or choose another character.'), {name:'ResourceError',code,category:'texture'});
      }
      let paused = true, disposed = false, activeMotion = character.idle,
        activeExpression = null, frames = 0, timer = null;
      const channels = { motion: 0, expression: 0 };
      let capture=null;
      const cancelCapture=()=>{if(!capture)return false;const request=capture;capture=null;request.reject(new DOMException('Synthetic cancellation','AbortError'));return true;};
      const draw = () => {
        if (paused || disposed) return;
        if (!fixture.noFrames) frames++;
        const context = canvas.getContext('2d');
        context.clearRect(0,0,canvas.width,canvas.height);
        context.fillStyle = '#edf4fa'; context.fillRect(15,15,canvas.width-30,canvas.height-30);
        context.fillStyle = '#203c54'; context.font = '22px sans-serif';
        context.fillText('Synthetic fixture', 15, 45);
        context.fillText(character.name, 15, 80);
        if(capture&&!capture.started){const request=capture;request.started=true;const finish=()=>canvas.toBlob((blob)=>{if(capture===request){capture=null;request.resolve(blob);}},'image/png');if(fixture.holdCapture)fixture.pendingCaptures.push(finish);else finish();}
        if (!fixture.freezeDrawing) timer = requestAnimationFrame(draw);
      };
      const candidate = {
        catalog, disposed: false,
        capabilities:()=>({gazeParameters:['ParamAngleX','ParamEyeBallX'],hitAreas:root.includes('/alpha/')?['Head','Body']:[]}),
        setGaze(x,y){record({type:'gaze',id,x,y});},resetGaze(){record({type:'gaze-reset',id});},
        hitAreaAt(x,y){const box=canvas.getBoundingClientRect();return root.includes('/alpha/')?(y<box.y+box.height/2?'Head':'Body'):null;},
        gl: { getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }),
          getParameter: () => { fixture.gpuQueries++; return 'Synthetic SwiftShader'; } },
        state: () => ({ paused, disposed, activeMotion, activeExpression, frames,
          renderMsAvg: 0.1, renderMsMax: 0.2, renderMsTotal: frames * 0.1 }),
        captureFrame(){if(capture||paused||disposed||character.captureAllowed!==true)return Promise.reject(Error('Synthetic capture unavailable'));record({type:'capture',id});return new Promise((resolve,reject)=>{capture={resolve,reject,started:false};});},
        cancelCapture,
        pause() { cancelCapture(); paused = true; cancelAnimationFrame(timer); },
        resume() { if (paused && !disposed) { record({type:'resume',id}); paused = false; timer = requestAnimationFrame(draw); } },
        cancelPending(type) { channels[type]++; record({ type: 'cancel', id, channel: type }); },
        idleNow() { this.cancelPending('motion'); activeMotion = character.idle; },
        resetExpression() { this.cancelPending('expression'); activeExpression = null; },
        async play(type, resource) {
          const channel = ++channels[type];
          record({ type: 'play-start', id, channel: type, resource });
          await fetch(root + type + '/' + resource + '.json').then((response) => {
            if (!response.ok) throw new Error('Synthetic resource unavailable');
            return response.json();
          });
          if (fixture.holdPlay && (!fixture.holdPlayChannel || fixture.holdPlayChannel === type)) {
            fixture.holdPlay = false;
            await new Promise((resolve) => fixture.pendingPlays.push(resolve));
          }
          if (disposed || channel !== channels[type]) return false;
          if (type === 'motion') activeMotion = resource;
          else activeExpression = resource;
          record({ type: 'play-complete', id, channel: type, resource });
          return true;
        },
        destroy() {
          cancelCapture();
          disposed = this.disposed = true; paused = true;
          channels.motion++; channels.expression++; cancelAnimationFrame(timer);
          record({ type: 'destroy', id });
        },
      };
      record({ type: 'create-return', id, root, aborted: signal.aborted });
      return candidate;
    },
  };
})();
