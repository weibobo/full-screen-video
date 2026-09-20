/**
 * 视频全屏助手 - content script（每个 frame 各注入一份）
 *
 * 两种模式：
 *  - web : 网页全屏，视频占满浏览器视口，浏览器窗口本身不变
 *  - full: 整个全屏，由 background 把浏览器窗口切为全屏，本脚本再把视频铺满
 *
 * 实现方式：给目标元素（优先播放器容器以保留站点控制条/弹幕，
 * 失败则直接改 video 元素；跨域 iframe 场景改 iframe 元素）
 * 强制加 position:fixed + 100vw/100vh + 最大 z-index 的内联样式。
 *
 * 防遮挡（视频不在最顶层的问题）：
 *  z-index 无法穿越层叠上下文——祖先带 opacity/contain/transform/fixed 等
 *  会把目标困在低层级里，外面低 z-index 的元素也能盖住它；站点自己的
 *  fixed 顶栏、悬浮挂件、top-layer 的 dialog 也会压在上面。
 *  进入填充后用 elementsFromPoint 采样检测遮挡，逐级升级：
 *   1) 扩展中和祖先的所有层叠上下文属性
 *   2) 隐藏与目标无关的 fixed/sticky/高 z-index 浮层
 *   3) 把目标 DOM 移动到独立的顶层挂载点（iframe 不能移，会整页重载）
 *  退出时逐条还原快照（样式 + DOM 位置），尽量不留痕迹。
 */
