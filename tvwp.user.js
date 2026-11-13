// ==UserScript==
// @name         TV Wallpaper
// @namespace    tvwp
// @version      3.2.0
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
  const VERSION = '3.2.0';
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
    rec: { on: false, video: false, quality: '720', keep: 25 },
    extras: { allOff: false, hideAds: true, streamer: false, streamerChart: true, streamerStyle: 'blur', brk: true, brkMode: 'ticks', brkRight: 300 },
    ind: { list: [] },
    sounds: {
      enabled: true, volume: 0.8, oneForAll: false, all: 'tone:chime', muteTV: false,
      slots: {
        market: { on: true, s: 'tone:cash' }, limit: { on: true, s: 'tone:chime' },
        stop: { on: true, s: 'tone:alarm' }, stopLimit: { on: true, s: 'tone:alarm' },
        takeProfit: { on: true, s: 'tone:success' }, stopLoss: { on: true, s: 'tone:error' },
        trailing: { on: true, s: 'tone:ding' },
        partial: { on: false, s: 'tone:pop' }, placed: { on: false, s: 'tone:bloop' },
        cancelled: { on: false, s: 'tone:click' }, rejected: { on: true, s: 'tone:buzz' }
      }
    },
    ui: { x: null, y: null, tab: 'wall', theme: 'auto', px: null, py: null }
  };
  function readSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('tvwp_settings') || '{}');
      return {
        wall: { ...DEFAULTS.wall, ...s.wall },
        candles: { ...DEFAULTS.candles, ...s.candles },
        extras: { ...DEFAULTS.extras, ...s.extras },
        rec: { ...DEFAULTS.rec, ...s.rec },
        ind: { list: Array.isArray(s.ind && s.ind.list) ? s.ind.list : [] },
        sounds: (() => {
          const d = DEFAULTS.sounds, u = s.sounds || {}, slots = {};
          for (const k of Object.keys(d.slots)) slots[k] = { ...d.slots[k], ...((u.slots || {})[k] || {}) };
          return { ...d, ...u, slots };
        })(),
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

  // Money amounts: "+125.00 USD", "-$40", "1,250.50 €" (prices on the axis have no currency, so they stay)
  const MONEY_RE = /[+−\-]?\s?(?:[$€£¥]\s?[\d.,]*\d[KMB]?|[\d.,]*\d[KMB]?\s?(?:USD|EUR|GBP|JPY|AUD|CAD|CHF|USDT|USDC|[$€£¥]|ticks?\b|pips?\b|points?\b|pts\b))/;
  const MONEY_RE_G = new RegExp(MONEY_RE.source, 'g');
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
        if (!S.extras.allOff && S.extras.streamer && S.extras.streamerChart && typeof args[0] === 'string' && MONEY_RE.test(args[0])) {
          args[0] = args[0].replace(MONEY_RE_G, '•••••');
        }
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
    if (!c.enabled || S.extras.allOff) { lookup = null; return; }
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
   * Ad hiding (just hides the ad boxes on your screen)
   * ======================================================= */
  const AD_CSS = [
    '#charting-ad',
    '[id^="div-gpt-ad"]',
    '[id^="google_ads_iframe"]',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="doubleclick"]',
    '[class*="toast-"]:has(> [class*="toastInner-"] > [id^="div-gpt-ad"])'
  ].join(',') + '{display:none!important}';
  function applyAds() {
    if (!document.documentElement) {
      // Very early in page load: try again as soon as the page exists.
      const mo = new MutationObserver(() => {
        if (document.documentElement) { mo.disconnect(); applyAds(); }
      });
      mo.observe(document, { childList: true });
      return;
    }
    let st = document.getElementById('tvwp-ads');
    if (S.extras.hideAds && !S.extras.allOff) {
      if (!st) {
        st = document.createElement('style');
        st.id = 'tvwp-ads';
        st.textContent = AD_CSS;
        document.documentElement.appendChild(st);
      }
    } else if (st) {
      st.remove();
    }
  }
  applyAds();

  /* =========================================================
   * Streamer mode: blurs P&L, balances and other account money
   * ======================================================= */
  const MONEY_HEADER = /p&l|pnl|profit|loss|balance|equity|margin|funds|commission|fee|buying power|net liq|cash|return|value/i;
  const STREAM_CSS = `
    [class*="accountSummaryField-"] [class*="value-"],
    [data-qa-id="account-selector"] [class*="content-"],
    .tvwp-sblur { filter: blur(7px) !important; user-select: none !important; }
    html.tvwp-shide [class*="accountSummaryField-"] [class*="value-"],
    html.tvwp-shide [data-qa-id="account-selector"] [class*="content-"],
    html.tvwp-shide .tvwp-sblur { filter: none !important; color: transparent !important; text-shadow: none !important;
      background: repeating-linear-gradient(45deg,#2a2e39 0 6px,#1e222d 6px 12px) !important; border-radius: 3px; }
    html.tvwp-shide .tvwp-sblur * { visibility: hidden !important; }`;
  let streamTimer = null, streamObs = null;
  function maskTables() {
    for (const table of document.querySelectorAll('table')) {
      const head = table.tHead && table.tHead.rows[0];
      if (!head) continue;
      const cols = [];
      [...head.cells].forEach((th, i) => { if (MONEY_HEADER.test(th.textContent || '')) cols.push(i); });
      for (const row of table.tBodies.length ? [...table.tBodies].flatMap(b => [...b.rows]) : []) {
        [...row.cells].forEach((td, i) => td.classList.toggle('tvwp-sblur', cols.includes(i)));
      }
    }
    // Any other number with a currency (order panel, DOM, notifications), except inside our own panel
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.nodeValue;
      if (!t || t.length > 60 || !MONEY_RE.test(t)) continue;
      const el = n.parentElement;
      if (!el || el.closest('#tvwp-host') || el.classList.contains('tvwp-sblur')) continue;
      el.classList.add('tvwp-sblur');
    }
  }
  function scheduleMask() {
    if (streamTimer) return;
    streamTimer = setTimeout(() => { streamTimer = null; if (S.extras.streamer) maskTables(); }, 120);
  }
  function applyStreamer() {
    if (!document.documentElement || !document.body) {
      document.addEventListener('DOMContentLoaded', applyStreamer, { once: true });
      return;
    }
    let st = document.getElementById('tvwp-stream');
    const on = !!S.extras.streamer && !S.extras.allOff;
    document.documentElement.classList.toggle('tvwp-shide', on && S.extras.streamerStyle === 'hide');
    if (on) {
      if (!st) {
        st = document.createElement('style');
        st.id = 'tvwp-stream';
        st.textContent = STREAM_CSS;
        document.documentElement.appendChild(st);
      }
      maskTables();
      if (!streamObs) {
        streamObs = new MutationObserver(scheduleMask);
        streamObs.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
    } else {
      if (st) st.remove();
      if (streamObs) { streamObs.disconnect(); streamObs = null; }
      document.querySelectorAll('.tvwp-sblur').forEach(e => e.classList.remove('tvwp-sblur'));
    }
    try { brkKick(); } catch (e) {}
    // redraw the chart so position-line P&L is masked / shown right away
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
    if (buildUI.onStreamer) buildUI.onStreamer();
  }
  function toggleStreamer() {
    S.extras.streamer = !S.extras.streamer;
    save('extras');
    applyStreamer();
  }
  window.addEventListener('keydown', e => {
    if (e.altKey && e.shiftKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); e.stopPropagation(); toggleStreamer(); }
  }, true);
  // Hide money right away with CSS (before the page draws); the rest starts in start().
  function earlyStreamCss() {
    if (!S.extras.streamer || S.extras.allOff || document.getElementById('tvwp-stream')) return;
    if (!document.documentElement) {
      const mo = new MutationObserver(() => { if (document.documentElement) { mo.disconnect(); earlyStreamCss(); } });
      mo.observe(document, { childList: true });
      return;
    }
    const early = document.createElement('style');
    early.id = 'tvwp-stream';
    early.textContent = STREAM_CSS;
    document.documentElement.appendChild(early);
  }
  earlyStreamCss();

  /* =========================================================
   * Master switch: turns every feature off at once (your settings are kept)
   * ======================================================= */
  function setAllOff(off) {
    S.extras.allOff = !!off;
    save('alloff');
    applyAllOff();
  }
  function applyAllOff() {
    try { refreshWall(); } catch (e) {}
    try { rebuildLookup(); redraw(); } catch (e) {}
    try { startInd(); } catch (e) {}
    try { applyAds(); applyStreamer(); applyMute(); } catch (e) {}
    try { brkKick(); } catch (e) {}
    if (!S.extras.allOff) setTimeout(() => { try { recBackfill(); } catch (e) {} }, 500);
    if (buildUI.refresh) buildUI.refresh();
  }
  window.addEventListener('keydown', e => {
    if (e.altKey && e.shiftKey && (e.key === 'X' || e.key === 'x')) { e.preventDefault(); e.stopPropagation(); setAllOff(!S.extras.allOff); }
  }, true);

  /* =========================================================
   * Wallpaper storage (IndexedDB)
   * ======================================================= */
  const DB = {
    _db: null,
    open() {
      return this._db || (this._db = new Promise((res, rej) => {
        const r = indexedDB.open('tvwp', 3);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('wallpapers')) db.createObjectStore('wallpapers', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('sounds')) db.createObjectStore('sounds', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('trades')) db.createObjectStore('trades', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'id' });
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }));
    },
    async run(mode, fn, store = 'wallpapers') {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    },
    all() { return this.run('readonly', s => s.getAll()); },
    get(id) { return this.run('readonly', s => s.get(id)); },
    put(w) { return this.run('readwrite', s => s.put(w)); },
    del(id) { return this.run('readwrite', s => s.delete(id)); },
    soundsAll() { return this.run('readonly', s => s.getAll(), 'sounds'); },
    soundGet(id) { return this.run('readonly', s => s.get(id), 'sounds'); },
    soundPut(x) { return this.run('readwrite', s => s.put(x), 'sounds'); },
    soundDel(id) { return this.run('readwrite', s => s.delete(id), 'sounds'); },
    tradesAll() { return this.run('readonly', s => s.getAll(), 'trades'); },
    tradeGet(id) { return this.run('readonly', s => s.get(id), 'trades'); },
    tradePut(x) { return this.run('readwrite', s => s.put(x), 'trades'); },
    tradeDel(id) { return this.run('readwrite', s => s.delete(id), 'trades'); },
    tradesClear() { return this.run('readwrite', s => s.clear(), 'trades'); },
    videoGet(id) { return this.run('readonly', s => s.get(id), 'videos'); },
    videoPut(x) { return this.run('readwrite', s => s.put(x), 'videos'); },
    videoDel(id) { return this.run('readwrite', s => s.delete(id), 'videos'); },
    videoKeys() { return this.run('readonly', s => s.getAllKeys(), 'videos'); },
    videosClear() { return this.run('readwrite', s => s.clear(), 'videos'); }
  };

  /* =========================================================
   * Order sounds
   * Listens to the order updates TradingView gets from whatever broker
   * is connected (Paper Trading, Tradovate, NinjaTrader, ...). Read-only.
   * ======================================================= */
  const TONES = {
    chime: 'Chime', ding: 'Ding', cash: 'Cash register', coin: 'Coin', success: 'Success',
    error: 'Low thud', alarm: 'Alarm', pop: 'Pop', bloop: 'Bloop', click: 'Click', buzz: 'Buzz', laser: 'Laser'
  };
  const SLOT_LABELS = {
    market: 'Market fill', limit: 'Limit fill', stop: 'Stop fill', stopLimit: 'Stop limit fill',
    takeProfit: 'Take profit fill', stopLoss: 'Stop loss fill', trailing: 'Trailing stop fill',
    partial: 'Partial fill', placed: 'Order placed', cancelled: 'Order cancelled', rejected: 'Order rejected'
  };
  const FILL_SLOTS = ['market', 'limit', 'stop', 'stopLimit', 'takeProfit', 'stopLoss', 'trailing'];
  let audioCtx = null;
  const bufferCache = new Map();
  let lastEvent = '';

  let master = null, pageClosing = false;
  function ctx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // Everything plays through a limiter so no sound can come out painfully loud.
      const lim = audioCtx.createDynamicsCompressor();
      lim.threshold.value = -10; lim.knee.value = 6; lim.ratio.value = 12;
      lim.attack.value = 0.003; lim.release.value = 0.15;
      master = audioCtx.createGain();
      master.gain.value = 0.9;
      master.connect(lim).connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended' && !pageClosing) audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  function outNode() { ctx(); return master; }
  // Silence everything the moment the page or app starts closing.
  function shutUp() {
    pageClosing = true;
    pendingEvents.length = 0;
    clearTimeout(pendingTimer);
    try { if (audioCtx) audioCtx.close(); } catch (e) {}
    audioCtx = null; master = null;
  }
  window.addEventListener('beforeunload', shutUp, true);
  window.addEventListener('pagehide', shutUp, true);
  // Browsers only allow sound after a click or key press on the page.
  for (const ev of ['pointerdown', 'keydown']) {
    window.addEventListener(ev, () => { try { ctx(); } catch (e) {} }, { capture: true, passive: true });
  }

  function playTone(name, vol) {
    const c = ctx(), t = c.currentTime;
    const out = c.createGain();
    out.gain.value = vol * 0.8;
    out.connect(outNode());
    const note = (freq, start, dur, type = 'sine', g = 0.6) => {
      const o = c.createOscillator(), gn = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t + start);
      gn.gain.setValueAtTime(0.0001, t + start);
      gn.gain.exponentialRampToValueAtTime(g, t + start + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
      o.connect(gn).connect(out);
      o.start(t + start);
      o.stop(t + start + dur + 0.05);
      return o;
    };
    switch (name) {
      case 'chime': note(880, 0, 0.6); note(1320, 0.12, 0.7); break;
      case 'ding': note(1568, 0, 0.9, 'sine', 0.7); note(3136, 0, 0.4, 'sine', 0.15); break;
      case 'cash': note(2093, 0, 0.2, 'square', 0.2); note(2637, 0.07, 0.3, 'square', 0.2); note(3136, 0.15, 0.6, 'triangle', 0.5); break;
      case 'coin': note(988, 0, 0.08, 'square', 0.3); note(1319, 0.08, 0.45, 'square', 0.3); break;
      case 'success': [523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.09, 0.4, 'triangle', 0.5)); break;
      case 'error': note(220, 0, 0.35, 'triangle', 0.7); note(165, 0.15, 0.45, 'triangle', 0.7); break;
      case 'alarm': for (let i = 0; i < 3; i++) { note(880, i * 0.22, 0.1, 'square', 0.3); note(660, i * 0.22 + 0.11, 0.1, 'square', 0.3); } break;
      case 'pop': { const o = note(600, 0, 0.12, 'sine', 0.7); o.frequency.exponentialRampToValueAtTime(200, t + 0.12); break; }
      case 'bloop': { const o = note(300, 0, 0.25, 'sine', 0.6); o.frequency.exponentialRampToValueAtTime(700, t + 0.2); break; }
      case 'click': note(1800, 0, 0.03, 'square', 0.4); break;
      case 'buzz': note(140, 0, 0.35, 'sawtooth', 0.35); note(147, 0, 0.35, 'sawtooth', 0.3); break;
      case 'laser': { const o = note(1800, 0, 0.3, 'sawtooth', 0.3); o.frequency.exponentialRampToValueAtTime(120, t + 0.3); break; }
      default: note(880, 0, 0.4);
    }
  }

  let playing = null;
  // Measure a file once so loud and quiet uploads come out at a similar level.
  function loudnessGain(buf) {
    let peak = 0, sum = 0, count = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < data.length; i += 4) { const v = Math.abs(data[i]); if (v > peak) peak = v; sum += v * v; count++; }
    }
    const rms = Math.sqrt(sum / Math.max(1, count));
    if (!peak || !rms) return 1;
    return Math.min(0.9 / peak, 0.18 / rms, 4);
  }
  async function playSound(ref, vol = S.sounds.volume) {
    window.__tvwpLastSound = ref;   // used by the automated tests
    if (pageClosing) return;
    try {
      if (!ref || ref === 'none') return;
      if (playing) { try { playing.stop(); } catch (e) {} playing = null; }   // never stack sounds
      if (ref.startsWith('tone:')) { playTone(ref.slice(5), vol); return; }
      if (ref.startsWith('file:')) {
        const id = ref.slice(5);
        let entry = bufferCache.get(id);
        if (!entry) {
          const rec = await DB.soundGet(id);
          if (!rec || pageClosing) return;
          const buf = await ctx().decodeAudioData(await rec.blob.arrayBuffer());
          entry = { buf, norm: loudnessGain(buf) };
          bufferCache.set(id, entry);
        }
        if (pageClosing) return;
        const c = ctx(), src = c.createBufferSource(), g = c.createGain();
        g.gain.value = vol * entry.norm;
        src.buffer = entry.buf;
        src.connect(g).connect(outNode());
        // Long files are cut off after 4 seconds with a short fade.
        const end = c.currentTime + Math.min(entry.buf.duration, 4);
        g.gain.setValueAtTime(vol * entry.norm, Math.max(c.currentTime, end - 0.25));
        g.gain.linearRampToValueAtTime(0.0001, end);
        src.start();
        src.stop(end + 0.02);
        playing = src;
        src.onended = () => { if (playing === src) playing = null; };
      }
    } catch (e) {
      console.warn('[TV Wallpaper] sound failed', e);
    }
  }

  // Order events are gathered for a moment, then at most ONE sound plays:
  // the most important event wins. A flood of events (history being re-sent
  // when connecting, reconnecting or closing) plays nothing at all.
  const PRIORITY = { rejected: 9, stopLoss: 8, takeProfit: 8, trailing: 7, stop: 7, stopLimit: 7, limit: 6, market: 6, partial: 4, cancelled: 3, placed: 2 };
  const pendingEvents = [];
  let pendingTimer = null;
  const BATCH_MS = 250, FLOOD = 5;

  function queueEvent(slot, text, key) {
    if (pageClosing || Date.now() < warmUntil) return;
    pendingEvents.push({ slot, text, key });
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(flushEvents, BATCH_MS);
  }
  function flushEvents() {
    const evs = pendingEvents.splice(0);
    if (!evs.length || pageClosing || Date.now() < warmUntil) return;
    if (evs.length >= FLOOD) {             // a replay of old orders, not real trading
      warmUntil = Date.now() + 2000;
      return;
    }
    evs.sort((a, b) => (PRIORITY[b.slot] || 0) - (PRIORITY[a.slot] || 0));
    const top = evs[0];
    lastEvent = evs.map(e => e.text).join(', ') + ' · ' + new Date().toLocaleTimeString();
    window.__tvwpLastEvent = { slot: top.slot, text: top.text };
    if (buildUI.onEvent) buildUI.onEvent();
    claimOnce(evs.map(e => e.key).join('|'), () => fireSlot(top.slot));
  }

  // With several chart windows/tabs open, only one of them plays each sound.
  function claimOnce(key, fn) {
    const run = () => {
      let recent = {};
      try { recent = JSON.parse(localStorage.getItem('tvwp_sound_claims') || '{}'); } catch (e) {}
      const now = Date.now();
      for (const k of Object.keys(recent)) if (now - recent[k] > 10000) delete recent[k];
      if (recent[key]) return;
      recent[key] = now;
      try { localStorage.setItem('tvwp_sound_claims', JSON.stringify(recent)); } catch (e) {}
      fn();
    };
    if (navigator.locks && navigator.locks.request) {
      navigator.locks.request('tvwp-sound', { ifAvailable: true }, lock => { if (lock) run(); }).catch(run);
    } else run();
  }

  function fireSlot(slot) {
    const so = S.sounds;
    if (!so.enabled || pageClosing || S.extras.allOff) return;
    if (FILL_SLOTS.includes(slot) && so.oneForAll) { playSound(so.all); return; }
    const conf = so.slots[slot];
    if (conf && conf.on) playSound(conf.s);
  }

  // Order fields follow TradingView's broker format:
  // type 1 limit, 2 market, 3 stop, 4 stop-limit; side 1 buy, -1 sell;
  // status 1 cancelled, 2 filled, 3 inactive, 4 placing, 5 rejected, 6 working;
  // stopType 1 trailing; parentId set for take-profit / stop-loss brackets.
  const ORDER_TYPES = { 1: 'limit', 2: 'market', 3: 'stop', 4: 'stopLimit' };
  function categorize(o) {
    if (o.stopType === 1) return 'trailing';
    if (o.parentId !== undefined && o.parentId !== null && o.parentId !== '') return o.type === 1 ? 'takeProfit' : 'stopLoss';
    return ORDER_TYPES[o.type] || 'market';
  }
  const trackedOrders = new Map();
  let hookedBroker = null, hookedConnected = null, warmUntil = 0, lastOrderFillAt = 0;
  const HOOK = {};

  function handleOrder(o) {
    if (!o || o.id === undefined || o.id === null) return;
    const prev = trackedOrders.get(o.id);
    const cur = { ...(prev || {}), ...o };
    trackedOrders.set(o.id, cur);
    if (Date.now() < warmUntil || pageClosing) return;  // history sent while connecting / closing
    if (hookedBroker && typeof hookedBroker.isConnected === 'function') {
      try { if (!hookedBroker.isConnected()) return; } catch (e) {}
    }
    const st = cur.status, pst = prev && prev.status;
    const cat = categorize(cur);
    const side = cur.side === -1 ? 'Sell' : 'Buy';
    const name = `${side} ${SLOT_LABELS[cat].replace(' fill', '')}`;
    const key = o.id + ':' + st + ':' + (cur.filledQty || 0);
    if (st === 2 && pst !== 2) {
      lastOrderFillAt = Date.now();
      clearTimeout(execTimer);
      queueEvent(cat, name + ' filled', key);
      return;
    }
    if (!prev) {         // first time we see this order
      if (st === 6) queueEvent('placed', name + ' placed', key);
      if (st === 5) queueEvent('rejected', name + ' rejected', key);  // brokers often reject straight away
      return;            // a cancelled order we never saw working is old history
    }
    if (st !== 2 && (cur.filledQty || 0) > (prev.filledQty || 0)) {
      lastOrderFillAt = Date.now();
      queueEvent('partial', name + ' partially filled', key);
      return;
    }
    if (st === 1 && pst !== 1) { queueEvent('cancelled', name + ' cancelled', key); return; }
    if (st === 5 && pst !== 5) { queueEvent('rejected', name + ' rejected', key); return; }
    if (st === 6 && pst !== 6) queueEvent('placed', name + ' placed', key);
  }
  function onOrderUpdate(o) {
    if (Array.isArray(o)) o.forEach(handleOrder); else handleOrder(o);
  }
  function onOrderPartial(id, data) {
    if (id && typeof id === 'object' && data === undefined) { handleOrder(id); return; }
    handleOrder({ ...(data || {}), id });
  }
  let execTimer = null;
  function onExecution(ex) {
    // Backup for brokers that report a fill only as an execution. One timer, never one per execution.
    if (Date.now() < warmUntil || pageClosing) return;
    clearTimeout(execTimer);
    const key = 'exec:' + ((ex && (ex.id || ex.time)) || Math.floor(Date.now() / 2000));
    execTimer = setTimeout(() => {
      if (Date.now() - lastOrderFillAt > 1200) queueEvent('market', 'Order filled', key);
    }, 700);
  }
  function onFullUpdate() { warmUntil = Date.now() + 3000; pendingEvents.length = 0; clearTimeout(execTimer); }
  function onConnection() { warmUntil = Date.now() + 3000; pendingEvents.length = 0; clearTimeout(execTimer); trackedOrders.clear(); }

  function currentBroker() {
    try {
      const ab = window.TradingViewApi.trading().activeBroker();
      return ab && typeof ab.value === 'function' ? ab.value() : ab;
    } catch (e) { return null; }
  }
  function sub(b, key, fn) {
    const d = b && b[key];
    if (d && typeof d.subscribe === 'function') { d.subscribe(HOOK, fn); return true; }
    return false;
  }
  function unsub(b, key, fn) {
    const d = b && b[key];
    try { if (d && typeof d.unsubscribe === 'function') d.unsubscribe(HOOK, fn); } catch (e) {}
  }
  function hookBroker() {
    const b = currentBroker();
    if (b !== hookedBroker) {
      if (hookedBroker) {
        unsub(hookedBroker, 'orderUpdate', onOrderUpdate);
        unsub(hookedBroker, 'orderPartialUpdate', onOrderPartial);
        unsub(hookedBroker, 'executionUpdate', onExecution);
        unsub(hookedBroker, 'executionUpdate', recOnExec);
        unsub(hookedBroker, 'ordersFullUpdate', onFullUpdate);
        unsub(hookedBroker, 'connectionStatusUpdate', onConnection);
      }
      hookedBroker = null;
      trackedOrders.clear();
      if (b && sub(b, 'orderUpdate', onOrderUpdate)) {
        sub(b, 'orderPartialUpdate', onOrderPartial);
        sub(b, 'executionUpdate', onExecution);
        sub(b, 'executionUpdate', recOnExec);
        sub(b, 'ordersFullUpdate', onFullUpdate);
        sub(b, 'connectionStatusUpdate', onConnection);
        hookedBroker = b;
        warmUntil = Date.now() + 3000;
      }
    }
    if (hookedBroker) {
      let conn = null;
      try { conn = typeof hookedBroker.isConnected === 'function' ? !!hookedBroker.isConnected() : null; } catch (e) {}
      if (conn !== hookedConnected && hookedConnected !== null) onConnection();
      if (conn && hookedConnected !== true) setTimeout(recBackfill, 3500);   // catch up on trades missed while closed
      hookedConnected = conn;
    }
  }

  /* =========================================================
   * Trade journal: records every round-trip trade from your broker's fills.
   * Works for any broker connected in TradingView, keeps working in a
   * background tab, and catches up on trades made while TradingView was closed.
   * ======================================================= */
  const REC_KEY = 'tvwp_rec_state';
  const recInfoCache = {};
  function recLoad() {
    let st = null;
    try { st = JSON.parse(localStorage.getItem(REC_KEY)); } catch (e) {}
    st = st || {};
    return { since: st.since || Date.now(), seen: st.seen || [], open: st.open || {}, lastFill: st.lastFill || 0 };
  }
  function recSave(st) {
    st.seen = st.seen.slice(-4000);
    try { localStorage.setItem(REC_KEY, JSON.stringify(st)); } catch (e) {}
  }
  function recStartFresh() {   // called when recording is switched on
    const st = recLoad();
    st.since = Date.now(); st.open = {};
    recSave(st);
  }
  function withLock(name, fn) {
    if (navigator.locks && navigator.locks.request) return navigator.locks.request(name, fn);
    return Promise.resolve().then(fn);
  }
  async function recTick(symbol) {
    if (recInfoCache[symbol] !== undefined) return recInfoCache[symbol];
    let info = null;
    try { const b = currentBroker(); if (b && typeof b.symbolInfo === 'function') info = await b.symbolInfo(symbol); } catch (e) {}
    recInfoCache[symbol] = info || {};
    return recInfoCache[symbol];
  }
  function normFill(ex) {
    if (!ex || !ex.symbol || !(+ex.qty) || !isFinite(+ex.price)) return null;
    let t = +ex.time || Date.now();
    if (t < 1e12) t *= 1000;                       // seconds -> ms
    const id = String(ex.id || `${ex.orderId || ''}:${t}:${ex.price}:${ex.qty}:${ex.side}`);
    return { id, symbol: ex.symbol, side: ex.side === -1 ? -1 : 1, qty: Math.abs(+ex.qty), price: +ex.price, time: t,
      commission: +ex.commission || 0, pointValue: +ex.pointValue || 0, orderId: ex.orderId || '' };
  }
  function newTrade(f) {
    return { id: 't' + f.time + Math.random().toString(36).slice(2, 6), symbol: f.symbol, dir: f.side, qty: 0, maxQty: 0,
      entryQty: 0, entryValue: 0, exitQty: 0, exitValue: 0, points: 0, commission: 0, pointValue: f.pointValue,
      openTime: f.time, fills: [], video: false, backfilled: false };
  }
  async function finishTrade(t) {
    const info = await recTick(t.symbol);
    const pv = t.pointValue || (+info.pipValue && +info.pipSize ? +info.pipValue / +info.pipSize : 0);
    const tick = +info.minTick || +info.pipSize || 0;
    const entry = t.entryValue / t.entryQty, exit = t.exitValue / t.exitQty;
    const rec = {
      id: t.id, symbol: t.symbol, dir: t.dir, qty: t.maxQty, entry, exit,
      openTime: t.openTime, closeTime: t.closeTime,
      ticks: tick ? Math.round(((exit - entry) * t.dir) / tick) : null,
      gross: pv ? t.points * pv : null, commission: t.commission,
      net: pv ? t.points * pv - t.commission : null, currency: info.currency || 'USD',
      fills: t.fills, backfilled: t.backfilled, videoId: t.video ? 'v_' + t.id : null
    };
    await DB.tradePut(rec);
    return rec;
  }
  // Applies fills (oldest first) to the open trades. Only one window does this at a time.
  function recProcess(fills, live) {
    if (!S.rec.on || S.extras.allOff) return Promise.resolve();
    return withLock('tvwp-rec', async () => {
      const st = recLoad();
      const seen = new Set(st.seen);
      const list = fills.map(normFill).filter(Boolean).sort((a, b) => a.time - b.time);
      const opened = [], closed = [];
      for (const f of list) {
        if (seen.has(f.id) || f.time < st.since - 2000) continue;
        seen.add(f.id); st.seen.push(f.id);
        st.lastFill = Math.max(st.lastFill, f.time);
        let qty = f.qty;
        while (qty > 0) {
          let t = st.open[f.symbol];
          if (!t) {
            t = st.open[f.symbol] = newTrade(f);
            t.backfilled = !live;
            opened.push(t);
          }
          if (!t.pointValue && f.pointValue) t.pointValue = f.pointValue;
          if (t.qty === 0 || Math.sign(t.qty) === f.side) {          // opening / adding
            t.qty += f.side * qty; t.entryQty += qty; t.entryValue += f.price * qty;
            t.maxQty = Math.max(t.maxQty, Math.abs(t.qty));
            t.commission += f.commission; t.fills.push({ time: f.time, side: f.side, qty, price: f.price });
            qty = 0;
          } else {                                                     // reducing / closing
            const c = Math.min(qty, Math.abs(t.qty));
            const avg = t.entryValue / t.entryQty;
            t.points += (f.price - avg) * t.dir * c;
            t.exitQty += c; t.exitValue += f.price * c; t.qty += f.side * c;
            t.commission += f.commission * (c / f.qty);
            t.fills.push({ time: f.time, side: f.side, qty: c, price: f.price });
            qty -= c;
            if (t.qty === 0) {
              t.closeTime = f.time;
              delete st.open[f.symbol];
              closed.push(t);
              f.commission = f.commission * (qty / f.qty);   // what's left goes to a flipped position
            }
          }
        }
      }
      recSave(st);
      const recs = [];
      for (const t of closed) recs.push(await finishTrade(t));
      return { opened, closed, recs, live };
    }).then(res => {
      if (!res) return;
      if (res.live) for (const t of res.opened) liveTrades.add(t.id);
      videoSync();
      if (res.recs.length && buildUI.onJournal) buildUI.onJournal();
    }).catch(e => console.warn('[TV Wallpaper] journal error', e));
  }
  function recOnExec(ex) {
    if (pageClosing) return;
    const f = normFill(ex);
    if (!f) return;
    recProcess([ex], Date.now() - f.time < 60000);
  }
  let backfilling = false;
  async function recBackfill() {
    if (!S.rec.on || S.extras.allOff || backfilling) return;
    const b = currentBroker();
    if (!b || typeof b.executions !== 'function') return;
    backfilling = true;
    try {
      const st = recLoad();
      const symbols = new Set(Object.keys(st.open));
      if (typeof b.ordersHistory === 'function') {
        for (const o of (await b.ordersHistory()) || []) {
          const when = +((o.extra && (o.extra.closeDate || o.extra.placingTime)) || o.updateTime || o.time || 0);
          if (o.status === 2 && o.symbol && (!when || when >= st.since - 2000)) symbols.add(o.symbol);
        }
      }
      try { for (const p of (await b.positions()) || []) if (p && p.symbol) symbols.add(p.symbol); } catch (e) {}
      const all = [];
      for (const sym of symbols) {
        try { all.push(...((await b.executions(sym)) || [])); } catch (e) {}
      }
      if (all.length) await recProcess(all, false);
    } catch (e) {
      console.warn('[TV Wallpaper] journal catch-up failed', e);
    } finally { backfilling = false; }
  }

  /* ---- chart video while you're in a trade ---- */
  let vid = null;
  const liveTrades = new Set();   // trades opened while this browser was running (not caught up from history)
  // Every window checks the shared trade state, so the right one starts/stops filming
  // no matter which window happened to process the fill.
  function videoSync() {
    if (pageClosing) return;
    const want = S.rec.on && S.rec.video && !S.extras.allOff;
    const open = recLoad().open;
    const openList = Object.values(open);
    if (vid && !vid.stopTimer) {
      const still = openList.some(t => t.id === vid.tradeId);
      if (!want) videoStop(vid.tradeId, 0);
      else if (!still) videoStop(vid.tradeId);
    }
    if (!want) return;
    for (const t of openList) {
      const fresh = liveTrades.has(t.id) || (!t.backfilled && Date.now() - t.openTime < 15000);
      if (!fresh || t.video || (vid && vid.tradeId === t.id)) continue;
      videoStart(t);
      break;
    }
  }
  setInterval(videoSync, 500);
  const sleepMs = ms => new Promise(r => setTimeout(r, ms));
  function videoTicker(fps, fn) {
    // A worker keeps ticking even when the tab is in the background (normal timers get slowed down there).
    try {
      const url = URL.createObjectURL(new Blob([`setInterval(()=>postMessage(0), ${Math.round(1000 / fps)});`], { type: 'text/javascript' }));
      const w = new Worker(url);
      w.onmessage = fn;
      return () => { w.terminate(); URL.revokeObjectURL(url); };
    } catch (e) {
      const h = setInterval(fn, Math.round(1000 / fps));
      return () => clearInterval(h);
    }
  }
  function drawChartFrame(g, cv, t) {
    const cont = document.querySelector('.chart-container.active') || document.querySelector('.chart-container');
    if (!cont) return;
    const cr = cont.getBoundingClientRect();
    if (cr.width < 50 || cr.height < 50) return;
    const sc = Math.min(cv.width / cr.width, cv.height / cr.height);
    const ox = (cv.width - cr.width * sc) / 2, oy = (cv.height - cr.height * sc) / 2;
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.fillStyle = getComputedStyle(cont).backgroundColor || '#131722';
    if (/rgba\(0, 0, 0, 0\)|transparent/.test(g.fillStyle)) g.fillStyle = '#131722';
    g.fillRect(0, 0, cv.width, cv.height);
    for (const c of cont.querySelectorAll('canvas')) {
      if (!c.width || !c.height) continue;
      const r = c.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const layer = c.classList.contains('tvwp-layer');
      g.globalAlpha = layer ? (+c.style.opacity || 1) : 1;
      g.globalCompositeOperation = layer ? (c.style.mixBlendMode || 'source-over') : 'source-over';
      try { g.drawImage(c, ox + (r.left - cr.left) * sc, oy + (r.top - cr.top) * sc, r.width * sc, r.height * sc); } catch (e) {}
    }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    const label = `${String(t.symbol).split(':').pop()} · ${t.dir > 0 ? 'Long' : 'Short'} · ${new Date().toLocaleTimeString()}`;
    g.font = `600 ${Math.round(14 * cv.height / 720)}px -apple-system, system-ui, sans-serif`;
    const pad = 10 * cv.height / 720, w = g.measureText(label).width + pad * 2, h = 24 * cv.height / 720;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(pad, cv.height - h - pad, w, h);
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(label, pad * 2, cv.height - pad - h / 2);
  }
  let nextVideo = null;
  function videoStart(t) {
    if (!S.rec.on || !S.rec.video || S.extras.allOff || typeof MediaRecorder === 'undefined') return;
    if (vid) {
      // Still filming the last few seconds of the previous trade: finish that video now, then start this one.
      if (vid.stopTimer) { nextVideo = t; clearTimeout(vid.stopTimer); clearTimeout(vid.maxTimer); try { vid.mr.stop(); } catch (e) {} }
      return;
    }
    if (navigator.locks && navigator.locks.request) {
      // Only one window records. The lock is held until this recording ends.
      navigator.locks.request('tvwp-video', { ifAvailable: true }, lock => {
        if (vid) return;
        if (!lock) return;                     // another window is filming; the sync tries again
        return new Promise(done => startRecording(t, done));
      }).catch(() => {});
    } else startRecording(t, () => {});
  }
  function startRecording(t, done) {
    const o = recLoad().open[t.symbol];
    if (!o || o.id !== t.id || o.video) { done(); return; }   // trade already closed, or already being filmed
    try {
      const H = S.rec.quality === '1080' ? 1080 : 720, W = Math.round(H * 16 / 9);
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      drawChartFrame(g, cv, t);
      const stream = cv.captureStream(30);
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
      const mr = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: H === 1080 ? 5e6 : 2.5e6 });
      const chunks = [];
      mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopTick = videoTicker(30, () => drawChartFrame(g, cv, t));
      vid = { tradeId: t.id, mr, stopTick, started: Date.now(), stopTimer: null, maxTimer: null };
      vid.maxTimer = setTimeout(() => videoStop(t.id, 0), 30 * 60000);      // 30-minute cap per trade
      mr.onstop = async () => {
        stopTick();
        const blob = new Blob(chunks, { type: mr.mimeType || 'video/webm' });
        const v = vid; vid = null;
        try {
          if (blob.size) {
            await DB.videoPut({ id: 'v_' + t.id, tradeId: t.id, blob, size: blob.size, mime: blob.type, started: v.started, ended: Date.now() });
            const rec = await DB.tradeGet(t.id);
            if (rec && !rec.videoId) { rec.videoId = 'v_' + t.id; await DB.tradePut(rec); }
            await videoCleanup();
          }
        } catch (e) { console.warn('[TV Wallpaper] video save failed', e); }
        if (buildUI.onJournal) buildUI.onJournal();
        done();
        if (nextVideo) { const n = nextVideo; nextVideo = null; setTimeout(() => videoStart(n), 50); }
      };
      mr.start(1000);
      // remember on the open trade that it has a video
      withLock('tvwp-rec', () => { const st = recLoad(); if (st.open[t.symbol] && st.open[t.symbol].id === t.id) { st.open[t.symbol].video = true; recSave(st); } });
      if (buildUI.onJournal) buildUI.onJournal();
    } catch (e) {
      console.warn('[TV Wallpaper] video recording unavailable', e);
      vid = null; done();
    }
  }
  function videoStop(tradeId, delay = 8000) {
    if (!vid || vid.tradeId !== tradeId) return;
    if (vid.stopTimer && delay) return;            // already finishing
    clearTimeout(vid.stopTimer);
    vid.stopTimer = setTimeout(() => {          // keep a few seconds after the exit
      if (!vid || vid.tradeId !== tradeId) return;
      clearTimeout(vid.maxTimer);
      try { vid.mr.state !== 'inactive' ? vid.mr.stop() : null; } catch (e) {}
    }, delay);
  }
  async function videoCleanup() {
    const keep = Math.max(1, +S.rec.keep || 25);
    const keys = ((await DB.videoKeys()) || []).map(String).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - keep))) await DB.videoDel(k);
  }
  window.addEventListener('pagehide', () => { if (vid) try { vid.mr.stop(); } catch (e) {} });

  // TradingView's own "play sound on order execution" switch.
  function tvSoundPref() {
    try { return window.TradingViewApi.trading().orderExecutedSoundParams.enabled; } catch (e) { return null; }
  }
  function applyMute() {
    const p = tvSoundPref();
    if (!p || typeof p.value !== 'function') return false;
    const want = S.sounds.enabled && S.sounds.muteTV && !S.extras.allOff;
    if (want) {
      if (p.value()) { try { localStorage.setItem('tvwp_tvsound_was_on', '1'); } catch (e) {} p.setValue(false); }
    } else if (localStorage.getItem('tvwp_tvsound_was_on') === '1') {
      p.setValue(true);
      try { localStorage.removeItem('tvwp_tvsound_was_on'); } catch (e) {}
    }
    return true;
  }
  let muteApplied = false;
  setInterval(() => {
    hookBroker();
    if (!muteApplied) muteApplied = applyMute();
  }, 1500);

  /* =========================================================
   * Indicators drawn by this script.
   * Your TradingView indicators + these never go above your plan's
   * indicators-per-chart limit.
   * ======================================================= */
  const IND_TYPES = { ema: 'EMA', sma: 'SMA', wma: 'WMA', vwap: 'VWAP (daily)', bb: 'Bollinger Bands', qt: 'Quarterly Theory', po3: 'Power of Three (HTF candles)' };
  const IND_DEFAULT_LEN = { ema: 20, sma: 50, wma: 20, vwap: 0, bb: 20, qt: 0, po3: 0 };
  const PLAN_LIMITS = [['ultimate', 'Ultimate', 50], ['premium', 'Premium', 25], ['plus', 'Plus', 10]];
  function planLimit() {
    let p = '';
    try { p = String((window.user && window.user.pro_plan) || '').toLowerCase(); } catch (e) {}
    if (!p) return { name: 'Basic', limit: 2 };
    for (const [k, name, limit] of PLAN_LIMITS) if (p.includes(k)) return { name, limit };
    return { name: 'Essential', limit: 5 };
  }
  let nativeCount = 0;
  function countNative() {
    // Same rule TradingView uses: only indicators that are showing take up a slot.
    try {
      const ac = window.TradingViewApi.activeChart();
      nativeCount = ac.getAllStudies().filter(st => {
        try { const o = ac.getStudyById(st.id); return typeof o.isVisible === 'function' ? o.isVisible() : true; }
        catch (e) { return true; }
      }).length;
    } catch (e) {}
    return nativeCount;
  }
  function overlaySlots() { return Math.max(0, planLimit().limit - nativeCount); }
  function activeOverlays() { return S.extras.allOff ? [] : S.ind.list.filter(x => x.on).slice(0, overlaySlots()); }

  function readBars(ms) {
    const b = ms.bars(), f = b.firstIndex(), l = b.lastIndex();
    const d = { idx: [], t: [], o: [], h: [], l: [], c: [], v: [] };
    if (f === null || l === null || f === undefined) return d;
    for (let i = f; i <= l; i++) {
      const v = b.valueAt(i);
      if (!v) continue;
      d.idx.push(i); d.t.push(v[0]); d.o.push(v[1]); d.h.push(v[2]); d.l.push(v[3]); d.c.push(v[4]); d.v.push(v[5] || 0);
    }
    addNyTime(d);
    return d;
  }

  // New York wall-clock time for each bar. Futures trading days start at 18:00 New York time.
  const nyFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
  });
  const nyOffsetCache = new Map();
  function nyOffset(ms) {
    const key = Math.floor(ms / 3600000);
    let off = nyOffsetCache.get(key);
    if (off === undefined) {
      const p = {};
      for (const x of nyFmt.formatToParts(new Date(key * 3600000))) p[x.type] = +x.value;
      off = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - key * 3600000;
      if (nyOffsetCache.size > 5000) nyOffsetCache.clear();
      nyOffsetCache.set(key, off);
    }
    return off;
  }
  const DAY = 86400000, SHIFT = 6 * 3600000;
  function addNyTime(d) {
    const n = d.t.length;
    d.wall = new Array(n); d.tday = new Array(n); d.tmin = new Array(n); d.tdow = new Array(n);
    for (let i = 0; i < n; i++) {
      const ms = d.t[i] * 1000, wall = ms + nyOffset(ms), sh = wall + SHIFT;
      d.wall[i] = wall;
      d.tday[i] = Math.floor(sh / DAY);                       // trading day number
      d.tmin[i] = Math.floor((sh - d.tday[i] * DAY) / 60000); // minutes since 18:00
      d.tdow[i] = (d.tday[i] + 4) % 7;                        // weekday of the trading day, 0 = Sunday
    }
  }

  const SOURCES = { close: 'Close', open: 'Open', high: 'High', low: 'Low', hl2: 'HL2', hlc3: 'HLC3', ohlc4: 'OHLC4' };
  const MA_FIELDS = [['len', 'Length', 'int', 1, 500], ['src', 'Source', 'src'], ['offset', 'Offset', 'int', -200, 200]];
  const IND_FIELDS = {
    ema: MA_FIELDS, sma: MA_FIELDS, wma: MA_FIELDS,
    vwap: [['src', 'Source', 'src'], ['anchor', 'Anchor', 'select', { session: 'Session (daily)', week: 'Week', month: 'Month' }],
      ['bandMult', 'Bands (std dev, 0 = off)', 'float', 0, 5], ['color2', 'Band color', 'color']],
    bb: [['len', 'Length', 'int', 1, 500], ['src', 'Source', 'src'], ['mult', 'Std dev', 'float', 0.1, 10],
      ['offset', 'Offset', 'int', -200, 200], ['color2', 'Band color', 'color'], ['fill', 'Fill opacity', 'float', 0, 1]],
    qt: [['daysBack', 'Trading days to show', 'int', 1, 10], ['showSessions', '6-hour sessions', 'bool'],
      ['show90', '90-minute quarters', 'bool'], ['showMicro', '22.5-minute quarters', 'bool'],
      ['shade', 'Shade sessions', 'bool'], ['labels', 'Labels', 'bool'], ['fill', 'Shade opacity', 'float', 0, 0.5],
      ['showTO', 'Daily & session True Opens', 'bool'], ['showWeekTO', 'Weekly True Open', 'bool'],
      ['color2', 'True Open color', 'color']],
    po3: [['htf', 'Timeframe', 'select', { 60: '1 hour', 240: '4 hours', D: 'Daily', W: 'Weekly' }],
      ['count', 'Candles', 'int', 1, 6], ['cw', 'Candle width', 'int', 4, 40], ['gap', 'Distance from price', 'int', 10, 300],
      ['upColor', 'Up candle', 'color'], ['downColor', 'Down candle', 'color'], ['showLevels', 'Open / High / Low lines', 'bool']]
  };
  const TYPE_DEFAULTS = {
    qt: { color: '#787b86', color2: '#ffeb3b', daysBack: 3, showSessions: true, show90: true, showMicro: false,
      shade: true, labels: true, fill: 0.06, showTO: true, showWeekTO: true, width: 1, style: 'dashed' },
    po3: { color: '#b2b5be', htf: '240', count: 3, cw: 12, gap: 40, upColor: '#26a69a', downColor: '#ef5350',
      showLevels: true, width: 1, style: 'dotted' }
  };
  const STYLE_FIELDS = [['color', 'Color', 'color'], ['width', 'Line width', 'select', { 1: '1', 2: '2', 3: '3', 4: '4' }],
    ['style', 'Line style', 'select', { solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted' }]];
  function normInd(ind) {
    const base = { len: IND_DEFAULT_LEN[ind.type] || 20, src: ind.type === 'vwap' ? 'hlc3' : 'close', offset: 0,
      width: 2, style: 'solid', color: '#2962ff', color2: ind.color || '#2962ff', mult: 2, fill: 0.08,
      anchor: 'session', bandMult: 0, ...(TYPE_DEFAULTS[ind.type] || {}) };
    for (const k of Object.keys(base)) if (ind[k] === undefined || ind[k] === null || ind[k] === '') ind[k] = base[k];
    return ind;
  }
  function indSummary(ind) {
    if (ind.type === 'qt') return 'Quarterly Theory';
    if (ind.type === 'po3') return 'PO3 ' + ({ 60: '1H', 240: '4H', D: 'D', W: 'W' }[ind.htf] || ind.htf);
    if (ind.type === 'vwap') return `VWAP ${ind.anchor === 'session' ? 'daily' : ind.anchor}${ind.bandMult > 0 ? ' ±' + ind.bandMult : ''}`;
    const src = ind.src !== 'close' ? ' ' + ind.src : '';
    return `${IND_TYPES[ind.type].replace(' (daily)', '')} ${ind.len}${ind.type === 'bb' ? ' ' + ind.mult : ''}${src}`;
  }
  function srcArr(d, src) {
    switch (src) {
      case 'open': return d.o;
      case 'high': return d.h;
      case 'low': return d.l;
      case 'hl2': return d.h.map((h, i) => (h + d.l[i]) / 2);
      case 'hlc3': return d.h.map((h, i) => (h + d.l[i] + d.c[i]) / 3);
      case 'ohlc4': return d.o.map((o, i) => (o + d.h[i] + d.l[i] + d.c[i]) / 4);
      default: return d.c;
    }
  }

  // Returns { lines: [main, ...bands], fill: [upper, lower] | null }
  function computeInd(ind, d) {
    normInd(ind);
    const c = srcArr(d, ind.src), n = c.length, len = Math.max(1, Math.round(ind.len || 1));
    const line = () => new Array(n).fill(null);
    if (ind.type === 'sma' || ind.type === 'bb') {
      const mid = line(), up = line(), lo = line(), k = ind.type === 'bb' ? +ind.mult : 0;
      let sum = 0, sq = 0;
      for (let i = 0; i < n; i++) {
        sum += c[i]; sq += c[i] * c[i];
        if (i >= len) { sum -= c[i - len]; sq -= c[i - len] * c[i - len]; }
        if (i >= len - 1) {
          const m = sum / len;
          mid[i] = m;
          const sd = Math.sqrt(Math.max(0, sq / len - m * m));
          up[i] = m + k * sd; lo[i] = m - k * sd;
        }
      }
      return ind.type === 'bb' ? { lines: [mid, up, lo], fill: [1, 2] } : { lines: [mid], fill: null };
    }
    if (ind.type === 'ema') {
      const out = line(), k = 2 / (len + 1);
      let e = null, seed = 0;
      for (let i = 0; i < n; i++) {
        if (i < len) { seed += c[i]; if (i === len - 1) { e = seed / len; out[i] = e; } continue; }
        e = c[i] * k + e * (1 - k);
        out[i] = e;
      }
      return { lines: [out], fill: null };
    }
    if (ind.type === 'wma') {
      const out = line(), wsum = len * (len + 1) / 2;
      for (let i = len - 1; i < n; i++) {
        let acc = 0;
        for (let j = 0; j < len; j++) acc += c[i - j] * (len - j);
        out[i] = acc / wsum;
      }
      return { lines: [out], fill: null };
    }
    if (ind.type === 'vwap') {
      const out = line(), up = line(), lo = line(), k = +ind.bandMult || 0;
      let pv = 0, pv2 = 0, vol = 0, key0 = null;
      for (let i = 0; i < n; i++) {
        const dt = new Date(d.t[i] * 1000);
        const key = ind.anchor === 'month' ? dt.getFullYear() * 12 + dt.getMonth()
          : ind.anchor === 'week' ? Math.floor((d.t[i] / 86400 + 3) / 7)
          : dt.getFullYear() * 1000 + dt.getMonth() * 40 + dt.getDate();
        if (key !== key0) { key0 = key; pv = 0; pv2 = 0; vol = 0; }
        const tp = c[i], v = d.v[i] || 0;
        pv += tp * v; pv2 += tp * tp * v; vol += v;
        const vw = vol > 0 ? pv / vol : tp;
        out[i] = vw;
        if (k > 0) {
          const sd = vol > 0 ? Math.sqrt(Math.max(0, pv2 / vol - vw * vw)) : 0;
          up[i] = vw + k * sd; lo[i] = vw - k * sd;
        }
      }
      return k > 0 ? { lines: [out, up, lo], fill: null } : { lines: [out], fill: null };
    }
    return { lines: [], fill: null };
  }

  /* ---- Quarterly Theory (Daye) ---- */
  const SESSION_NAMES = ['Asia', 'London', 'NY AM', 'NY PM'];
  const SESSION_TINT = ['#7e57c2', '#26c6da', '#66bb6a', '#ffa726'];
  function hexRgba(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex;
    const v = parseInt(m[1], 16);
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
  }
  function drawQT(g, ind, d, env) {
    const { ts, ps, fv, W, H } = env, n = d.t.length;
    if (!n) return;
    const bs = ts.barSpacing();
    const lastDay = d.tday[n - 1], firstDay = lastDay - (Math.max(1, ind.daysBack) - 1);
    const X = i => ts.indexToCoordinate(d.idx[i]);
    const DASH = { solid: [], dashed: [6, 4], dotted: [1.5, 3] };
    // segments for each level: session (6h), quarter (90m), micro (22.5m)
    const key = (i, lvl) => d.tday[i] * 1000 + (lvl === 0 ? Math.floor(d.tmin[i] / 360)
      : lvl === 1 ? Math.floor(d.tmin[i] / 90) : Math.floor(d.tmin[i] / 22.5));
    const segs = [[], [], []];
    for (let lvl = 0; lvl < 3; lvl++) {
      let cur = null;
      for (let i = 0; i < n; i++) {
        if (d.tday[i] < firstDay) continue;
        const k = key(i, lvl);
        if (!cur || cur.k !== k) { cur = { k, s: i, e: i }; segs[lvl].push(cur); } else cur.e = i;
      }
    }
    const visible = sg => { const x0 = X(sg.s) - bs / 2, x1 = X(sg.e) + bs / 2; return x1 >= 0 && x0 <= W ? [x0, x1] : null; };
    // shading per 6h session
    if (ind.shade && ind.showSessions) {
      for (const sg of segs[0]) {
        const v = visible(sg); if (!v) continue;
        g.fillStyle = hexRgba(SESSION_TINT[Math.floor(d.tmin[sg.s] / 360)], Math.max(0, +ind.fill));
        g.fillRect(v[0], 0, v[1] - v[0], H);
      }
    }
    // separators (micro faint, 90m dotted, session solid)
    const sep = (lvl, alpha, dash, width) => {
      g.strokeStyle = hexRgba(ind.color, alpha);
      g.setLineDash(dash); g.lineWidth = width;
      g.beginPath();
      for (const sg of segs[lvl]) {
        const x = Math.round(X(sg.s) - bs / 2) + 0.5;
        if (x < 0 || x > W) continue;
        g.moveTo(x, 0); g.lineTo(x, H);
      }
      g.stroke();
    };
    if (ind.showMicro) sep(2, 0.25, [1, 4], 1);
    if (ind.show90) sep(1, 0.55, [2, 3], 1);
    if (ind.showSessions) sep(0, 0.9, [], Math.max(1, +ind.width));
    g.setLineDash([]);
    // labels
    if (ind.labels) {
      g.font = '10px -apple-system, system-ui, sans-serif';
      g.textBaseline = 'top';
      if (ind.showSessions) for (const sg of segs[0]) {
        const v = visible(sg); if (!v || v[1] - v[0] < 30) continue;
        const si = Math.floor(d.tmin[sg.s] / 360);
        g.fillStyle = hexRgba(SESSION_TINT[si], 0.95);
        g.fillText(`${SESSION_NAMES[si]} · Q${si + 1}`, Math.max(v[0] + 3, 3), 4);
      }
      if (ind.show90) for (const sg of segs[1]) {
        const v = visible(sg); if (!v || v[1] - v[0] < 18) continue;
        g.fillStyle = hexRgba(ind.color, 0.9);
        g.fillText('q' + (Math.floor(d.tmin[sg.s] / 90) % 4 + 1), Math.max(v[0] + 3, 3), 18);
      }
      g.textBaseline = 'alphabetic';
    }
    // True Opens: line from the open of the 2nd quarter to the end of its cycle
    const toLine = (i0, i1, label, dash, width) => {
      const y = Math.round(ps.priceToCoordinate(d.o[i0], fv)) + 0.5;
      const x0 = X(i0) - bs / 2, x1 = i1 === n - 1 ? W : X(i1) + bs / 2;
      if (x1 < 0 || x0 > W) return;
      g.strokeStyle = ind.color2; g.lineWidth = width; g.setLineDash(dash);
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
      g.setLineDash([]);
      if (ind.labels) {
        g.font = '10px -apple-system, system-ui, sans-serif';
        g.fillStyle = ind.color2;
        g.fillText(label, Math.max(x0 + 2, 2), y - 3);
      }
    };
    if (ind.showTO) {
      // daily True Open = 00:00 New York (start of London, the day's 2nd quarter)
      const days = new Map();
      for (let i = 0; i < n; i++) {
        if (d.tday[i] < firstDay) continue;
        let r = days.get(d.tday[i]);
        if (!r) days.set(d.tday[i], r = { to: -1, end: i });
        r.end = i;
        if (r.to < 0 && d.tmin[i] >= 360) r.to = i;
      }
      for (const r of days.values()) if (r.to >= 0) toLine(r.to, r.end, 'Daily TO', DASH[ind.style] || [], Math.max(1, +ind.width) + 0.5);
      // session True Open = start of each session's 2nd 90-minute quarter
      for (const sg of segs[0]) {
        let to = -1;
        for (let i = sg.s; i <= sg.e; i++) if (d.tmin[i] % 360 >= 90) { to = i; break; }
        if (to >= 0) toLine(to, sg.e, 'Session TO', [2, 3], 1);
      }
    }
    if (ind.showWeekTO) {
      // weekly True Open = Monday 18:00 New York (start of the week's 2nd day, Tuesday's session)
      let wk = -1;
      for (let i = n - 1; i >= 0; i--) {
        if (d.tdow[i] === 2 && (i === 0 || d.tday[i - 1] !== d.tday[i])) { wk = i; break; }
        if (d.tdow[i] === 1 || d.tdow[i] === 0) break;   // still Monday: this week's TO isn't here yet
      }
      if (wk >= 0) toLine(wk, n - 1, 'Weekly TO', [8, 4], Math.max(1, +ind.width) + 1);
    }
  }

  /* ---- Power of Three: higher-timeframe candles to the right of price ---- */
  function htfKey(d, i, htf) {
    const sh = d.wall[i] + SHIFT;
    if (htf === 'W') return Math.floor((Math.floor(sh / DAY) + 3) / 7);  // weeks start Sunday 18:00
    if (htf === 'D') return d.tday[i];
    const mins = +htf || 240;
    return Math.floor(sh / (mins * 60000));                         // 4H: 18:00, 22:00, 02:00 ...
  }
  function drawPO3(g, ind, d, env) {
    const { ts, ps, fv, W } = env, n = d.t.length;
    if (!n) return;
    const candles = [];
    let cur = null;
    for (let i = 0; i < n; i++) {
      const k = htfKey(d, i, ind.htf);
      if (!cur || cur.k !== k) { cur = { k, s: i, o: d.o[i], h: d.h[i], l: d.l[i], c: d.c[i] }; candles.push(cur); }
      else { cur.h = Math.max(cur.h, d.h[i]); cur.l = Math.min(cur.l, d.l[i]); cur.c = d.c[i]; }
    }
    const show = candles.slice(-Math.max(1, ind.count));
    const Y = p => ps.priceToCoordinate(p, fv);
    const lastX = ts.indexToCoordinate(d.idx[n - 1]);
    const cw = Math.max(4, +ind.cw), step = cw + Math.max(4, Math.round(cw * 0.6));
    const live = show[show.length - 1];
    if (ind.showLevels && live) {
      const x0 = ts.indexToCoordinate(d.idx[live.s]);
      const DASH = { solid: [], dashed: [6, 4], dotted: [1.5, 3] };
      g.setLineDash(DASH[ind.style] || []);
      g.lineWidth = Math.max(1, +ind.width);
      g.font = '10px -apple-system, system-ui, sans-serif';
      for (const [p, name] of [[live.o, 'Open'], [live.h, 'High'], [live.l, 'Low']]) {
        const y = Math.round(Y(p)) + 0.5;
        g.strokeStyle = hexRgba(ind.color, 0.8);
        g.beginPath(); g.moveTo(Math.max(0, x0), y); g.lineTo(Math.min(W, lastX + ind.gap - 6), y); g.stroke();
        g.fillStyle = hexRgba(ind.color, 0.9);
        g.fillText(`HTF ${name}`, Math.max(2, x0 + 2), y - 3);
      }
      g.setLineDash([]);
    }
    let x = lastX + Math.max(10, +ind.gap);
    for (const c of show) {
      const up = c.c >= c.o, col = up ? ind.upColor : ind.downColor;
      const cx = Math.round(x + cw / 2) + 0.5;
      g.strokeStyle = col; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx, Y(c.h)); g.lineTo(cx, Y(c.l)); g.stroke();
      const yo = Y(c.o), yc = Y(c.c);
      g.fillStyle = col;
      g.fillRect(Math.round(x), Math.min(yo, yc), cw, Math.max(1, Math.abs(yc - yo)));
      x += step;
    }
    if (show.length) {
      g.font = '10px -apple-system, system-ui, sans-serif';
      g.fillStyle = hexRgba(ind.color, 0.9);
      const label = ({ 60: '1H', 240: '4H', D: 'Daily', W: 'Weekly' }[ind.htf] || ind.htf);
      const top = Math.min(...show.map(c => Y(c.h)));
      g.fillText(label, lastX + Math.max(10, +ind.gap), top - 6);
    }
  }
  const IND_DRAW = { qt: drawQT, po3: drawPO3 };
  window.__tvwpTest = { addNyTime, htfKey };   // used by the automated tests

  let indCanvas = null, indSig = '', indData = null, indDataSig = '', indLoop = false;
  function indPaneEl() {
    return document.querySelector('.chart-container.active .chart-markup-table.pane .chart-gui-wrapper') ||
           document.querySelector('.chart-markup-table.pane .chart-gui-wrapper');
  }
  function removeIndCanvas() { if (indCanvas) { indCanvas.remove(); indCanvas = null; } indSig = ''; }

  let indErrors = 0;
  function indFrame() {
    try { indFrameInner(); indErrors = 0; }
    catch (e) {
      // never let a bad frame spam errors or freeze the chart; back off and retry
      if (++indErrors === 1) console.warn('[TV Wallpaper] indicators paused:', e && e.message);
      if (indErrors > 3) { indLoop = false; removeIndCanvas(); setTimeout(() => { indErrors = 0; startInd(); }, 5000); }
    }
  }
  function indFrameInner() {
    const list = activeOverlays();
    if (!list.length) { removeIndCanvas(); indLoop = false; return; }
    requestAnimationFrame(indFrame);
    let cw, m, ms, ts, ps;
    try {
      cw = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      m = cw.model(); ms = m.mainSeries(); ts = m.timeScale(); ps = ms.priceScale();
    } catch (e) { return; }
    const host = indPaneEl();
    if (!host) return;
    if (!indCanvas || !indCanvas.isConnected || indCanvas.parentElement !== host) {
      removeIndCanvas();
      indCanvas = document.createElement('canvas');
      indCanvas.className = 'tvwp-ind';
      Object.assign(indCanvas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none' });
      const firstCanvas = host.querySelector(':scope > canvas');
      if (firstCanvas) firstCanvas.after(indCanvas); else host.appendChild(indCanvas);
    }
    const b = ms.bars();
    const lastV = b.size() ? b.valueAt(b.lastIndex()) : null;
    const fv = ms.firstValue();
    const dataSig = [b.size(), b.firstIndex(), b.lastIndex(), lastV && lastV.join(',')].join('|');
    const W = host.clientWidth, H = host.clientHeight, dpr = window.devicePixelRatio || 1;
    const sig = [dataSig, W, H, dpr, ts.barSpacing(), ts.indexToCoordinate(b.lastIndex() || 0),
      ps.priceToCoordinate(fv, fv), ps.priceToCoordinate(fv * 1.01, fv), JSON.stringify(list)].join('|');
    if (sig === indSig) return;
    indSig = sig;
    if (dataSig !== indDataSig) { indData = readBars(ms); indDataSig = dataSig; }
    const cv = indCanvas;
    if (cv.width !== Math.round(W * dpr)) cv.width = Math.round(W * dpr);
    if (cv.height !== Math.round(H * dpr)) cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineJoin = 'round';
    const d = indData;
    let legendY = H - 10;
    const DASH = { solid: [], dashed: [6, 4], dotted: [1.5, 3] };
    const hexA = (hex, a) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
      if (!m) return hex;
      const v = parseInt(m[1], 16);
      return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
    };
    for (const ind of list) {
      if (IND_DRAW[ind.type]) {
        normInd(ind);
        g.save();
        try { IND_DRAW[ind.type](g, ind, d, { ts, ps, fv, W, H }); } catch (e) { console.warn('[TV Wallpaper] indicator failed', e); }
        g.restore();
        g.font = '11px -apple-system, system-ui, sans-serif';
        g.fillStyle = ind.type === 'qt' ? ind.color2 : ind.color;
        g.fillText(indSummary(ind), 8, legendY);
        legendY -= 15;
        continue;
      }
      const res = computeInd(ind, d);
      const off = Math.round(ind.offset || 0);
      const pts = res.lines.map(vals => vals.map((v, i) => {
        if (v === null || !isFinite(v)) return null;
        const x = ts.indexToCoordinate(d.idx[i] + off);
        if (x < -50 || x > W + 50) return null;
        return [x, ps.priceToCoordinate(v, fv)];
      }));
      if (res.fill && ind.fill > 0) {
        const [a, b] = res.fill, top = [], bot = [];
        for (let i = 0; i < pts[a].length; i++) {
          if (pts[a][i] && pts[b][i]) { top.push(pts[a][i]); bot.push(pts[b][i]); }
        }
        if (top.length > 1) {
          g.beginPath();
          top.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
          for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i][0], bot[i][1]);
          g.closePath();
          g.fillStyle = hexA(ind.color2, Math.min(1, Math.max(0, +ind.fill)));
          g.fill();
        }
      }
      pts.forEach((line, li) => {
        g.beginPath();
        g.setLineDash(DASH[ind.style] || []);
        g.strokeStyle = li === 0 ? ind.color : ind.color2;
        g.lineWidth = li === 0 ? (+ind.width || 2) : Math.max(1, (+ind.width || 2) - 1);
        let pen = false;
        for (const p of line) {
          if (!p) { pen = false; continue; }
          if (pen) g.lineTo(p[0], p[1]); else { g.moveTo(p[0], p[1]); pen = true; }
        }
        g.stroke();
      });
      g.setLineDash([]);
      g.font = '11px -apple-system, system-ui, sans-serif';
      g.fillStyle = ind.color;
      g.fillText(indSummary(ind), 8, legendY);
      legendY -= 15;
    }
  }
  function startInd() {
    if (indLoop) { indSig = ''; return; }
    if (!activeOverlays().length) { removeIndCanvas(); return; }
    indLoop = true;
    requestAnimationFrame(indFrame);
  }
  setInterval(() => {
    const before = nativeCount;
    countNative();
    if (before !== nativeCount) { startInd(); if (buildUI.onInd) buildUI.onInd(); }
    else if (!indLoop && activeOverlays().length) startInd();
  }, 2000);

  /* =========================================================
   * Win / lose labels on take-profit and stop orders.
   * Some brokers (e.g. Tradovate) turn brackets into plain limit/stop orders,
   * so TradingView stops showing what you'd make or lose. This draws it.
   * Read-only: never touches your orders.
   * ======================================================= */
  const brk = { positions: [], orders: [], sym: {}, canvas: null, sig: '', loop: false, busy: false };
  const symRoot = s => String(s || '').split(':').pop().replace(/\d!$/, '').replace(/[FGHJKMNQUVXZ]\d{1,4}$/, '').toUpperCase();
  async function brkPoll() {
    if (brk.busy) return;
    const b = S.extras.brk && !S.extras.allOff ? currentBroker() : null;
    let connected = false;
    try { connected = !!(b && (typeof b.isConnected !== 'function' || b.isConnected())); } catch (e) {}
    if (!connected) { brk.positions = []; brk.orders = []; brkKick(); return; }
    brk.busy = true;
    try {
      const [pos, ords] = await Promise.all([b.positions(), b.orders()]);
      brk.positions = (pos || []).filter(p => p && p.qty);
      brk.orders = (ords || []).filter(o => o && o.status === 6 && (o.type === 1 || o.type === 3 || o.type === 4));
      for (const p of brk.positions) {
        if (!brk.sym[p.symbol] && typeof b.symbolInfo === 'function') {
          try { brk.sym[p.symbol] = await b.symbolInfo(p.symbol); } catch (e) { brk.sym[p.symbol] = {}; }
        }
      }
    } catch (e) {
      brk.positions = []; brk.orders = [];
    } finally { brk.busy = false; }
    brkKick();
  }
  setInterval(brkPoll, 1000);

  function brkLabels() {
    let chartSym = '';
    try { chartSym = window.TradingViewApi.activeChart().symbol(); } catch (e) {}
    const root = symRoot(chartSym), out = [];
    for (const p of brk.positions) {
      if (symRoot(p.symbol) !== root) continue;
      const info = brk.sym[p.symbol] || {};
      const tick = +info.minTick || +info.pipSize || 0;
      if (!tick) continue;
      const perTick = (+info.pipValue || 0) * (tick / (+info.pipSize || tick));
      const long = p.side !== -1;
      for (const o of brk.orders) {
        if (symRoot(o.symbol) !== root) continue;
        if (o.parentId) continue;                           // real brackets: TradingView already shows these
        if ((o.side === -1) !== long) continue;             // only orders that would close the position
        const price = o.type === 1 ? o.limitPrice : o.stopPrice;
        if (!isFinite(price)) continue;
        const ticks = Math.round(((price - p.avgPrice) / tick) * (long ? 1 : -1));
        const qty = Math.min(+o.qty || 0, Math.abs(+p.qty) || 0) || Math.abs(+p.qty) || 1;
        const money = ticks * perTick * qty;
        const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '');
        const t = `${sign(ticks)}${Math.abs(ticks)} ticks`;
        const m = perTick ? `${sign(money)}${Math.abs(money).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${info.currency || 'USD'}` : '';
        const text = S.extras.brkMode === 'money' && m ? m : S.extras.brkMode === 'both' && m ? `${t} · ${m}` : t;
        out.push({ price, text, win: ticks >= 0, kind: ticks >= 0 ? 'TP' : 'SL' });
      }
    }
    return out;
  }
  function brkKick() { brk.sig = ''; if (!brk.loop) { brk.loop = true; requestAnimationFrame(brkFrame); } }
  function brkFrame() {
    const labels = S.extras.brk && !S.extras.allOff ? brkLabels() : [];
    if (!labels.length) {
      if (brk.canvas) { brk.canvas.remove(); brk.canvas = null; }
      brk.loop = false; brk.sig = '';
      return;
    }
    requestAnimationFrame(brkFrame);
    let ms, ps, fv;
    try {
      const m = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model();
      ms = m.mainSeries(); ps = ms.priceScale(); fv = ms.firstValue();
    } catch (e) { return; }
    const host = indPaneEl();
    if (!host) return;
    if (!brk.canvas || !brk.canvas.isConnected || brk.canvas.parentElement !== host) {
      if (brk.canvas) brk.canvas.remove();
      brk.canvas = document.createElement('canvas');
      brk.canvas.className = 'tvwp-brk';
      Object.assign(brk.canvas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none' });
      host.appendChild(brk.canvas);
    }
    const W = host.clientWidth, H = host.clientHeight, dpr = window.devicePixelRatio || 1;
    const ys = labels.map(l => ps.priceToCoordinate(l.price, fv));
    const sig = [W, H, dpr, S.extras.streamer, S.extras.streamerChart, S.extras.brkRight, JSON.stringify(labels), ys.map(Math.round).join(',')].join('|');
    if (sig === brk.sig) return;
    brk.sig = sig;
    const cv = brk.canvas;
    if (cv.width !== Math.round(W * dpr)) cv.width = Math.round(W * dpr);
    if (cv.height !== Math.round(H * dpr)) cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = '600 11px -apple-system, system-ui, "Segoe UI", sans-serif';
    g.textBaseline = 'middle';
    labels.forEach((l, i) => {
      const y = ys[i];
      if (!isFinite(y) || y < -10 || y > H + 10) return;
      const tag = l.kind, text = l.text;            // fillText masks it in Streamer mode
      const tw = g.measureText(tag).width, xw = g.measureText(text).width;
      const pad = 6, h = 18, w = tw + xw + pad * 4;
      const right = W - Math.max(0, +S.extras.brkRight || 0);
      const x = Math.max(4, right - w);
      const col = l.win ? '#22ab94' : '#f23645';
      g.fillStyle = 'rgba(19,23,34,0.92)';
      g.strokeStyle = col; g.lineWidth = 1;
      g.beginPath();
      if (g.roundRect) g.roundRect(x + 0.5, y - h / 2 + 0.5, w, h, 3); else g.rect(x + 0.5, y - h / 2 + 0.5, w, h);
      g.fill(); g.stroke();
      g.fillStyle = col;
      g.fillText(tag, x + pad, y + 1);
      g.fillText(text, x + pad * 3 + tw, y + 1);
    });
  }

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
    if (!S.wall.enabled || !source || S.extras.allOff) {
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
  * { box-sizing: border-box; font-family: Inter, -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; }
  .panel {
    --bg: #15171e; --nav: #101218; --card: #1c1f28; --card2: #232733; --line: #2a2e3a; --line2: #343949;
    --text: #e7e9ef; --muted: #8a90a2; --accent: #5b6cff; --accent2: #7f8cff; --accentBg: rgba(91,108,255,.14);
    --good: #22c39a; --bad: #f2495c; --warn: #f5a524; --shadow: 0 24px 60px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.35);
  }
  .panel.light {
    --bg: #f6f7fb; --nav: #eceef5; --card: #ffffff; --card2: #f3f4f8; --line: #e1e4ec; --line2: #d3d7e2;
    --text: #1a1e29; --muted: #697083; --accentBg: rgba(91,108,255,.10);
    --shadow: 0 24px 60px rgba(20,24,40,.18), 0 2px 8px rgba(20,24,40,.08);
  }

  /* floating button */
  .fab { position: fixed; z-index: 2147483000; width: 38px; height: 38px; border-radius: 12px; border: none; cursor: grab;
    display: grid; place-items: center; color: #fff; touch-action: none; user-select: none;
    background: linear-gradient(135deg, #5b6cff 0%, #22c3e6 100%); box-shadow: 0 6px 18px rgba(0,0,0,.4); transition: transform .12s; }
  .fab:hover { transform: translateY(-1px); }
  .fab:active { cursor: grabbing; }
  .fab.live { box-shadow: 0 0 0 3px #f2495c, 0 6px 18px rgba(0,0,0,.4); }
  .fab svg { width: 20px; height: 20px; pointer-events: none; }

  /* window */
  .panel { position: fixed; z-index: 2147483001; isolation: isolate; display: none; grid-template-columns: 196px 1fr;
    width: min(800px, calc(100vw - 24px)); height: min(640px, calc(100vh - 24px));
    background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 16px; overflow: hidden;
    box-shadow: var(--shadow); font-size: 13px; line-height: 1.4; }
  .panel.open { display: grid; }

  /* sidebar */
  aside { background: var(--nav); border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .brand { display: flex; align-items: center; gap: 9px; padding: 14px 14px 10px; font-weight: 700; font-size: 14px; }
  .logo { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; color: #fff;
    background: linear-gradient(135deg, #5b6cff 0%, #22c3e6 100%); }
  .logo svg { width: 15px; height: 15px; }
  .conn { margin: 0 10px 8px; padding: 9px 10px; border-radius: 10px; background: var(--card); border: 1px solid var(--line); display: flex; gap: 9px; align-items: center; }
  .conn b { display: block; font-size: 12.5px; }
  .conn small { color: var(--muted); font-size: 11.5px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; }
  .dot.on { background: var(--good); box-shadow: 0 0 0 3px rgba(34,195,154,.18); }
  .tabs { flex: 1; overflow: auto; padding: 2px 8px 8px; display: flex; flex-direction: column; gap: 1px; }
  .grp { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); padding: 8px 8px 3px; }
  .tabs button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 6px 8px; border: none; border-radius: 8px;
    background: none; color: var(--text); font: inherit; font-size: 13px; cursor: pointer; text-align: left; opacity: .82; }
  .tabs button svg { width: 16px; height: 16px; flex: none; color: var(--muted); }
  .tabs button:hover { background: var(--card); opacity: 1; }
  .tabs button.on { background: var(--accent); color: #fff; opacity: 1; font-weight: 600; }
  .tabs button.on svg { color: #fff; }
  .tabs button .badge { margin-left: auto; font-size: 10.5px; padding: 1px 6px; border-radius: 10px; background: var(--card2); color: var(--muted); }
  .tabs button.on .badge { background: rgba(255,255,255,.22); color: #fff; }
  .power { width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--line2); background: var(--card); color: var(--good); cursor: pointer; display: grid; place-items: center; padding: 0; }
  .power svg { width: 15px; height: 15px; }
  .power:hover { border-color: var(--bad); color: var(--bad); }
  .power.off { color: var(--bad); border-color: var(--bad); background: rgba(242,73,92,.12); }
  .offbar { display: none; align-items: center; justify-content: space-between; gap: 10px; margin: 12px 18px 0; padding: 10px 12px; border-radius: 10px;
    background: rgba(242,73,92,.12); color: var(--bad); font-size: 12.5px; font-weight: 600; }
  .panel.alloff .offbar { display: flex; }
  .panel.alloff .content, .panel.alloff .quick { opacity: .45; pointer-events: none; }
  .fab.alloff { filter: grayscale(1); opacity: .55; }
  .quick { border-top: 1px solid var(--line); padding: 6px 10px; display: grid; gap: 0; }
  .quick label { display: flex; align-items: center; justify-content: space-between; padding: 4px 4px; font-size: 12.5px; cursor: pointer; }
  .foot { padding: 8px 14px 12px; color: var(--muted); font-size: 11px; border-top: 1px solid var(--line); }

  /* main */
  main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  header { display: flex; align-items: flex-start; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid var(--line); cursor: move; user-select: none; }
  header .t { flex: 1; min-width: 0; }
  h1 { font-size: 18px; margin: 0; font-weight: 700; letter-spacing: -.01em; }
  header p { margin: 2px 0 0; color: var(--muted); font-size: 12.5px; }
  .pill { font-size: 11.5px; font-weight: 600; padding: 4px 10px; border-radius: 20px; background: var(--card2); color: var(--muted); white-space: nowrap; display: flex; align-items: center; gap: 6px; }
  .pill.live { background: rgba(242,73,92,.14); color: var(--bad); }
  .pill.ok { background: rgba(34,195,154,.13); color: var(--good); }
  .x { width: 28px; height: 28px; border-radius: 8px; border: none; background: none; color: var(--muted); font-size: 20px; line-height: 1; cursor: pointer; }
  .x:hover { background: var(--card2); color: var(--text); }
  .content { flex: 1; overflow: auto; padding: 14px 18px 20px; }
  section { display: none; gap: 12px; }
  section.on { display: grid; }

  /* cards & rows */
  .card, .sgroup, .side { background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
  .card > .item + .item, .card > .item + .sub { border-top: 1px solid var(--line); }
  .item { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 11px 14px; min-height: 48px; }
  .item .txt { min-width: 0; }
  .item .txt b { display: block; font-weight: 600; font-size: 13px; }
  .item .txt small { display: block; color: var(--muted); font-size: 12px; margin-top: 1px; }
  .item select, .item input[type=range] { width: 190px; flex: none; }
  .item input[type=number] { width: 90px; }
  .sub { padding: 12px 14px; display: grid; gap: 10px; }
  .card-h { padding: 11px 14px 0; font-weight: 600; font-size: 13px; display: flex; justify-content: space-between; align-items: center; }
  .card-h small { color: var(--muted); font-weight: 400; }
  .sgroup { display: grid; gap: 6px; padding: 10px 14px 12px; }
  .sgroup h3 { margin: 2px 0 2px; font-size: 13px; font-weight: 600; color: var(--text); }
  .row { display: flex; gap: 8px; align-items: center; }
  .between { justify-content: space-between; }
  .hint { color: var(--muted); font-size: 12px; }
  .msg { font-size: 12px; color: var(--warn); }
  .msg:empty { display: none; }
  kbd { font: 600 11px ui-monospace, Menlo, monospace; padding: 2px 6px; border-radius: 5px; background: var(--card2); border: 1px solid var(--line2); }
  a { color: var(--accent2); text-decoration: none; }

  /* controls */
  .btn { flex: 1; display: inline-flex; justify-content: center; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 9px;
    border: 1px solid var(--line2); background: var(--card2); color: var(--text); cursor: pointer; font: inherit; font-weight: 600; font-size: 12.5px; }
  .btn:hover { border-color: var(--accent); }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn.slim { flex: none; }
  select, input[type=number], input[type=text] { background: var(--card2); color: var(--text); border: 1px solid var(--line2); border-radius: 8px; padding: 6px 8px; font: inherit; font-size: 12.5px; outline: none; }
  select:focus, input:focus { border-color: var(--accent); }
  input[type=range] { accent-color: var(--accent); }
  input[type=checkbox] { appearance: none; -webkit-appearance: none; flex: none; width: 34px; height: 20px; border-radius: 20px; margin: 0;
    background: var(--line2); position: relative; cursor: pointer; transition: background .15s; }
  input[type=checkbox]::before { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: transform .15s; }
  input[type=checkbox]:checked { background: var(--accent); }
  input[type=checkbox]:checked::before { transform: translateX(14px); }
  input[type=color] { width: 40px; height: 26px; padding: 0; border: 1px solid var(--line2); border-radius: 7px; background: none; cursor: pointer; }
  .seg { display: inline-flex; padding: 3px; gap: 2px; background: var(--card2); border: 1px solid var(--line2); border-radius: 9px; }
  .seg button { border: none; background: none; color: var(--muted); font: inherit; font-size: 12.5px; padding: 5px 12px; border-radius: 7px; cursor: pointer; }
  .seg button.on { background: var(--card); color: var(--text); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.2); }

  /* wallpaper */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
  .thumb { position: relative; aspect-ratio: 16/10; border-radius: 9px; overflow: hidden; border: 2px solid transparent; cursor: pointer; background: var(--card2); }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb.active { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accentBg); }
  .tag { position: absolute; left: 5px; bottom: 5px; background: rgba(0,0,0,.7); color: #fff; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px; }
  .del { position: absolute; top: 5px; right: 5px; width: 20px; height: 20px; border: none; border-radius: 50%; background: rgba(0,0,0,.7); color: #fff; font-size: 13px; line-height: 20px; cursor: pointer; display: none; padding: 0; }
  .thumb:hover .del { display: block; }
  .empty { color: var(--muted); grid-column: 1/-1; text-align: center; padding: 22px 0; border: 1px dashed var(--line2); border-radius: 10px; }

  /* candles */
  .side { display: grid; gap: 10px; padding: 12px 14px; }
  .side-head { display: flex; align-items: center; justify-content: space-between; font-weight: 600; }
  .rgb { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.6fr); gap: 8px; }
  input[type=number] { -moz-appearance: textfield; }
  input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .rgb label { display: grid; gap: 3px; font-size: 11px; color: var(--muted); }
  .rgb input { width: 100%; padding: 5px 7px; }
  .field { display: grid; gap: 4px; }
  .field > span { color: var(--muted); font-size: 12px; }
  .extra { display: none; gap: 8px; grid-template-columns: 1fr 1fr; }
  .extra.on { display: grid; }
  .extra label { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--muted); gap: 6px; }
  .candle-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .presets { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 14px; }
  .preset { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid var(--line2); border-radius: 20px; background: var(--card2); color: var(--text); font: inherit; font-size: 12px; cursor: pointer; }
  .preset:hover { border-color: var(--accent); }
  .preset i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .detected { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
  .detected i { width: 14px; height: 14px; border-radius: 4px; display: inline-block; border: 1px solid var(--line2); }

  /* sounds & indicators */
  .srow { display: grid; grid-template-columns: 34px 1fr 140px 30px; gap: 8px; align-items: center; padding: 3px 0; }
  .srow .lbl { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .srow select { padding: 5px 6px; font-size: 12px; width: 100%; }
  .play { width: 30px; height: 28px; border-radius: 8px; border: 1px solid var(--line2); background: var(--card2); color: var(--text); cursor: pointer; padding: 0; }
  .play:hover { border-color: var(--accent); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: flex; align-items: center; gap: 4px; padding: 3px 4px 3px 10px; border: 1px solid var(--line2); border-radius: 16px; font-size: 12px; max-width: 100%; background: var(--card2); }
  .chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
  .chip button { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 14px; line-height: 1; }
  .last { font-size: 12px; color: var(--muted); }
  .last:not(:empty) { padding: 9px 12px; border-radius: 10px; background: var(--card); border: 1px solid var(--line); color: var(--text); }
  .iset { display: grid; grid-template-columns: 1fr 150px; gap: 8px 10px; align-items: center; padding: 10px 12px; margin: 2px 0 6px 42px;
    border-left: 2px solid var(--accent); background: var(--card2); border-radius: 0 9px 9px 0; }
  .iset label { font-size: 12px; color: var(--muted); }
  .iset input[type=number], .iset select { width: 100%; padding: 5px 6px; font-size: 12px; }
  .iset input[type=color] { width: 44px; height: 24px; }
  .gear { width: 28px; height: 26px; border-radius: 7px; border: 1px solid var(--line2); background: var(--card2); color: var(--text); cursor: pointer; padding: 0; font-size: 13px; }
  .gear.on { border-color: var(--accent); background: var(--accent); color: #fff; }
  .trow { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, .9fr) 30px 30px; gap: 8px; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); }
  .trow:first-of-type { border-top: none; }
  .trow b { font-size: 12.5px; display: block; }
  .trow small { color: var(--muted); font-size: 11.5px; display: block; }
  .trow .px { font-size: 12px; font-variant-numeric: tabular-nums; }
  .trow .pnl { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; font-size: 12.5px; }
  .trow .pnl.win { color: var(--good); } .trow .pnl.loss { color: var(--bad); }
  .side-l { color: var(--good); } .side-s { color: var(--bad); }
  .rec-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--bad); margin-right: 6px; animation: blink 1s infinite; }
  @keyframes blink { 50% { opacity: .25; } }
  .player { position: absolute; inset: 0; background: rgba(0,0,0,.6); display: grid; place-items: center; z-index: 5; }
  .player[hidden] { display: none; }
  .pbox { width: min(680px, 92%); background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px; display: grid; gap: 10px; }
  .pbox video { width: 100%; border-radius: 8px; background: #000; max-height: 60vh; }
  .status { padding: 10px 12px; border-radius: 10px; background: var(--accentBg); color: var(--text); font-size: 12.5px; }

  @media (max-width: 620px) {
    .panel { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
    aside { border-right: none; border-bottom: 1px solid var(--line); }
    .tabs { flex-direction: row; overflow-x: auto; padding: 6px 8px; }
    .tabs button { width: auto; white-space: nowrap; }
    .grp, .quick, .foot, .conn { display: none; }
    .item select, .item input[type=range] { width: 140px; }
    .candle-pair { grid-template-columns: 1fr; }
  }
  `;

  const SIDE_HTML = side => `
    <div class="side" data-side="${side}">
      <div class="side-head"><span>${side === 'up' ? 'Up candles' : 'Down candles'}</span><input type="color" class="main"></div>
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

  const ICON = {
    logo: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="7" width="4" height="10" rx="1"/><rect x="5.5" y="4" width="1" height="16" rx=".5"/><rect x="10" y="5" width="4" height="8" rx="1"/><rect x="11.5" y="3" width="1" height="13" rx=".5"/><rect x="16" y="9" width="4" height="9" rx="1"/><rect x="17.5" y="6" width="1" height="15" rx=".5"/></svg>',
    wall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    candles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 3v4M7 17v4M17 3v6M17 17v4"/><rect x="4.5" y="7" width="5" height="10" rx="1"/><rect x="14.5" y="9" width="5" height="8" rx="1"/></svg>',
    ind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-6 4 3 8-9"/><path d="M3 21h18"/></svg>',
    sounds: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/></svg>',
    trading: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 17h16"/><path d="M8 4v6M16 14v6"/></svg>',
    stream: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>',
    journal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
    extras: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>'
  };
  const PAGES = {
    wall: ['Wallpaper', 'Images and GIFs behind your chart.'],
    candles: ['Candles', 'Your own candle colors. Only changes what you see.'],
    ind: ['Indicators', "Extra indicators on the chart, within your plan's limit."],
    sounds: ['Sounds', 'A sound when your orders fill, per order type.'],
    trading: ['Brackets', 'Win / lose amounts on your take-profit and stop orders.'],
    stream: ['Streamer', 'Hide your P&L and balances while streaming.'],
    journal: ['Journal', 'Every trade recorded automatically, with an optional chart video.'],
    extras: ['General', 'Ads, appearance, shortcuts and info.']
  };
  const item = (title, desc, control) => `<div class="item"><div class="txt"><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</div>${control}</div>`;
  const NAV = (tab, label) => `<button data-tab="${tab}">${ICON[tab]}<span>${label}</span><span class="badge" data-badge="${tab}" hidden></span></button>`;

  const HTML = `
  <button class="fab" title="TV Wallpaper (Alt+Shift+W)">${ICON.logo}</button>
  <div class="panel">
    <aside>
      <div class="brand"><span class="logo">${ICON.logo}</span><span style="flex:1">TV Wallpaper</span>
        <button class="power" id="power" title="Turn everything off (Alt+Shift+X)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1011.4 0"/></svg></button></div>
      <div class="conn"><span class="dot" id="connDot"></span><div><b>TradingView</b><small id="connText">Checking…</small></div></div>
      <nav class="tabs">
        <div class="grp">Chart</div>
        ${NAV('wall', 'Wallpaper')}${NAV('candles', 'Candles')}${NAV('ind', 'Indicators')}
        <div class="grp">Trading</div>
        ${NAV('journal', 'Journal')}${NAV('sounds', 'Sounds')}${NAV('trading', 'Brackets')}${NAV('stream', 'Streamer')}
        <div class="grp">App</div>
        ${NAV('extras', 'General')}
      </nav>
      <div class="quick">
        <label>Wallpaper <input type="checkbox" id="qWall"></label>
        <label>Candles <input type="checkbox" id="qCandles"></label>
        <label>Sounds <input type="checkbox" id="qSounds"></label>
        <label>Streamer <input type="checkbox" id="qStream"></label>
      </div>
      <div class="foot">v${VERSION} · <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>W</kbd></div>
    </aside>
    <main>
      <header><div class="t"><h1 id="pgTitle"></h1><p id="pgSub"></p></div><span class="pill" id="pill"></span><button class="x" title="Close">×</button></header>
      <div class="offbar" id="offbar">Everything is turned off. Your settings are saved. <button class="btn primary slim" id="powerOn">Turn back on</button></div>
      <div class="content">

    <section data-tab="wall">
      <div class="card">${item('Show wallpaper', 'Images, GIFs and animated WebP behind your candles.', '<input type="checkbox" id="wEnabled">')}</div>
      <div class="card">
        <div class="card-h">Your wallpapers <small>Click one to use it</small></div>
        <div class="sub">
          <div class="grid" id="grid"></div>
          <div class="msg" id="wMsg"></div>
          <div class="row">
            <label class="btn">＋ Add images / GIFs<input type="file" id="file" accept="image/*" multiple hidden></label>
            <button class="btn primary" id="next">Next wallpaper →</button>
          </div>
        </div>
      </div>
      <div class="card">
        ${item('Strength <span class="hint" id="opVal"></span>', 'How strongly the image shows through.', '<input type="range" id="opacity" min="0.05" max="1" step="0.05">')}
        ${item('Blend', 'Match this to your chart theme.', `<select id="blend">
          <option value="lighten">Dark chart – subtle</option><option value="screen">Dark chart – vivid</option>
          <option value="darken">Light chart – subtle</option><option value="multiply">Light chart – vivid</option></select>`)}
        ${item('Fit', 'How the image fills the chart.', `<select id="fit">
          <option value="cover">Fill (crop)</option><option value="contain">Fit (letterbox)</option><option value="stretch">Stretch</option></select>`)}
      </div>
    </section>

    <section data-tab="candles">
      <div class="card">${item('Custom candle colors', 'Recolors candles, wicks and borders on your screen.', '<input type="checkbox" id="cEnabled">')}</div>
      <div class="card"><div class="card-h">Presets</div><div class="presets" id="presets"></div></div>
      <div class="candle-pair">${SIDE_HTML('up')}${SIDE_HTML('down')}</div>
      <div class="card">
        ${item('Separate border & wick colors', 'Pick border and wick colors on their own.', '<input type="checkbox" id="cSeparate">')}
        ${item('Recolor volume bars', 'Volume bars follow your candle colors.', '<input type="checkbox" id="cVolume">')}
        ${item("Chart's current colors", 'These are the colors being replaced.', '<div class="detected" id="detected"></div>')}
        <div class="sub"><div class="row"><button class="btn" id="redetect">Re-detect colors</button><button class="btn" id="cReset">Turn off</button></div></div>
      </div>
    </section>

    <section data-tab="ind">
      <div class="status" id="iStatus"></div>
      <div class="sgroup" id="iList"><h3>Your indicators</h3></div>
      <div class="card"><div class="sub">
        <div class="row"><select id="iType" style="flex:1"></select><button class="btn primary slim" id="iAdd">＋ Add</button></div>
        <div class="msg" id="iMsg"></div>
        <div class="hint">Drawn on the main chart pane. Click ⚙ on an indicator for its settings.</div>
      </div></div>
    </section>

    <section data-tab="sounds">
      <div class="card">
        ${item('Order sounds', 'Plays when your orders fill. Works with any broker in TradingView.', '<input type="checkbox" id="sEnabled">')}
        ${item('Volume <span class="hint" id="sVolVal"></span>', '', '<input type="range" id="sVol" min="0.05" max="1" step="0.05">')}
        ${item('One sound for all fills', 'Use the same sound for every order type.', '<input type="checkbox" id="sOne">')}
        ${item("Mute TradingView's own fill sound", 'So you only hear yours.', '<input type="checkbox" id="sMuteTV">')}
      </div>
      <div class="sgroup" id="sFills"><h3>Fills</h3></div>
      <div class="sgroup" id="sOther"><h3>Other order events</h3></div>
      <div class="sgroup"><h3>Your sounds</h3>
        <div class="chips" id="sChips"></div>
        <label class="btn">＋ Upload sounds (MP3, WAV…)<input type="file" id="sFile" accept="audio/*" multiple hidden></label>
        <div class="msg" id="sMsg"></div>
      </div>
      <div class="last" id="sLast"></div>
      <div class="hint">Click anywhere on the chart once after opening it, so the browser allows sound.</div>
    </section>

    <section data-tab="journal">
      <div class="card">
        ${item('Record my trades', 'Logs every trade from your broker: entry, exit, size, P&amp;L, time held.', '<input type="checkbox" id="rOn">')}
        ${item('Record chart video', 'Records the chart from entry until a few seconds after exit. No permission pop-ups.', '<input type="checkbox" id="rVideo">')}
        ${item('Video quality', '', '<select id="rQuality"><option value="720">720p (smaller files)</option><option value="1080">1080p</option></select>')}
        ${item('Keep videos', 'Older videos are deleted automatically. Trades are always kept.', '<select id="rKeep"><option value="10">Last 10</option><option value="25">Last 25</option><option value="50">Last 50</option><option value="100">Last 100</option></select>')}
      </div>
      <div class="status" id="rStats"></div>
      <div class="sgroup" id="rList"><h3>Recent trades</h3></div>
      <div class="row"><button class="btn" id="rCsv">⬇ Export CSV (Excel)</button><button class="btn" id="rClear">Clear journal</button></div>
      <div class="hint">Keeps recording when TradingView is in a background tab or minimized, and catches up on trades made while it was closed, including trades placed on your broker's own app. In Chrome, add tradingview.com to Settings → Performance → Memory Saver → "Always keep these sites active".</div>
      <div class="player" id="rPlayer" hidden><div class="pbox"><div class="row between"><b id="rPTitle"></b><button class="x" id="rPClose">×</button></div><video id="rVideoEl" controls playsinline></video><div class="row"><a class="btn" id="rPDown" download>⬇ Download video</a></div></div></div>
    </section>

    <section data-tab="trading">
      <div class="card">
        ${item('Show win / lose on TP & SL orders', 'For brokers like Tradovate that turn brackets into plain limit/stop orders.', '<input type="checkbox" id="xBrk">')}
        ${item('Show as', '', '<select id="xBrkMode"><option value="ticks">Ticks</option><option value="money">Money</option><option value="both">Ticks + money</option></select>')}
        ${item('Distance from right edge', 'Slide labels so they sit next to your order labels.', '<input type="number" id="xBrkRight" min="0" max="800" step="10">')}
      </div>
      <div class="hint">Only reads your orders. It never places or changes anything.</div>
    </section>

    <section data-tab="stream">
      <div class="card">
        ${item('Streamer mode', 'Hide P&L, balance, equity and margin. Shortcut: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>', '<input type="checkbox" id="xStream">')}
        ${item('Also on the chart', 'Mask P&L on position lines and brackets.', '<input type="checkbox" id="xStreamChart">')}
        ${item('Style', '', '<select id="xStreamStyle"><option value="blur">Blur</option><option value="hide">Cover completely</option></select>')}
      </div>
      <div class="hint">Covers the account panel, money columns in your history tables, and any amount with a currency, ticks, pips or points. Prices and symbols stay visible.</div>
    </section>

    <section data-tab="extras">
      <div class="card">
        ${item('Turn everything off', 'Stops every feature at once. Your settings stay saved. Shortcut: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>', '<input type="checkbox" id="gAllOff">')}
        ${item('Hide ads', "Hides TradingView's ad pop-ups on the chart.", '<input type="checkbox" id="xAds">')}
        ${item('Theme', 'Auto follows your TradingView theme.', '<div class="seg" id="gTheme"><button data-v="auto">Auto</button><button data-v="dark">Dark</button><button data-v="light">Light</button></div>')}
        ${item('Button position', 'Drag the floating button anywhere, or put it back here.', '<button class="btn slim" id="gResetPos">Reset</button>')}
      </div>
      <div class="card">
        ${item('Open / close this window', '', '<span><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>W</kbd></span>')}
        ${item('Streamer mode on / off', '', '<span><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd></span>')}
        ${item('Everything off / on', '', '<span><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd></span>')}
      </div>
      <div class="card">
        ${item('Version', 'Updates install automatically.', `<span class="hint">v${VERSION}</span>`)}
        ${item('Source & help', '', '<a href="https://github.com/antoniog06/tv-wallpaper" target="_blank" rel="noopener">GitHub ↗</a>')}
      </div>
    </section>

      </div>
    </main>
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
      placeFab();
      const pw = panel.offsetWidth || 780, ph = panel.offsetHeight || 580;
      let left = S.ui.px ?? Math.round((window.innerWidth - pw) / 2);
      let top = S.ui.py ?? Math.round((window.innerHeight - ph) / 2);
      left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - pw - 8));
      top = Math.min(Math.max(8, top), Math.max(8, window.innerHeight - ph - 8));
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
    }
    // drag the window by its header
    const head = $('header');
    let wdrag = null;
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button, .pill')) return;
      wdrag = { sx: e.clientX, sy: e.clientY, ox: panel.offsetLeft, oy: panel.offsetTop };
      try { head.setPointerCapture(e.pointerId); } catch (err) {}
    });
    head.addEventListener('pointermove', e => {
      if (!wdrag) return;
      S.ui.px = wdrag.ox + e.clientX - wdrag.sx; S.ui.py = wdrag.oy + e.clientY - wdrag.sy;
      placePanel();
    });
    head.addEventListener('pointerup', () => { if (wdrag) { wdrag = null; save(null); } });
    let drag = null;
    fab.addEventListener('pointerdown', e => {
      drag = { sx: e.clientX, sy: e.clientY, ox: fab.offsetLeft, oy: fab.offsetTop, moved: false };
      try { fab.setPointerCapture(e.pointerId); } catch (err) {}
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
      if (!PAGES[t]) t = 'wall';
      root.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
      root.querySelectorAll('section').forEach(s => s.classList.toggle('on', s.dataset.tab === t));
      $('#pgTitle').textContent = PAGES[t][0];
      $('#pgSub').textContent = PAGES[t][1];
      $('.content').scrollTop = 0;
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

    /* ---- sounds tab ---- */
    let soundFiles = [];
    function soundOptions(selected) {
      const opts = ['<option value="none">None</option>', '<optgroup label="Built-in">'];
      for (const [k, v] of Object.entries(TONES)) opts.push(`<option value="tone:${k}">${v}</option>`);
      opts.push('</optgroup>');
      if (soundFiles.length) {
        opts.push('<optgroup label="Your sounds">');
        for (const f of soundFiles) {
          const name = f.name.replace(/[<>&"]/g, '');
          opts.push(`<option value="file:${f.id}">${name}</option>`);
        }
        opts.push('</optgroup>');
      }
      const sel = document.createElement('select');
      sel.innerHTML = opts.join('');
      sel.value = selected;
      if (sel.value !== selected) sel.value = 'none';
      return sel;
    }
    function soundRow(label, getRef, setRef, getOn, setOn) {
      const row = document.createElement('div');
      row.className = 'srow';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      if (getOn) { cb.checked = getOn(); cb.onchange = () => { setOn(cb.checked); saveSounds(); }; }
      else cb.style.visibility = 'hidden';
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = label;
      const sel = soundOptions(getRef());
      sel.onchange = () => { setRef(sel.value); saveSounds(); playSound(sel.value); };
      const play = document.createElement('button');
      play.className = 'play';
      play.title = 'Test';
      play.textContent = '▶';
      play.onclick = () => playSound(sel.value);
      row.append(cb, lbl, sel, play);
      return row;
    }
    function saveSounds() { save('sounds'); }
    async function renderSoundUI() {
      const so = S.sounds;
      try { soundFiles = (await DB.soundsAll()).sort((a, b) => a.added - b.added); } catch (e) { soundFiles = []; }
      $('#sEnabled').checked = so.enabled;
      $('#sVol').value = so.volume;
      $('#sVolVal').textContent = Math.round(so.volume * 100) + '%';
      $('#sOne').checked = so.oneForAll;
      $('#sMuteTV').checked = so.muteTV;
      const fills = $('#sFills'), other = $('#sOther');
      fills.querySelectorAll('.srow').forEach(r => r.remove());
      other.querySelectorAll('.srow').forEach(r => r.remove());
      if (so.oneForAll) {
        fills.appendChild(soundRow('All fills', () => so.all, v => { so.all = v; }));
      } else {
        for (const k of FILL_SLOTS) {
          fills.appendChild(soundRow(SLOT_LABELS[k].replace(' fill', ''), () => so.slots[k].s, v => { so.slots[k].s = v; },
            () => so.slots[k].on, v => { so.slots[k].on = v; }));
        }
      }
      for (const k of ['partial', 'placed', 'cancelled', 'rejected']) {
        other.appendChild(soundRow(SLOT_LABELS[k].replace('Order ', '').replace(/^./, c => c.toUpperCase()), () => so.slots[k].s, v => { so.slots[k].s = v; },
          () => so.slots[k].on, v => { so.slots[k].on = v; }));
      }
      const chips = $('#sChips');
      chips.innerHTML = soundFiles.length ? '' : '<span class="hint">None yet</span>';
      for (const f of soundFiles) {
        const c = document.createElement('div');
        c.className = 'chip';
        const n = document.createElement('span');
        n.textContent = f.name;
        n.title = f.name;
        const pb = document.createElement('button');
        pb.textContent = '▶'; pb.title = 'Play';
        pb.onclick = () => playSound('file:' + f.id);
        const db = document.createElement('button');
        db.textContent = '×'; db.title = 'Remove';
        db.onclick = async () => {
          await DB.soundDel(f.id);
          bufferCache.delete(f.id);
          const ref = 'file:' + f.id;
          if (so.all === ref) so.all = 'tone:chime';
          for (const k of Object.keys(so.slots)) if (so.slots[k].s === ref) so.slots[k].s = DEFAULTS.sounds.slots[k].s;
          saveSounds();
          bc && bc.postMessage({ type: 'soundlist' });
          renderSoundUI();
        };
        c.append(n, pb, db);
        chips.appendChild(c);
      }
      $('#sLast').textContent = lastEvent ? 'Last: ' + lastEvent : '';
      if (panel.classList.contains('open')) placePanel();
    }
    buildUI.onEvent = () => { const el = $('#sLast'); if (el) el.textContent = 'Last: ' + lastEvent; };
    $('#sEnabled').onchange = e => { S.sounds.enabled = e.target.checked; saveSounds(); applyMute(); };
    $('#sVol').oninput = e => {
      S.sounds.volume = parseFloat(e.target.value);
      $('#sVolVal').textContent = Math.round(S.sounds.volume * 100) + '%';
      saveSounds();
    };
    $('#sVol').onchange = () => playSound(S.sounds.oneForAll ? S.sounds.all : S.sounds.slots.market.s);
    $('#sOne').onchange = e => { S.sounds.oneForAll = e.target.checked; saveSounds(); renderSoundUI(); };
    $('#sMuteTV').onchange = e => {
      S.sounds.muteTV = e.target.checked;
      saveSounds();
      if (!applyMute()) $('#sMsg').textContent = 'Open a chart with trading connected, then this takes effect.';
    };
    $('#sFile').onchange = async e => {
      const files = [...e.target.files];
      e.target.value = '';
      const problems = [];
      for (const f of files) {
        if (f.size > 10e6) { problems.push(`${f.name} is over 10 MB`); continue; }
        try {
          await ctx().decodeAudioData(await f.arrayBuffer());   // make sure it plays
          const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
          await DB.soundPut({ id, name: f.name.replace(/\.[^.]+$/, ''), blob: f, added: Date.now() });
        } catch (err) {
          problems.push(`Couldn't play ${f.name}`);
        }
      }
      $('#sMsg').textContent = problems.join(' · ');
      bc && bc.postMessage({ type: 'soundlist' });
      renderSoundUI();
    };

    /* ---- indicators tab ---- */
    const iType = $('#iType');
    iType.innerHTML = Object.entries(IND_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    const IND_COLORS = ['#2962ff', '#ff9800', '#e040fb', '#00bcd4', '#ffeb3b'];
    function saveInd() { save('ind'); startInd(); renderIndUI(); }
    let openIndId = null;
    function indSettingsBox(ind, lbl, rowColor) {
      const box = document.createElement('div');
      box.className = 'iset srow';
      for (const [key, label, kind, a, b] of [...(IND_FIELDS[ind.type] || []), ...STYLE_FIELDS]) {
        const l = document.createElement('label');
        l.textContent = label;
        let inp;
        if (kind === 'bool') {
          inp = document.createElement('input');
          inp.type = 'checkbox';
          inp.checked = !!ind[key];
          inp.style.justifySelf = 'start';
          inp.onchange = () => { ind[key] = inp.checked; save('ind'); startInd(); };
        } else if (kind === 'int' || kind === 'float') {
          inp = document.createElement('input');
          inp.type = 'number'; inp.min = a; inp.max = b;
          inp.step = kind === 'int' ? '1' : '0.05';
          inp.value = ind[key];
          inp.onchange = () => {
            let v = kind === 'int' ? parseInt(inp.value, 10) : parseFloat(inp.value);
            if (!isFinite(v)) { inp.value = ind[key]; return; }
            v = Math.min(b, Math.max(a, v));
            inp.value = v; ind[key] = v;
            lbl.textContent = indSummary(ind);
            save('ind'); startInd();
          };
        } else if (kind === 'color') {
          inp = document.createElement('input');
          inp.type = 'color'; inp.value = ind[key];
          inp.oninput = () => {
            ind[key] = inp.value;
            if (key === 'color') rowColor.value = inp.value;
            save('ind'); startInd();
          };
        } else {
          const opts = kind === 'src' ? SOURCES : a;
          inp = document.createElement('select');
          inp.innerHTML = Object.entries(opts).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
          inp.value = String(ind[key]);
          inp.onchange = () => {
            ind[key] = key === 'width' ? parseInt(inp.value, 10) : inp.value;
            lbl.textContent = indSummary(ind);
            save('ind'); startInd();
          };
        }
        box.append(l, inp);
      }
      return box;
    }
    function renderIndUI() {
      countNative();
      const plan = planLimit(), slots = overlaySlots();
      const onCount = S.ind.list.filter(x => x.on).length;
      $('#iStatus').textContent = `Your plan (${plan.name}) allows ${plan.limit} per chart. TradingView indicators showing on this chart: ${nativeCount}. Room for these: ${slots}.`;
      const box = $('#iList');
      box.querySelectorAll('.srow').forEach(r => r.remove());
      if (!S.ind.list.length) {
        const e = document.createElement('div');
        e.className = 'srow hint';
        e.textContent = 'None yet';
        box.appendChild(e);
      }
      let shown = 0;
      S.ind.list.forEach((ind, i) => {
        normInd(ind);
        const row = document.createElement('div');
        row.className = 'srow';
        row.style.gridTemplateColumns = '34px 1fr 40px 28px 30px';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = ind.on;
        cb.onchange = () => {
          if (cb.checked && S.ind.list.filter(x => x.on).length >= slots) {
            cb.checked = false;
            $('#iMsg').textContent = slots === 0
              ? `No room: ${nativeCount} TradingView indicator${nativeCount === 1 ? ' is' : 's are'} showing and your plan allows ${plan.limit}. Hide one in TradingView first.`
              : `Your plan allows ${plan.limit} indicators per chart in total.`;
            return;
          }
          $('#iMsg').textContent = '';
          ind.on = cb.checked; saveInd();
        };
        const lbl = document.createElement('span');
        lbl.className = 'lbl';
        lbl.textContent = indSummary(ind);
        if (ind.on) { shown++; if (shown > slots) { lbl.textContent += ' (hidden: over limit)'; lbl.style.color = '#f7a600'; } }
        const col = document.createElement('input');
        col.type = 'color'; col.value = ind.color;
        col.style.width = '34px'; col.style.height = '24px';
        col.oninput = () => { ind.color = col.value; save('ind'); startInd(); };
        const gear = document.createElement('button');
        gear.className = 'gear' + (openIndId === ind.id ? ' on' : '');
        gear.textContent = '⚙'; gear.title = 'Settings';
        gear.onclick = () => { openIndId = openIndId === ind.id ? null : ind.id; renderIndUI(); };
        const del = document.createElement('button');
        del.className = 'play'; del.textContent = '×'; del.title = 'Remove';
        del.style.width = '30px';
        del.onclick = () => { S.ind.list.splice(i, 1); $('#iMsg').textContent = ''; saveInd(); };
        row.append(cb, lbl, col, gear, del);
        box.appendChild(row);
        if (openIndId === ind.id) box.appendChild(indSettingsBox(ind, lbl, col));
      });
      $('#iAdd').disabled = false;
      if (panel.classList.contains('open')) placePanel();
    }
    buildUI.onInd = () => { if (panel.classList.contains('open')) renderIndUI(); };
    $('#iAdd').onclick = () => {
      const type = iType.value;
      const room = overlaySlots() - S.ind.list.filter(x => x.on).length;
      const ind = {
        id: Date.now().toString(36), type, len: IND_DEFAULT_LEN[type], width: (TYPE_DEFAULTS[type] && TYPE_DEFAULTS[type].width) || 2,
        on: room > 0
      };
      if (!TYPE_DEFAULTS[type]) { ind.color = IND_COLORS[S.ind.list.length % IND_COLORS.length]; ind.color2 = ind.color; }
      normInd(ind);
      openIndId = ind.id;
      S.ind.list.push(ind);
      $('#iMsg').textContent = room > 0 ? '' : (overlaySlots() === 0
        ? `Added but off: your chart already shows ${planLimit().limit} indicators, your plan's limit. Hide a TradingView indicator to turn it on.`
        : `Added but off: your plan allows ${planLimit().limit} indicators per chart in total.`);
      saveInd();
    };

    $('#xStream').onchange = e => { S.extras.streamer = e.target.checked; save('extras'); applyStreamer(); };
    $('#xStreamChart').onchange = e => { S.extras.streamerChart = e.target.checked; save('extras'); applyStreamer(); };
    $('#xStreamStyle').onchange = e => { S.extras.streamerStyle = e.target.value; save('extras'); applyStreamer(); };
    $('#xBrk').onchange = e => { S.extras.brk = e.target.checked; save('extras'); brkPoll(); brkKick(); };
    $('#xBrkMode').onchange = e => { S.extras.brkMode = e.target.value; save('extras'); brkKick(); };
    $('#xBrkRight').onchange = e => {
      const v = Math.min(800, Math.max(0, parseInt(e.target.value, 10) || 0));
      e.target.value = v; S.extras.brkRight = v; save('extras'); brkKick();
    };
    function renderStreamUI() {
      $('#xBrk').checked = S.extras.brk !== false;
      $('#xBrkMode').value = S.extras.brkMode || 'ticks';
      $('#xBrkRight').value = S.extras.brkRight ?? 300;
      $('#xStream').checked = !!S.extras.streamer;
      $('#xStreamChart').checked = S.extras.streamerChart !== false;
      $('#xStreamStyle').value = S.extras.streamerStyle || 'blur';
      fab.classList.toggle('live', !!S.extras.streamer);
    }
    buildUI.onStreamer = () => { renderStreamUI(); renderQuick(); renderStatus(); };
    renderStreamUI();
    /* ---- journal ---- */
    const money = (v, cur) => (v > 0 ? '+' : v < 0 ? '\u2212' : '') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (cur || 'USD');
    const fmtPx = v => (+v).toLocaleString(undefined, { maximumFractionDigits: 6 });
    const fmtDur = ms => { const sec = Math.max(0, Math.round(ms / 1000)); return sec < 60 ? sec + 's' : sec < 3600 ? Math.floor(sec / 60) + 'm ' + (sec % 60) + 's' : Math.floor(sec / 3600) + 'h ' + Math.floor(sec % 3600 / 60) + 'm'; };
    const shortSym = sym => String(sym).split(':').pop();
    let journalCache = [];
    async function renderJournal() {
      $('#rOn').checked = !!S.rec.on;
      $('#rVideo').checked = !!S.rec.video;
      $('#rQuality').value = S.rec.quality || '720';
      $('#rKeep').value = String(S.rec.keep || 25);
      let trades = [];
      try { trades = (await DB.tradesAll()) || []; } catch (e) {}
      trades.sort((a, b) => b.closeTime - a.closeTime);
      journalCache = trades;
      const hide = S.extras.streamer;
      const today = new Date().toDateString();
      const td = trades.filter(t => new Date(t.closeTime).toDateString() === today);
      const wins = td.filter(t => (t.net ?? t.ticks ?? 0) > 0).length;
      const net = td.reduce((a, t) => a + (t.net || 0), 0);
      const open = recLoad().open, openN = Object.keys(open).length;
      const recLine = vid ? '<span class="rec-dot"></span>Recording video · ' : '';
      $('#rStats').innerHTML = !S.rec.on ? 'Recording is off. Switch on <b>Record my trades</b> to start your journal.'
        : `${recLine}<b>Today:</b> ${td.length} trade${td.length === 1 ? '' : 's'} · ${wins} win${wins === 1 ? '' : 's'} · ${hide ? '•••••' : money(net, td[0] && td[0].currency)}${openN ? ` · ${openN} open position${openN === 1 ? '' : 's'} being tracked` : ''}`;
      const list = $('#rList');
      list.querySelectorAll('.trow, .empty').forEach(e => e.remove());
      if (!trades.length) {
        const e = document.createElement('div'); e.className = 'empty';
        e.textContent = S.rec.on ? 'No trades yet. Your next trade will show up here.' : 'No trades recorded yet.';
        list.appendChild(e);
      }
      for (const t of trades.slice(0, 50)) {
        const row = document.createElement('div');
        row.className = 'trow';
        const pnl = t.net !== null && t.net !== undefined ? money(t.net, t.currency) : '';
        const tk = t.ticks !== null && t.ticks !== undefined ? `${t.ticks > 0 ? '+' : ''}${t.ticks} ticks` : '';
        const win = (t.net ?? t.ticks ?? 0) > 0;
        row.innerHTML = `<div><b><span class="${t.dir > 0 ? 'side-l' : 'side-s'}">${t.dir > 0 ? 'Long' : 'Short'} ${t.qty}</span> ${shortSym(t.symbol)}</b>
            <small>${new Date(t.openTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${fmtDur(t.closeTime - t.openTime)}${t.backfilled ? ' · caught up' : ''}</small></div>
          <div class="px">${fmtPx(t.entry)} → ${fmtPx(t.exit)}</div>
          <div class="pnl ${win ? 'win' : 'loss'}">${hide ? '•••••' : (pnl || tk)}<small>${hide ? '' : (pnl ? tk : '')}</small></div>`;
        const play = document.createElement('button');
        play.className = 'play'; play.title = t.videoId ? 'Watch video' : 'No video';
        play.textContent = '▶'; play.disabled = !t.videoId; play.style.opacity = t.videoId ? 1 : .3;
        play.onclick = () => openVideo(t);
        const del = document.createElement('button');
        del.className = 'play'; del.title = 'Delete trade'; del.textContent = '×';
        del.onclick = async () => { await DB.tradeDel(t.id); if (t.videoId) await DB.videoDel(t.videoId); renderJournal(); };
        row.append(play, del);
        list.appendChild(row);
      }
      const badge = root.querySelector('[data-badge="journal"]');
      badge.hidden = !(S.rec.on && (vid || openN)); badge.textContent = vid ? '● REC' : 'live';
    }
    let playerUrl = null;
    async function openVideo(t) {
      const v = await DB.videoGet(t.videoId);
      if (!v) { t.videoId = null; renderJournal(); return; }
      if (playerUrl) URL.revokeObjectURL(playerUrl);
      playerUrl = URL.createObjectURL(v.blob);
      $('#rVideoEl').src = playerUrl;
      $('#rPTitle').textContent = `${t.dir > 0 ? 'Long' : 'Short'} ${t.qty} ${shortSym(t.symbol)} · ${new Date(t.openTime).toLocaleString()}`;
      $('#rPDown').href = playerUrl;
      $('#rPDown').download = `trade-${shortSym(t.symbol)}-${new Date(t.openTime).toISOString().replace(/[:.]/g, '-')}.webm`;
      $('#rPlayer').hidden = false;
    }
    $('#rPClose').onclick = () => { $('#rPlayer').hidden = true; $('#rVideoEl').pause(); };
    $('#rOn').onchange = e => { S.rec.on = e.target.checked; if (S.rec.on) recStartFresh(); save('journal'); renderJournal(); };
    $('#rVideo').onchange = e => { S.rec.video = e.target.checked; save('journal'); renderJournal(); };
    $('#rQuality').onchange = e => { S.rec.quality = e.target.value; save('journal'); };
    $('#rKeep').onchange = e => { S.rec.keep = +e.target.value; save('journal'); videoCleanup().then(renderJournal); };
    $('#rCsv').onclick = () => {
      const head = ['Open time', 'Close time', 'Symbol', 'Side', 'Qty', 'Entry', 'Exit', 'Ticks', 'Gross P&L', 'Commission', 'Net P&L', 'Currency', 'Seconds held', 'Caught up', 'Has video'];
      const q = v => { const x = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
      const rows = journalCache.slice().reverse().map(t => [new Date(t.openTime).toISOString(), new Date(t.closeTime).toISOString(), shortSym(t.symbol), t.dir > 0 ? 'Long' : 'Short', t.qty,
        t.entry, t.exit, t.ticks, t.gross !== null ? +t.gross.toFixed(2) : '', +(+t.commission || 0).toFixed(2), t.net !== null ? +t.net.toFixed(2) : '', t.currency,
        Math.round((t.closeTime - t.openTime) / 1000), t.backfilled ? 'yes' : '', t.videoId ? 'yes' : ''].map(q).join(','));
      const url = URL.createObjectURL(new Blob(['\ufeff' + [head.join(','), ...rows].join('\r\n')], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url; a.download = `trade-journal-${new Date().toISOString().slice(0, 10)}.csv`;
      root.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    let clearArmed = null;
    $('#rClear').onclick = async () => {
      if (!clearArmed) {
        $('#rClear').textContent = 'Click again to delete all trades & videos';
        clearArmed = setTimeout(() => { clearArmed = null; $('#rClear').textContent = 'Clear journal'; }, 4000);
        return;
      }
      clearTimeout(clearArmed); clearArmed = null;
      $('#rClear').textContent = 'Clear journal';
      await DB.tradesClear(); await DB.videosClear();
      renderJournal();
    };
    buildUI.onJournal = () => { if (panel.classList.contains('open')) renderJournal(); };

    $('#xAds').onchange = e => { S.extras.hideAds = e.target.checked; save('extras'); applyAds(); };
    /* ---- sidebar quick switches, theme, status ---- */
    function setQuick(id, on) {
      if (id === 'qWall') { S.wall.enabled = on; save('wall'); refreshWall(); }
      if (id === 'qCandles') { S.candles.enabled = on; save('candles'); rebuildLookup(); redraw(); }
      if (id === 'qSounds') { S.sounds.enabled = on; save('sounds'); applyMute(); }
      if (id === 'qStream') { S.extras.streamer = on; save('extras'); applyStreamer(); }
      renderAllUI();
    }
    for (const id of ['qWall', 'qCandles', 'qSounds', 'qStream']) $('#' + id).onchange = e => setQuick(id, e.target.checked);
    function themeIsLight() {
      const t = S.ui.theme || 'auto';
      if (t === 'light') return true;
      if (t === 'dark') return false;
      const h = document.documentElement;
      if (h.classList.contains('theme-light')) return true;
      if (h.classList.contains('theme-dark')) return false;
      return !(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    }
    function applyTheme() {
      panel.classList.toggle('light', themeIsLight());
      root.querySelectorAll('#gTheme button').forEach(b => b.classList.toggle('on', b.dataset.v === (S.ui.theme || 'auto')));
    }
    root.querySelectorAll('#gTheme button').forEach(b => b.onclick = () => { S.ui.theme = b.dataset.v; save(null); applyTheme(); });
    new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    $('#power').onclick = () => setAllOff(!S.extras.allOff);
    $('#powerOn').onclick = () => setAllOff(false);
    $('#gAllOff').onchange = e => setAllOff(e.target.checked);
    function renderOff() {
      const off = !!S.extras.allOff;
      panel.classList.toggle('alloff', off);
      fab.classList.toggle('alloff', off);
      $('#power').classList.toggle('off', off);
      $('#power').title = off ? 'Turn everything back on (Alt+Shift+X)' : 'Turn everything off (Alt+Shift+X)';
      $('#gAllOff').checked = off;
    }
    $('#gResetPos').onclick = () => { S.ui.x = S.ui.y = S.ui.px = S.ui.py = null; save(null); placePanel(); };
    function renderStatus() {
      let name = '', connected = false;
      try {
        const b = currentBroker();
        if (b) {
          const mi = typeof b.metainfo === 'function' ? b.metainfo() : null;
          name = (mi && (mi.title || mi.name || mi.id)) || '';
          if (name === 'Paper') name = 'Paper Trading';
          connected = typeof b.isConnected === 'function' ? !!b.isConnected() : true;
        }
      } catch (e) {}
      $('#connDot').classList.toggle('on', connected);
      $('#connText').textContent = connected ? `${name || 'Broker'} · connected` : 'No broker connected';
      const pill = $('#pill');
      pill.className = 'pill' + (S.extras.allOff ? ' live' : S.extras.streamer ? ' live' : connected ? ' ok' : '');
      pill.textContent = S.extras.allOff ? '⏻ All off' : S.extras.streamer ? '● Streamer on' : connected ? '● ' + (name || 'Connected') : 'Not trading';
      const nOn = S.ind.list.filter(x => x.on).length;
      const badge = root.querySelector('[data-badge="ind"]');
      badge.hidden = !nOn; badge.textContent = nOn + ' on';
    }
    setInterval(() => { if (panel.classList.contains('open')) renderStatus(); }, 2000);
    function renderQuick() {
      $('#qWall').checked = !!S.wall.enabled;
      $('#qCandles').checked = !!S.candles.enabled;
      $('#qSounds').checked = !!S.sounds.enabled;
      $('#qStream').checked = !!S.extras.streamer;
    }
    applyTheme();

    function renderAllUI() { renderOff(); renderQuick(); renderStatus(); applyTheme(); renderWallUI(); renderCandleUI(); renderSoundUI(); renderIndUI(); renderJournal(); $('#xAds').checked = !!S.extras.hideAds; renderStreamUI(); showTab(S.ui.tab || 'wall'); }
    buildUI.refresh = () => { renderOff(); if (panel.classList.contains('open')) renderAllUI(); placeFab(); };
    renderOff();
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
      if (t === 'extras') { applyAds(); applyStreamer(); brkKick(); }
      if (t === 'alloff') applyAllOff();
      if (t === 'journal' && buildUI.onJournal) buildUI.onJournal();
      if (t === 'sounds') applyMute();
      if (t === 'soundlist') bufferCache.clear();
      if (t === 'ind') startInd();
      buildUI.refresh && buildUI.refresh();
    };
  }

  function start() {
    buildUI();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    loadWallpaper();
    countNative();
    startInd();
    applyStreamer();
    brkPoll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
