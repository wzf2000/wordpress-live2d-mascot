// Site integration, 2026-09-14. Framework imports retain the Live2D Open Software License.
import { CubismFramework } from './framework/live2dcubismframework';
import { CubismUserModel } from './framework/model/cubismusermodel';
import { CubismModelSettingJson } from './framework/cubismmodelsettingjson';
import { CubismMatrix44 } from './framework/math/cubismmatrix44';
import { CubismEyeBlink } from './framework/effect/cubismeyeblink';
import { CubismShaderManager_WebGL } from './framework/rendering/cubismshader_webgl';
import { ACubismMotion } from './framework/motion/acubismmotion';
import { CubismExpressionMotionManager } from './framework/motion/cubismexpressionmotionmanager';

import {
  bytes,
  resource,
  jsonResource,
  decodeImage,
  bounded,
  cancelled,
  checkSignal,
  ResourceError,
} from './resources';

// Fixed SDK queue removal splices while iterating. Drain until all entries are gone.
// Cached motions use autoDelete:false, so releasing entries never owns their assets.
function stopQueue(manager: any) {
  while (manager.getCubismMotionQueueEntries().length) manager.stopAllMotions();
}

class Mascot extends CubismUserModel {
  stage = 'webgl';
  phase(stage: string) {
    this.stage = stage;
    if (typeof this.options.onDiagnosticStage === 'function') this.options.onDiagnosticStage(stage);
  }
  catalog: any;
  options: any;
  idle: string;
  settings: any;
  root: string;
  shaderRoot: string;
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  stopped = true;
  disposed = false;
  frame: number | null = null;
  time = 0;
  frames = 0;
  lastMotion = '';
  lastExpression = '';
  activeMotion = 'haru_g_idle';
  motionElapsed = 0;
  completedMotion = '';
  motionPlays = 0;
  renderTotal = 0;
  renderMax = 0;
  motions = new Map<string, any>();
  expressions = new Map<string, any>();
  pending = new Map<string, Promise<any>>();
  textures: WebGLTexture[] = [];
  abort = new AbortController();
  sequences = { motion: 0, expression: 0 };
  captureRequest: any = null;
  gazeParameters = new Map<string, number>();
  hitAreas: { name: string; drawable: any }[] = [];
  gazeTarget = { x: 0, y: 0 };
  gazeCurrent = { x: 0, y: 0 };
  capabilities() {
    return { gazeParameters: [...this.gazeParameters.keys()], hitAreas: this.hitAreas.map((area) => area.name) };
  }
  setGaze(x: number, y: number) {
    if (this.disposed || this.stopped || !Number.isFinite(x) || !Number.isFinite(y)) return this.resetGaze();
    this.gazeTarget = { x: Math.max(-1, Math.min(1,x)), y: Math.max(-1, Math.min(1,y)) };
  }
  resetGaze() {
    this.gazeTarget = {x:0,y:0}; this.gazeCurrent = {x:0,y:0};
  }
  hitAreaAt(clientX: number, clientY: number) {
    if (this.disposed || this.stopped || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    const box=this.canvas.getBoundingClientRect();
    if (!box.width || !box.height || clientX<box.left || clientX>box.right || clientY<box.top || clientY>box.bottom) return null;
    const x=((clientX-box.left)/box.width*2-1)/((this.canvas.height/this.canvas.width)*0.92);
    const y=(1-(clientY-box.top)/box.height*2)/0.92;
    return this.hitAreas.find((area) => this.isHit(area.drawable,x,y))?.name || null;
  }
  applyGaze(dt: number) {
    const factor=1-Math.exp(-dt*7);
    this.gazeCurrent.x += (this.gazeTarget.x-this.gazeCurrent.x)*factor;
    this.gazeCurrent.y += (this.gazeTarget.y-this.gazeCurrent.y)*factor;
    const x=this.gazeCurrent.x,y=this.gazeCurrent.y;
    const values: Record<string,number>={ParamAngleX:x*6,ParamAngleY:y*5,ParamAngleZ:x*y*2,ParamBodyAngleX:x*2,ParamEyeBallX:x*0.18,ParamEyeBallY:y*0.18};
    for (const [name,index] of this.gazeParameters) this.getModel().addParameterValueByIndex(index,values[name]);
  }
  constructor(canvas: HTMLCanvasElement, root: string, shaderRoot: string, options: any = {}) {
    super();
    this.options = options;
    this.idle = options.idle || 'haru_g_idle';
    this.activeMotion = this.idle;
    this.canvas = canvas;
    this.root = root;
    this.shaderRoot = shaderRoot;
    this.gl = (canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      preserveDrawingBuffer: false,
    }) ||
      canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: true,
        preserveDrawingBuffer: false,
      })) as WebGLRenderingContext;
    if (!this.gl) throw new ResourceError('webgl', "This browser does not support WebGL; the mascot cannot be displayed.", 'webgl');
    if (
      options.webgl2 &&
      (typeof WebGL2RenderingContext === 'undefined' ||
        !(this.gl instanceof WebGL2RenderingContext))
    )
      throw new ResourceError('webgl', "This character requires WebGL 2. Choose another character or browser.", 'webgl');
  }
  async init() {
    const signal = this.abort.signal;
    this.phase('model');
    const raw = await bytes(this.root + (this.options.file || 'Haru.model3.json'), signal);
    const json = jsonResource(raw);
    const refs = json?.FileReferences;
    if (
      !refs ||
      typeof refs.Moc !== 'string' ||
      !Array.isArray(refs.Textures) ||
      !refs.Textures.length ||
      refs.Textures.some((file: any) => typeof file !== 'string' || !file)
    ) {
      throw new ResourceError('invalid', "Character model configuration is invalid. Choose another character.");
    }
    this.settings = new CubismModelSettingJson(raw, raw.byteLength);
    this.phase('catalog');
    const cat = await bytes(this.root + 'catalog.json', signal);
    this.catalog = jsonResource(cat);
    if (
      !this.catalog ||
      !['motions', 'expressions'].every(
        (key) =>
          Array.isArray(this.catalog[key]) &&
          this.catalog[key].every(
            (entry: any) => entry && typeof entry.id === 'string' && typeof entry.file === 'string',
          ),
      )
    ) {
      throw new ResourceError('invalid', "Character motion catalog is invalid. Choose another character.");
    }
    this.phase('moc');
    this.loadModel(await bytes(this.root + json.FileReferences.Moc, signal), true);
    if (!this.getModel()) throw new Error("Model validation failed");
    const model=this.getModel();
    const gazeIds=new Set(['ParamAngleX','ParamAngleY','ParamAngleZ','ParamBodyAngleX','ParamEyeBallX','ParamEyeBallY']);
    // getParameterIndex can manufacture virtual indices. Enumerate actual parameters only.
    for (let index=0; index<model.getParameterCount(); index++) {
      const name=model.getParameterId(index).getString();
      if (gazeIds.has(name)) this.gazeParameters.set(name,index);
    }
    for (let index=0; index<this.settings.getHitAreasCount(); index++) {
      const name=this.settings.getHitAreaName(index),drawable=this.settings.getHitAreaId(index);
      const drawableIndex=model.getDrawableIndex(drawable);
      if (typeof name==='string' && name && drawableIndex>=0 && model.getDrawableVertexCount(drawableIndex)>0 && !this.hitAreas.some((area)=>area.name===name)) this.hitAreas.push({name,drawable});
    }
    for (const [key, fn] of [
      ['Physics', 'loadPhysics'],
      ['Pose', 'loadPose'],
    ] as const) {
      if (!json.FileReferences[key]) continue;
      this.phase(key.toLowerCase());
      const b = await bytes(this.root + json.FileReferences[key], signal);
      jsonResource(b);
      this[fn](b, b.byteLength);
    }
    this._eyeBlink = CubismEyeBlink.create(this.settings);
    this._modelMatrix.setHeight(2 * (this.options.renderScale || 1));
    this._modelMatrix.setPosition(this.options.renderX || 0, this.options.renderY || 0);
    this.createRenderer(this.canvas.width, this.canvas.height);
    const renderer = this.getRenderer();
    renderer.startUp(this.gl);
    renderer.setIsPremultipliedAlpha(true);
    this.phase('texture');
    await Promise.all(
      json.FileReferences.Textures.map(async (file: string, index: number) => {
        const blob = (await resource(this.root + file, signal, 'blob')) as Blob;
        const img = await decodeImage(blob, signal);
        checkSignal(signal);
        const gl = this.gl,
          t = gl.createTexture();
        if (!t) throw Error("Texture creation failed");
        this.textures.push(t);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        renderer.bindTexture(index, t);
      }),
    );
    this.phase('shader');
    const shader = CubismShaderManager_WebGL.getInstance().getShader(this.gl);
    shader.setShaderPath(this.shaderRoot);
    // Fixed SDK Web 5 R5 integration: intercept its private loader so cancellation
    // rejects loadShaders before its late registration callback can touch a new model.
    let shaderError: unknown;
    (shader as any).loadShader = async (url: string) => {
      try {
        return await resource(url, signal, 'text');
      } catch (error) {
        shaderError = error;
        throw error;
      }
    };
    const sdkLoadShaders = (shader as any).loadShaders.bind(shader);
    (shader as any).loadShaders = async () => {
      await sdkLoadShaders();
      // The SDK catches individual fetch failures; restore rejection before registerShader.
      checkSignal(signal);
      if (shaderError) throw shaderError;
    };
    shader.generateShaders();
    await bounded(async (waitSignal) => {
      while (!shader._isShaderLoaded) {
        checkSignal(waitSignal);
        if (shaderError) throw shaderError;
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }, signal);
    checkSignal(signal);
    if (!shader._shaderSets[0]?.shaderProgram)
      throw new ResourceError('invalid', "The rendering program is invalid; this character cannot be displayed.");
    this.phase('motion');
    await this.asset('motion', this.idle);
    this.getModel().saveParameters();
    this.setInitialized(true);
    this.phase('ready');
  }
  async asset(type: string, id: string) {
    const list = type === 'motion' ? this.catalog.motions : this.catalog.expressions,
      entry = list.find((x: any) => x.id === id);
    if (!entry) throw Error("Unknown motion");
    const map = type === 'motion' ? this.motions : this.expressions;
    const key = type + ':' + id;
    if (map.has(id)) return map.get(id);
    if (!this.pending.has(key))
      this.pending.set(
        key,
        (async () => {
          const b = await bytes(this.root + entry.file, this.abort.signal);
          checkSignal(this.abort.signal);
          jsonResource(b);
          const m =
            type === 'motion'
              ? this.loadMotion(b, b.byteLength, id)
              : this.loadExpression(b, b.byteLength, id);
          if (!m) throw Error("Motion file unavailable");
          if (type === 'motion') {
            m.setLoop(id === this.idle);
            m.setEffectIds(
              Array.from({ length: this.settings.getEyeBlinkParameterCount() }, (_, i) =>
                this.settings.getEyeBlinkParameterId(i),
              ),
              [],
            );
            m.setFadeInTime(0.35);
            m.setFadeOutTime(0.35);
          }
          map.set(id, m);
          return m;
        })()
          .catch((error) => {
            if (error instanceof ResourceError) {
              error.category = type;
              throw error;
            }
            if (error?.name === 'AbortError') throw error;
            throw new ResourceError('invalid', "Motion or expression resources are invalid. Try again.", type);
          })
          .finally(() => this.pending.delete(key)),
      );
    return this.pending.get(key);
  }
  async play(type: string, id: string) {
    const channel = type === 'motion' ? 'motion' : 'expression';
    const seq = ++this.sequences[channel];
    const m = await this.asset(type, id);
    if (this.disposed || this.stopped || seq !== this.sequences[channel]) return false;
    if (type === 'motion') {
      this._motionManager.setReservePriority(3);
      this._motionManager.startMotionPriority(m, false, 3);
      this.lastMotion = id;
      this.activeMotion = id;
      this.motionElapsed = 0;
      this.motionPlays++;
    } else {
      this._expressionManager.startMotion(m, false);
      this.lastExpression = id;
    }
    return true;
  }
  idleNow() {
    if (this.disposed) return;
    this.sequences.motion++;
    stopQueue(this._motionManager);
    this._motionManager.setReservePriority(0);
    const idle = this.motions.get(this.idle);
    if (idle) this._motionManager.startMotionPriority(idle, false, 1);
    this.lastMotion = this.activeMotion = this.idle;
    this.motionElapsed = 0;
  }
  resetExpression() {
    if (this.disposed) return;
    this.sequences.expression++;
    // stopAllMotions alone retains expression blending/overwrite parameter lists.
    // release does not release the inherited queue; drain it before rebuilding.
    stopQueue(this._expressionManager);
    this._expressionManager.release();
    this._expressionManager = new CubismExpressionMotionManager();
    this.lastExpression = '';
    // The frame saves its current motion baseline before expression effects. Restore
    // that baseline, not model defaults, without changing the active motion or layout.
    this.getModel().loadParameters();
  }
  cancelPending(type: string) {
    if (type === 'motion' || type === 'expression') this.sequences[type]++;
  }
  captureFrame(): Promise<Blob> {
    if (this.disposed || this.stopped || !this.isInitialized() || this.options.captureAllowed !== true || this.captureRequest) return Promise.reject(new Error("PNG capture is unavailable for this character."));
    return new Promise((resolve,reject)=>{
      const request:any={resolve,reject,copy:null,timer:null};
      this.captureRequest=request;
      request.timer=setTimeout(()=>{if(this.captureRequest===request)this.cancelCapture();},5000);
    });
  }
  cancelCapture() {
    const request=this.captureRequest;
    if(!request)return false;
    this.captureRequest=null;clearTimeout(request.timer);
    if(request.copy){request.copy.width=0;request.copy.height=0;}
    request.reject(cancelled());return true;
  }
  copyCaptureFrame() {
    const request=this.captureRequest;
    if(!request || request.copy)return;
    try{
      const copy=document.createElement('canvas');copy.width=this.canvas.width;copy.height=this.canvas.height;
      const context=copy.getContext('2d',{alpha:true});
      if(!context)throw new Error("PNG capture failed. Try again.");
      request.copy=copy;
      // drawModel and this copy run in one JS task, before a non-preserved WebGL
      // drawing buffer can be discarded. No DOM or speech bubble enters the PNG.
      context.drawImage(this.canvas,0,0);
      copy.toBlob((blob)=>{
        if(this.captureRequest!==request)return;
        this.captureRequest=null;clearTimeout(request.timer);copy.width=0;copy.height=0;
        if(!blob || blob.type!=='image/png' || blob.size>16*1024*1024)request.reject(new Error("PNG capture failed. Try again."));
        else request.resolve(blob);
      },'image/png');
    }catch(error){
      if(this.captureRequest===request){this.captureRequest=null;clearTimeout(request.timer);if(request.copy){request.copy.width=0;request.copy.height=0;}request.reject(error);}
    }
  }
  pause() {
    this.cancelCapture();
    this.resetGaze();
    this.stopped = true;
    this.sequences.motion++;
    this.sequences.expression++;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }
  resume() {
    if (this.disposed || !this.isInitialized() || !this.stopped) return;
    this.stopped = false;
    this.time = performance.now();
    this.frame = requestAnimationFrame((t) => this.tick(t));
  }
  tick(t: number) {
    this.frame = null;
    if (this.stopped || this.disposed) return;
    if (t - this.time < 1000 / 30 - 0.5) {
      this.frame = requestAnimationFrame((next) => this.tick(next));
      return;
    }
    const dt = Math.min((t - this.time) / 1000, 0.1);
    this.time = t;
    try {
      const renderStart = performance.now();
      const model = this.getModel();
      model.loadParameters();
      if (this._motionManager.isFinished()) {
        if (this.activeMotion !== this.idle) this.completedMotion = this.activeMotion;
        this.activeMotion = this.idle;
        this.motionElapsed = 0;
        this._motionManager.startMotionPriority(this.motions.get(this.idle), false, 1);
      }
      this.motionElapsed += dt;
      const updated = this._motionManager.updateMotion(model, dt);
      model.saveParameters();
      if (!updated) this._eyeBlink.updateParameters(model, dt);
      this._expressionManager.updateMotion(model, dt);
      this.applyGaze(dt);
      this._physics?.evaluate(model, dt);
      this._pose?.updateParameters(model, dt);
      model.update();
      const gl = this.gl;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const matrix = new CubismMatrix44();
      matrix.scale((this.canvas.height / this.canvas.width) * 0.92, 0.92);
      matrix.multiplyByMatrix(this._modelMatrix);
      this.getRenderer().setMvpMatrix(matrix);
      this.getRenderer().setRenderState(null, [0, 0, this.canvas.width, this.canvas.height]);
      this.getRenderer().drawModel(this.shaderRoot);
      this.copyCaptureFrame();
      this.frames++;
      const cost = performance.now() - renderStart;
      this.renderTotal += cost;
      this.renderMax = Math.max(this.renderMax, cost);
      this.frame = requestAnimationFrame((t) => this.tick(t));
    } catch (e) {
      console.error('Haru rendering', e);
      this.pause();
      this.canvas.dispatchEvent(new CustomEvent('mascoterror', { detail: "Character rendering failed" }));
    }
  }
  state() {
    return {
      frames: this.frames,
      paused: this.stopped,
      motion: this.lastMotion,
      expression: this.lastExpression,
      activeMotion: this.activeMotion,
      motionElapsed: this.motionElapsed,
      completedMotion: this.completedMotion,
      motionPlays: this.motionPlays,
      renderMsAvg: this.frames ? this.renderTotal / this.frames : 0,
      renderMsMax: this.renderMax,
      cachedMotions: this.motions.size,
      cachedExpressions: this.expressions.size,
    };
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
    this.abort.abort();
    stopQueue(this._expressionManager);
    this.release();
    for (const m of this.motions.values()) ACubismMotion.delete(m);
    for (const m of this.expressions.values()) ACubismMotion.delete(m);
    this.motions.clear();
    this.expressions.clear();
    for (const t of this.textures) this.gl.deleteTexture(t);
    this.textures = [];
    CubismShaderManager_WebGL.deleteInstance();
  }
}
(window as any).WZFHaruEngine = {
  create: async (
    canvas: HTMLCanvasElement,
    root: string,
    shaders: string,
    options: any = {},
    signal = new AbortController().signal,
  ) => {
    checkSignal(signal);
    if (!CubismFramework.isStarted()) CubismFramework.startUp();
    if (!CubismFramework.isInitialized()) CubismFramework.initialize();
    const instance = new Mascot(canvas, root, shaders, options);
    // Destroy synchronously on cancellation: the old create's eventual catch is then
    // idempotent and cannot release the shader manager of a newer create.
    const abort = () => instance.destroy();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () =>
        instance.abort.abort(
          new ResourceError('timeout', "Character initialization timed out. Try again.", instance.stage),
        ),
      60000,
    );
    try {
      await instance.init();
      checkSignal(signal);
      checkSignal(instance.abort.signal);
      return instance;
    } catch (error) {
      instance.destroy();
      if (signal.aborted) throw signal.reason || cancelled();
      if (error instanceof ResourceError) {
        if (error.category === 'resource') error.category = instance.stage;
        throw error;
      }
      if ((error as any)?.name === 'AbortError') throw error;
      throw new ResourceError(
        'invalid',
        "Character resources are invalid. Retry or choose another character.",
        instance.stage,
      );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  },
};
