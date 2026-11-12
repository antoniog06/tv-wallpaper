// ==UserScript==
// @name         TV Wallpaper
// @namespace    tvwp
// @version      2.3.0
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
  const VERSION = '2.3.0';
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
    extras: { hideAds: true },
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
    ui: { x: null, y: null, tab: 'wall' }
  };
  function readSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('tvwp_settings') || '{}');
      return {
        wall: { ...DEFAULTS.wall, ...s.wall },
        candles: { ...DEFAULTS.candles, ...s.candles },
        extras: { ...DEFAULTS.extras, ...s.extras },
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
    if (S.extras.hideAds) {
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
   * Wallpaper storage (IndexedDB)
   * ======================================================= */
  const DB = {
    _db: null,
    open() {
      return this._db || (this._db = new Promise((res, rej) => {
        const r = indexedDB.open('tvwp', 2);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('wallpapers')) db.createObjectStore('wallpapers', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('sounds')) db.createObjectStore('sounds', { keyPath: 'id' });
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
    soundDel(id) { return this.run('readwrite', s => s.delete(id), 'sounds'); }
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

  function ctx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  // Browsers only allow sound after a click or key press on the page.
  for (const ev of ['pointerdown', 'keydown']) {
    window.addEventListener(ev, () => { try { ctx(); } catch (e) {} }, { capture: true, passive: true });
  }

  function playTone(name, vol) {
    const c = ctx(), t = c.currentTime;
    const out = c.createGain();
    out.gain.value = vol;
    out.connect(c.destination);
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

  async function playSound(ref, vol = S.sounds.volume) {
    window.__tvwpLastSound = ref;   // used by the automated tests
    try {
      if (!ref || ref === 'none') return;
      if (ref.startsWith('tone:')) { playTone(ref.slice(5), vol); return; }
      if (ref.startsWith('file:')) {
        const id = ref.slice(5);
        let buf = bufferCache.get(id);
        if (!buf) {
          const rec = await DB.soundGet(id);
          if (!rec) return;
          buf = await ctx().decodeAudioData(await rec.blob.arrayBuffer());
          bufferCache.set(id, buf);
        }
        const c = ctx(), src = c.createBufferSource(), g = c.createGain();
        g.gain.value = vol;
        src.buffer = buf;
        src.connect(g).connect(c.destination);
        src.start();
      }
    } catch (e) {
      console.warn('[TV Wallpaper] sound failed', e);
    }
  }

  function fireSlot(slot, text) {
    lastEvent = text + ' · ' + new Date().toLocaleTimeString();
    window.__tvwpLastEvent = { slot, text };
    if (buildUI.onEvent) buildUI.onEvent();
    const so = S.sounds;
    if (!so.enabled) return;
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
  let hookedBroker = null, hookedConnected = null, warmUntil = 0, lastOrderFillAt = 0, lastFallbackAt = 0;
  const HOOK = {};

  function handleOrder(o) {
    if (!o || o.id === undefined || o.id === null) return;
    const prev = trackedOrders.get(o.id);
    const cur = { ...(prev || {}), ...o };
    trackedOrders.set(o.id, cur);
    if (Date.now() < warmUntil) return;  // ignore the history sent right after connecting
    const st = cur.status, pst = prev && prev.status;
    const cat = categorize(cur);
    const side = cur.side === -1 ? 'Sell' : 'Buy';
    const name = `${side} ${SLOT_LABELS[cat].replace(' fill', '')}`;
    if (st === 2 && pst !== 2) {
      lastOrderFillAt = Date.now();
      if (Date.now() - lastFallbackAt < 1500) { lastFallbackAt = 0; return; } // already beeped for this fill
      fireSlot(cat, name + ' filled');
      return;
    }
    if (st !== 2 && prev && (cur.filledQty || 0) > (prev.filledQty || 0)) {
      lastOrderFillAt = Date.now();
      fireSlot('partial', name + ' partially filled');
      return;
    }
    if (st === 1 && pst !== 1) { fireSlot('cancelled', name + ' cancelled'); return; }
    if (st === 5 && pst !== 5) { fireSlot('rejected', name + ' rejected'); return; }
    if (st === 6 && pst !== 6) fireSlot('placed', name + ' placed');
  }
  function onOrderUpdate(o) {
    if (Array.isArray(o)) o.forEach(handleOrder); else handleOrder(o);
  }
  function onOrderPartial(id, data) {
    if (id && typeof id === 'object' && data === undefined) { handleOrder(id); return; }
    handleOrder({ ...(data || {}), id });
  }
  function onExecution() {
    // Backup for brokers that report the fill only as an execution.
    if (Date.now() < warmUntil) return;
    setTimeout(() => {
      if (Date.now() - lastOrderFillAt > 1200) { lastFallbackAt = Date.now(); fireSlot('market', 'Order filled'); }
    }, 700);
  }
  function onFullUpdate() { warmUntil = Date.now() + 3000; }

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
        unsub(hookedBroker, 'ordersFullUpdate', onFullUpdate);
      }
      hookedBroker = null;
      trackedOrders.clear();
      if (b && sub(b, 'orderUpdate', onOrderUpdate)) {
        sub(b, 'orderPartialUpdate', onOrderPartial);
        sub(b, 'executionUpdate', onExecution);
        sub(b, 'ordersFullUpdate', onFullUpdate);
        hookedBroker = b;
        warmUntil = Date.now() + 3000;
      }
    }
    if (hookedBroker) {
      let conn = null;
      try { conn = typeof hookedBroker.isConnected === 'function' ? !!hookedBroker.isConnected() : null; } catch (e) {}
      if (conn && hookedConnected === false) { warmUntil = Date.now() + 3000; trackedOrders.clear(); }
      hookedConnected = conn;
    }
  }

  // TradingView's own "play sound on order execution" switch.
  function tvSoundPref() {
    try { return window.TradingViewApi.trading().orderExecutedSoundParams.enabled; } catch (e) { return null; }
  }
  function applyMute() {
    const p = tvSoundPref();
    if (!p || typeof p.value !== 'function') return false;
    const want = S.sounds.enabled && S.sounds.muteTV;
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
  const IND_TYPES = { ema: 'EMA', sma: 'SMA', wma: 'WMA', vwap: 'VWAP (daily)', bb: 'Bollinger Bands' };
  const IND_DEFAULT_LEN = { ema: 20, sma: 50, wma: 20, vwap: 0, bb: 20 };
  const PLAN_LIMITS = [['ultimate', 'Ultimate', 50], ['premium', 'Premium', 25], ['plus', 'Plus', 10]];
  function planLimit() {
    let p = '';
    try { p = String((window.user && window.user.pro_plan) || '').toLowerCase(); } catch (e) {}
    if (!p) return { name: 'TEST', limit: 10 };
    for (const [k, name, limit] of PLAN_LIMITS) if (p.includes(k)) return { name, limit };
    return { name: 'Essential', limit: 5 };
  }
  let nativeCount = 0;
  function countNative() {
    try { nativeCount = window.TradingViewApi.activeChart().getAllStudies().length; } catch (e) {}
    return nativeCount;
  }
  function overlaySlots() { return Math.max(0, planLimit().limit - nativeCount); }
  function activeOverlays() { return S.ind.list.filter(x => x.on).slice(0, overlaySlots()); }

  function readBars(ms) {
    const b = ms.bars(), f = b.firstIndex(), l = b.lastIndex();
    const d = { idx: [], t: [], h: [], l: [], c: [], v: [] };
    if (f === null || l === null || f === undefined) return d;
    for (let i = f; i <= l; i++) {
      const v = b.valueAt(i);
      if (!v) continue;
      d.idx.push(i); d.t.push(v[0]); d.h.push(v[2]); d.l.push(v[3]); d.c.push(v[4]); d.v.push(v[5] || 0);
    }
    return d;
  }

  function computeInd(ind, d) {
    const c = d.c, n = c.length, len = Math.max(1, Math.round(ind.len || 1));
    const line = () => new Array(n).fill(null);
    if (ind.type === 'sma' || ind.type === 'bb') {
      const mid = line(), up = line(), lo = line();
      let sum = 0, sq = 0;
      for (let i = 0; i < n; i++) {
        sum += c[i]; sq += c[i] * c[i];
        if (i >= len) { sum -= c[i - len]; sq -= c[i - len] * c[i - len]; }
        if (i >= len - 1) {
          const m = sum / len;
          mid[i] = m;
          const sd = Math.sqrt(Math.max(0, sq / len - m * m));
          up[i] = m + 2 * sd; lo[i] = m - 2 * sd;
        }
      }
      return ind.type === 'bb' ? [mid, up, lo] : [mid];
    }
    if (ind.type === 'ema') {
      const out = line(), k = 2 / (len + 1);
      let e = null, seed = 0;
      for (let i = 0; i < n; i++) {
        if (i < len) { seed += c[i]; if (i === len - 1) { e = seed / len; out[i] = e; } continue; }
        e = c[i] * k + e * (1 - k);
        out[i] = e;
      }
      return [out];
    }
    if (ind.type === 'wma') {
      const out = line(), wsum = len * (len + 1) / 2;
      for (let i = len - 1; i < n; i++) {
        let acc = 0;
        for (let j = 0; j < len; j++) acc += c[i - j] * (len - j);
        out[i] = acc / wsum;
      }
      return [out];
    }
    if (ind.type === 'vwap') {
      const out = line();
      let pv = 0, vol = 0, day = null;
      for (let i = 0; i < n; i++) {
        const dt = new Date(d.t[i] * 1000), key = dt.getFullYear() * 1000 + dt.getMonth() * 40 + dt.getDate();
        if (key !== day) { day = key; pv = 0; vol = 0; }
        const tp = (d.h[i] + d.l[i] + c[i]) / 3, v = d.v[i] || 0;
        pv += tp * v; vol += v;
        out[i] = vol > 0 ? pv / vol : tp;
      }
      return [out];
    }
    return [];
  }

  let indCanvas = null, indSig = '', indData = null, indDataSig = '', indLoop = false;
  function indPaneEl() {
    return document.querySelector('.chart-container.active .chart-markup-table.pane .chart-gui-wrapper') ||
           document.querySelector('.chart-markup-table.pane .chart-gui-wrapper');
  }
  function removeIndCanvas() { if (indCanvas) { indCanvas.remove(); indCanvas = null; } indSig = ''; }

  function indFrame() {
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
    for (const ind of list) {
      const lines = computeInd(ind, d);
      lines.forEach((vals, li) => {
        g.beginPath();
        g.strokeStyle = ind.color;
        g.lineWidth = li === 0 ? (ind.width || 2) : Math.max(1, (ind.width || 2) - 1);
        g.globalAlpha = li === 0 ? 1 : 0.7;
        let pen = false;
        for (let i = 0; i < vals.length; i++) {
          const v = vals[i];
          if (v === null || !isFinite(v)) { pen = false; continue; }
          const x = ts.indexToCoordinate(d.idx[i]);
          if (x < -50 || x > W + 50) { pen = false; continue; }
          const y = ps.priceToCoordinate(v, fv);
          if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; }
        }
        g.stroke();
      });
      g.globalAlpha = 1;
      g.font = '11px -apple-system, system-ui, sans-serif';
      g.fillStyle = ind.color;
      g.fillText(IND_TYPES[ind.type] + (ind.type === 'vwap' ? '' : ' ' + ind.len), 8, legendY);
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
  .srow { display: grid; grid-template-columns: 18px 1fr 120px 28px; gap: 6px; align-items: center; }
  .srow .lbl { font-size: 12px; }
  .srow select { padding: 4px; font-size: 12px; }
  .play { width: 28px; height: 26px; border-radius: 6px; border: 1px solid #2a2e39; background: #1e222d; color: #d1d4dc; cursor: pointer; padding: 0; }
  .sgroup { display: grid; gap: 6px; padding: 10px; border: 1px solid #2a2e39; border-radius: 8px; background: #1e222d; }
  .sgroup h3 { margin: 0 0 2px; font-size: 12px; color: #787b86; font-weight: 600; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: flex; align-items: center; gap: 4px; padding: 3px 4px 3px 8px; border: 1px solid #2a2e39; border-radius: 14px; font-size: 12px; max-width: 100%; }
  .chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
  .chip button { background: none; border: none; color: #787b86; cursor: pointer; font-size: 14px; line-height: 1; }
  .last { font-size: 12px; color: #d1d4dc; }
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
    <div class="tabs"><button data-tab="wall">Wallpaper</button><button data-tab="candles">Candles</button><button data-tab="sounds">Sounds</button><button data-tab="ind">Indicators</button><button data-tab="extras">Extras</button></div>
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
    <section data-tab="sounds">
      <div class="row between"><span class="hint">Plays when your orders fill</span><label class="sw"><input type="checkbox" id="sEnabled"> On</label></div>
      <div class="field"><span>Volume <b id="sVolVal"></b></span><input type="range" id="sVol" min="0.05" max="1" step="0.05"></div>
      <label class="sw"><input type="checkbox" id="sOne"> One sound for all fills</label>
      <div class="sgroup" id="sFills"><h3>Fills</h3></div>
      <div class="sgroup" id="sOther"><h3>Other order events</h3></div>
      <div class="sgroup"><h3>Your sounds</h3>
        <div class="chips" id="sChips"></div>
        <label class="btn">Upload sounds (MP3, WAV…)<input type="file" id="sFile" accept="audio/*" multiple hidden></label>
        <div class="msg" id="sMsg"></div>
      </div>
      <label class="sw"><input type="checkbox" id="sMuteTV"> Mute TradingView's own fill sound</label>
      <div class="last" id="sLast"></div>
      <div class="hint">Works with any broker you connect in TradingView (Paper Trading, Tradovate, NinjaTrader…). Click anywhere on the page once after opening it so the browser allows sound.</div>
    </section>
    <section data-tab="ind">
      <div class="hint" id="iStatus"></div>
      <div class="sgroup" id="iList"><h3>Your indicators</h3></div>
      <div class="row">
        <select id="iType"></select>
        <button class="btn primary" id="iAdd">Add</button>
      </div>
      <div class="msg" id="iMsg"></div>
      <div class="hint">Drawn on the main chart pane. Together with your TradingView indicators, these stay within your plan's indicators-per-chart limit.</div>
    </section>
    <section data-tab="extras">
      <label class="sw"><input type="checkbox" id="xAds"> Hide ads on the chart</label>
      <div class="hint">Hides TradingView's ad pop-ups and ad boxes on your screen.</div>
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
    function renderIndUI() {
      countNative();
      const plan = planLimit(), slots = overlaySlots();
      const onCount = S.ind.list.filter(x => x.on).length;
      $('#iStatus').textContent = `Your plan (${plan.name}) allows ${plan.limit} per chart. TradingView indicators on this chart: ${nativeCount}. Room for these: ${slots}.`;
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
        const row = document.createElement('div');
        row.className = 'srow';
        row.style.gridTemplateColumns = '18px 1fr 54px 34px 22px';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = ind.on;
        cb.onchange = () => {
          if (cb.checked && S.ind.list.filter(x => x.on).length >= slots) {
            cb.checked = false;
            $('#iMsg').textContent = slots === 0
              ? `No room: your chart already has ${nativeCount} TradingView indicator${nativeCount === 1 ? '' : 's'} and your plan allows ${plan.limit}. Remove one in TradingView first.`
              : `Your plan allows ${plan.limit} indicators per chart in total.`;
            return;
          }
          $('#iMsg').textContent = '';
          ind.on = cb.checked; saveInd();
        };
        const lbl = document.createElement('span');
        lbl.className = 'lbl';
        lbl.textContent = IND_TYPES[ind.type];
        if (ind.on) { shown++; if (shown > slots) { lbl.textContent += ' (hidden: over limit)'; lbl.style.color = '#f7a600'; } }
        const len = document.createElement('input');
        len.type = 'number'; len.min = '1'; len.max = '500';
        len.value = ind.len;
        len.disabled = ind.type === 'vwap';
        len.style.padding = '4px';
        len.onchange = () => { const v = parseInt(len.value, 10); if (v >= 1 && v <= 500) { ind.len = v; saveInd(); } };
        const col = document.createElement('input');
        col.type = 'color'; col.value = ind.color;
        col.style.width = '34px'; col.style.height = '24px';
        col.oninput = () => { ind.color = col.value; save('ind'); startInd(); };
        const del = document.createElement('button');
        del.className = 'play'; del.textContent = '×'; del.title = 'Remove';
        del.style.width = '22px';
        del.onclick = () => { S.ind.list.splice(i, 1); $('#iMsg').textContent = ''; saveInd(); };
        row.append(cb, lbl, len, col, del);
        box.appendChild(row);
      });
      $('#iAdd').disabled = false;
      if (panel.classList.contains('open')) placePanel();
    }
    buildUI.onInd = () => { if (panel.classList.contains('open')) renderIndUI(); };
    $('#iAdd').onclick = () => {
      const type = iType.value;
      const room = overlaySlots() - S.ind.list.filter(x => x.on).length;
      const ind = {
        id: Date.now().toString(36), type, len: IND_DEFAULT_LEN[type], width: 2,
        color: IND_COLORS[S.ind.list.length % IND_COLORS.length], on: room > 0
      };
      S.ind.list.push(ind);
      $('#iMsg').textContent = room > 0 ? '' : (overlaySlots() === 0
        ? `Added but off: your chart already uses all ${planLimit().limit} indicator slots on your plan. Remove a TradingView indicator to turn it on.`
        : `Added but off: your plan allows ${planLimit().limit} indicators per chart in total.`);
      saveInd();
    };

    $('#xAds').onchange = e => { S.extras.hideAds = e.target.checked; save('extras'); applyAds(); };
    function renderAllUI() { renderWallUI(); renderCandleUI(); renderSoundUI(); renderIndUI(); $('#xAds').checked = !!S.extras.hideAds; showTab(S.ui.tab || 'wall'); }
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
      if (t === 'extras') applyAds();
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
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