(() => {
  if (window.__fsvInjected) return;
  window.__fsvInjected = true;

  const MAX_Z = '2147483647';
  const HINT_ID = '__fsv_hint_host__';
  const MOUNT_ID = '__fsv_mount_host__';
  const PLAYER_HINT = /player|video|dplayer|artplayer|xgplayer|jwplayer|videojs|prism|clappr|flowplayer|shaka|mediaelement/i;

  const state = {
    active: false,
    mode: null, // 'web' | 'full'
    kind: null, // 'container' | 'video' | 'iframe'
    target: null,
    video: null,
    controlsSet: false,
    opts: { nativeControls: true, stretchFill: false },
    snapshots: [], // [{ el, cssText }]
    snapSet: new WeakSet(),
    onKey: null,
    onResize: null,
    onFsChange: null,
    mo: null,
    wasFullH: 0,
    hintTimer: 0,
    moved: false,        // 是否把目标移到了挂载点
    host: null,          // 挂载点元素
    origParent: null,    // 原父节点
    origNext: null,      // 原下一个兄弟
  };

  /* ---------------- 基础工具 ---------------- */

  function debounce(fn, ms) {
    let t = 0;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }

  function classIdString(el) {
    let s = '';
    try {
      const c = el.className;
      s += typeof c === 'string' ? c : (c && c.baseVal) || '';
    } catch (e) { /* SVG className 可能抛错 */ }
    try { s += ' ' + (el.id || ''); } catch (e) { /* ignore */ }
    return s;
  }

  // 穿透 shadow DOM 的查询
  function deepQueryAll(selector, root, out) {
    root = root || document;
    out = out || [];
    out.push.apply(out, root.querySelectorAll(selector));
    const all = root.querySelectorAll('*');
    for (const el of all) {
      if (el.shadowRoot) deepQueryAll(selector, el.shadowRoot, out);
    }
    return out;
  }

  function collectVideos() {
    try { return deepQueryAll('video'); } catch (e) { return []; }
  }

  // 页面内提示文案的多语言（content script 可用 chrome.i18n，取不到时回落英文）
  function i18nText(key, fallback) {
    try { return (chrome.i18n && chrome.i18n.getMessage(key)) || fallback; } catch (e) { return fallback; }
  }

  // 沿 DOM 向上走，能穿过 shadow root 边界（parentElement 在影子根处为 null）
  function parentOf(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    try {
      const root = node.getRootNode();
      if (root && root.host) return root.host;
    } catch (e) { /* ignore */ }
    return null;
  }

  /* ---------------- 目标选择 ---------------- */

  function videoScore(v) {
    try {
      const r = v.getBoundingClientRect();
      let s = 0;
      if (r.width >= 2 && r.height >= 2) s = r.width * r.height;
      else if (!v.paused && v.readyState >= 2) s = 100; // 隐藏但在播放
      if (!v.paused && !v.ended) s *= 5; // 正在播放的优先
      if (v.readyState >= 2) s *= 1.5;
      return s;
    } catch (e) {
      return 0;
    }
  }

  function pickVideo() {
    let best = null;
    let bestScore = 0;
    for (const v of collectVideos()) {
      const s = videoScore(v);
      if (s > bestScore) { bestScore = s; best = v; }
    }
    return bestScore > 0 ? best : null;
  }

  // 本 frame 没有 video 时，选面积最大的 iframe（视频常在跨域 iframe 里）
  function pickIframe() {
    let best = null;
    let bestArea = 0;
    for (const f of document.querySelectorAll('iframe')) {
      try {
        const r = f.getBoundingClientRect();
        if (r.width < 50 || r.height < 50) continue;
        const area = r.width * r.height;
        if (area > bestArea) { bestArea = area; best = f; }
      } catch (e) { /* ignore */ }
    }
    return best;
  }

  // 沿祖先链找"播放器容器"：class/id 命中播放器关键词的最外层祖先。
  // 命中容器而非 video 本体，可以保留站点的控制条、弹幕、字幕。
  function findContainer(video) {
    const vids = collectVideos();
    const vArea = (window.innerWidth * window.innerHeight) || 1;
    let el = parentOf(video);
    let best = null;
    let depth = 0;
    while (el && depth < 30 && el !== document.body && el !== document.documentElement) {
      if (PLAYER_HINT.test(classIdString(el))) {
        const hasOtherVideo = vids.some((v) => v !== video && el.contains(v));
        try {
          const r = el.getBoundingClientRect();
          if (!hasOtherVideo && r.width * r.height <= vArea * 1.35) best = el;
        } catch (e) { /* ignore */ }
      }
      el = parentOf(el);
      depth++;
    }
    return best;
  }

  /* ---------------- 样式套用 / 还原 ---------------- */

  function snapshot(el) {
    if (state.snapSet.has(el)) return;
    state.snapSet.add(el);
    state.snapshots.push({ el, cssText: el.style.cssText });
  }

  const FILL_PROPS = [
    ['position', 'fixed'],
    ['top', '0'],
    ['left', '0'],
    ['width', '100vw'],
    ['height', '100vh'],
    ['max-width', 'none'],
    ['max-height', 'none'],
    ['min-width', '0'],
    ['min-height', '0'],
    ['margin', '0'],
    ['padding', '0'],
    ['transform', 'none'],
    ['transition', 'none'],
    ['z-index', MAX_Z],
    ['background-color', '#000'],
    ['visibility', 'visible'],
    ['opacity', '1'],
    ['display', 'block'],
    ['border', 'none'],
    ['border-radius', '0'],
    ['box-shadow', 'none'],
    ['clip-path', 'none'],
    ['pointer-events', 'auto'],
  ];

  function applyFillProps(el, extra) {
    snapshot(el);
    for (const kv of FILL_PROPS) el.style.setProperty(kv[0], kv[1], 'important');
    if (extra) {
      for (const k of Object.keys(extra)) el.style.setProperty(k, extra[k], 'important');
    }
  }

  // 中和祖先上会"捕获" position:fixed 或创建层叠上下文的属性。
  // basic: 直接破坏 fixed 定位的；extended: 额外中和所有层叠上下文来源
  // （含 position:relative/absolute + z-index 的普通布局包裹层——
  //   它们会把目标困在低层级，让外面低 z-index 的顶栏/侧栏也能盖住视频），
  // 用于检测到目标被盖住（困在低层级）之后的升级处理。
  function neutralizeStackingBreakers(el, extended) {
    let p = parentOf(el);
    while (p) {
      let cs = null;
      try { cs = getComputedStyle(p); } catch (e) { /* ignore */ }
      if (cs) {
        const isHtmlBody = p === document.documentElement || p === document.body;
        const bad = cs.transform !== 'none' ||
          cs.perspective !== 'none' ||
          (cs.filter && cs.filter !== 'none') ||
          (typeof cs.willChange === 'string' && cs.willChange.indexOf('transform') !== -1) ||
          (extended && (
            (cs.opacity && parseFloat(cs.opacity) < 1) ||
            cs.isolation === 'isolate' ||
            (cs.mixBlendMode && cs.mixBlendMode !== 'normal') ||
            (cs.contain && cs.contain !== 'none') ||
            (cs.backdropFilter && cs.backdropFilter !== 'none') ||
            (cs.clipPath && cs.clipPath !== 'none') ||
            (cs.maskImage && cs.maskImage !== 'none') ||
            cs.transformStyle === 'preserve-3d' ||
            cs.containerType && cs.containerType !== 'normal' ||
            (!isHtmlBody && cs.zIndex !== 'auto') ||
            (!isHtmlBody && (cs.position === 'fixed' || cs.position === 'sticky'))
          ));
        if (bad) {
          snapshot(p);
          p.style.setProperty('transform', 'none', 'important');
          p.style.setProperty('perspective', 'none', 'important');
          p.style.setProperty('filter', 'none', 'important');
          p.style.setProperty('will-change', 'auto', 'important');
          if (extended) {
            p.style.setProperty('opacity', '1', 'important');
            p.style.setProperty('isolation', 'normal', 'important');
            p.style.setProperty('mix-blend-mode', 'normal', 'important');
            p.style.setProperty('contain', 'none', 'important');
            p.style.setProperty('backdrop-filter', 'none', 'important');
            p.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
            p.style.setProperty('clip-path', 'none', 'important');
            p.style.setProperty('mask-image', 'none', 'important');
            p.style.setProperty('-webkit-mask-image', 'none', 'important');
            p.style.setProperty('transform-style', 'flat', 'important');
            p.style.setProperty('container-type', 'normal', 'important');
            if (!isHtmlBody) {
              p.style.setProperty('z-index', 'auto', 'important');
              p.style.setProperty('position', 'static', 'important');
            }
          }
        }
      }
      p = parentOf(p);
    }
  }

  function rectFillsViewport(el) {
    try {
      const r = el.getBoundingClientRect();
      return Math.abs(r.left) <= 2 && Math.abs(r.top) <= 2 &&
        r.width >= window.innerWidth * 0.97 &&
        r.height >= window.innerHeight * 0.97;
    } catch (e) {
      return false;
    }
  }

  // 容器铺满后，里面的视频也应该基本铺满（否则说明选错了容器）
  function videoNearlyFillsViewport(video) {
    try {
      const r = video.getBoundingClientRect();
      return (r.width >= window.innerWidth * 0.85 && r.height >= window.innerHeight * 0.7) ||
        (r.height >= window.innerHeight * 0.85 && r.width >= window.innerWidth * 0.7);
    } catch (e) {
      return false;
    }
  }

  function lockScroll() {
    const list = [document.documentElement, document.body];
    for (const el of list) {
      if (!el) continue;
      snapshot(el);
      el.style.setProperty('overflow', 'hidden', 'important');
      el.style.setProperty('scrollbar-width', 'none', 'important');
    }
  }

  function restoreContainerOnly(c) {
    const rec = state.snapshots.find((s) => s.el === c);
    if (rec) {
      try { c.style.cssText = rec.cssText; } catch (e) { /* ignore */ }
    }
  }

  /* ---------------- 遮挡检测与升级 ---------------- */

  // 视口采样点：3x3 网格 + 上下边中点，覆盖常见站点顶栏/侧栏/底栏的位置
  const SAMPLE_XS = [0.5, 0.1, 0.5, 0.9, 0.1, 0.5, 0.9, 0.1, 0.5, 0.9, 0.5, 0.5];
  const SAMPLE_YS = [0.5, 0.1, 0.1, 0.1, 0.5, 0.5, 0.5, 0.9, 0.9, 0.9, 0.05, 0.95];

  // 用 elementsFromPoint 采样，找出真正压在最顶层的外来元素。
  // html/body 或目标的祖先/后代/我们自己的挂载点都算"没被挡"。
  // 返回该元素本身（供精确隐藏），没有则返回 null。
  function foreignTopElement() {
    const t = state.target;
    if (!t || !t.isConnected) return null;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = 0; i < SAMPLE_XS.length; i++) {
      let els;
      try { els = document.elementsFromPoint(w * SAMPLE_XS[i], h * SAMPLE_YS[i]); } catch (e) { return null; }
      if (!els || !els.length) continue;
      const top = els[0];
      if (!top || top === t || t.contains(top) || top.contains(t)) continue;
      if (top === document.documentElement || top === document.body) continue;
      if (top.id === HINT_ID || top.id === MOUNT_ID) continue;
      return top;
    }
    return null;
  }

  function isOccluded() {
    return !!foreignTopElement();
  }

  // 精确隐藏：把采样点上压在最上层的外来元素逐个隐藏，直到不遮挡。
  // 比"扫描猜测哪些元素是浮层"可靠——命中什么藏什么。
  function hideOccluders() {
    for (let round = 0; round < 24; round++) {
      const occ = foreignTopElement();
      if (!occ) return;
      snapshot(occ);
      occ.style.setProperty('visibility', 'hidden', 'important');
      occ.style.setProperty('pointer-events', 'none', 'important');
    }
  }

  // 隐藏与目标无关、可能压在上面的浮层：
  // fixed/sticky 元素、高 z-index 的 absolute 元素、top-layer 的 dialog/popover。
  function hideOverlays() {
    const t = state.target;
    if (!t) return;
    let candidates;
    try { candidates = deepQueryAll('body *'); } catch (e) { return; }
    const vpw = window.innerWidth;
    const vph = window.innerHeight;
    let hidden = 0;
    let checked = 0;

    const tryHide = (el, cs) => {
      let r;
      try { r = el.getBoundingClientRect(); } catch (e) { return; }
      if (r.width < 8 || r.height < 8) return;
      if (r.right < 0 || r.bottom < 0 || r.left > vpw || r.top > vph) return;
      snapshot(el);
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
      hidden++;
    };

    for (const el of candidates) {
      if (hidden > 300 || checked > 4000) break;
      if (!el || el === t || t.contains(el) || el.contains(t)) continue;
      if (el.id === HINT_ID || el.id === MOUNT_ID) continue;
      checked++;
      let cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const pos = cs.position;
      let isTopLayer = false;
      if (el.tagName === 'DIALOG' && el.open) isTopLayer = true;
      try { if (el.hasAttribute && el.hasAttribute('popover') && el.matches(':popover-open')) isTopLayer = true; } catch (e) { /* ignore */ }
      const highZAbs = pos === 'absolute' && parseInt(cs.zIndex, 10) >= 9000;
      if (pos !== 'fixed' && pos !== 'sticky' && !isTopLayer && !highZAbs) continue;
      tryHide(el, cs);
    }

    // 站点自己的 DOM 全屏元素也在 top layer，压不过它只能藏
    try {
      const fs = document.fullscreenElement;
      if (fs && fs !== t && !t.contains(fs) && !fs.contains(t)) {
        snapshot(fs);
        fs.style.setProperty('visibility', 'hidden', 'important');
        fs.style.setProperty('pointer-events', 'none', 'important');
      }
    } catch (e) { /* ignore */ }
  }

  // 把目标移到独立的顶层挂载点，一步跳出所有祖先层叠上下文。
  // 注意：iframe 不能移（移除会销毁 browsing context 导致整页重载）。
  function reparent() {
    const t = state.target;
    if (!t) return;
    try {
      if (!state.host || !state.host.isConnected) {
        state.host = document.createElement('div');
        state.host.id = MOUNT_ID;
        state.host.style.cssText =
          'position:fixed;top:0;left:0;width:100vw;height:100vh;' +
          'margin:0;padding:0;border:none;background:#000;z-index:' + MAX_Z + ';';
        (document.documentElement || document.body).appendChild(state.host);
      }
      if (!state.moved) {
        state.origParent = t.parentNode;
        state.origNext = t.nextSibling;
        state.moved = true;
      }
      state.host.appendChild(t);
    } catch (e) { /* ignore */ }
  }

  // 遮挡升级阶梯，每步后复测
  function ensureOnTop() {
    if (!state.active || !state.target) return;
    if (!isOccluded()) return;
    // 1) 中和祖先的全部层叠上下文来源（含 z-index 包裹层），多数遮挡在此解决
    neutralizeStackingBreakers(state.target, true);
    if (!isOccluded()) return;
    // 2) 精确隐藏采样点上压在最上层的外来元素（absolute 侧栏/顶栏等）
    hideOccluders();
    if (!isOccluded()) return;
    // 3) 广谱隐藏 fixed/sticky、高 z-index、dialog/popover 浮层
    hideOverlays();
    if (!isOccluded()) return;
    // 4) 把目标移到独立顶层挂载点（iframe 不能移——移除会销毁 browsing context）
    if (state.kind !== 'iframe') {
      reparent();
      if (isOccluded()) hideOccluders();
      if (isOccluded()) hideOverlays();
    }
  }

  /* ---------------- 进入 / 退出 ---------------- */

  function getOptions() {
    const def = { nativeControls: true, stretchFill: false };
    return chrome.storage.local.get(def)
      .then((o) => { state.opts = { nativeControls: !!o.nativeControls, stretchFill: !!o.stretchFill }; })
      .catch(() => { state.opts = { nativeControls: true, stretchFill: false }; });
  }

  // 选择目标并套样式；返回是否成功
  function retarget() {
    const video = pickVideo();
    if (video) {
      const c = findContainer(video);
      if (c) {
        applyFillProps(c);
        neutralizeStackingBreakers(c, false);
        if (rectFillsViewport(c) && videoNearlyFillsViewport(video)) {
          state.target = c;
          state.kind = 'container';
          state.video = video;
          return true;
        }
        // 容器方案失败（fixed 被破坏或选错容器）：还原后直接改视频元素
        restoreContainerOnly(c);
      }
      applyFillProps(video, { 'object-fit': state.opts.stretchFill ? 'fill' : 'contain' });
      neutralizeStackingBreakers(video, false);
      state.target = video;
      state.kind = 'video';
      state.video = video;
      if (state.opts.nativeControls && !video.controls) {
        video.controls = true;
        state.controlsSet = true;
      }
      return true;
    }
    const f = pickIframe();
    if (f) {
      applyFillProps(f);
      neutralizeStackingBreakers(f, false);
      state.target = f;
      state.kind = 'iframe';
      state.video = null;
      return true;
    }
    return false;
  }

  function enter(mode) {
    const run = () => {
      if (state.active) {
        state.mode = mode; // 已激活时只切换模式标签
        return Promise.resolve(getStatus());
      }
      if (!retarget()) return Promise.resolve(getStatus()); // 什么都没找到
      state.active = true;
      state.mode = mode;
      lockScroll();
      hookEvents();
      startObserver();
      state.wasFullH = window.outerHeight || 0;
      showHint(mode === 'full'
        ? i18nText('hintFullFull', 'Fullscreen · Esc to exit')
        : i18nText('hintWebFull', 'Web fullscreen · Esc to exit'));
      // 样式生效后做遮挡检测与升级
      requestAnimationFrame(() => setTimeout(() => {
        if (state.active) runQuietly(ensureOnTop);
      }, 80));
      if (mode === 'full' && window === window.top) {
        // 兜底：若 background 的窗口全屏没生效，尝试页面级全屏（多数情况会被手势检查拒绝）
        setTimeout(() => {
          if (!state.active || state.mode !== 'full') return;
          const sh = screen.availHeight || screen.height;
          if ((window.outerHeight || 0) < sh - 40 && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => { /* 无手势时会被拒绝，忽略 */ });
          }
        }, 400);
      }
      return Promise.resolve(getStatus());
    };
    return getOptions().then(run);
  }

  // notify=true 表示由用户按键等"自发"退出，需要 background 同步其它 frame 和窗口状态
  function exitFill(notify) {
    if (!state.active) return getStatus();
    const wasMode = state.mode;
    unhookEvents();
    stopObserver();
    hideHint();
    // 先还原 DOM 位置，再还原样式快照
    if (state.moved && state.target) {
      try {
        if (state.origParent && state.origParent.isConnected) {
          const next = state.origNext && state.origNext.isConnected ? state.origNext : null;
          state.origParent.insertBefore(state.target, next);
        } else {
          // 原父容器已被站点移除，兜底挂回 body，避免视频被连着挂载点一起摘掉
          (document.body || document.documentElement).appendChild(state.target);
        }
      } catch (e) { /* ignore */ }
    }
    if (state.host && state.host.parentNode) {
      try { state.host.parentNode.removeChild(state.host); } catch (e) { /* ignore */ }
    }
    state.moved = false;
    state.host = null;
    state.origParent = null;
    state.origNext = null;
    if (state.controlsSet && state.video) {
      try { state.video.controls = false; } catch (e) { /* ignore */ }
    }
    for (let i = state.snapshots.length - 1; i >= 0; i--) {
      const rec = state.snapshots[i];
      try { if (rec.el) rec.el.style.cssText = rec.cssText; } catch (e) { /* ignore */ }
    }
    state.snapshots = [];
    state.snapSet = new WeakSet();
    state.active = false;
    state.mode = null;
    state.kind = null;
    state.target = null;
    state.video = null;
    state.controlsSet = false;
    if (notify && wasMode) {
      try {
        chrome.runtime.sendMessage({ type: 'fsv-esc-exited', mode: wasMode }).catch(() => { /* ignore */ });
      } catch (e) { /* ignore */ }
    }
    return getStatus();
  }

  /* ---------------- 事件与观察器 ---------------- */

  function hookEvents() {
    state.onKey = (e) => {
      if (e.key === 'Escape' && state.active) exitFill(true);
    };
    window.addEventListener('keydown', state.onKey, true);

    state.onFsChange = () => {
      // 整个全屏模式下，DOM 全屏被退出（Esc）时同步退出填充
      if (state.active && state.mode === 'full' && !document.fullscreenElement) exitFill(true);
    };
    document.addEventListener('fullscreenchange', state.onFsChange);

    state.onResize = debounce(() => {
      if (!state.active) return;
      if (state.mode === 'full') {
        const sh = screen.availHeight || screen.height;
        const oh = window.outerHeight || 0;
        if (state.wasFullH >= sh - 4 && oh < sh - 40) {
          // 浏览器窗口离开了全屏（如用户按了 F11）
          exitFill(true);
          return;
        }
        state.wasFullH = oh;
      }
      runQuietly(reassert);
    }, 300);
    window.addEventListener('resize', state.onResize);
  }

  function unhookEvents() {
    if (state.onKey) { window.removeEventListener('keydown', state.onKey, true); state.onKey = null; }
    if (state.onFsChange) { document.removeEventListener('fullscreenchange', state.onFsChange); state.onFsChange = null; }
    if (state.onResize) { window.removeEventListener('resize', state.onResize); state.onResize = null; }
  }

  const OBS_CFG = { childList: true, subtree: true, attributes: true };

  function startObserver() {
    state.mo = new MutationObserver(debounce(() => {
      if (state.active) runQuietly(reassert);
    }, 300));
    state.mo.observe(document.documentElement || document, OBS_CFG);
  }

  function stopObserver() {
    if (state.mo) { state.mo.disconnect(); state.mo = null; }
  }

  // 站点 JS 可能持续改写样式、换掉 video 元素、把目标挪回去，
  // 或者中途弹出新的浮层盖住视频——定期重申样式并复查遮挡。
  function reassert() {
    if (!state.active) return;
    if (state.target && state.target.isConnected) {
      if (state.moved && state.host && !state.host.contains(state.target)) {
        // 站点把目标挪回去了，重新挂载
        try { state.host.appendChild(state.target); } catch (e) { /* ignore */ }
      }
      if (state.kind === 'video') {
        applyFillProps(state.target, { 'object-fit': state.opts.stretchFill ? 'fill' : 'contain' });
        if (state.controlsSet && state.video) state.video.controls = true;
      } else {
        applyFillProps(state.target);
      }
      lockScroll();
      if (isOccluded()) ensureOnTop();
    } else if (!retarget()) {
      exitFill(false);
    }
  }

  // 在观察器暂停的保护下执行（避免我们自己的改动再触发它）
  function runQuietly(fn) {
    const mo = state.mo;
    if (mo) mo.disconnect();
    try {
      fn();
    } finally {
      if (mo && state.active) mo.observe(document.documentElement || document, OBS_CFG);
    }
  }

  /* ---------------- 提示气泡 ---------------- */

  function showHint(text) {
    try {
      const host = document.createElement('div');
      host.id = HINT_ID;
      host.style.cssText = 'all:initial;' + [
        'position:fixed', 'right:16px', 'bottom:16px', 'z-index:' + (Number(MAX_Z) - 1),
        'margin:0', 'padding:0', 'border:none', 'background:none', 'pointer-events:none',
      ].join(';') + ';';
      const root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : null;
      const box = document.createElement('div');
      box.textContent = text;
      box.style.cssText = [
        'font:12px/1.4 system-ui,sans-serif', 'color:#f8fafc', 'background:rgba(15,23,42,.85)',
        'padding:6px 10px', 'border-radius:8px', 'max-width:60vw',
      ].join(';');
      if (root) root.appendChild(box); else host.appendChild(box);
      (document.body || document.documentElement).appendChild(host);
      state.hintTimer = setTimeout(() => hideHint(), 2600);
    } catch (e) { /* ignore */ }
  }

  function hideHint() {
    clearTimeout(state.hintTimer);
    state.hintTimer = 0;
    const host = document.getElementById(HINT_ID);
    if (host && host.parentNode) host.parentNode.removeChild(host);
  }

  /* ---------------- 状态与消息 ---------------- */

  function getStatus() {
    let videos = 0;
    try { videos = collectVideos().length; } catch (e) { /* ignore */ }
    return {
      ok: true,
      active: state.active,
      mode: state.mode,
      kind: state.kind,
      videos: videos,
      isTop: window === window.top,
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'ping':
        sendResponse({ ok: true });
        return;
      case 'status':
        sendResponse(getStatus());
        return;
      case 'enter':
        enter(msg.mode === 'full' ? 'full' : 'web')
          .then(sendResponse)
          .catch(() => sendResponse(getStatus()));
        return true;
      case 'exit':
        sendResponse(exitFill(false));
        return;
      case 'toggle':
        if (state.active) {
          if (state.mode === msg.mode) sendResponse(exitFill(false));
          else { state.mode = msg.mode; sendResponse(getStatus()); }
        } else {
          enter(msg.mode === 'full' ? 'full' : 'web')
            .then(sendResponse)
            .catch(() => sendResponse(getStatus()));
        }
        return true;
    }
  });
})();
