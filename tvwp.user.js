// ==UserScript==
// @name         TV Wallpaper
// @namespace    tvwp
// @version      2.0.0
// @description  Wallpapers (including animated GIFs) and custom candle colors for TradingView charts. Purely visual, local to your device.
// @match        https://*.tradingview.com/*
// @run-at       document-start
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/antoniog06/tv-wallpaper/main/tvwp.user.js
// @downloadURL  https://raw.githubusercontent.com/antoniog06/tv-wallpaper/main/tvwp.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (window.__tvwpLoaded) return;
  const VERSION = '2.0.0';
  window.__tvwpLoaded = VERSION;

  /* =========================================================
   * Settings (localStorage, synced across tabs)
   * ======================================================= */
  const DEFAULTS = {
    wall: { enabled: true, opacity: 0.55, blend: 'lighten', fit: 'cover', currentId: null },
    candles: {
      enabled: false, up: '#00ff9c', upA: 1, down: '#ff2e88', downA: 1,
      separate: false, borderUp: '#00ff9c', borderDown: '#ff2e88', wickUp: '#00ff9c', wickDown: '#ff2e88',
      volume: true
    },
    ui: { x: null, y: null, tab: 'wall' }
  };
  function readSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('tvwp_settings') || '{}');
      return {
        wall: { ...DEFAULTS.wall, ...s.wall },
        candles: { ...DEFAULTS.candles, ...s.candles },
        ui: { ...DEFAULTS.ui, ...s.ui }
      };
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  }
  let S = readSettings();
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('tvwp') : null;
  function save(part) {
    try { localStorage.setItem('tvwp_settings', JSON.stringify(S)); } catch (e) {}
    if (part) bc && bc.postMessage({ type: part });
  }

  /* =========================================================
   * Candle colors: swap colors as the chart draws them
   * ======================================================= */
  function parseColor(v) {
    if (typeof v !== 'string') return null;
    const s = v.trim().toLowerCase();
    if (s[0] === '#') {
      let h = s.slice(1);
      if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
      if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) return null;
      const n = parseInt(h.slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
    }
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
    if (!m) return null;
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), a];
  }

  const DEFAULT_UP = ['#089981', '#26a69a', '#22ab94'];
  const DEFAULT_DOWN = ['#f23645', '#ef5350', '#f7525f'];
  let lookup = null;           // Map "r,g,b" -> { t: [r,g,b,a], srcA }
  const cache = new Map();
  let detected = {};

  function translate(v) {
    if (!lookup || typeof v !== 'string') return v;
    let out = cache.get(v);
    if (out !== undefined) return out;
    out = v;
    const p = parseColor(v);
    if (p) {
      const e = lookup.get(p[0] + ',' + p[1] + ',' + p[2]);
      if (e) {
        const ratio = e.srcA > 0 ? p[3] / e.srcA : 1;
        // ratio well below 1 = a faded copy of the candle color, i.e. volume bars
        if (S.candles.volume || ratio > 0.95) {
          const a = Math.min(1, Math.round(e.t[3] * ratio * 1000) / 1000);
          out = `rgba(${e.t[0]},${e.t[1]},${e.t[2]},${a})`;
        }
      }
    }
    if (cache.size > 4000) cache.clear();
    cache.set(v, out);
    return out;
  }

  // Remember the color the chart asked for, so text (drawings, labels) can keep it.
  const original = { fillStyle: new WeakMap(), strokeStyle: new WeakMap() };
  for (const C of [window.CanvasRenderingContext2D, window.OffscreenCanvasRenderingContext2D]) {
    if (!C) continue;
    const setters = {};
    for (const prop of ['fillStyle', 'strokeStyle', 'shadowColor']) {
      const d = Object.getOwnPropertyDescriptor(C.prototype, prop);
      if (!d || !d.set) continue;
      setters[prop] = d.set;
      Object.defineProperty(C.prototype, prop, {
        configurable: true, enumerable: d.enumerable, get: d.get,
        set(v) {
          if (original[prop]) original[prop].set(this, v);
          d.set.call(this, translate(v));
        }
      });
    }
    // Keep the remembered colors in step with save()/restore().
    const stacks = new WeakMap();
    const save0 = C.prototype.save, restore0 = C.prototype.restore;
    C.prototype.save = function () {
      let st = stacks.get(this);
      if (!st) stacks.set(this, st = []);
      st.push([original.fillStyle.get(this), original.strokeStyle.get(this)]);
      return save0.call(this);
    };
    C.prototype.restore = function () {
      const st = stacks.get(this);
      const top = st && st.pop();
      if (top) {
        top[0] === undefined ? original.fillStyle.delete(this) : original.fillStyle.set(this, top[0]);
        top[1] === undefined ? original.strokeStyle.delete(this) : original.strokeStyle.set(this, top[1]);
      }
      return restore0.call(this);
    };
    for (const [fn, prop] of [['fillText', 'fillStyle'], ['strokeText', 'strokeStyle']]) {
      const draw = C.prototype[fn];
      const rawSet = setters[prop];
      if (!draw || !rawSet) continue;
      C.prototype[fn] = function (...args) {
        const o = lookup && original[prop].get(this);
        if (typeof o !== 'string' || translate(o) === o) return draw.apply(this, args);
        const cur = this[prop];
        rawSet.call(this, o);
        try { return draw.apply(this, args); } finally { rawSet.call(this, cur); }
      };
    }
  }
  if (window.CanvasGradient) {
    const add = CanvasGradient.prototype.addColorStop;
    CanvasGradient.prototype.addColorStop = function (o, c) { return add.call(this, o, translate(c)); };
  }

  function chartWidget() {
    try { return window.TradingViewApi._activeChartWidgetWV.value()._chartWidget; } catch (e) { return null; }
  }

  // Reads (never writes) the candle colors set in your TradingView chart settings.
  function detectSources() {
    const out = {};
    try {
      const st = chartWidget().model().mainSeries().properties().childs().candleStyle.state();
      for (const k of ['upColor', 'downColor', 'borderUpColor', 'borderDownColor', 'wickUpColor', 'wickDownColor']) {
        if (st[k]) out[k] = st[k];
      }
    } catch (e) {}
    return out;
  }

  function rebuildLookup() {
    cache.clear();
    const c = S.candles;
    if (!c.enabled) { lookup = null; return; }
    const tgt = (hex, a) => { const p = parseColor(hex); return p ? [p[0], p[1], p[2], a ?? 1] : null; };
    const body = { up: tgt(c.up, c.upA), down: tgt(c.down, c.downA) };
    const border = { up: c.separate ? tgt(c.borderUp, c.upA) : body.up, down: c.separate ? tgt(c.borderDown, c.downA) : body.down };
    const wick = { up: c.separate ? tgt(c.wickUp, c.upA) : body.up, down: c.separate ? tgt(c.wickDown, c.downA) : body.down };
    const m = new Map();
    const add = (src, t) => { const p = parseColor(src); if (p && t) m.set(p[0] + ',' + p[1] + ',' + p[2], { t, srcA: p[3] }); };
    DEFAULT_UP.forEach(h => add(h, body.up));
    DEFAULT_DOWN.forEach(h => add(h, body.down));
    const d = detected;
    add(d.wickUpColor, wick.up); add(d.wickDownColor, wick.down);
    add(d.borderUpColor, border.up); add(d.borderDownColor, border.down);
    add(d.upColor, body.up); add(d.downColor, body.down);
    lookup = m.size ? m : null;
  }

  function redraw() {
    const el = document.querySelector('.layout__area--center');
    if (!el) return;
    const prev = el.style.width;
    el.style.width = (el.offsetWidth - 1) + 'px';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.width = prev;
      window.dispatchEvent(new Event('resize'));
    }));
  }

  function applyCandles() {
    const d = detectSources();
    if (Object.keys(d).length) detected = d;
    rebuildLookup();
    redraw();
  }

  // Wait for the chart to be ready, then pick up your candle colors.
  (function waitForChart(tries) {
    const d = detectSources();
    if (Object.keys(d).length) { detected = d; rebuildLookup(); if (S.candles.enabled) redraw(); return; }
    rebuildLookup();
    if (tries < 90) setTimeout(() => waitForChart(tries + 1), 1000);
  })(0);

  /* =========================================================
   * Wallpaper storage (IndexedDB)
   * ======================================================= */
  const DB = {
    _db: null,
    open() {
      return this._db || (this._db = new Promise((res, rej) => {
        const r = indexedDB.open('tvwp', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('wallpapers', { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }));
    },
    async run(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction('wallpapers', mode);
        const req = fn(t.objectStore('wallpapers'));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    },
    all() { return this.run('readonly', s => s.getAll()); },
    get(id) { return this.run('readonly', s => s.get(id)); },
    put(w) { return this.run('readwrite', s => s.put(w)); },
    del(id) { return this.run('readwrite', s => s.delete(id)); }
  };

  /* =========================================================
   * Wallpaper rendering
   * ======================================================= */
  const LAYER = 'tvwp-layer';
  let source = null, sourceId = null, loadToken = 0, animToken = 0, scheduled = false;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const resizeObs = new ResizeObserver(() => schedule());
  const watched = new WeakSet();

  async function decode(blob) {
    const type = blob.type;
    if ('ImageDecoder' in window && /^image\/(gif|webp|png|apng|avif)$/.test(type)) {
      let ok = false;
      try { ok = await ImageDecoder.isTypeSupported(type); } catch (e) {}
      if (ok) {
        const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type });
        await decoder.tracks.ready;
        await decoder.completed;
        const track = decoder.tracks.selectedTrack;
        if (track && track.frameCount > 1) return { kind: 'anim', decoder, count: track.frameCount, frame: null };
        const { image } = await decoder.decode({ frameIndex: 0 });
        const bmp = await createImageBitmap(image);
        image.close(); decoder.close();
        return { kind: 'static', image: bmp };
      }
    }
    return { kind: 'static', image: await createImageBitmap(blob) };
  }

  function dispose(src) {
    if (!src) return;
    try {
      if (src.kind === 'static') src.image.close();
      else { if (src.frame) src.frame.close(); src.decoder.close(); }
    } catch (e) {}
  }

  function setSource(src, id) {
    animToken++;
    dispose(source);
    source = src; sourceId = id;
    document.querySelectorAll('canvas.' + LAYER).forEach(c => delete c.dataset.key);
    if (src && src.kind === 'anim') runAnimation(src, animToken);
    schedule();
  }

  async function loadWallpaper() {
    const token = ++loadToken;
    const id = S.wall.currentId;
    if (!id) { setSource(null, null); return; }
    if (id === sourceId) return;
    try {
      const wp = await DB.get(id);
      if (token !== loadToken) return;
      if (!wp) { setSource(null, null); return; }
      const src = await decode(wp.blob);
      if (token !== loadToken) { dispose(src); return; }
      setSource(src, id);
    } catch (e) {
      console.warn('[TV Wallpaper] could not load wallpaper', e);
      setSource(null, null);
    }
  }

  async function runAnimation(src, token) {
    let i = 0;
    while (token === animToken) {
      if (document.hidden || !S.wall.enabled || !document.querySelector('canvas.' + LAYER)) { await sleep(300); continue; }
      const t0 = performance.now();
      let image;
      try { ({ image } = await src.decoder.decode({ frameIndex: i })); }
      catch (e) { i = 0; await sleep(100); continue; }
      if (token !== animToken) { image.close(); return; }
      if (src.frame) src.frame.close();
      src.frame = image;
      document.querySelectorAll('canvas.' + LAYER).forEach(cv => drawInto(cv, true));
      let ms = (image.duration || 0) / 1000;
      if (ms <= 10) ms = 100;
      i = (i + 1) % src.count;
      await sleep(Math.max(0, ms - (performance.now() - t0)));
    }
  }

  function containers() {
    const vis = el => el.clientWidth > 80 && el.clientHeight > 60;
    for (const sel of ['.chart-container', '.chart-markup-table', '.chart-gui-wrapper']) {
      const list = [...document.querySelectorAll(sel)].filter(vis);
      if (list.length) return list;
    }
    return [];
  }

  function ensureLayer(container) {
    let cv = container.querySelector(':scope > canvas.' + LAYER);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.className = LAYER;
      Object.assign(cv.style, {
        position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: '50'
      });
      if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
      container.appendChild(cv);
    } else if (cv !== container.lastElementChild) {
      container.appendChild(cv);
    }
    if (!watched.has(container)) { watched.add(container); resizeObs.observe(container); }
    return cv;
  }

  function drawInto(cv, force) {
    const parent = cv.parentElement;
    if (!parent) return;
    cv.style.opacity = String(S.wall.opacity);
    cv.style.mixBlendMode = S.wall.blend;
    const img = source && (source.kind === 'static' ? source.image : source.frame);
    if (!img) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(parent.clientWidth * dpr));
    const H = Math.max(1, Math.round(parent.clientHeight * dpr));
    const key = `${sourceId}|${W}x${H}|${S.wall.fit}`;
    if (!force && cv.dataset.key === key) return;
    cv.dataset.key = key;
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const iw = img.displayWidth || img.width, ih = img.displayHeight || img.height;
    let dw = W, dh = H, dx = 0, dy = 0;
    if (S.wall.fit !== 'stretch') {
      const sc = S.wall.fit === 'contain' ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih);
      dw = iw * sc; dh = ih * sc; dx = (W - dw) / 2; dy = (H - dh) / 2;
    }
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  function renderAll() {
    scheduled = false;
    if (!S.wall.enabled || !source) {
      document.querySelectorAll('canvas.' + LAYER).forEach(c => c.remove());
      return;
    }
    for (const c of containers()) drawInto(ensureLayer(c), false);
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(renderAll);
  }
  function refreshWall() {
    document.querySelectorAll('canvas.' + LAYER).forEach(c => delete c.dataset.key);
    schedule();
  }

  /* =========================================================
   * Adding images
   * ======================================================= */
  const MAX_SIDE = 2560, THUMB = 200, MAX_ANIM = 50e6;

  function toCanvas(bmp, maxSide) {
    const sc = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * sc));
    c.height = Math.max(1, Math.round(bmp.height * sc));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }
  async function frameCount(file) {
    if (!('ImageDecoder' in window) || !/^image\/(gif|webp|png|apng|avif)$/.test(file.type)) return 1;
    try {
      if (!(await ImageDecoder.isTypeSupported(file.type))) return 1;
      const d = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
      await d.tracks.ready; await d.completed;
      const n = (d.tracks.selectedTrack && d.tracks.selectedTrack.frameCount) || 1;
      d.close();
      return n;
    } catch (e) { return 1; }
  }
  async function addFiles(files) {
    const problems = [];
    let lastId = null;
    for (const f of files) {
      try {
        const bmp = await createImageBitmap(f);
        const thumb = toCanvas(bmp, THUMB).toDataURL('image/jpeg', 0.8);
        const animated = (await frameCount(f)) > 1;
        let blob;
        if (animated) {
          if (f.size > MAX_ANIM) { problems.push(`${f.name} is over 50 MB`); bmp.close(); continue; }
          blob = f;
        } else {
          blob = await new Promise(r => toCanvas(bmp, MAX_SIDE).toBlob(r, 'image/jpeg', 0.9));
        }
        bmp.close();
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        await DB.put({ id, blob, thumb, animated, added: Date.now() });
        lastId = id;
      } catch (e) {
        problems.push(`Couldn't add ${f.name}`);
      }
    }
    if (lastId) {
      S.wall.currentId = lastId;
      S.wall.enabled = true;
      save('wall');
      loadWallpaper();
    }
    bc && bc.postMessage({ type: 'list' });
    return problems;
  }

  /* =========================================================
   * On-chart settings panel
   * ======================================================= */
  const PRESETS = [
    ['Neon', '#00ff9c', '#ff2e88'], ['Ice & Fire', '#00b7ff', '#ff6a00'],
    ['Gold & Purple', '#ffd700', '#9b5cff'], ['Blue & Red', '#2962ff', '#ff1744'],
    ['Mono', '#e0e3eb', '#5d606b'], ['Classic', '#26a69a', '#ef5350']
  ];

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, system-ui, "Segoe UI", sans-serif; }
  .fab { position: fixed; z-index: 2147483000; width: 36px; height: 36px; border-radius: 50%;
    background: #2962ff; color: #fff; border: none; cursor: grab; display: grid; place-items: center;
    box-shadow: 0 2px 10px rgba(0,0,0,.45); touch-action: none; user-select: none; }
  .fab:active { cursor: grabbing; }
  .fab svg { width: 18px; height: 18px; pointer-events: none; }
  .panel { position: fixed; z-index: 2147483001; width: 330px; max-height: 80vh; overflow: auto;
    background: #131722; color: #d1d4dc; border: 1px solid #2a2e39; border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,.55); font-size: 13px; line-height: 1.4; display: none; }
  .panel.open { display: block; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #2a2e39; }
  h1 { font-size: 14px; margin: 0; font-weight: 600; }
  .x { background: none; border: none; color: #787b86; font-size: 18px; cursor: pointer; line-height: 1; }
  .tabs { display: flex; border-bottom: 1px solid #2a2e39; }
  .tabs button { flex: 1; padding: 9px; background: none; border: none; border-bottom: 2px solid transparent; color: #787b86; font: inherit; cursor: pointer; }
  .tabs button.on { color: #d1d4dc; border-bottom-color: #2962ff; }
  section { padding: 12px 14px; display: none; gap: 12px; }
  section.on { display: grid; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .thumb { position: relative; aspect-ratio: 16/10; border-radius: 6px; overflow: hidden; border: 2px solid transparent; cursor: pointer; background: #1e222d; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb.active { border-color: #2962ff; }
  .tag { position: absolute; left: 3px; bottom: 3px; background: rgba(0,0,0,.7); color: #fff; font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 3px; }
  .del { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border: none; border-radius: 50%; background: rgba(0,0,0,.7); color: #fff; font-size: 12px; line-height: 18px; cursor: pointer; display: none; padding: 0; }
  .thumb:hover .del { display: block; }
  .empty { color: #787b86; grid-column: 1/-1; text-align: center; padding: 14px 0; border: 1px dashed #2a2e39; border-radius: 6px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .between { justify-content: space-between; }
  .btn { flex: 1; text-align: center; padding: 8px; border-radius: 6px; border: 1px solid #2a2e39; background: #1e222d; color: #d1d4dc; cursor: pointer; font: inherit; }
  .btn.primary { background: #2962ff; border-color: #2962ff; color: #fff; }
  .field { display: grid; gap: 4px; }
  .field > span { color: #787b86; font-size: 12px; }
  select, input[type=range] { width: 100%; }
  select, input[type=number], input[type=text] { background: #1e222d; color: #d1d4dc; border: 1px solid #2a2e39; border-radius: 6px; padding: 6px; font: inherit; }
  label.sw { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .hint { color: #787b86; font-size: 11px; }
  .msg { font-size: 12px; color: #f7a600; }
  .msg:empty { display: none; }
  .side { display: grid; gap: 8px; padding: 10px; border: 1px solid #2a2e39; border-radius: 8px; background: #1e222d; }
  .side-head { display: flex; align-items: center; justify-content: space-between; font-weight: 600; }
  input[type=color] { width: 44px; height: 28px; padding: 0; border: 1px solid #2a2e39; border-radius: 6px; background: none; cursor: pointer; }
  .rgb { display: grid; grid-template-columns: repeat(3, 1fr) 1.4fr; gap: 6px; }
  .rgb label { display: grid; gap: 2px; font-size: 11px; color: #787b86; }
  .rgb input { width: 100%; padding: 5px; }
  .extra { display: none; gap: 6px; grid-template-columns: 1fr 1fr; }
  .extra.on { display: grid; }
  .extra label { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #787b86; gap: 6px; }
  .presets { display: flex; flex-wrap: wrap; gap: 6px; }
  .preset { display: flex; align-items: center; gap: 5px; padding: 5px 8px; border: 1px solid #2a2e39; border-radius: 20px; background: #1e222d; color: #d1d4dc; font: inherit; font-size: 12px; cursor: pointer; }
  .preset i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .detected { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
  .detected i { width: 12px; height: 12px; border-radius: 2px; display: inline-block; border: 1px solid #2a2e39; }
  `;

  const SIDE_HTML = side => `
    <div class="side" data-side="${side}">
      <div class="side-head"><span>${side === 'up' ? 'Up' : 'Down'} candles</span><input type="color" class="main"></div>
      <div class="rgb">
        <label>R<input type="number" min="0" max="255" data-ch="0"></label>
        <label>G<input type="number" min="0" max="255" data-ch="1"></label>
        <label>B<input type="number" min="0" max="255" data-ch="2"></label>
        <label>Hex<input type="text" class="hex" maxlength="7" spellcheck="false"></label>
      </div>
      <div class="field"><span>Opacity <b class="aVal"></b></span><input type="range" class="alpha" min="0.1" max="1" step="0.05"></div>
      <div class="extra">
        <label>Border <input type="color" class="border"></label>
        <label>Wick <input type="color" class="wick"></label>
      </div>
    </div>`;

  const HTML = `
  <button class="fab" title="TV Wallpaper (Alt+Shift+W)">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
  </button>
  <div class="panel">
    <header><h1>TV Wallpaper <span class="hint">v${VERSION}</span></h1><button class="x" title="Close">×</button></header>
    <div class="tabs"><button data-tab="wall">Wallpaper</button><button data-tab="candles">Candles</button></div>
    <section data-tab="wall">
      <div class="row between"><span class="hint">Images, GIFs, animated WebP</span><label class="sw"><input type="checkbox" id="wEnabled"> On</label></div>
      <div class="grid" id="grid"></div>
      <div class="msg" id="wMsg"></div>
      <div class="row">
        <label class="btn">Add images / GIFs<input type="file" id="file" accept="image/*" multiple hidden></label>
        <button class="btn primary" id="next">Next wallpaper</button>
      </div>
      <div class="field"><span>Strength <b id="opVal"></b></span><input type="range" id="opacity" min="0.05" max="1" step="0.05"></div>
      <div class="field"><span>Chart theme / blend</span>
        <select id="blend">
          <option value="lighten">Dark theme – subtle (lighten)</option>
          <option value="screen">Dark theme – vivid (screen)</option>
          <option value="darken">Light theme – subtle (darken)</option>
          <option value="multiply">Light theme – vivid (multiply)</option>
        </select></div>
      <div class="field"><span>Fit</span>
        <select id="fit">
          <option value="cover">Fill (crop)</option>
          <option value="contain">Fit (letterbox)</option>
          <option value="stretch">Stretch</option>
        </select></div>
    </section>
    <section data-tab="candles">
      <div class="row between"><span class="hint">Only changes what you see</span><label class="sw"><input type="checkbox" id="cEnabled"> On</label></div>
      <div class="presets" id="presets"></div>
      ${SIDE_HTML('up')}
      ${SIDE_HTML('down')}
      <label class="sw"><input type="checkbox" id="cSeparate"> Separate border &amp; wick colors</label>
      <label class="sw"><input type="checkbox" id="cVolume"> Also recolor volume bars</label>
      <div class="field"><span>Your chart's current colors (replaced)</span><div class="detected" id="detected"></div></div>
      <div class="row"><button class="btn" id="redetect">Re-detect colors</button><button class="btn" id="cReset">Turn off</button></div>
    </section>
  </div>`;

  function buildUI() {
    if (document.getElementById('tvwp-host')) return;
    const host = document.createElement('div');
    host.id = 'tvwp-host';
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>${HTML}`;
    const $ = sel => root.querySelector(sel);
    const fab = $('.fab'), panel = $('.panel');

    /* ---- floating button: drag to move, click to open ---- */
    function placeFab() {
      const x = S.ui.x ?? 60, y = S.ui.y ?? (window.innerHeight - 130);
      const cx = Math.min(Math.max(4, x), window.innerWidth - 40);
      const cy = Math.min(Math.max(4, y), window.innerHeight - 40);
      fab.style.left = cx + 'px';
      fab.style.top = cy + 'px';
      return [cx, cy];
    }
    function placePanel() {
      const [x, y] = placeFab();
      const pw = 330, ph = Math.min(panel.scrollHeight || 560, window.innerHeight * 0.8);
      let left = x + 46;
      if (left + pw > window.innerWidth - 8) left = x - pw - 10;
      left = Math.max(8, left);
      let top = Math.min(y, window.innerHeight - ph - 8);
      top = Math.max(8, top);
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
    }
    let drag = null;
    fab.addEventListener('pointerdown', e => {
      drag = { sx: e.clientX, sy: e.clientY, ox: fab.offsetLeft, oy: fab.offsetTop, moved: false };
      fab.setPointerCapture(e.pointerId);
    });
    fab.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) {
        S.ui.x = drag.ox + dx; S.ui.y = drag.oy + dy;
        placeFab();
        if (panel.classList.contains('open')) placePanel();
      }
    });
    fab.addEventListener('pointerup', () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      if (moved) save(null);
      else toggle();
    });
    function toggle(force) {
      const open = force ?? !panel.classList.contains('open');
      panel.classList.toggle('open', open);
      if (open) { renderAllUI(); placePanel(); }
    }
    $('.x').onclick = () => toggle(false);
    window.addEventListener('keydown', e => {
      if (e.altKey && e.shiftKey && (e.key === 'W' || e.key === 'w')) { e.preventDefault(); toggle(); }
    }, true);
    window.addEventListener('resize', () => { placeFab(); if (panel.classList.contains('open')) placePanel(); });
    placeFab();

    /* ---- tabs ---- */
    function showTab(t) {
      root.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
      root.querySelectorAll('section').forEach(s => s.classList.toggle('on', s.dataset.tab === t));
    }
    root.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
      S.ui.tab = b.dataset.tab; save(null); showTab(b.dataset.tab); placePanel();
    });

    /* ---- wallpaper tab ---- */
    async function renderGrid() {
      const grid = $('#grid');
      let list = [];
      try { list = (await DB.all()).sort((a, b) => a.added - b.added); } catch (e) {}
      grid.innerHTML = '';
      if (!list.length) { grid.innerHTML = '<div class="empty">No wallpapers yet — add some images or GIFs</div>'; return; }
      for (const w of list) {
        const d = document.createElement('div');
        d.className = 'thumb' + (w.id === S.wall.currentId ? ' active' : '');
        const img = document.createElement('img');
        img.src = w.thumb;
        d.appendChild(img);
        if (w.animated) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'GIF'; d.appendChild(t); }
        const del = document.createElement('button');
        del.className = 'del'; del.title = 'Remove'; del.textContent = '×';
        d.appendChild(del);
        d.onclick = () => { S.wall.currentId = w.id; S.wall.enabled = true; save('wall'); loadWallpaper(); renderWallUI(); };
        del.onclick = async e => {
          e.stopPropagation();
          await DB.del(w.id);
          if (S.wall.currentId === w.id) {
            const rest = list.filter(x => x.id !== w.id);
            S.wall.currentId = rest.length ? rest[0].id : null;
            save('wall'); loadWallpaper();
          }
          bc && bc.postMessage({ type: 'list' });
          renderWallUI();
        };
        grid.appendChild(d);
      }
    }
    function renderWallUI() {
      $('#wEnabled').checked = S.wall.enabled;
      $('#opacity').value = S.wall.opacity;
      $('#opVal').textContent = Math.round(S.wall.opacity * 100) + '%';
      $('#blend').value = S.wall.blend;
      $('#fit').value = S.wall.fit;
      renderGrid();
    }
    $('#file').onchange = async e => {
      const files = [...e.target.files];
      e.target.value = '';
      if (!files.length) return;
      $('#wMsg').textContent = 'Adding…';
      const problems = await addFiles(files);
      $('#wMsg').textContent = problems.join(' · ');
      renderWallUI();
    };
    $('#next').onclick = async () => {
      const list = (await DB.all()).sort((a, b) => a.added - b.added);
      if (!list.length) return;
      const i = list.findIndex(w => w.id === S.wall.currentId);
      S.wall.currentId = list[(i + 1) % list.length].id;
      S.wall.enabled = true;
      save('wall'); loadWallpaper(); renderWallUI();
    };
    $('#wEnabled').onchange = e => { S.wall.enabled = e.target.checked; save('wall'); refreshWall(); };
    $('#opacity').oninput = e => {
      S.wall.opacity = parseFloat(e.target.value);
      $('#opVal').textContent = Math.round(S.wall.opacity * 100) + '%';
      save('wall'); refreshWall();
    };
    $('#blend').onchange = e => { S.wall.blend = e.target.value; save('wall'); refreshWall(); };
    $('#fit').onchange = e => { S.wall.fit = e.target.value; save('wall'); refreshWall(); };

    /* ---- candles tab ---- */
    const toHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
    const normHex = h => { const p = parseColor((h || '').startsWith('#') ? h : '#' + h); return p ? toHex(p) : ''; };
    let candleTimer = null;
    function commitCandles() {
      clearTimeout(candleTimer);
      candleTimer = setTimeout(() => { save('candles'); rebuildLookup(); redraw(); }, 80);
    }
    function paintSide(side) {
      const el = root.querySelector(`.side[data-side="${side}"]`);
      const c = S.candles, hex = c[side], rgb = parseColor(hex) || [0, 0, 0], a = c[side + 'A'] ?? 1;
      const active = root.activeElement;
      el.querySelector('.main').value = hex;
      el.querySelectorAll('input[data-ch]').forEach(inp => { if (inp !== active) inp.value = rgb[+inp.dataset.ch]; });
      const hx = el.querySelector('.hex');
      if (hx !== active) hx.value = hex;
      el.querySelector('.alpha').value = a;
      el.querySelector('.aVal').textContent = Math.round(a * 100) + '%';
      el.querySelector('.extra').classList.toggle('on', !!c.separate);
      const cap = side === 'up' ? 'Up' : 'Down';
      el.querySelector('.border').value = c['border' + cap];
      el.querySelector('.wick').value = c['wick' + cap];
    }
    function renderDetected() {
      const box = $('#detected');
      box.innerHTML = '';
      const names = { upColor: 'Up', downColor: 'Down', borderUpColor: 'Border up', borderDownColor: 'Border down', wickUpColor: 'Wick up', wickDownColor: 'Wick down' };
      const keys = Object.keys(names).filter(k => detected[k]);
      if (!keys.length) { box.innerHTML = '<span class="hint">Not detected yet — using TradingView defaults. Click Re-detect once the chart loads.</span>'; return; }
      for (const k of keys) {
        const i = document.createElement('i');
        i.style.background = detected[k];
        i.title = names[k] + ': ' + detected[k];
        box.appendChild(i);
      }
    }
    function renderCandleUI() {
      $('#cEnabled').checked = S.candles.enabled;
      $('#cSeparate').checked = !!S.candles.separate;
      $('#cVolume').checked = S.candles.volume !== false;
      paintSide('up'); paintSide('down');
      renderDetected();
    }
    function setSideColor(side, hex) {
      const cap = side === 'up' ? 'Up' : 'Down';
      if (!S.candles.separate) { S.candles['border' + cap] = hex; S.candles['wick' + cap] = hex; }
      S.candles[side] = hex;
      S.candles.enabled = true;
      renderCandleUI(); commitCandles();
    }
    for (const side of ['up', 'down']) {
      const el = root.querySelector(`.side[data-side="${side}"]`);
      const cap = side === 'up' ? 'Up' : 'Down';
      el.querySelector('.main').oninput = e => setSideColor(side, e.target.value);
      el.querySelectorAll('input[data-ch]').forEach(inp => {
        inp.oninput = () => {
          const v = parseInt(inp.value, 10);
          if (Number.isNaN(v)) return;
          const rgb = (parseColor(S.candles[side]) || [0, 0, 0]).slice(0, 3);
          rgb[+inp.dataset.ch] = Math.max(0, Math.min(255, v));
          setSideColor(side, toHex(rgb));
        };
      });
      el.querySelector('.hex').oninput = e => { const h = normHex(e.target.value); if (h) setSideColor(side, h); };
      el.querySelector('.alpha').oninput = e => {
        S.candles[side + 'A'] = parseFloat(e.target.value);
        S.candles.enabled = true;
        renderCandleUI(); commitCandles();
      };
      el.querySelector('.border').oninput = e => { S.candles['border' + cap] = e.target.value; S.candles.enabled = true; commitCandles(); };
      el.querySelector('.wick').oninput = e => { S.candles['wick' + cap] = e.target.value; S.candles.enabled = true; commitCandles(); };
    }
    $('#cEnabled').onchange = e => { S.candles.enabled = e.target.checked; commitCandles(); };
    $('#cSeparate').onchange = e => {
      S.candles.separate = e.target.checked;
      if (!S.candles.separate) {
        S.candles.borderUp = S.candles.wickUp = S.candles.up;
        S.candles.borderDown = S.candles.wickDown = S.candles.down;
      }
      renderCandleUI(); commitCandles(); placePanel();
    };
    $('#cVolume').onchange = e => { S.candles.volume = e.target.checked; commitCandles(); };
    $('#redetect').onclick = () => { applyCandles(); renderCandleUI(); };
    $('#cReset').onclick = () => { S.candles.enabled = false; renderCandleUI(); commitCandles(); };
    for (const [name, up, down] of PRESETS) {
      const b = document.createElement('button');
      b.className = 'preset';
      b.innerHTML = `<i style="background:${up}"></i><i style="background:${down}"></i>`;
      b.append(name);
      b.onclick = () => {
        Object.assign(S.candles, { up, down, borderUp: up, wickUp: up, borderDown: down, wickDown: down, separate: false, enabled: true });
        renderCandleUI(); commitCandles();
      };
      $('#presets').appendChild(b);
    }

    function renderAllUI() { renderWallUI(); renderCandleUI(); showTab(S.ui.tab || 'wall'); }
    buildUI.refresh = () => { if (panel.classList.contains('open')) renderAllUI(); placeFab(); };
  }

  /* =========================================================
   * Cross-tab sync + startup
   * ======================================================= */
  if (bc) {
    bc.onmessage = e => {
      S = readSettings();
      const t = e.data && e.data.type;
      if (t === 'wall') { loadWallpaper(); refreshWall(); }
      if (t === 'candles') { rebuildLookup(); redraw(); }
      buildUI.refresh && buildUI.refresh();
    };
  }

  function start() {
    buildUI();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    loadWallpaper();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
