(() => {
  'use strict';
  const el = document.getElementById('wzf-live2d-config');
  if (!el) return;
  let config;
  try {
    config = JSON.parse(el.textContent);
  } catch {
    return;
  }
  const t = (message, ...values) => {
    const translated = config.i18n && Object.hasOwn(config.i18n, message) && typeof config.i18n[message] === 'string' ? config.i18n[message] : message;
    return translated.replace(/%([1-9]\d*)\$s/g, (match, index) => String(values[Number(index) - 1] ?? match));
  };
  const start = () => {
    const characters = config.characters;
    if (!characters || typeof characters !== 'object' || !Object.keys(characters).length) return;
    const defaultCharacter = Object.hasOwn(characters, 'haru')
      ? 'haru'
      : Object.keys(characters)[0];
    const favoritesKey = 'wzf-mascot-favorites';
    const readFavorites = () => {
      const raw = localStorage.getItem(favoritesKey);
      let ids;
      try {
        ids = JSON.parse(raw || '[]');
      } catch {
        ids = [];
      }
      return new Set(
        Array.isArray(ids)
          ? ids.filter(
              (id) =>
                typeof id === 'string' &&
                id.length > 0 &&
                id.length <= 200 &&
                !/[\u0000-\u001f\u007f]/.test(id),
            )
          : [],
      );
    };
    let favorites = new Set(),
      favoritesNotice = '';
    let recent = [], recentNotice = '';
    const recentKey='wzf-mascot-recent-v1';
    const historyId=(id)=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
    try{const saved=JSON.parse(localStorage.getItem(recentKey)||'[]');if(Array.isArray(saved))recent=[...new Set(saved.filter(historyId))].slice(0,8);}catch{}
    const pendingFavorites = new Map();
    // Favorites storage must not interrupt the existing visibility/consent reads.
    try {
      favorites = readFavorites();
    } catch {}
    const suspensions = new Set();
    const interactions = { motion: 0, expression: 0 };
    const desktop = matchMedia('not all and (max-width:782px)'),
      reduce = matchMedia('(prefers-reduced-motion: reduce)');
    let wanted = false,
      mobileOptIn = false,
      accepted = false,
      loading = false,
      failed = false,
      engine = null,
      host = null,
      canvas = null,
      panelOpen = false,
      operation = 0,
      generation = 0,
      touchCount = 0,
      nextTouch = 0,
      touchPending = false,
      manualPending = new Set(),
      committed = defaultCharacter,
      active = defaultCharacter,
      preview = false,
      layouts = {},
      loadController = null,
      loadAttempt = 0,
      pageHidden = false,
      loadError = '';
    try {
      wanted = localStorage.getItem('wzfl-mascot') === 'shown';
      mobileOptIn = localStorage.getItem('wzf-mascot-mobile-v1') === 'enabled';
      accepted = localStorage.getItem('wzf-haru-terms') === config.termsVersion;
      const saved = localStorage.getItem('wzf-mascot-character');
      if (Object.hasOwn(characters, saved)) committed = saved;
      const parsed = JSON.parse(localStorage.getItem('wzf-mascot-layouts') || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) layouts = parsed;
      if (!layouts.haru) {
        const old = JSON.parse(localStorage.getItem('wzf-haru-layout') || 'null');
        if (old && typeof old === 'object') layouts.haru = old;
      }
    } catch {}
    let dialogueMode = 'auto';
    try {
      const saved = localStorage.getItem('wzf-mascot-dialogue-v1');
      if (['auto', 'active', 'silent'].includes(saved)) dialogueMode = saved;
    } catch {}
    const dialogueShown = new Map();
    let bubble = null, bubbleTimer = null, dialogueWelcomeConsumed = false,
      lastDialogue = -Infinity, awayAt = null;
    const clearDialogue = () => {
      clearTimeout(bubbleTimer);
      bubbleTimer = null;
      if (bubble) { bubble.textContent = ''; bubble.hidden = true; }
    };
    const showLine = (line, proactive = false) => {
      if (!allowed() || !engine || loading || dialogueMode === 'silent' ||
          (proactive && (dialogueMode !== 'auto' || preview))) return false;
      if (typeof line !== 'string' || !line.trim() || new TextEncoder().encode(line).length > 300 || /[\u0000-\u001f\u007f]/.test(line)) return false;
      clearDialogue();
      if (!bubble) return false;
      bubble.textContent = line;
      bubble.hidden = false;
      placeDialogue();
      bubbleTimer = setTimeout(clearDialogue, Math.max(4500,Math.min(12000,[...line].length*40)));
      return true;
    };
    const speak = (event, proactive = false) => {
      const rule = characters[active].dialogue?.[event];
      if (!rule || rule.enabled !== true || !Array.isArray(rule.lines)) return false;
      const lines = rule.lines.filter((line) => typeof line === 'string' && line.trim() && new TextEncoder().encode(line).length <= 300);
      const cooldown = Number.isInteger(rule.cooldown) && rule.cooldown >= 15 && rule.cooldown <= 3600 ? rule.cooldown * 1000 : 60000;
      const now = performance.now(), key = active + ':' + event;
      if (!lines.length || now - lastDialogue < 15000 || now - (dialogueShown.get(key) ?? -Infinity) < cooldown) return false;
      if (!showLine(lines[Math.floor(Math.random() * lines.length)], proactive)) return false;
      dialogueShown.set(key, now); lastDialogue = now;
      return true;
    };
    const welcomeDialogue = () => {
      if (dialogueWelcomeConsumed || preview || !allowed() || !engine || loading) return;
      dialogueWelcomeConsumed = true;
      const hour = new Date().getHours();
      if (!speak('welcome', true)) speak(hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening', true);
    };
    active = committed;
    let position = 'right',
      size = 180,
      anchor = null, dragState = null;
    let dragHandle = null;
    let welcomeConsumed = false,
      welcomeCount = 0,
      welcomeTimer = null,
      welcomeEnd = null,
      welcomeTarget = null;
    let pendingPreset = null;
    const cancelPreset = () => {
      const pending = pendingPreset;
      pendingPreset = null;
      if (!pending || pending.target !== engine || pending.g !== generation) return;
      operation++;
      for (const [type, channel] of pending.channels) {
        if (interactions[type] !== channel) continue;
        engine.cancelPending(type);
        interactions[type]++;
        manualPending.delete(type);
      }
    };
    const cancelWelcome = (preserveActiveMotion = false) => {
      clearTimeout(welcomeTimer);
      welcomeTimer = null;
      if (
        preserveActiveMotion &&
        welcomeTarget === engine &&
        engine &&
        engine.state().activeMotion === characters[active].welcome
      )
        return;
      clearTimeout(welcomeEnd);
      welcomeEnd = null;
      if (welcomeTarget && welcomeTarget === engine && !welcomeTarget.disposed)
        welcomeTarget.idleNow();
      welcomeTarget = null;
    };
    const scheduleWelcome = () => {
      welcomeDialogue();
      if (welcomeConsumed || preview || !allowed() || !engine) return;
      welcomeConsumed = true;
      const target = engine,
        g = generation,
        id = characters[active].welcome;
      if (!id) return;
      welcomeTimer = setTimeout(async () => {
        welcomeTimer = null;
        if (
          !allowed() ||
          loading ||
          preview ||
          engine !== target ||
          g !== generation ||
          manualPending.size ||
          touchPending ||
          target.state().activeMotion !== characters[active].idle
        )
          return;
        const n = operation;
        welcomeTarget = target;
        try {
          const done = await target.play('motion', id);
          if (!done || welcomeTarget !== target || n !== operation || g !== generation) return;
          welcomeCount++;
          state.textContent = t("%1$s welcomes you", characters[active].name);
          welcomeEnd = setTimeout(() => {
            if (welcomeTarget === target && g === generation) cancelWelcome();
          }, 3500);
        } catch {
          if (welcomeTarget === target) cancelWelcome();
        }
      }, 650);
    };
    const make = (tag, text, cls) => {
      const e = document.createElement(tag);
      if (text) e.textContent = text;
      if (cls) e.className = cls;
      if (tag === 'button') e.type = 'button';
      return e;
    };
    // Diagnostics stay in memory. Nothing is sampled or queried from the GPU until opt-in.
    let diagnosticsEnabled = false,
      diagnosticReport = null,
      currentLoad = null,
      loadStage = 'idle',
      lastDiagnosticError = null,
      sampleWindow = null,
      firstFrameWatch = null,
      diagnosticGeneration = 0,
      diagnosticWindows = [],
      replacedWindows = 0,
      windowSequence = 0,
      sampleSeries = null,
      seriesMessage = '';
    const diagnostics = make('details', '', 'wzf-haru-diagnostics');
    diagnostics.append(make('summary', t("Local diagnostics")));
    const diagnosticBody = make('div', '', 'wzf-haru-diagnostic-body');
    const diagnosticEnable = make('button', t("Enable local diagnostics")),
      diagnosticSample = make('button', t("Sample for 3 seconds")),
      diagnosticSeries = make('button', t("Sample 3 windows")),
      diagnosticStopSample = make('button', t("Stop sampling")),
      diagnosticExport = make('button', t("Download diagnostic JSON")),
      diagnosticExportBatch = make('button', t("Download all saved windows")),
      diagnosticSaved = make('p'),
      diagnosticStatus = make('p', t("Diagnostics are not enabled."));
    diagnosticStatus.setAttribute('role', 'status');
    diagnosticStatus.setAttribute('aria-live', 'polite');
    diagnosticSaved.setAttribute('aria-live', 'polite');
    diagnosticBody.append(
      make(
        'p',
        t("After you enable diagnostics, this page reads current WebGL / GPU information and records local loading and short FPS samples. Reports exclude page URLs, queries, cookies and user profiles and are never sent to a server."),
      ),
      diagnosticEnable,
      make('p', t("Re-enabling diagnostics clears saved windows and starts a new batch. Up to 20 windows stay in this page's memory; older windows are replaced.")),
      diagnosticSample,
      diagnosticSeries,
      diagnosticStopSample,
      make('p', t("Single report downloads the last saved window; before sampling, it downloads current diagnostic state.")),
      diagnosticExport,
      diagnosticExportBatch,
      diagnosticSaved,
      diagnosticStatus,
    );
    diagnostics.append(diagnosticBody);
    document.body.append(diagnostics);
    const diagnosticUpdate = () => {
      diagnosticEnable.textContent = diagnosticsEnabled ? t("Stop recording") : t("Enable local diagnostics");
      diagnosticSample.disabled =
        !diagnosticsEnabled || !!sampleWindow || !engine || !allowed() || loading;
      diagnosticSeries.disabled = diagnosticSample.disabled || !!sampleSeries;
      diagnosticStopSample.disabled = !sampleWindow && !sampleSeries;
      diagnosticExport.disabled = !diagnosticReport;
      diagnosticExportBatch.disabled = !diagnosticWindows.length;
      diagnosticSaved.textContent = t("Saved windows: %1$s of 20. Older windows replaced: %2$s.", diagnosticWindows.length, replacedWindows);
      diagnosticStatus.textContent = !diagnosticReport
        ? t("Diagnostics are not enabled.")
        : sampleWindow
          ? sampleSeries
            ? t("Continuous sampling: window %1$s of 3. Hiding or switching stops the sequence.", sampleSeries.completed + 1)
            : t("Sampling; hiding, reading suspension or character switching will interrupt it.")
          : seriesMessage
            ? seriesMessage
          : diagnosticReport.sample
            ? diagnosticReport.sample.interrupted
              ? t("Sample interrupted.")
              : t("Sample complete: %1$s FPS.", diagnosticReport.sample.fps.toFixed(1))
            : t("Local state recorded. Sample now, or show the mascot again to record loading time. You choose whether to share downloaded reports.");
    };
    const diagnosticEnvironment = () => {
      const result = {
        viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
        reducedMotion: reduce.matches,
        webgl: null,
        gpuRenderer: null,
        softwareRenderer: null,
      };
      const gl = engine?.gl;
      if (gl) {
        result.webgl =
          typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
            ? 'webgl2'
            : 'webgl';
        try {
          const extension = gl.getExtension('WEBGL_debug_renderer_info');
          if (extension) {
            result.gpuRenderer = String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)).slice(
              0,
              300,
            );
            result.softwareRenderer = /swiftshader|llvmpipe|softpipe|software|lavapipe/i.test(
              result.gpuRenderer,
            );
          }
        } catch {}
      }
      return result;
    };
    const diagnosticId = () => [...crypto.getRandomValues(new Uint8Array(16))]
      .map((value) => value.toString(16).padStart(2, '0')).join('');
    const diagnosticSnapshot = (report) => {
      const copy = JSON.parse(JSON.stringify(report));
      if (copy.load) delete copy.load.started;
      for (const load of copy.loadAttempts || []) delete load.started;
      return copy;
    };
    const diagnosticBegin = (id, fallback = false) => {
      if (!diagnosticsEnabled) return;
      if (!fallback) diagnosticReport.requestedCharacterId = id;
      diagnosticReport.loadSessionId = diagnosticId();
      currentLoad = {
        sessionId: diagnosticReport.loadSessionId,
        characterId: id,
        fallback,
        started: performance.now(),
        stages: [],
        status: 'loading',
        readyMs: null,
        firstFrameMs: null,
        firstFrameStatus: 'not-observed',
      };
      diagnosticReport.load = currentLoad;
      diagnosticReport.renderedCharacterId = null;
      diagnosticReport.loadAttempts.push(currentLoad);
      if (diagnosticReport.loadAttempts.length > 20) diagnosticReport.loadAttempts.shift();
    };
    const diagnosticPhase = (phase) => {
      if (
        ![
          'idle',
          'core',
          'engine',
          'webgl',
          'model',
          'catalog',
          'moc',
          'physics',
          'pose',
          'texture',
          'shader',
          'motion',
          'ready',
        ].includes(phase)
      )
        return;
      loadStage = phase;
      if (diagnosticsEnabled) diagnosticReport.phase = phase;
      if (diagnosticsEnabled && currentLoad && currentLoad.stages.length < 30)
        currentLoad.stages.push({ phase, elapsedMs: performance.now() - currentLoad.started });
    };
    const diagnosticError = (error, category = loadStage) => {
      const codes = [
        'timeout',
        'http',
        'network',
        'invalid',
        'webgl',
        'context-lost',
        'render',
        'cancelled',
      ];
      const categories = [
        'core',
        'engine',
        'webgl',
        'model',
        'catalog',
        'moc',
        'physics',
        'pose',
        'texture',
        'shader',
        'motion',
        'expression',
      ];
      lastDiagnosticError = {
        code: codes.includes(error?.code) ? error.code : 'invalid',
        category: categories.includes(error?.category)
          ? error.category
          : categories.includes(category)
            ? category
            : 'resource',
        phase: loadStage,
        characterId: currentLoad?.characterId || active,
      };
      if (diagnosticsEnabled) {
        diagnosticReport.error = { ...lastDiagnosticError };
        if (currentLoad) {
          currentLoad.status = 'failed';
          currentLoad.error = { ...lastDiagnosticError };
        }
      }
    };
    const finishDiagnosticSample = (interrupted = false, reason = null) => {
      if (!sampleWindow) return;
      const sample = sampleWindow;
      sampleWindow = null;
      clearTimeout(sample.timer);
      const end = sample.target.state(),
        elapsedMs = performance.now() - sample.started,
        frameDelta = Math.max(0, end.frames - sample.frames);
      diagnosticReport.windowId = ++windowSequence;
      diagnosticReport.sample = {
        characterId: sample.characterId,
        environment: sample.environment,
        durationMs: elapsedMs,
        frameDelta,
        fps: elapsedMs > 0 ? (frameDelta * 1000) / elapsedMs : 0,
        interrupted,
        reason,
        cpuDrawMsAvg: frameDelta
          ? Math.max(0, end.renderMsAvg * end.frames - sample.drawTotal) / frameDelta
          : 0,
        engineLifetimeCpuDrawMsMax: end.renderMsMax,
      };
      diagnosticReport.engineStats = { ...end };
      diagnosticReport.engineStatsCharacterId = sample.characterId;
      const frozen = sample.report;
      if (frozen.loadSessionId === diagnosticReport.loadSessionId) {
        const latest = diagnosticSnapshot(diagnosticReport);
        for (const key of ['load', 'loadAttempts', 'phase', 'error']) frozen[key] = latest[key];
      }
      frozen.windowId = diagnosticReport.windowId;
      frozen.characterId = sample.characterId;
      frozen.environment = sample.environment;
      frozen.sample = diagnosticSnapshot(diagnosticReport.sample);
      frozen.engineStats = { ...end };
      frozen.engineStatsCharacterId = sample.characterId;
      diagnosticWindows.push(frozen);
      if (diagnosticWindows.length > 20) { diagnosticWindows.shift(); replacedWindows++; }
      if (sampleSeries) {
        if (interrupted) {
          seriesMessage = t("Continuous sampling stopped. No further windows will start automatically.");
          sampleSeries = null;
        } else {
          sampleSeries.completed++;
          if (sampleSeries.completed < 3) { startDiagnosticSample(); return; }
          seriesMessage = t("Continuous sampling complete: 3 of 3 windows saved.");
          sampleSeries = null;
        }
      }
      diagnosticUpdate();
    };
    const interruptDiagnostics = (reason) => {
      finishDiagnosticSample(true, reason);
      if (firstFrameWatch) {
        clearTimeout(firstFrameWatch.timer);
        firstFrameWatch.load.firstFrameStatus = 'interrupted';
        firstFrameWatch = null;
      }
    };
    const diagnosticReady = () => {
      if (!diagnosticsEnabled || !currentLoad || !engine) return;
      currentLoad.readyMs = performance.now() - currentLoad.started;
      currentLoad.status = 'ready';
      currentLoad.renderedCharacterId = active;
      diagnosticReport.renderedCharacterId = active;
      diagnosticReport.environment = diagnosticEnvironment();
      const target = engine,
        loadRecord = currentLoad,
        started = loadRecord.started;
      firstFrameWatch = { target, load: loadRecord, timer: null };
      const observe = () => {
        if (!firstFrameWatch || firstFrameWatch.target !== target) return;
        if (target !== engine || !allowed()) {
          interruptDiagnostics('state-change');
          return;
        }
        if (target.state().frames > 0) {
          loadRecord.firstFrameMs = performance.now() - started;
          loadRecord.firstFrameStatus = 'observed';
          firstFrameWatch = null;
        } else if (performance.now() - started > 75000) {
          loadRecord.firstFrameStatus = 'not-observed';
          firstFrameWatch = null;
        } else firstFrameWatch.timer = setTimeout(observe, 30);
      };
      firstFrameWatch.timer = setTimeout(observe, 0);
    };
    diagnosticEnable.onclick = () => {
      if (diagnosticsEnabled) {
        interruptDiagnostics('user-stopped');
        diagnosticsEnabled = false;
        currentLoad = null;
        diagnosticGeneration++;
      } else {
        diagnosticGeneration++;
        diagnosticWindows = []; replacedWindows = 0; windowSequence = 0; sampleSeries = null; seriesMessage = '';
        diagnosticsEnabled = true;
        diagnosticReport = {
          schema: 1,
          batchId: diagnosticId(),
          loadSessionId: diagnosticId(),
          windowId: null,
          pluginVersion: config.version || 'unknown',
          characterId: active,
          requestedCharacterId: null,
          renderedCharacterId: engine ? active : null,
          loadAttempts: [],
          environment: diagnosticEnvironment(),
          phase: loadStage,
          error: lastDiagnosticError,
          load: null,
          sample: null,
          engineStats: engine ? { ...engine.state() } : null,
          engineStatsCharacterId: engine ? active : null,
          measurements:
            'FPS uses frames drawn during the explicit sample window. CPU draw times are not GPU execution times. Loading readiness is distinct from first observed frame. GPU renderer is queried only after opt-in.',
        };
      }
      diagnosticUpdate();
    };
    const startDiagnosticSample = () => {
      if (!diagnosticsEnabled || !engine || !allowed() || loading || sampleWindow) return;
      const snapshot = engine.state();
      diagnosticReport.characterId = active;
      diagnosticReport.environment = diagnosticEnvironment();
      sampleWindow = {
        target: engine,
        characterId: active,
        environment: diagnosticReport.environment,
        report: diagnosticSnapshot(diagnosticReport),
        started: performance.now(),
        frames: snapshot.frames,
        drawTotal: snapshot.renderMsAvg * snapshot.frames,
        timer: null,
      };
      const sample = sampleWindow, epoch = diagnosticGeneration;
      sampleWindow.timer = setTimeout(() => {
        if (sampleWindow !== sample || epoch !== diagnosticGeneration) return;
        finishDiagnosticSample(!allowed() || loading || sample.target !== engine, 'window-ended');
      }, 3000);
      diagnosticUpdate();
    };
    diagnosticSample.onclick = () => {
      if (sampleSeries) return;
      seriesMessage = '';
      startDiagnosticSample();
    };
    diagnosticSeries.onclick = () => {
      if (!diagnosticsEnabled || !engine || !allowed() || loading || sampleWindow || sampleSeries) return;
      seriesMessage = '';
      sampleSeries = { completed: 0 };
      startDiagnosticSample();
    };
    diagnosticStopSample.onclick = () => {
      interruptDiagnostics('user-stopped-sampling');
      diagnosticUpdate();
    };
    const downloadDiagnostic = (data, filename) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      if (blob.size > 2 * 1024 * 1024) {
        seriesMessage = t("The diagnostic download exceeds 2 MiB. Stop recording and start a new batch after saving available reports.");
        diagnosticUpdate();
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = make('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    diagnosticExport.onclick = () => {
      if (diagnosticReport) downloadDiagnostic(diagnosticWindows.at(-1) || diagnosticSnapshot(diagnosticReport), 'mascot-diagnostics-' + (config.version || 'unknown') + '.json');
    };
    diagnosticExportBatch.onclick = () => {
      if (!diagnosticWindows.length) return;
      downloadDiagnostic({ kind: 'wzf-mascot-diagnostic-batch', schema: 1,
        batchId: diagnosticReport.batchId, maxWindows: 20, replacedWindows,
        windows: diagnosticWindows }, 'mascot-diagnostic-batch-' + diagnosticReport.batchId + '.json');
    };
    let button = document.querySelector('.wzfl-mascot-toggle');
    if (!button) {
      button = make('button', '', 'wzfl-mascot-toggle');
      document.body.append(button);
    }
    const controlsDock = make('div', '', 'wzf-haru-dock');
    controlsDock.append(diagnostics, button);
    document.body.append(controlsDock);
    const panel = make('section', '', 'wzf-haru-controls');
    panel.id = 'wzf-haru-panel';
    panel.setAttribute('aria-label', t("Mascot interaction"));
    panel.hidden = true;
    const label = make('strong'),
      characterSearch = make('input'),
      clearSearch = make('button', t("Clear")),
      searchResults = make('span', '', 'wzf-haru-search-results'),
      favoritesFilter = make('input'),
      favoritesLabel = make('label', '', 'wzf-haru-favorites-filter'),
      favoriteButton = make('button', t("Favorite selected character"), 'wzf-haru-favorite-toggle'),
      favoritesState = make('span', '', 'wzf-haru-favorites-state'),
      characterSelect = make('select');
    characterSelect.className='wzf-haru-character-select';
    const randomFavorite=make('button',t("Random favorite candidate")),recentSettings=make('details','','wzf-haru-layout'),recentSelect=make('select'),recentState=make('span','','wzf-haru-search-results');
    randomFavorite.className='wzf-haru-random';
    recentSelect.setAttribute('aria-label',t("Recent confirmed characters"));
    recentState.setAttribute('role','status');
    recentSettings.append(make('summary',t("Recent characters")),recentSelect,recentState);
    let randomBag=[],randomPoolKey='',randomLast=null;
    const randomPool=()=>[...characterSelect.options].map(option=>option.value).filter(id=>favorites.has(id));
    const syncRecentOptions=()=>{
      const available=new Set([...characterSelect.options].map(option=>option.value));
      recentSelect.replaceChildren();const empty=make('option',t("Choose a recent character candidate"));empty.value='';recentSelect.append(empty);
      for(const id of recent){if(!available.has(id))continue;const option=make('option',characters[id].name);option.value=id;recentSelect.append(option);}
      recentSelect.disabled=loading||recentSelect.options.length<2;
      recentState.textContent=recentNotice;recentState.hidden=!recentNotice;
      randomFavorite.disabled=loading||!randomPool().length;
    };
    const rememberRecent=(id)=>{
      if(!historyId(id))return;
      recent=[id,...recent.filter(value=>value!==id)].slice(0,8);
      try{localStorage.setItem(recentKey,JSON.stringify(recent));recentNotice='';}catch{recentNotice=t("Recent choices apply only to this page; the browser did not allow saving.");}
      syncRecentOptions();
    };
    favoritesFilter.type = 'checkbox';
    favoritesLabel.append(favoritesFilter, document.createTextNode(t("Favorites only")));
    favoritesState.setAttribute('role', 'status');
    favoritesState.setAttribute('aria-live', 'polite');
    characterSearch.type = 'search';
    characterSearch.placeholder = t("Name or character ID");
    characterSearch.setAttribute('aria-label', t("Search characters"));
    searchResults.id = 'wzf-haru-search-results';
    searchResults.setAttribute('role', 'status');
    searchResults.setAttribute('aria-live', 'polite');
    characterSearch.setAttribute('aria-describedby', searchResults.id);
    clearSearch.setAttribute('aria-label', t("Clear character search"));
    characterSelect.setAttribute('aria-label', t("Choose character"));
    const candidatePreview = make('figure', '', 'wzf-haru-candidate'),
      candidateImage = make('img'),
      candidateInitials = make('span', '', 'wzf-haru-candidate-initials'),
      candidateCaption = make('figcaption');
    candidateImage.loading = 'eager';
    candidateImage.decoding = 'async';
    candidateImage.hidden = true;
    candidateInitials.setAttribute('aria-hidden', 'true');
    candidatePreview.append(candidateImage, candidateInitials, candidateCaption);
    let candidateKey = null;
    const thumbnailSource = (character) => {
      if (typeof character?.thumbnail !== 'string') return null;
      try {
        const url = new URL(character.thumbnail);
        if (
          !['https:', 'http:'].includes(url.protocol) ||
          url.origin !== location.origin ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !/\/wzf-mascot\/thumbnail-[0-9a-f]{32}\/image\.png$/.test(url.pathname)
        )
          return null;
        return url.href;
      } catch {
        return null;
      }
    };
    const syncThumbnail = () => {
      const id = characterSelect.value,
        character = Object.hasOwn(characters, id) ? characters[id] : null;
      candidateCaption.textContent = character ? t("Candidate: %1$s", character.name) : t("No candidate character");
      candidateInitials.textContent = character
        ? Array.from(character.name.trim()).slice(0, 2).join('')
        : '?';
      candidateImage.alt = character ? t("Thumbnail of %1$s", character.name) : '';
      const src = thumbnailSource(character),
        key = id + ':' + (src || '');
      if (!panelOpen || panel.hidden || !src) {
        candidateImage.onload = candidateImage.onerror = null;
        candidateImage.removeAttribute('src');
        candidateImage.hidden = true;
        candidateInitials.hidden = false;
        candidateKey = null;
        return;
      }
      if (candidateKey === key) return;
      candidateKey = key;
      candidateImage.hidden = true;
      candidateInitials.hidden = false;
      candidateImage.onload = () => {
        if (candidateKey === key) {
          candidateImage.hidden = false;
          candidateInitials.hidden = true;
        }
      };
      candidateImage.onerror = () => {
        if (candidateKey !== key) return;
        candidateImage.hidden = true;
        candidateInitials.hidden = false;
        candidateImage.removeAttribute('src');
      };
      // Only the selected candidate's local image is requested when the panel is open.
      candidateImage.src = src;
    };
    const syncFavoriteButton = () => {
      const id = characterSelect.value,
        selected = Object.hasOwn(characters, id),
        saved = selected && favorites.has(id);
      favoriteButton.textContent = saved ? t("Unfavorite selected character") : t("Favorite selected character");
      favoriteButton.setAttribute('aria-pressed', String(saved));
      favoriteButton.setAttribute(
        'aria-label',
        t(saved ? 'Unfavorite %1$s' : 'Favorite %1$s', selected ? characters[id].name : t('No selectable character')),
      );
      favoriteButton.disabled = loading || !selected;
    };
    const searchKey = (value) => value.normalize('NFKC').trim().toLowerCase();
    const syncCharacterOptions = (preferred = characterSelect.value) => {
      const previous = characterSelect.value,
        query = searchKey(characterSearch.value),
        matches = Object.entries(characters).filter(
          ([id, character]) =>
            (!favoritesFilter.checked || favorites.has(id)) &&
            (searchKey(character.name).includes(query) || searchKey(id).includes(query)),
        );
      characterSelect.replaceChildren();
      for (const [id, character] of matches) {
        const option = make('option', character.name);
        option.value = id;
        characterSelect.append(option);
      }
      characterSelect.value = matches.some(([id]) => id === preferred)
        ? preferred
        : matches.some(([id]) => id === previous)
          ? previous
          : matches[0]?.[0] || '';
      searchResults.textContent = matches.length
        ? t("Showing %1$s of %2$s characters", matches.length, Object.keys(characters).length)
        : favoritesFilter.checked && !Object.keys(characters).some((id) => favorites.has(id))
          ? t("No favorites yet. Turn off “Favorites only” to see all characters.")
          : favoritesFilter.checked
            ? t("No matching favorites. Change the search or clear it.")
            : t("No matching characters. Change the search or clear it.");
      syncFavoriteButton();
      syncThumbnail();
      syncRecentOptions();
    };
    syncCharacterOptions(active);
    const previewButton = make('button', t("Preview character")),
      commitButton = make('button', t("Use this character")),
      cancelPreview = make('button', t("Cancel preview"));
    const motion = make('select'),
      expression = make('select');
    motion.setAttribute('aria-label', t("Choose motion"));
    expression.setAttribute('aria-label', t("Choose expression"));
    const play = make('button', t("Play motion")),
      stopMotion = make('button', t("Stop motion and return to idle"), 'wzf-haru-reset'),
      face = make('button', t("Change expression")),
      resetFace = make('button', t("Reset expression"), 'wzf-haru-reset'),
      state = make('span', '', 'wzf-haru-state');
    state.setAttribute('role', 'status');
    const livePresets = new Map();
    let nextHit = 0, gazeEnabled = false;
    try { gazeEnabled = localStorage.getItem('wzf-mascot-gaze-v1') === 'enabled'; } catch {}
    const capabilities = () => engine?.capabilities?.() || {gazeParameters:[],hitAreas:[]};
    const helpButton = make('details', '', 'wzf-haru-layout');
    helpButton.append(make('summary',t("Interaction help")),make('p',t("Use Interact to preview characters and play quick interactions. The move handle supports dragging and arrow keys.")));
    const presetControls = make('div', '', 'wzf-haru-presets');
    presetControls.setAttribute('aria-label', t("Quick interactions"));
    const dialogueChoice = make('select');
    dialogueChoice.setAttribute('aria-label', t("Dialogue mode"));
    for (const [value, caption] of [['auto', t("Automatic dialogue")], ['active', t("Only on interaction")], ['silent', t("Silent")]]) {
      const option = make('option', caption); option.value = value; dialogueChoice.append(option);
    }
    dialogueChoice.value = dialogueMode;
    dialogueChoice.onchange = () => {
      dialogueMode = dialogueChoice.value;
      clearDialogue();
      dialogueWelcomeConsumed = true;
      try { localStorage.setItem('wzf-mascot-dialogue-v1', dialogueMode); } catch {}
      paint();
    };
    const credit = make('a');
    credit.href = config.terms;
    credit.target = '_blank';
    credit.rel = 'noopener';
    const searchRow = make('div', '', 'wzf-haru-search-row');
    searchRow.append(characterSearch, clearSearch);
    const dialogueSettings = make('details', '', 'wzf-haru-layout');
    dialogueSettings.append(make('summary', t("Dialogue preferences")), dialogueChoice);
    const pointerSettings = make('details', '', 'wzf-haru-layout');
    const gazeChoice = make('input'), gazeLabel = make('label', '', 'wzf-haru-favorites-filter'), pointerStatus = make('p');
    gazeChoice.type='checkbox'; gazeChoice.checked=gazeEnabled;
    gazeLabel.append(gazeChoice,document.createTextNode(t("Follow pointer gently")));
    pointerSettings.append(make('summary',t("Pointer interactions")),gazeLabel,pointerStatus);
    gazeChoice.onchange=()=>{gazeEnabled=gazeChoice.checked;engine?.resetGaze?.();try{localStorage.setItem('wzf-mascot-gaze-v1',gazeEnabled?'enabled':'disabled');}catch{}};
    panel.append(
      label,
      searchRow,
      searchResults,
      characterSelect,
      randomFavorite,
      recentSettings,
      candidatePreview,
      previewButton,
      favoritesLabel,
      favoriteButton,
      favoritesState,
      commitButton,
      cancelPreview,
      presetControls,
      helpButton,
      motion,
      play,
      stopMotion,
      expression,
      face,
      resetFace,
      dialogueSettings,
      pointerSettings,
      credit,
      state,
    );
    document.body.append(panel);
    const panelToggle = make('button', t("Interact"), 'wzf-haru-panel-toggle');
    panelToggle.hidden = true;
    panelToggle.setAttribute('aria-controls', panel.id);
    panelToggle.setAttribute('aria-expanded', 'false');
    controlsDock.insertBefore(panelToggle, button);
    if (config.mobileEnabled === true) {
      controlsDock.classList.add('wzf-haru-mobile-enabled');
      panel.classList.add('wzf-haru-mobile-enabled');
    }
    const settings = make('details', '', 'wzf-haru-layout'),
      summary = make('summary', t("Position and size"));
    settings.append(summary);
    const side = make('select');
    side.setAttribute('aria-label', t("Character position"));
    for (const [value, text] of [
      ['right', t("Bottom right")],
      ['left', t("Bottom left")],
    ]) {
      const o = make('option', text);
      o.value = value;
      side.append(o);
    }
    const slider = make('input');
    slider.type = 'range';
    slider.min = '140';
    slider.max = '260';
    slider.step = '10';
    slider.setAttribute('aria-label', t("Character size"));
    const output = make('output'),
      reset = make('button', t("Reset defaults"));
    settings.append(side, slider, output, reset);
    panel.insertBefore(settings, credit);
    const mobileSize = make('p', '', 'wzf-haru-mobile-size');
    panel.insertBefore(mobileSize, credit);
    const captureSettings=make('details','','wzf-haru-layout');
    const captureButton=make('button',t("Download transparent PNG")),captureStatus=make('p');
    captureStatus.setAttribute('role','status');
    captureSettings.append(make('summary',t("Character PNG")),make('p',t("Save only the current character canvas on a transparent background.")),captureButton,captureStatus);
    panel.insertBefore(captureSettings,credit);
    let pendingCapture=null,captureSequence=0,pngURL=null,pngURLTimer=null;
    const clearPngURL=()=>{clearTimeout(pngURLTimer);pngURLTimer=null;if(pngURL){URL.revokeObjectURL(pngURL);pngURL=null;}};
    const cancelPNG=()=>{
      const request=pendingCapture;pendingCapture=null;captureSequence++;
      request?.target.cancelCapture?.();clearPngURL();if(request)captureStatus.textContent=t("PNG capture cancelled.");
    };
    captureButton.onclick=async()=>{
      if(pendingCapture||!engine||!allowed()||loading||characters[active].captureAllowed!==true||typeof engine.captureFrame!=='function')return;
      clearPngURL();
      const request={target:engine,g:generation,id:active,token:++captureSequence};pendingCapture=request;
      captureStatus.textContent=t("Preparing PNG…");paint();
      const current=()=>pendingCapture===request&&captureSequence===request.token&&engine===request.target&&generation===request.g&&active===request.id&&allowed()&&!loading;
      try{
        const blob=await request.target.captureFrame();if(!current())return;
        if(!(blob instanceof Blob)||blob.type!=='image/png'||blob.size>16*1024*1024)throw Error('invalid-png');
        pngURL=URL.createObjectURL(blob);
        const link=make('a');link.href=pngURL;link.download='mascot-'+request.id.replace(/[^A-Za-z0-9_-]/g,'').slice(0,80)+'.png';document.body.append(link);link.click();link.remove();
        pngURLTimer=setTimeout(clearPngURL,1000);
        captureStatus.textContent=t("PNG download started.");
      }catch(error){if(current())captureStatus.textContent=error.name==='AbortError'?t("PNG capture cancelled."):t("PNG capture failed. Try again.");}
      finally{if(pendingCapture===request){pendingCapture=null;paint();}}
    };
    const accountSettings=make('details','','wzf-haru-layout');
    accountSettings.append(make('summary',t("Account preferences")),make('p',t("Optional: synchronize only character, favorites and layout. Visibility, terms and mobile consent stay in this browser. Nothing is read or saved until you choose an action.")));
    const accountRead=make('button',t("Read account preferences")),accountSave=make('button',t("Save browser preferences to account")),accountUse=make('button',t("Use account preferences")),accountKeep=make('button',t("Keep browser preferences")),accountStatus=make('p');
    accountStatus.setAttribute('role','status');
    const accountActions=make('div','','wzf-haru-account-actions');
    accountActions.append(accountRead,accountSave,accountUse,accountKeep);
    accountSettings.append(accountActions,accountStatus);
    panel.insertBefore(accountSettings,credit);
    let accountState=null,accountNonce='',accountPending=false;
    const preferenceId=(id)=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
    const exactFields=(value,allowed,required=allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key));
    const validPreferences=(value)=>{
      if(!exactFields(value,['character','favorites','layouts'])||!preferenceId(value.character)||!Array.isArray(value.favorites)||value.favorites.length>100||!value.favorites.every(preferenceId)||new Set(value.favorites).size!==value.favorites.length||!Array.isArray(value.layouts)||value.layouts.length>100)return false;
      const seen=new Set();
      for(const row of value.layouts){
        if(!exactFields(row,['id','position','size','anchor'],['id','position','size'])||!preferenceId(row.id)||seen.has(row.id)||!['left','right'].includes(row.position)||!Number.isInteger(row.size)||row.size<140||row.size>260||row.size%10)return false;
        seen.add(row.id);
        if(Object.hasOwn(row,'anchor')&&(!exactFields(row.anchor,['x','y'])||!['x','y'].every(axis=>Number.isFinite(row.anchor[axis])&&row.anchor[axis]>=0&&row.anchor[axis]<=1)))return false;
      }
      return true;
    };
    const browserPreferences=()=>{
      let character=committed;
      try{const saved=localStorage.getItem('wzf-mascot-character');if(preferenceId(saved))character=saved;}catch{}
      const rows=[];
      for(const [id,row] of Object.entries(layouts)){
        if(!preferenceId(id)||!row||!['left','right'].includes(row.position)||!Number.isInteger(row.size)||row.size<140||row.size>260||row.size%10)continue;
        const next={id,position:row.position,size:row.size};
        if(row.anchor&&['x','y'].every(axis=>Number.isFinite(row.anchor[axis])&&row.anchor[axis]>=0&&row.anchor[axis]<=1))next.anchor={x:row.anchor.x,y:row.anchor.y};
        rows.push(next);if(rows.length===100)break;
      }
      return {character,favorites:[...favorites].filter(preferenceId).slice(0,100),layouts:rows};
    };
    const accountUpdate=()=>{
      accountRead.disabled=accountPending;
      accountSave.disabled=accountPending||!accountState||loading||preview;
      accountUse.disabled=accountPending||!accountState?.preferences||!engine||loading||preview||!allowed();
      accountKeep.disabled=accountPending||!accountState;
    };
    const accountRequest=async(operation,extra={})=>{
      const url=new URL(config.accountEndpoint,location.href);
      if(!config.accountEndpoint||url.origin!==location.origin)throw Error('unavailable');
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
      try{
        const response=await fetch(url,{method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({action:'wzf_mascot_preferences',operation,...extra})});
        const raw=await response.text();if(raw.length>65536)throw Error('invalid-response');
        const result=JSON.parse(raw);const data=result?.data;
        if(!data||typeof data!=='object')throw Error('invalid-response');
        if(data.state){if(!exactFields(data.state,['revision','preferences'])||!Number.isInteger(data.state.revision)||data.state.revision<0||data.state.revision>2147483646||(data.state.preferences!==null&&!validPreferences(data.state.preferences)))throw Error('invalid-response');}
        return result;
      }catch(error){if(error.name==='AbortError')throw Error('request-timeout');throw error;}
      finally{clearTimeout(timer);}
    };
    const accountError=(code)=>code==='request-timeout'?t("The request timed out. A save may have completed. Read account preferences again before saving."):code==='sign-in-required'?t("Sign in to read or save account preferences."):code==='account-busy'?t("Account preferences are busy. Try again."):t("Account preferences could not be read or saved. Your browser preferences are retained.");
    accountRead.onclick=async()=>{
      if(accountPending)return;accountState=null;accountNonce='';accountPending=true;accountUpdate();accountStatus.textContent=t("Reading account preferences…");
      try{
        const result=await accountRequest('bootstrap');
        if(!result.success||!result.data.state||typeof result.data.nonce!=='string'||result.data.nonce.length>128)throw Error(result.data.code||'invalid-response');
        accountState=result.data.state;accountNonce=result.data.nonce;
        accountStatus.textContent=!accountState.preferences?t("No account preferences saved. Saving is optional."):JSON.stringify(accountState.preferences)===JSON.stringify(browserPreferences())?t("Account and browser preferences match."):t("Account and browser differ. Choose which preferences to use; saving to the account is a separate action.");
      }catch(error){accountStatus.textContent=accountError(error.message);}
      finally{accountPending=false;accountUpdate();}
    };
    accountSave.onclick=async()=>{
      if(accountPending||!accountState)return;const preferences=browserPreferences();accountPending=true;accountUpdate();accountStatus.textContent=t("Saving account preferences…");
      try{
        const result=await accountRequest('save',{nonce:accountNonce,revision:String(accountState.revision),preferences:JSON.stringify(preferences)});
        if(!result.success){if(result.data.code==='conflict'&&result.data.state){accountState=result.data.state;accountStatus.textContent=t("The account changed elsewhere. Nothing was overwritten. Use the account version or keep this browser; press Save again only to replace the newly read account version.");}else throw Error(result.data.code||'invalid-response');}
        else{if(!result.data.state)throw Error('invalid-response');accountState=result.data.state;accountStatus.textContent=t("Account preferences saved. Any later browser changes remain local.");}
      }catch(error){accountState=null;accountNonce='';accountStatus.textContent=accountError(error.message);}
      finally{accountPending=false;accountUpdate();}
    };
    accountKeep.onclick=()=>{accountStatus.textContent=t("Keeping browser preferences. The account was not changed.");};
    accountUse.onclick=async()=>{
      if(accountPending||!accountState?.preferences||loading||preview||!allowed()||!engine)return;
      const value=accountState.preferences,nextLayouts=Object.create(null),available=Object.hasOwn(characters,value.character);
      for(const row of value.layouts){nextLayouts[row.id]={position:row.position,size:row.size,...(row.anchor?{anchor:{...row.anchor}}:{})};}
      const changes=[['wzf-mascot-character',value.character],[favoritesKey,JSON.stringify(value.favorites)],['wzf-mascot-layouts',JSON.stringify(nextLayouts)]];
      const previous=[];
      const rollbackPreview=async()=>{
        if(active===committed&&!preview)return;
        if(allowed()&&engine&&!loading)await switchTo(committed,false);
        else{destroy();active=committed;preview=false;readLayout();paint();}
      };
      accountPending=true;accountUpdate();
      try{
        // Stage an available role first. Do not persist selection or preferences
        // until loading succeeds and the original explicit apply is still valid.
        if(available&&value.character!==active)await switchTo(value.character,true);
        if(available&&(active!==value.character||!engine||failed||loading||!allowed())){
          await rollbackPreview();accountStatus.textContent=t("The account character could not load. Browser preferences were not changed.");return;
        }
        try{for(const [key]of changes)previous.push([key,localStorage.getItem(key)]);for(const [key,text]of changes)localStorage.setItem(key,text);}
        catch{for(const [key,text]of previous){try{text===null?localStorage.removeItem(key):localStorage.setItem(key,text);}catch{}}let restored=false;try{restored=previous.length===changes.length&&previous.every(([key,text])=>localStorage.getItem(key)===text);}catch{}await rollbackPreview();accountStatus.textContent=restored?t("The browser did not allow saving account preferences locally. Current preferences are retained."):t("This page keeps its previous preferences, but browser storage may be incomplete. Check browser storage permission before trying again.");return;}
        layouts=nextLayouts;favorites=new Set(value.favorites);pendingFavorites.clear();favoritesNotice='';
        if(available){committed=active;preview=false;rememberRecent(active);}
        syncCharacterOptions(active);readLayout();paint();
        accountStatus.textContent=(available?t("Account preferences applied to this browser."):t("Account preferences saved in this browser. The selected character is unavailable now; the current display is retained."))+(recentNotice?' '+recentNotice:'');
      }finally{accountPending=false;accountUpdate();}
    };
    accountUpdate();
    const readLayout = () => {
      const saved = layouts[active] || {};
      position = ['left', 'right'].includes(saved.position) ? saved.position : 'right';
      size = Number.isFinite(saved.size)
        ? Math.max(140, Math.min(260, Math.round(saved.size / 10) * 10))
        : characters[active].size;
      anchor = saved.anchor && Number.isFinite(saved.anchor.x) && Number.isFinite(saved.anchor.y) && saved.anchor.x >= 0 && saved.anchor.x <= 1 && saved.anchor.y >= 0 && saved.anchor.y <= 1 ? {x:saved.anchor.x,y:saved.anchor.y} : null;
      side.value = position;
      slider.value = String(size);
    };
    const safeProbe = make('div', '', 'wzf-haru-safe-area');
    document.body.append(safeProbe);
    const movementBounds = () => {
      const css = getComputedStyle(safeProbe), view = window.visualViewport;
      const left = (view?.offsetLeft || 0) + Math.max(6, parseFloat(css.paddingLeft) || 0);
      const top = (view?.offsetTop || 0) + Math.max(6, parseFloat(css.paddingTop) || 0);
      const right = (view?.offsetLeft || 0) + (view?.width || innerWidth) - Math.max(6, parseFloat(css.paddingRight) || 0);
      const bottom = (view?.offsetTop || 0) + (view?.height || innerHeight) - Math.max(6, parseFloat(css.paddingBottom) || 0);
      return {left,top,maxX:Math.max(left,right-(host?.offsetWidth || size)),maxY:Math.max(top,bottom-(host?.offsetHeight || size*1.5)),right,bottom};
    };
    const clamp = (n, low, high) => Math.max(low, Math.min(high,n));
    const placeDialogue = () => {
      if (!bubble || bubble.hidden || !host) return;
      const bounds=movementBounds(), box=host.getBoundingClientRect();
      bubble.style.maxHeight=Math.max(44,bounds.bottom-bounds.top-12)+'px';
      const text=bubble.getBoundingClientRect();
      const x=clamp(position==='right'?box.right-text.width:box.left,bounds.left,Math.max(bounds.left,bounds.right-text.width));
      const y=clamp(box.top-text.height+30,bounds.top,Math.max(bounds.top,bounds.bottom-text.height));
      bubble.style.right='auto';bubble.style.bottom='auto';
      bubble.style.left=(x-box.left)+'px';bubble.style.top=(y-box.top)+'px';
    };
    const layout = () => {
      const renderedSize = desktop.matches
        ? size
        : Math.max(96, Math.min(140, Math.floor(innerWidth * 0.34)));
      const leftControls = position === 'right';
      const edge = 'max(16px, env(safe-area-inset-' + (leftControls ? 'left' : 'right') + '))';
      for (const element of [panel, controlsDock]) {
        element.style.left = leftControls ? edge : 'auto';
        element.style.right = leftControls ? 'auto' : edge;
      }
      controlsDock.style.alignItems = leftControls ? 'flex-start' : 'flex-end';
      diagnosticBody.style.left = leftControls ? '0' : 'auto';
      diagnosticBody.style.right = leftControls ? 'auto' : '0';
      if (host) {
        host.classList.toggle('wzf-haru-mobile-enabled', config.mobileEnabled === true);
        host.style.width = renderedSize + 'px';
        host.style.height = renderedSize * 1.5 + 'px';
        host.style.transform = 'translateY(' + characters[active].offset + '%)';
        host.style.right = position === 'right' ? 'max(6px, env(safe-area-inset-right))' : 'auto';
        host.style.left = position === 'left' ? 'max(6px, env(safe-area-inset-left))' : 'auto';
        if (anchor) {
          const bounds = movementBounds();
          host.style.transform = 'none'; host.style.right = 'auto'; host.style.bottom = 'auto';
          host.style.left = (bounds.left + anchor.x*(bounds.maxX-bounds.left))+'px';
          host.style.top = (bounds.top + anchor.y*(bounds.maxY-bounds.top))+'px';
        } else { host.style.top = 'auto'; host.style.bottom = '0'; }
        if (dragHandle) {
          const box=host.getBoundingClientRect(), bounds=movementBounds();
          dragHandle.style.left=clamp(box.x+box.width/2-22,bounds.left,bounds.right-44)+'px';
          dragHandle.style.top=clamp(box.bottom-44,bounds.top,bounds.bottom-44)+'px';
        }
        placeDialogue();
      }
      settings.hidden = !desktop.matches;
      mobileSize.hidden = desktop.matches;
      mobileSize.textContent = t("Compact mobile size: %1$s pixels (desktop settings retained)", renderedSize);
      output.textContent = t("%1$s pixels", size);
    };
    const layoutDock = () => {
      const bottom = 24 + controlsDock.offsetHeight;
      panel.style.bottom = 'calc(' + bottom + 'px + env(safe-area-inset-bottom))';
      panel.style.maxHeight =
        'calc(100dvh - ' +
        (bottom + 16) +
        'px - env(safe-area-inset-bottom) - env(safe-area-inset-top))';
    };
    const rememberLayout = () => {
      layouts[active] = { position, size, ...(anchor ? {anchor:{...anchor}} : {}) };
      try {
        localStorage.setItem('wzf-mascot-layouts', JSON.stringify(layouts));
      } catch {}
      layout();
    };
    side.onchange = () => {
      position = side.value;
      if (anchor) anchor.x = position === 'left' ? 0 : 1;
      rememberLayout();
    };
    slider.oninput = () => {
      size = Number(slider.value);
      rememberLayout();
    };
    reset.onclick = () => {
      position = 'right';
      anchor = null;
      size = characters[active].size;
      side.value = position;
      slider.value = String(size);
      rememberLayout();
    };
    dragHandle = make('button', '↔', 'wzf-haru-drag-handle');
    dragHandle.hidden = true;
    dragHandle.setAttribute('aria-label', t("Move mascot: drag, use arrow keys, or Escape to reset"));
    dragHandle.title = t("Move mascot");
    document.body.append(dragHandle);
    const endDrag = (commit = false) => {
      if (!dragState) return;
      const previous = dragState;
      const pointer = previous.pointer;
      dragState = null;
      if (dragHandle.hasPointerCapture?.(pointer)) dragHandle.releasePointerCapture(pointer);
      if (commit && anchor) {
        position = anchor.x < 0.5 ? 'left' : 'right';
        anchor.x = position === 'left' ? 0 : 1;
        side.value = position; rememberLayout();
      } else { anchor=previous.anchor; position=previous.position; layout(); }
    };
    const moveAnchor = (x,y) => {
      const bounds=movementBounds();
      anchor={x:(clamp(x,bounds.left,bounds.maxX)-bounds.left)/Math.max(1,bounds.maxX-bounds.left), y:(clamp(y,bounds.top,bounds.maxY)-bounds.top)/Math.max(1,bounds.maxY-bounds.top)};
      layout();
    };
    dragHandle.onpointerdown = (event) => {
      if (event.button !== 0 || !allowed() || !engine || loading) return;
      const box=host.getBoundingClientRect();
      dragState={pointer:event.pointerId,dx:event.clientX-box.x,dy:event.clientY-box.y,anchor:anchor?{...anchor}:null,position};
      clearDialogue(); cancelWelcome(); cancelPreset(); engine?.resetGaze?.();
      dragHandle.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    dragHandle.onpointermove = (event) => {
      if (!dragState || dragState.pointer !== event.pointerId) return;
      moveAnchor(event.clientX-dragState.dx,event.clientY-dragState.dy);
    };
    dragHandle.onpointerup = (event) => { if (dragState?.pointer === event.pointerId) endDrag(true); };
    dragHandle.onpointercancel = () => endDrag(false);
    dragHandle.onlostpointercapture = () => endDrag(false);
    dragHandle.onkeydown = (event) => {
      if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || !allowed() || !engine || loading) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); endDrag(); reset.click(); return; }
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      clearDialogue(); cancelWelcome(); cancelPreset(); engine?.resetGaze?.();
      const box=host.getBoundingClientRect(), bounds=movementBounds();
      const step=event.shiftKey ? 40 : 16;
      moveAnchor(event.key==='ArrowLeft'?bounds.left:event.key==='ArrowRight'?bounds.maxX:box.x,box.y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0));
      position=anchor.x<0.5?'left':'right'; side.value=position; rememberLayout();
    };
    readLayout();
    const consent = make('dialog', '', 'wzf-haru-consent'),
      title = make('h2', t("Show mascot"));
    title.id = 'wzf-mascot-terms-title';
    consent.setAttribute('aria-labelledby', title.id);
    const text = make(
      'p',
      typeof config.consentText === 'string' && config.consentText
        ? config.consentText
        : t("Characters and runtime libraries are imported by this site’s administrator. See source information for credits and terms; this plugin grants no redistribution or other rights to resources."),
    );
    const link = make('a', t("View character sources, terms and notices"));
    link.href = config.terms;
    link.target = '_blank';
    link.rel = 'noopener';
    const agree = make('button', t("Accept terms and show")),
      cancel = make('button', t("Cancel"));
    consent.append(title, text, link, make('br'), agree, cancel);
    document.body.append(consent);
    const displayWanted = () => (desktop.matches ? wanted : mobileOptIn);
    const allowed = () =>
      displayWanted() &&
      accepted &&
      (desktop.matches || config.mobileEnabled === true) &&
      !reduce.matches &&
      !document.hidden &&
      !pageHidden &&
      !suspensions.size &&
      !failed;
    const paint = () => {
      const run = allowed();
      if (!run) {
        endDrag();
        cancelPNG();
        clearDialogue();
        cancelPreset();
        cancelWelcome();
        cancelExternal();
      }
      if(loading)cancelPNG();
      captureButton.disabled=!!pendingCapture||!run||!engine||loading||characters[active].captureAllowed!==true||typeof engine?.captureFrame!=='function';
      if(characters[active].captureAllowed!==true)captureStatus.textContent=t("PNG download is not enabled for this character.");
      if (!run || loading || (sampleWindow && sampleWindow.target !== engine))
        interruptDiagnostics('hidden-suspended-or-loading');
      controlsDock.hidden = suspensions.size > 0;
      diagnostics.hidden = panelOpen;
      diagnosticUpdate();
      button.hidden = suspensions.size > 0;
      button.disabled = reduce.matches || suspensions.size > 0;
      button.textContent = reduce.matches
        ? t("Reduced motion enabled")
        : loading
          ? t("Loading mascot…")
          : failed
            ? loadError + t("(click to retry)")
            : displayWanted() && accepted
              ? t("Hide mascot")
              : t("Show mascot");
      button.setAttribute('aria-pressed', String(displayWanted() && accepted));
      button.setAttribute('aria-busy', String(loading));
      dragHandle.hidden = !(run && engine && !loading);
      panel.hidden = !(run && panelOpen);
      syncThumbnail();
      panelToggle.hidden = !(run && engine);
      panelToggle.textContent = panelOpen ? t("Close interaction") : t("Interact");
      panelToggle.setAttribute('aria-expanded', String(panelOpen));
      layoutDock();
      const supported=capabilities();
      gazeChoice.disabled=!supported.gazeParameters.length;
      pointerStatus.textContent=supported.hitAreas.length?t("Model hit areas available: %1$s",supported.hitAreas.join(', ')):t("No model hit areas; normal greeting is used.");
      if (!run || loading || dragState || !gazeEnabled) engine?.resetGaze?.();
      if (host) {
        host.hidden = !(run && engine && !loading);
        const touch = host.querySelector('button');
        const hasBindings=Array.isArray(characters[active].hitBindings)&&characters[active].hitBindings.some((binding)=>supported.hitAreas.includes(binding?.area)&&livePresets.has(binding?.preset));
        touch.classList.toggle('wzf-haru-hit-enabled',hasBindings);
        const hasGreetings = hasBindings || !!characters[active].greetings?.length || (dialogueMode !== 'silent' && characters[active].dialogue?.click?.enabled === true);
        touch.hidden = !hasGreetings;
        touch.disabled = !hasGreetings || !run || !engine || loading;
      }
      play.disabled =
        stopMotion.disabled =
        face.disabled =
        resetFace.disabled =
          !(run && engine && !loading);
      for (const button of presetControls.querySelectorAll('button')) button.disabled = !(run && engine && !loading);
      face.disabled = face.disabled || !expression.options.length;
      expression.hidden = face.hidden = resetFace.hidden = !expression.options.length;
      resetFace.disabled = resetFace.disabled || !expression.options.length;
      characterSearch.disabled = loading;
      favoritesFilter.disabled = loading;
      syncFavoriteButton();
      syncRecentOptions();
      favoritesState.textContent =
        favoritesNotice ||
        t("Available favorites: %1$s characters", Object.keys(characters).filter((id) => favorites.has(id)).length);
      clearSearch.disabled = loading || !characterSearch.value;
      characterSelect.disabled = previewButton.disabled =
        loading || !characterSelect.options.length;
      commitButton.hidden = cancelPreview.hidden = !preview;
      commitButton.disabled = cancelPreview.disabled = loading || !engine;
      accountUpdate();
      side.disabled = slider.disabled = reset.disabled = loading;
      label.textContent = preview ? t('%1$s · Previewing', characters[active].name) : characters[active].name;
      credit.textContent =
        t('%1$s · %2$s · Sources and terms', characters[active].name, characters[active].credit || t('Administrator-imported resources'));
      credit.href =
        config.terms + (characters[active].termsAnchor ? '#' + characters[active].termsAnchor : '');
      if (engine) {
        if (run && !loading) engine.resume();
        else engine.pause();
      }
      layout();
    };
    diagnostics.addEventListener('toggle', () => {
      if (diagnostics.open) {
        panelOpen = false;
        paint();
      }
    });
    panelToggle.onclick = () => {
      diagnostics.open = false;
      panelOpen = !panelOpen;
      paint();
      if (panelOpen && !panel.hidden) {
        const entry = characterSelect.options.length ? characterSelect : characterSearch;
        entry.focus({ preventScroll: true });
      }
    };
    characterSearch.oninput = () => {
      syncCharacterOptions();
      paint();
    };
    const selectCandidate=(id)=>{
      if(loading||![...characterSelect.options].some(option=>option.value===id))return;
      characterSelect.value=id;syncFavoriteButton();syncThumbnail();
      state.textContent=t("Candidate selected. Preview it before choosing.");
    };
    randomFavorite.onclick=()=>{
      if(loading)return;
      const pool=randomPool(),key=JSON.stringify([...pool].sort());if(!pool.length)return;
      if(key!==randomPoolKey){randomPoolKey=key;randomBag=[];}
      if(!randomBag.length){randomBag=[...pool];for(let index=randomBag.length-1;index>0;index--){const other=Math.floor(Math.random()*(index+1));[randomBag[index],randomBag[other]]=[randomBag[other],randomBag[index]];}if(randomBag.length>1&&randomBag[0]===randomLast)[randomBag[0],randomBag[1]]=[randomBag[1],randomBag[0]];}
      const id=randomBag.shift();randomLast=id;selectCandidate(id);
    };
    recentSelect.onchange=()=>{selectCandidate(recentSelect.value);recentSelect.value='';};
    characterSelect.onchange = () => {
      syncFavoriteButton();
      syncThumbnail();
    };
    favoritesFilter.onchange = () => {
      syncCharacterOptions();
      paint();
    };
    favoriteButton.onclick = () => {
      const id = characterSelect.value;
      if (loading || !Object.hasOwn(characters, id)) return;
      pendingFavorites.set(id, !favorites.has(id));
      const applyPending = (set) => {
        for (const [id, saved] of pendingFavorites) {
          if (saved) set.add(id);
          else set.delete(id);
        }
        return set;
      };
      const local = applyPending(new Set(favorites));
      try {
        // Best-effort merge at click time. This is not an atomic cross-tab lock.
        const merged = applyPending(readFavorites());
        localStorage.setItem(favoritesKey, JSON.stringify([...merged]));
        favorites = merged;
        pendingFavorites.clear();
        favoritesNotice = '';
      } catch {
        favorites = local;
        favoritesNotice = t("Favorites apply only to this page; the browser did not allow saving.");
      }
      syncCharacterOptions(id);
      paint();
      // Only the user's removal event moves focus; asynchronous paint never does.
      if (favoritesFilter.checked && !characterSelect.options.length)
        favoritesFilter.focus({ preventScroll: true });
    };
    clearSearch.onclick = () => {
      characterSearch.value = '';
      syncCharacterOptions();
      paint();
      characterSearch.focus({ preventScroll: true });
    };
    let composing = false;
    panel.addEventListener('compositionstart', () => (composing = true));
    panel.addEventListener('compositionend', () => (composing = false));
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.isComposing && !composing) {
        e.preventDefault();
        panelOpen = false;
        paint();
        panelToggle.focus();
      }
    });
    const cancelled = () => new DOMException(t("Loading cancelled"), 'AbortError');
    const checkSignal = (signal) => {
      if (signal.aborted) throw cancelled();
    };
    const errorMessage = (error) => {
      if (error?.name === 'ResourceError') {
        const label = {
          core: 'Core',
          engine: t("Engine"),
          webgl: 'WebGL',
          model: t("Model"),
          catalog: t("Catalog"),
          moc: 'MOC',
          physics: t("Physics"),
          pose: t("Pose"),
          texture: t("Texture"),
          shader: t("Shader"),
          motion: t("Motion"),
          expression: t("Expression"),
        }[error.category || loadStage];
        return (label ? label + ': ' : '') + t(error.message);
      }
      return t("Character resources are invalid. Cannot display; try again.");
    };
    // Download first: an aborted/timed-out request never leaves executable script
    // behind. Once a Blob script is appended its execution is shared across callers.
    const scriptExecutions = new Map();
    const waitForScript = (request, signal) =>
      new Promise((resolve, reject) => {
        const finish = (error) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          if (error) reject(error);
          else resolve();
        };
        const abort = () => finish(cancelled());
        const timer = setTimeout(
          () =>
            finish(
              Object.assign(new Error(t("Runtime startup timed out. Refresh and retry.")), {
                name: 'ResourceError',
                code: 'timeout',
              }),
            ),
          15000,
        );
        signal.addEventListener('abort', abort, { once: true });
        request.then(() => {
          try {
            checkSignal(signal);
            finish();
          } catch (error) {
            finish(error);
          }
        }, finish);
      });
    const script = async (src, exists, signal) => {
      checkSignal(signal);
      if (exists()) return;
      const executing = scriptExecutions.get(src);
      if (executing) return waitForScript(executing, signal);
      const controller = new AbortController();
      const abort = () => controller.abort(cancelled());
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(
        () =>
          controller.abort(
            Object.assign(new Error(t("Runtime loading timed out. Try again.")), {
              name: 'ResourceError',
              code: 'timeout',
            }),
          ),
        15000,
      );
      let source;
      try {
        source = await new Promise((resolve, reject) => {
          const aborted = () => reject(controller.signal.reason);
          controller.signal.addEventListener('abort', aborted, { once: true });
          (async () => {
            const response = await fetch(src, {
              signal: controller.signal,
              credentials: 'omit',
            });
            if (!response.ok)
              throw Object.assign(
                new Error(
                  response.status === 404
                    ? t("The runtime component is missing. Try again later.")
                    : t("Runtime download failed. Try again later."),
                ),
                { name: 'ResourceError', code: 'http' },
              );
            return response.text();
          })()
            .then(resolve, reject)
            .finally(() => controller.signal.removeEventListener('abort', aborted));
        });
        checkSignal(signal);
      } catch (error) {
        if (signal.aborted) throw cancelled();
        if (controller.signal.aborted) throw controller.signal.reason;
        if (error?.name === 'ResourceError') throw error;
        throw Object.assign(new Error(t("Runtime download failed. Check your connection and retry.")), {
          name: 'ResourceError',
          code: 'network',
        });
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
      // Another caller may have finished downloading while we awaited the body.
      if (exists()) return;
      let request = scriptExecutions.get(src);
      if (!request) {
        request = new Promise((resolve, reject) => {
          const tag = make('script');
          const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
          tag.src = url;
          const finish = (error) => {
            tag.onload = tag.onerror = null;
            URL.revokeObjectURL(url);
            tag.remove();
            scriptExecutions.delete(src);
            if (error) reject(error);
            else resolve();
          };
          tag.onload = () =>
            finish(
              exists()
                ? undefined
                : Object.assign(new Error(t("The runtime component is invalid. Try again.")), {
                    name: 'ResourceError',
                    code: 'invalid',
                  }),
            );
          tag.onerror = () =>
            finish(
              Object.assign(new Error(t("The browser blocked mascot execution. Refresh and retry.")), {
                name: 'ResourceError',
                code: 'invalid',
              }),
            );
          document.head.append(tag);
        });
        scriptExecutions.set(src, request);
      }
      return waitForScript(request, signal);
    };
    const cancelLoad = () => {
      if (!loadController) return;
      welcomeConsumed = true;
      if (currentLoad && currentLoad.status === 'loading') currentLoad.status = 'cancelled';
      interruptDiagnostics('load-cancelled');
      loadAttempt++;
      loadController.abort();
      loadController = null;
      loading = false;
      generation++;
      operation++;
      manualPending.clear();
      touchPending = false;
      active = committed;
      syncCharacterOptions(committed);
      preview = false;
      readLayout();
      state.textContent = t("Loading cancelled");
    };
    const beginLoad = (id = committed) => {
      cancelPNG();captureStatus.textContent='';
      clearDialogue();
      interruptDiagnostics('load-started');
      if (diagnosticsEnabled) {
        diagnosticReport.characterId = id;
        diagnosticBegin(id);
        diagnosticReport.error = null;
      }
      const controller = new AbortController();
      loadController = controller;
      const attempt = ++loadAttempt;
      loading = true;
      loadError = '';
      state.textContent = t("Loading character…");
      paint();
      return { signal: controller.signal, attempt };
    };
    const finishLoad = (attempt) => {
      if (attempt !== loadAttempt) return;
      loadController = null;
      loading = false;
      paint();
    };
    const destroy = () => {
      cancelPNG();
      endDrag();
      cancelPreset();
      clearDialogue();
      cancelWelcome();
      cancelExternal();
      interruptDiagnostics('engine-replaced');
      generation++;
      operation++;
      manualPending.clear();
      touchPending = false;
      engine?.destroy();
      engine = null;
    };
    const populatePresets = () => {
      livePresets.clear(); nextHit=0;
      presetControls.replaceChildren();
      const rows = characters[active].presets;
      if (!Array.isArray(rows)) { presetControls.hidden = true; return; }
      for (const row of rows.slice(0, 8)) {
        if (!row || typeof row !== 'object' || typeof row.name !== 'string' || !row.name.trim() || new TextEncoder().encode(row.name).length > 80) continue;
        if (!['motion','expression','line'].every((key) => typeof row[key] === 'string') ||
            (!row.motion && !row.expression && !row.line.trim()) ||
            (row.motion && !engine.catalog.motions.some((item) => item.id === row.motion)) ||
            (row.expression && !engine.catalog.expressions.some((item) => item.id === row.expression)) ||
            new TextEncoder().encode(row.line).length > 300) continue;
        livePresets.set(row.id,row);
        const button = make('button', row.name);
        button.dataset.presetId = row.id;
        button.onclick = () => performPreset(row);
        presetControls.append(button);
      }
      presetControls.hidden = !presetControls.children.length;
    };
    const populate = () => {
      populatePresets();
      for (const [select, items] of [
        [motion, engine.catalog.motions],
        [expression, engine.catalog.expressions],
      ]) {
        select.replaceChildren();
        for (const item of items) {
          const opt = make('option');
          opt.value = item.id;
          opt.textContent = active === 'haru' ? haruNames[item.id] || item.label : item.label;
          select.append(opt);
        }
      }
      motion.value = characters[active].greetings?.[0] || characters[active].idle;
    };
    const load = async (id, signal) => {
      checkSignal(signal);
      destroy();
      active = id;
      if (diagnosticsEnabled && currentLoad?.status === 'failed') diagnosticBegin(id, true);
      diagnosticPhase('webgl');
      if (diagnosticsEnabled) diagnosticReport.characterId = id;
      readLayout();
      syncCharacterOptions(id);
      touchCount = 0;
      nextTouch = 0;
      if (!host) {
        host = make('div');
        host.id = 'wzf-haru-character';
        host.hidden = true;
        canvas = make('canvas');
        canvas.width = 360;
        canvas.height = 540;
        const touch = make('button', '', 'wzf-haru-touch');
        touch.title = t("Tap to greet");
        touch.onclick = greet;
        bubble = make('div', '', 'wzf-haru-bubble');
        bubble.hidden = true;
        bubble.setAttribute('aria-live', 'polite');
        bubble.setAttribute('aria-label', t("Character dialogue"));
        bubble.tabIndex = 0;
        bubble.onfocus=()=>{clearTimeout(bubbleTimer);bubbleTimer=null;};
        bubble.onblur=()=>{if(!bubble.hidden){clearTimeout(bubbleTimer);bubbleTimer=setTimeout(clearDialogue,2000);}};
        bubble.addEventListener('wheel',()=>{if(!bubble.hidden){clearTimeout(bubbleTimer);bubbleTimer=setTimeout(clearDialogue,12000);}},{passive:true});
        host.append(canvas, touch, bubble);
        document.body.append(host);
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          diagnosticError({ code: 'context-lost', category: 'webgl' });
          cancelLoad();
          failed = true;
          loadError = state.textContent = t("The graphics context was lost. Try again.");
          paint();
        });
        canvas.addEventListener('mascoterror', () => {
          diagnosticError({ code: 'render', category: 'webgl' });
          cancelLoad();
          failed = true;
          loadError = state.textContent = t("Rendering failed. Try again.");
          paint();
        });
      }
      canvas.setAttribute('aria-label', t("%1$s mascot", characters[id].name));
      host
        .querySelector('button')
        .setAttribute('aria-label', t("Tap %1$s to greet", characters[id].name));
      layout();
      const candidate = await window.WZFHaruEngine.create(
        canvas,
        characters[id].root,
        config.shaders,
        { ...characters[id], onDiagnosticStage: diagnosticPhase },
        signal,
      );
      if (signal.aborted) {
        candidate.destroy();
        throw cancelled();
      }
      engine = candidate;
      populate();
      diagnosticReady();
    };
    const apply = async () => {
      if (!allowed()) cancelLoad();
      paint();
      if (!allowed() || engine || loading) return;
      const { signal, attempt } = beginLoad();
      try {
        diagnosticPhase('core');
        await script(config.core, () => !!window.Live2DCubismCore, signal);
        diagnosticPhase('engine');
        await script(config.engine, () => !!window.WZFHaruEngine, signal);
        checkSignal(signal);
        await load(committed, signal);
        if (attempt !== loadAttempt) return;
        preview = false;
        state.textContent = t("Ready");
      } catch (error) {
        if (attempt !== loadAttempt || signal.aborted || error?.name === 'AbortError') return;
        diagnosticError(error);
        failed = true;
        destroy();
        loadError = state.textContent = errorMessage(error);
      } finally {
        finishLoad(attempt);
        if (attempt === loadAttempt && engine && !failed) scheduleWelcome();
      }
    };
    const switchTo = async (id, isPreview) => {
      if (!allowed() || loading || !engine || !Object.hasOwn(characters, id)) return;
      welcomeConsumed = true;
      cancelWelcome();
      const { signal, attempt } = beginLoad(id);
      try {
        await load(id, signal);
        if (attempt !== loadAttempt) return;
        preview = isPreview && id !== committed;
        state.textContent = preview ? t("Previewing. Select “Use this character” to save.") : t("Returned to the original character");
      } catch (error) {
        if (attempt !== loadAttempt || signal.aborted || error?.name === 'AbortError') return;
        diagnosticError(error);
        const reason = errorMessage(error);
        try {
          await load(committed, signal);
          if (attempt !== loadAttempt) return;
          preview = false;
          state.textContent = t("%1$s; returned to the original character. You can retry.", reason);
        } catch (fallbackError) {
          if (attempt !== loadAttempt || signal.aborted || fallbackError?.name === 'AbortError')
            return;
          diagnosticError(fallbackError);
          failed = true;
          destroy();
          preview = false;
          active = committed;
          syncCharacterOptions(committed);
          readLayout();
          loadError = state.textContent = errorMessage(fallbackError);
        }
      } finally {
        finishLoad(attempt);
      }
    };
    previewButton.onclick = () => switchTo(characterSelect.value, true);
    cancelPreview.onclick = () => switchTo(committed, false);
    commitButton.onclick = () => {
      if (!allowed() || loading || !engine || !preview) return;
      try {
        localStorage.setItem('wzf-mascot-character', active);
        committed = active;
        preview = false;
        rememberRecent(active);
        state.textContent = t("Using %1$s; this browser will remember your selection.", characters[active].name)+(recentNotice?' '+recentNotice:'');
      } catch {
        state.textContent = t("The browser did not allow saving. This preview is still usable.");
      }
      paint();
    };
    const save = () => {
      try {
        if (desktop.matches) localStorage.setItem('wzfl-mascot', wanted ? 'shown' : 'hidden');
        else localStorage.setItem('wzf-mascot-mobile-v1', mobileOptIn ? 'enabled' : 'disabled');
      } catch {}
    };
    agree.onclick = () => {
      accepted = true;
      try {
        localStorage.setItem('wzf-haru-terms', config.termsVersion);
      } catch {}
      if (desktop.matches) wanted = true;
      else mobileOptIn = true;
      save();
      consent.close();
      apply();
    };
    cancel.onclick = () => consent.close();
    button.onclick = () => {
      if (suspensions.size || reduce.matches || (!desktop.matches && config.mobileEnabled !== true))
        return;
      if (!accepted || (!desktop.matches && !mobileOptIn)) {
        agree.textContent = desktop.matches ? t("Accept terms and show") : t("Accept terms and enable mobile animation in this browser");
        consent.showModal();
        return;
      }
      if (failed && !loading) {
        destroy();
        host?.remove();
        host = null;
        canvas = null;
        failed = false;
        if (desktop.matches) wanted = true;
        else mobileOptIn = true;
      } else if (desktop.matches) wanted = !wanted;
      else mobileOptIn = !mobileOptIn;
      save();
      apply();
    };
    const perform = async (type, id) => {
      if (!allowed() || !engine || loading) return;
      cancelPreset();
      cancelExternal();
      welcomeConsumed = true;
      cancelWelcome();
      const n = ++operation,
        channel = ++interactions[type],
        g = generation,
        target = engine,
        text = (type === 'motion' ? motion : expression).selectedOptions[0]?.textContent || id;
      if (type === 'motion') {
        touchPending = false;
        nextTouch = 0;
      }
      manualPending.add(type);
      state.textContent = t("Loading…");
      try {
        const done = await target.play(type, id);
        if (n === operation && g === generation)
          state.textContent = done ? t("Previewing: %1$s", text) : t("Cancelled");
      } catch (error) {
        if (n === operation && g === generation && error?.name !== 'AbortError')
          diagnosticError(error, type);
        if (n === operation && g === generation)
          state.textContent = error?.name === 'AbortError' ? t("Cancelled") : errorMessage(error);
      } finally {
        if (channel === interactions[type] && g === generation) manualPending.delete(type);
      }
    };
    const performPreset = async (preset) => {
      if (!allowed() || !engine || loading || engine.state().paused) return false;
      cancelPreset(); clearDialogue(); cancelExternal();
      welcomeConsumed = true; dialogueWelcomeConsumed = true; cancelWelcome();
      const n = ++operation, g = generation, target = engine;
      const pending = { target, g, channels: new Map() };
      pendingPreset = pending;
      const jobs = [];
      for (const type of ['motion', 'expression']) {
        if (!preset[type]) continue;
        const channel = ++interactions[type];
        manualPending.add(type);
        pending.channels.set(type, channel);
        if (type === 'motion') { touchPending = false; nextTouch = 0; }
        // The calls start synchronously before collecting either result.
        jobs.push((async () => target.play(type, preset[type]))().then(
          (done) => ({ type, done }),
          (error) => ({ type, error }),
        ).finally(() => {
          pending.channels.delete(type);
          if (g === generation && channel === interactions[type]) manualPending.delete(type);
        }));
      }
      if (preset.line) showLine(preset.line);
      const results = await Promise.allSettled(jobs);
      if (pendingPreset === pending) pendingPreset = null;
      if (n !== operation || g !== generation || target !== engine || !allowed()) return false;
      const values = results.map((result) => result.status === 'fulfilled' ? result.value : {error:result.reason});
      const errors = values.filter((value) => value.error && value.error.name !== 'AbortError');
      for (const value of errors) diagnosticError(value.error, value.type);
      if (errors.length) state.textContent = t("Some interactions could not load. Try again.");
      else if (values.some((value) => !value.done)) state.textContent = t("Cancelled");
      else state.textContent = t("Previewing: %1$s", preset.name);
      return !errors.length;
    };
    const restore = (type) => {
      if (!allowed() || !engine || loading || (type === 'expression' && !expression.options.length))
        return;
      cancelPreset();
      cancelExternal();
      welcomeConsumed = true;
      cancelWelcome(type === 'expression');
      operation++;
      interactions[type]++;
      manualPending.delete(type);
      if (type === 'motion') {
        touchPending = false;
        nextTouch = 0;
        engine.idleNow();
        state.textContent = t("Motion stopped; returned to idle");
      } else {
        engine.resetExpression();
        state.textContent = t("Expression reset");
      }
    };
    play.onclick = () => perform('motion', motion.value);
    face.onclick = () => perform('expression', expression.value);
    stopMotion.onclick = () => restore('motion');
    resetFace.onclick = () => restore('expression');
    const greet = async (event) => {
      if (!allowed() || !engine || loading || dragState) return;
      if (event?.detail > 0 && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        const area=engine.hitAreaAt?.(event.clientX,event.clientY);
        const binding=Array.isArray(characters[active].hitBindings)?characters[active].hitBindings.find((item)=>item?.area===area&&capabilities().hitAreas.includes(area)):null;
        const preset=binding&&livePresets.get(binding.preset);
        if(preset){if(performance.now()<nextHit)return;nextHit=performance.now()+1000;void performPreset(preset);return;}
      }
      welcomeConsumed = true;
      dialogueWelcomeConsumed = true;
      cancelWelcome();
      cancelPreset();
      speak('click');
      if (!characters[active].greetings?.length) return;
      if (
        !allowed() ||
        !engine ||
        loading ||
        touchPending ||
        manualPending.size ||
        performance.now() < nextTouch ||
        engine.state().activeMotion !== characters[active].idle
      )
        return;
      touchPending = true;
      nextTouch = performance.now() + 8000;
      const n = ++operation,
        channel = ++interactions.motion,
        g = generation,
        target = engine,
        list = characters[active].greetings,
        id = list[touchCount % list.length];
      try {
        const done = await target.play('motion', id);
        if (g !== generation || channel !== interactions.motion) return;
        if (done) {
          touchCount++;
          if (n === operation) state.textContent = t("%1$s greeted you", characters[active].name);
        } else nextTouch = 0;
      } catch (error) {
        if (g === generation && channel === interactions.motion && error?.name !== 'AbortError')
          diagnosticError(error, 'motion');
        if (g === generation && channel === interactions.motion) {
          nextTouch = 0;
          if (n === operation) state.textContent = t("The greeting could not load yet. Tap again to retry.");
        }
      } finally {
        if (g === generation && channel === interactions.motion) touchPending = false;
      }
    };
    const haruNames = {
      haru_g_idle: t("Stand quietly (idle)"),
      haru_g_m01: t("Hands in front \u00b7 soft response"),
      haru_g_m02: t("Hands behind \u00b7 head tilt"),
      haru_g_m03: t("Arms crossed \u00b7 nod"),
      haru_g_m04: t("Arms crossed \u00b7 glance aside"),
      haru_g_m05: t("Arms slightly open"),
      haru_g_m06: t("Chin in hand \u00b7 open palm"),
      haru_g_m07: t("Open palms \u00b7 head tilt"),
      haru_g_m08: t("Hands together \u00b7 gentle sway"),
      haru_g_m09: t("Hands together \u00b7 blink"),
      haru_g_m10: t("Arms open \u00b7 smile"),
      haru_g_m11: t("Arms crossed \u00b7 head tilt"),
      haru_g_m12: t("Raise hand to greet"),
      haru_g_m13: t("Arms open \u00b7 gentle sway"),
      haru_g_m14: t("Hands together to arms open"),
      haru_g_m15: t("Arms crossed \u00b7 thinking"),
      haru_g_m16: t("Hands on cheeks \u00b7 soft smile"),
      haru_g_m17: t("Hands behind \u00b7 smile"),
      haru_g_m18: t("Hands behind to hands together"),
      haru_g_m19: t("Head lowered \u00b7 listening"),
      haru_g_m20: t("Arms crossed \u00b7 turn head"),
      haru_g_m21: t("Arms open \u00b7 smile with eyes closed"),
      haru_g_m22: t("Hands together to hands behind"),
      haru_g_m23: t("Hands together \u00b7 light sway"),
      haru_g_m24: t("Turn with hands behind"),
      haru_g_m25: t("Hands behind \u00b7 blink"),
      haru_g_m26: t("Arms open \u00b7 head tilt"),
      F01: t("Smile"),
      F02: t("Open mouth \u00b7 frown"),
      F03: t("Displeased"),
      F04: t("Lowered brows"),
      F05: t("Smile with eyes closed"),
      F06: t("Surprised"),
      F07: t("Blush"),
      F08: t("Pursed lips"),
    };
    // Versioned local integration: it never shows, switches or loads arbitrary resources.
    let externalPending = null,
      externalSequence = 0,
      externalNext = 0,
      captionTimer = null;
    const cancelExternal = () => {
      clearTimeout(captionTimer);
      if (!externalPending) return false;
      externalPending.target.cancelPending(externalPending.type);
      externalSequence++;
      externalPending = null;
      manualPending.delete('external');
      return true;
    };
    const externalRequest = (request) => {
      if (
        !request ||
        typeof request !== 'object' ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(request))
      )
        return null;
      const keys = Reflect.ownKeys(request);
      if (
        keys.some(
          (key) =>
            typeof key !== 'string' ||
            !['action', 'id', 'channel', 'caption'].includes(key) ||
            !Object.hasOwn(Object.getOwnPropertyDescriptor(request, key), 'value'),
        )
      )
        return null;
      const { action, id, channel, caption } = request;
      if (!['motion', 'expression', 'reset', 'stop'].includes(action)) return null;
      if (['motion', 'expression'].includes(action)) {
        if (
          typeof id !== 'string' ||
          !id ||
          id.length > 200 ||
          /[\u0000-\u001f\u007f]/.test(id) ||
          channel !== undefined
        )
          return null;
      } else if (
        id !== undefined ||
        (action === 'stop' && channel !== undefined) ||
        (channel !== undefined && !['all', 'motion', 'expression'].includes(channel))
      )
        return null;
      if (
        caption !== undefined &&
        (typeof caption !== 'string' ||
          [...caption].length > 120 ||
          /[<>\u0000-\u001f\u007f]/.test(caption))
      )
        return null;
      return { action, id, channel, caption };
    };
    const externalCommand = async (request) => {
      let req;
      try {
        req = externalRequest(request);
      } catch {
        return { ok: false, code: 'invalid-request' };
      }
      if (!req) return { ok: false, code: 'invalid-request' };
      if (!engine || !allowed() || loading || engine.state().paused)
        return { ok: false, code: 'unavailable' };
      if (
        ['motion', 'expression'].includes(req.action) &&
        !engine.catalog[req.action === 'motion' ? 'motions' : 'expressions'].some(
          (item) => item.id === req.id,
        )
      )
        return { ok: false, code: 'unknown-id' };
      if (externalPending || manualPending.size || touchPending) return { ok: false, code: 'busy' };
      if (performance.now() < externalNext) return { ok: false, code: 'rate-limited' };
      externalNext = performance.now() + 500;
      welcomeConsumed = true;
      cancelWelcome();
      const target = engine,
        g = generation,
        n = ++operation,
        token = ++externalSequence,
        characterId = active;
      clearTimeout(captionTimer);
      const result = () => ({
        ok: true,
        code: req.action === 'stop' ? 'stopped' : req.action === 'reset' ? 'reset' : 'played',
        characterId,
      });
      const caption = () => {
        if (req.caption !== undefined) {
          state.textContent = req.caption;
          captionTimer = setTimeout(() => {
            if (engine === target && generation === g && operation === n)
              state.textContent = t("Ready");
          }, 5000);
        }
      };
      if (req.action === 'reset' || req.action === 'stop') {
        if (req.action === 'stop' || !req.channel || ['all', 'motion'].includes(req.channel))
          target.idleNow();
        if (req.action === 'reset' && (!req.channel || ['all', 'expression'].includes(req.channel)))
          target.resetExpression();
        caption();
        return result();
      }
      externalPending = { target, type: req.action };
      manualPending.add('external');
      try {
        const done = await target.play(req.action, req.id);
        if (
          !done ||
          externalSequence !== token ||
          engine !== target ||
          generation !== g ||
          operation !== n ||
          !allowed()
        )
          return { ok: false, code: 'cancelled', characterId };
        caption();
        return result();
      } catch (error) {
        return {
          ok: false,
          code:
            externalSequence !== token || error?.name === 'AbortError'
              ? 'cancelled'
              : 'resource-error',
          characterId,
        };
      } finally {
        if (externalSequence === token) {
          externalPending = null;
          manualPending.delete('external');
        }
      }
    };
    const semanticTimes = new Map();
    let semanticNext = 0;
    const notify = async (request) => {
      let event,caption,presetId;
      try {
        if (!request || typeof request!=='object' || ![Object.prototype,null].includes(Object.getPrototypeOf(request)) || Object.keys(request).some((key)=>!['event','caption','presetId'].includes(key))) return {ok:false,code:'invalid-request'};
        ({event,caption,presetId}=request);
        if (!['help','tool-complete','action-complete'].includes(event) || (caption!==undefined&&(typeof caption!=='string'||!caption.trim()||new TextEncoder().encode(caption).length>300||/[<>\u0000-\u001f\u007f]/.test(caption))) || (presetId!==undefined&&(typeof presetId!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(presetId)))) return {ok:false,code:'invalid-request'};
      } catch { return {ok:false,code:'invalid-request'}; }
      if (!engine||!allowed()||loading||preview||dragState||engine.state().paused) return {ok:false,code:'unavailable'};
      const preset=presetId===undefined?null:livePresets.get(presetId);
      if(presetId!==undefined&&!preset)return {ok:false,code:'unknown-id'};
      if(manualPending.size||touchPending||externalPending)return {ok:false,code:'busy'};
      const now=performance.now(), key=active+':'+event;
      if(now<semanticNext || now-(semanticTimes.get(key)??-Infinity)<30000)return {ok:false,code:'rate-limited'};
      if(!preset&&dialogueMode==='silent')return {ok:false,code:'muted'};
      semanticNext=now+15000; semanticTimes.set(key,now);
      const characterId=active;
      const line=caption??(event==='help'?t("Use Interact to preview characters and play quick interactions. The move handle supports dragging and arrow keys."):event==='tool-complete'?t("Tool completed"):t("Action completed"));
      if(preset){const ok=await performPreset({...preset,line:caption??preset.line});return {ok,code:ok?'played':'cancelled',characterId};}
      welcomeConsumed=true;dialogueWelcomeConsumed=true;cancelWelcome();clearDialogue();
      return {ok:showLine(line),code:'shown',characterId};
    };
    helpButton.addEventListener('toggle',()=>{if(helpButton.open)void notify({event:'help'});});
    document.addEventListener('wzf-mascot-event',(event)=>{void notify(event.detail);});
    window.WZFMascot = Object.freeze({
      version: 1,
      notify,
      command: externalCommand,
      cancel: () => {const pending=!!pendingPreset;cancelPreset();clearDialogue();return {ok:true,code:cancelExternal()||pending?'cancelled':'idle'};},
    });
    const setSuspension = (source, suspended) => {
      if (suspensions.has(source) === suspended) return;
      if (suspended) {
        suspensions.add(source);
        // Opening reading UI consumes even a welcome that has not been scheduled yet.
        dialogueWelcomeConsumed = true;
        clearDialogue();
        welcomeConsumed = true;
        cancelWelcome();
      } else suspensions.delete(source);
      apply();
    };
    document.addEventListener('wzf-mascot-suspension', (event) => {
      const detail = event.detail;
      if (
        typeof detail?.source !== 'string' ||
        !detail.source.trim() ||
        typeof detail.suspended !== 'boolean'
      )
        return;
      setSuspension('event:' + detail.source.trim(), detail.suspended);
    });
    const installReadingSuspension = () => {
      // Keep all existing-reader DOM knowledge here. Observe a complete mutation batch,
      // so moving a panel between a dock and dialog cannot briefly resume the mascot.
      const selector = 'dialog,.pagenest-reading-rail,.pagenest-notes-slot,.llmn-panel,.llmc-panel';
      const own = (node) =>
        [button, panel, panelToggle, host, consent, controlsDock, dragHandle].some(
          (element) => element && (element === node || element.contains(node)),
        );
      const visible = (element) =>
        element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
      const sync = () => {
        const dialogOpen = [...document.querySelectorAll('dialog[open]')].some(
          (dialog) => dialog !== consent && visible(dialog),
        );
        const dockOpen = [
          ...document.querySelectorAll(
            '.pagenest-reading-rail.llmn-show-notes .pagenest-notes-slot',
          ),
        ].some(
          (slot) =>
            visible(slot) && [...slot.querySelectorAll('.llmn-panel,.llmc-panel')].some(visible),
        );
        setSuspension('reading-ui', dialogOpen || dockOpen);
      };
      const relevant = (node) =>
        node.nodeType === Node.ELEMENT_NODE &&
        !own(node) &&
        (node.matches(selector) || node.querySelector(selector));
      const observer = new MutationObserver((records) => {
        if (
          records.some(
            (record) =>
              !own(record.target) &&
              (record.type === 'attributes'
                ? relevant(record.target)
                : [...record.addedNodes, ...record.removedNodes].some(relevant)),
          )
        )
          sync();
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['open', 'hidden', 'class'],
      });
      window.addEventListener('resize', sync);
      document.addEventListener('pagenest-reading-layout', sync);
      sync();
    };
    const syncMobileInput = () => {
      const node = document.activeElement;
      const editable =
        node &&
        (node.matches('input,textarea,select,[contenteditable="true"],[contenteditable=""]') ||
          node.isContentEditable);
      const own = [panel, controlsDock, host, consent].some((element) => element?.contains(node));
      setSuspension(
        'mobile-input',
        !desktop.matches &&
          mobileOptIn &&
          config.mobileEnabled === true &&
          config.mobilePauseOnInput !== false &&
          !!editable &&
          !own,
      );
    };
    document.addEventListener('focusin', syncMobileInput);
    document.addEventListener('focusout', () => setTimeout(syncMobileInput, 0));
    window.visualViewport?.addEventListener('resize', () => { syncMobileInput(); layout(); layoutDock(); });
    window.visualViewport?.addEventListener('scroll', layout);
    window.addEventListener('resize', () => {
      layout();
      layoutDock();
    });
    desktop.addEventListener('change', () => {
      syncMobileInput();
      apply();
    });
    document.addEventListener('pointermove',(event)=>{
      if(!gazeEnabled || event.pointerType!=='mouse' || !matchMedia('(pointer: fine)').matches || !allowed() || loading || dragState || !engine || !capabilities().gazeParameters.length)return;
      const box=canvas.getBoundingClientRect();
      if(box.width&&box.height)engine.setGaze?.((event.clientX-(box.left+box.width/2))/(box.width/2),((box.top+box.height/2)-event.clientY)/(box.height/2));
    },{passive:true});
    document.addEventListener('pointerleave',()=>engine?.resetGaze?.());
    window.addEventListener('blur',()=>engine?.resetGaze?.());
    reduce.addEventListener('change', apply);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { awayAt = performance.now(); clearDialogue(); }
      apply();
      if (!document.hidden) {
        const absent = awayAt === null ? 0 : performance.now() - awayAt;
        awayAt = null;
        if (absent >= 60000) speak('return', true);
      }
    });
    window.addEventListener('pagehide', () => {
      pageHidden = true;
      apply();
    });
    window.addEventListener('pageshow', () => {
      pageHidden = false;
      apply();
    });
    window.WZFHaruStatus = () => ({
      ready: !!engine,
      loading,
      failed,
      accepted,
      wanted,
      mobileOptIn,
      mobileEnabled: config.mobileEnabled === true,
      panelOpen,
      suspended: suspensions.size > 0,
      suspensionSources: [...suspensions].sort(),
      touchCount,
      welcomeCount,
      welcomeConsumed,
      dialogueMode,
      dialogueWelcomeConsumed,
      engineCapabilities: capabilities(),
      gazeEnabled,
      character: active,
      committed,
      preview,
      ...(engine?.state() || {}),
    });
    installReadingSuspension();
    paint();
    apply();
  };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
