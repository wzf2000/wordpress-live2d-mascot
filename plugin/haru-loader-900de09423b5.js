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
  const start = () => {
    const characters = config.characters;
    if (!characters || typeof characters !== 'object' || !Object.keys(characters).length) return;
    const defaultCharacter = Object.hasOwn(characters, 'haru') ? 'haru' : Object.keys(characters)[0];
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
          ? ids.filter((id) => typeof id === 'string' && Object.hasOwn(characters, id))
          : [],
      );
    };
    let favorites = new Set(),
      favoritesNotice = '';
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
    active = committed;
    let position = 'right',
      size = 180;
    let welcomeConsumed = false,
      welcomeCount = 0,
      welcomeTimer = null,
      welcomeEnd = null,
      welcomeTarget = null;
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
          state.textContent = characters[active].name + ' 欢迎你';
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
    let button = document.querySelector('.wzfl-mascot-toggle');
    if (!button) {
      button = make('button', '', 'wzfl-mascot-toggle');
      document.body.append(button);
    }
    const panel = make('section', '', 'wzf-haru-controls');
    panel.id = 'wzf-haru-panel';
    panel.setAttribute('aria-label', '看板娘互动');
    panel.hidden = true;
    const label = make('strong'),
      characterSearch = make('input'),
      clearSearch = make('button', '清空'),
      searchResults = make('span', '', 'wzf-haru-search-results'),
      favoritesFilter = make('input'),
      favoritesLabel = make('label', '', 'wzf-haru-favorites-filter'),
      favoriteButton = make('button', '收藏选中角色', 'wzf-haru-favorite-toggle'),
      favoritesState = make('span', '', 'wzf-haru-favorites-state'),
      characterSelect = make('select');
    favoritesFilter.type = 'checkbox';
    favoritesLabel.append(favoritesFilter, document.createTextNode('只看收藏'));
    favoritesState.setAttribute('role', 'status');
    favoritesState.setAttribute('aria-live', 'polite');
    characterSearch.type = 'search';
    characterSearch.placeholder = '名称或角色 ID';
    characterSearch.setAttribute('aria-label', '搜索角色');
    searchResults.id = 'wzf-haru-search-results';
    searchResults.setAttribute('role', 'status');
    searchResults.setAttribute('aria-live', 'polite');
    characterSearch.setAttribute('aria-describedby', searchResults.id);
    clearSearch.setAttribute('aria-label', '清空角色搜索');
    characterSelect.setAttribute('aria-label', '选择角色');
    const syncFavoriteButton = () => {
      const id = characterSelect.value,
        selected = Object.hasOwn(characters, id),
        saved = selected && favorites.has(id);
      favoriteButton.textContent = saved ? '取消选中收藏' : '收藏选中角色';
      favoriteButton.setAttribute('aria-pressed', String(saved));
      favoriteButton.setAttribute(
        'aria-label',
        (saved ? '取消收藏选中角色：' : '收藏选中角色：') +
          (selected ? characters[id].name : '当前没有可选角色'),
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
        ? '显示 ' + matches.length + ' / ' + Object.keys(characters).length + ' 个角色'
        : favoritesFilter.checked && !favorites.size
          ? '还没有收藏的角色，取消“只看收藏”可查看全部角色'
          : favoritesFilter.checked
            ? '收藏中没有匹配的角色，请更换关键词或清空搜索'
            : '没有匹配的角色，请更换关键词或清空搜索';
      syncFavoriteButton();
    };
    syncCharacterOptions(active);
    const previewButton = make('button', '预览角色'),
      commitButton = make('button', '使用这个角色'),
      cancelPreview = make('button', '取消预览');
    const motion = make('select'),
      expression = make('select');
    motion.setAttribute('aria-label', '选择动作');
    expression.setAttribute('aria-label', '选择表情');
    const play = make('button', '播放动作'),
      stopMotion = make('button', '停止动作，恢复待机', 'wzf-haru-reset'),
      face = make('button', '切换表情'),
      resetFace = make('button', '恢复默认表情', 'wzf-haru-reset'),
      state = make('span', '', 'wzf-haru-state');
    state.setAttribute('role', 'status');
    const credit = make('a');
    credit.href = config.terms;
    credit.target = '_blank';
    credit.rel = 'noopener';
    panel.append(
      label,
      characterSearch,
      clearSearch,
      searchResults,
      characterSelect,
      previewButton,
      favoritesLabel,
      favoriteButton,
      favoritesState,
      commitButton,
      cancelPreview,
      motion,
      play,
      stopMotion,
      expression,
      face,
      resetFace,
      credit,
      state,
    );
    document.body.append(panel);
    const panelToggle = make('button', '互动', 'wzf-haru-panel-toggle');
    panelToggle.hidden = true;
    panelToggle.setAttribute('aria-controls', panel.id);
    panelToggle.setAttribute('aria-expanded', 'false');
    document.body.append(panelToggle);
    const settings = make('details', '', 'wzf-haru-layout'),
      summary = make('summary', '位置与大小');
    settings.append(summary);
    const side = make('select');
    side.setAttribute('aria-label', '人物位置');
    for (const [value, text] of [
      ['right', '右下角'],
      ['left', '左下角'],
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
    slider.setAttribute('aria-label', '人物大小');
    const output = make('output'),
      reset = make('button', '恢复默认');
    settings.append(side, slider, output, reset);
    panel.insertBefore(settings, credit);
    const readLayout = () => {
      const saved = layouts[active] || {};
      position = ['left', 'right'].includes(saved.position) ? saved.position : 'right';
      size = Number.isFinite(saved.size)
        ? Math.max(140, Math.min(260, Math.round(saved.size / 10) * 10))
        : characters[active].size;
      side.value = position;
      slider.value = String(size);
    };
    const layout = () => {
      if (host) {
        host.style.width = size + 'px';
        host.style.height = size * 1.5 + 'px';
        host.style.transform = 'translateY(' + characters[active].offset + '%)';
        host.style.right = position === 'right' ? '6px' : 'auto';
        host.style.left = position === 'left' ? '6px' : 'auto';
      }
      panel.style.left = position === 'right' ? '16px' : 'auto';
      panel.style.right = position === 'left' ? '16px' : 'auto';
      panelToggle.style.right = position === 'right' ? size + 12 + 'px' : 'auto';
      panelToggle.style.left = position === 'left' ? size + 12 + 'px' : 'auto';
      output.textContent = size + ' 像素';
    };
    const rememberLayout = () => {
      layouts[active] = { position, size };
      try {
        localStorage.setItem('wzf-mascot-layouts', JSON.stringify(layouts));
      } catch {}
      layout();
    };
    side.onchange = () => {
      position = side.value;
      rememberLayout();
    };
    slider.oninput = () => {
      size = Number(slider.value);
      rememberLayout();
    };
    reset.onclick = () => {
      position = 'right';
      size = characters[active].size;
      side.value = position;
      slider.value = String(size);
      rememberLayout();
    };
    readLayout();
    const consent = make('dialog', '', 'wzf-haru-consent'),
      title = make('h2', '显示看板娘');
    title.id = 'wzf-mascot-terms-title';
    consent.setAttribute('aria-labelledby', title.id);
    const text = make(
      'p',
      typeof config.consentText === 'string' && config.consentText
        ? config.consentText
        : '角色与运行库由本站管理员自行导入。制作署名和适用条款见来源说明；本插件不授予素材再分发或其他使用权。',
    );
    const link = make('a', '查看角色来源、使用条款及声明');
    link.href = config.terms;
    link.target = '_blank';
    link.rel = 'noopener';
    const agree = make('button', '同意条款并显示'),
      cancel = make('button', '取消');
    consent.append(title, text, link, make('br'), agree, cancel);
    document.body.append(consent);
    const allowed = () =>
      wanted &&
      accepted &&
      desktop.matches &&
      !reduce.matches &&
      !document.hidden &&
      !pageHidden &&
      !suspensions.size &&
      !failed;
    const paint = () => {
      layout();
      const run = allowed();
      if (!run) cancelWelcome();
      button.hidden = suspensions.size > 0;
      button.disabled = reduce.matches || suspensions.size > 0;
      button.textContent = reduce.matches
        ? '已减少动画'
        : loading
          ? '加载看板娘…'
          : failed
            ? loadError + '（点击重试）'
            : wanted && accepted
              ? '收起看板娘'
              : '显示看板娘';
      button.setAttribute('aria-pressed', String(wanted && accepted));
      button.setAttribute('aria-busy', String(loading));
      panel.hidden = !(run && panelOpen);
      panelToggle.hidden = !(run && engine);
      panelToggle.textContent = panelOpen ? '收起互动' : '互动';
      panelToggle.setAttribute('aria-expanded', String(panelOpen));
      if (host) {
        host.hidden = !(run && engine && !loading);
        const touch = host.querySelector('button');
        const hasGreetings = !!characters[active].greetings?.length;
        touch.hidden = !hasGreetings;
        touch.disabled = !hasGreetings || !run || !engine || loading;
      }
      play.disabled =
        stopMotion.disabled =
        face.disabled =
        resetFace.disabled =
          !(run && engine && !loading);
      face.disabled = face.disabled || !expression.options.length;
      expression.hidden = face.hidden = resetFace.hidden = !expression.options.length;
      resetFace.disabled = resetFace.disabled || !expression.options.length;
      characterSearch.disabled = loading;
      favoritesFilter.disabled = loading;
      syncFavoriteButton();
      favoritesState.textContent = favoritesNotice || '已收藏 ' + favorites.size + ' 个角色';
      clearSearch.disabled = loading || !characterSearch.value;
      characterSelect.disabled = previewButton.disabled =
        loading || !characterSelect.options.length;
      commitButton.hidden = cancelPreview.hidden = !preview;
      commitButton.disabled = cancelPreview.disabled = loading || !engine;
      side.disabled = slider.disabled = reset.disabled = loading;
      label.textContent = characters[active].name + (preview ? ' · 预览中' : '');
      credit.textContent =
        characters[active].name +
        ' · ' +
        (characters[active].credit || '管理员导入资源') +
        ' · 来源与条款';
      credit.href =
        config.terms + (characters[active].termsAnchor ? '#' + characters[active].termsAnchor : '');
      if (engine) {
        if (run && !loading) engine.resume();
        else engine.pause();
      }
    };
    panelToggle.onclick = () => {
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
    characterSelect.onchange = syncFavoriteButton;
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
        localStorage.setItem(
          favoritesKey,
          JSON.stringify(Object.keys(characters).filter((id) => merged.has(id))),
        );
        favorites = merged;
        pendingFavorites.clear();
        favoritesNotice = '';
      } catch {
        favorites = local;
        favoritesNotice = '仅本页生效，浏览器未允许保存收藏';
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
    const cancelled = () => new DOMException('已取消加载', 'AbortError');
    const checkSignal = (signal) => {
      if (signal.aborted) throw cancelled();
    };
    const errorMessage = (error) => {
      if (error?.name === 'ResourceError') return error.message;
      return '角色资源无效，无法显示，请重试';
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
              Object.assign(new Error('运行组件启动超时，请刷新页面后重试'), {
                name: 'ResourceError',
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
            Object.assign(new Error('运行组件加载超时，请重试'), { name: 'ResourceError' }),
          ),
        15000,
      );
      let source;
      try {
        source = await new Promise((resolve, reject) => {
          const aborted = () => reject(controller.signal.reason);
          controller.signal.addEventListener('abort', aborted, { once: true });
          (async () => {
            const response = await fetch(src, { signal: controller.signal, credentials: 'omit' });
            if (!response.ok)
              throw Object.assign(
                new Error(
                  response.status === 404
                    ? '运行组件不存在，请稍后重试'
                    : '运行组件下载失败，请稍后重试',
                ),
                { name: 'ResourceError' },
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
        throw Object.assign(new Error('运行组件下载失败，请检查网络后重试'), {
          name: 'ResourceError',
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
                : Object.assign(new Error('运行组件无效，请重试'), { name: 'ResourceError' }),
            );
          tag.onerror = () =>
            finish(
              Object.assign(new Error('浏览器阻止了看板娘运行，请刷新页面后重试'), {
                name: 'ResourceError',
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
      state.textContent = '已取消加载';
    };
    const beginLoad = () => {
      const controller = new AbortController();
      loadController = controller;
      const attempt = ++loadAttempt;
      loading = true;
      loadError = '';
      state.textContent = '正在加载角色…';
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
      cancelWelcome();
      generation++;
      operation++;
      manualPending.clear();
      touchPending = false;
      engine?.destroy();
      engine = null;
    };
    const populate = () => {
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
        touch.title = '轻点打招呼';
        touch.onclick = greet;
        host.append(canvas, touch);
        document.body.append(host);
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          cancelLoad();
          failed = true;
          loadError = state.textContent = '绘图连接已中断，请重试';
          paint();
        });
        canvas.addEventListener('mascoterror', () => {
          cancelLoad();
          failed = true;
          loadError = state.textContent = '绘图失败，请重试';
          paint();
        });
      }
      canvas.setAttribute('aria-label', characters[id].name + ' 看板娘');
      host
        .querySelector('button')
        .setAttribute('aria-label', '轻点 ' + characters[id].name + ' 打招呼');
      layout();
      const candidate = await window.WZFHaruEngine.create(
        canvas,
        characters[id].root,
        config.shaders,
        characters[id],
        signal,
      );
      if (signal.aborted) {
        candidate.destroy();
        throw cancelled();
      }
      engine = candidate;
      populate();
    };
    const apply = async () => {
      if (!allowed()) cancelLoad();
      paint();
      if (!allowed() || engine || loading) return;
      const { signal, attempt } = beginLoad();
      try {
        await script(config.core, () => !!window.Live2DCubismCore, signal);
        await script(config.engine, () => !!window.WZFHaruEngine, signal);
        checkSignal(signal);
        await load(committed, signal);
        if (attempt !== loadAttempt) return;
        preview = false;
        state.textContent = '已就绪';
      } catch (error) {
        if (attempt !== loadAttempt || signal.aborted || error?.name === 'AbortError') return;
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
      const { signal, attempt } = beginLoad();
      try {
        await load(id, signal);
        if (attempt !== loadAttempt) return;
        preview = isPreview && id !== committed;
        state.textContent = preview ? '正在预览，点击“使用这个角色”才会保存' : '已返回原角色';
      } catch (error) {
        if (attempt !== loadAttempt || signal.aborted || error?.name === 'AbortError') return;
        const reason = errorMessage(error);
        try {
          await load(committed, signal);
          if (attempt !== loadAttempt) return;
          preview = false;
          state.textContent = reason + '；已返回原角色，可重试';
        } catch (fallbackError) {
          if (attempt !== loadAttempt || signal.aborted || fallbackError?.name === 'AbortError')
            return;
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
        state.textContent = '已使用 ' + characters[active].name + '，下次打开会记住';
      } catch {
        state.textContent = '浏览器未允许保存，当前预览仍可使用';
      }
      paint();
    };
    const save = () => {
      try {
        localStorage.setItem('wzfl-mascot', wanted ? 'shown' : 'hidden');
      } catch {}
    };
    agree.onclick = () => {
      accepted = true;
      try {
        localStorage.setItem('wzf-haru-terms', config.termsVersion);
      } catch {}
      wanted = true;
      save();
      consent.close();
      apply();
    };
    cancel.onclick = () => consent.close();
    button.onclick = () => {
      if (suspensions.size) return;
      if (!accepted) {
        consent.showModal();
        return;
      }
      if (failed && !loading) {
        destroy();
        host?.remove();
        host = null;
        canvas = null;
        failed = false;
        wanted = true;
      } else wanted = !wanted;
      save();
      apply();
    };
    const perform = async (type, id) => {
      if (!allowed() || !engine || loading) return;
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
      state.textContent = '正在加载…';
      try {
        const done = await target.play(type, id);
        if (n === operation && g === generation)
          state.textContent = done ? '正在预览：' + text : '已取消';
      } catch (error) {
        if (n === operation && g === generation)
          state.textContent = error?.name === 'AbortError' ? '已取消' : errorMessage(error);
      } finally {
        if (channel === interactions[type] && g === generation) manualPending.delete(type);
      }
    };
    const restore = (type) => {
      if (!allowed() || !engine || loading || (type === 'expression' && !expression.options.length))
        return;
      welcomeConsumed = true;
      cancelWelcome(type === 'expression');
      operation++;
      interactions[type]++;
      manualPending.delete(type);
      if (type === 'motion') {
        touchPending = false;
        nextTouch = 0;
        engine.idleNow();
        state.textContent = '已停止动作，恢复待机';
      } else {
        engine.resetExpression();
        state.textContent = '已恢复默认表情';
      }
    };
    play.onclick = () => perform('motion', motion.value);
    face.onclick = () => perform('expression', expression.value);
    stopMotion.onclick = () => restore('motion');
    resetFace.onclick = () => restore('expression');
    const greet = async () => {
      if (!characters[active].greetings?.length) return;
      welcomeConsumed = true;
      cancelWelcome();
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
          if (n === operation) state.textContent = characters[active].name + ' 向你打了个招呼';
        } else nextTouch = 0;
      } catch {
        if (g === generation && channel === interactions.motion) {
          nextTouch = 0;
          if (n === operation) state.textContent = '招呼暂未加载成功，可以再点一次';
        }
      } finally {
        if (g === generation && channel === interactions.motion) touchPending = false;
      }
    };
    const haruNames = {
      haru_g_idle: '安静站立（待机）',
      haru_g_m01: '双手身前·轻声回应',
      haru_g_m02: '双手背后·侧头',
      haru_g_m03: '抱臂点头',
      haru_g_m04: '抱臂侧望',
      haru_g_m05: '双臂微张',
      haru_g_m06: '托腮摊手',
      haru_g_m07: '摊手侧头',
      haru_g_m08: '合手轻摆',
      haru_g_m09: '合手眨眼',
      haru_g_m10: '展臂微笑',
      haru_g_m11: '抱臂歪头',
      haru_g_m12: '举手招呼',
      haru_g_m13: '展臂轻摆',
      haru_g_m14: '合手转展臂',
      haru_g_m15: '抱臂沉思',
      haru_g_m16: '捧脸轻笑',
      haru_g_m17: '背手微笑',
      haru_g_m18: '背手转合手',
      haru_g_m19: '低头倾听',
      haru_g_m20: '抱臂侧头',
      haru_g_m21: '展臂闭眼笑',
      haru_g_m22: '合手转背手',
      haru_g_m23: '合手轻晃',
      haru_g_m24: '转身背手',
      haru_g_m25: '背手眨眼',
      haru_g_m26: '展臂歪头',
      F01: '微笑',
      F02: '张嘴皱眉',
      F03: '不满',
      F04: '低眉',
      F05: '闭眼笑',
      F06: '惊讶',
      F07: '脸红',
      F08: '抿嘴',
    };
    const setSuspension = (source, suspended) => {
      if (suspensions.has(source) === suspended) return;
      if (suspended) {
        suspensions.add(source);
        // Opening reading UI consumes even a welcome that has not been scheduled yet.
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
        [button, panel, panelToggle, host, consent].some(
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
    desktop.addEventListener('change', apply);
    reduce.addEventListener('change', apply);
    document.addEventListener('visibilitychange', apply);
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
      panelOpen,
      suspended: suspensions.size > 0,
      suspensionSources: [...suspensions].sort(),
      touchCount,
      welcomeCount,
      welcomeConsumed,
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
