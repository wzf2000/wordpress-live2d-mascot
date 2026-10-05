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
    }) ||
      canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: true,
      })) as WebGLRenderingContext;
    if (!this.gl) throw new ResourceError('webgl', '浏览器不支持 WebGL，无法显示看板娘');
    if (
      options.webgl2 &&
      (typeof WebGL2RenderingContext === 'undefined' ||
        !(this.gl instanceof WebGL2RenderingContext))
    )
      throw new ResourceError('webgl', '此角色需要 WebGL 2，请选择其他角色或更换浏览器');
  }
  async init() {
    const signal = this.abort.signal;
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
      throw new ResourceError('invalid', '角色模型配置无效，请选择其他角色');
    }
    this.settings = new CubismModelSettingJson(raw, raw.byteLength);
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
      throw new ResourceError('invalid', '角色动作目录无效，请选择其他角色');
    }
    this.loadModel(await bytes(this.root + json.FileReferences.Moc, signal), true);
    if (!this.getModel()) throw new Error('模型校验失败');
    for (const [key, fn] of [
      ['Physics', 'loadPhysics'],
      ['Pose', 'loadPose'],
    ] as const) {
      if (!json.FileReferences[key]) continue;
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
    await Promise.all(
      json.FileReferences.Textures.map(async (file: string, index: number) => {
        const blob = (await resource(this.root + file, signal, 'blob')) as Blob;
        const img = await decodeImage(blob, signal);
        checkSignal(signal);
        const gl = this.gl,
          t = gl.createTexture();
        if (!t) throw Error('纹理创建失败');
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
      throw new ResourceError('invalid', '绘图程序无效，无法显示此角色');
    await this.asset('motion', this.idle);
    this.getModel().saveParameters();
    this.setInitialized(true);
  }
  async asset(type: string, id: string) {
    const list = type === 'motion' ? this.catalog.motions : this.catalog.expressions,
      entry = list.find((x: any) => x.id === id);
    if (!entry) throw Error('未知动作');
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
          if (!m) throw Error('动作文件不可用');
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
        })().finally(() => this.pending.delete(key)),
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
  pause() {
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
      this.frames++;
      const cost = performance.now() - renderStart;
      this.renderTotal += cost;
      this.renderMax = Math.max(this.renderMax, cost);
      this.frame = requestAnimationFrame((t) => this.tick(t));
    } catch (e) {
      console.error('Haru rendering', e);
      this.pause();
      this.canvas.dispatchEvent(new CustomEvent('mascoterror', { detail: '角色绘制失败' }));
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
      () => instance.abort.abort(new ResourceError('timeout', '角色初始化超时，请重试')),
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
      if (error instanceof ResourceError || (error as any)?.name === 'AbortError') throw error;
      throw new ResourceError('invalid', '角色资源无效，无法显示此角色，请重试或选择其他角色');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  },
};
