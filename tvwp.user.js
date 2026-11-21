// ==UserScript==
// @name         Wick
// @namespace    tvwp
// @version      3.24.0
// @description  Wick for TradingView: wallpapers, candle colors, order sounds, trade journal with chart video, daily limits and lockout. Runs only on your device.
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
  const VERSION = '3.24.0';
  window.__tvwpLoaded = VERSION;

  // TradingView treats typed keys as chart shortcuts (a number opens its timeframe box), which
  // swallows typing in our boxes. While you're typing in one of our fields, keep the keys away
  // from TradingView. Registered first thing, so it runs before TradingView's own key handling.
  function inOurField(e) {
    const host = document.getElementById('tvwp-host');
    if (!host) return false;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (!path.includes(host)) return false;
    const t = path[0];
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
  }
  // If TradingView got to a key first and swallowed it, put the character into our box ourselves.
  function typeSwallowed(e) {
    if (e.type !== 'keydown' || !e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.__tvwpTyped) return;
    const t = e.composedPath()[0];
    if (!t || t.tagName !== 'INPUT' || t.type !== 'text') return;
    const a = t.selectionStart ?? t.value.length, z = t.selectionEnd ?? a;
    if (e.key.length === 1) t.setRangeText(e.key, a, z, 'end');
    else if (e.key === 'Backspace') { if (a !== z) t.setRangeText('', a, z, 'end'); else if (a > 0) t.setRangeText('', a - 1, a, 'end'); }
    else if (e.key === 'Delete') { if (a !== z) t.setRangeText('', a, z, 'end'); else t.setRangeText('', a, a + 1, 'end'); }
    else if (e.key === 'Enter') { if (t.__tvwpDirty) { t.__tvwpDirty = false; t.dispatchEvent(new Event('change', { bubbles: true })); } e.__tvwpTyped = true; return; }
    else return;
    e.__tvwpTyped = true;
    t.__tvwpDirty = true;                       // so leaving the box still saves it
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // Remember whether your last click was inside our window or on the chart. While you're working in
  // our window, keys don't trigger TradingView's chart shortcuts (like a number opening the timeframe box).
  let inOurWindow = false;
  window.addEventListener('pointerdown', e => {
    const host = document.getElementById('tvwp-host');
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const panel = host && host.shadowRoot && host.shadowRoot.querySelector('.panel');
    inOurWindow = !!(panel && path.includes(panel));
  }, true);
  function inOurWindowNow() {
    const host = document.getElementById('tvwp-host');
    const panel = host && host.shadowRoot && host.shadowRoot.querySelector('.panel');
    return inOurWindow && !!panel && panel.classList.contains('open');
  }
  for (const ev of ['keydown', 'keypress', 'keyup']) {
    window.addEventListener(ev, e => {
      if (inOurField(e)) { typeSwallowed(e); e.stopImmediatePropagation(); return; }
      // Our own shortcuts (Alt+Shift+…) still work; everything else stays away from the chart.
      if (inOurWindowNow() && !(e.altKey && e.shiftKey)) e.stopImmediatePropagation();
    }, true);
  }

  /* =========================================================
   * Settings (localStorage, synced across tabs)
   * ======================================================= */
  const DEFAULTS = {
    wall: { enabled: true, opacity: 0.55, blend: 'lighten', fit: 'cover', currentId: null, zoom: 1, posX: 0.5, posY: 0.5, dim: 0, blur: 0, perPanel: {}, used: {}, autoDim: false, tint: false },
    candles: {
      enabled: false, up: '#00ff9c', upA: 1, down: '#ff2e88', downA: 1,
      separate: false, borderUp: '#00ff9c', borderDown: '#ff2e88', wickUp: '#00ff9c', wickDown: '#ff2e88',
      volume: true
    },
    rec: { on: false, video: false, quality: '720', keep: 25, folderOn: false, folderName: '' },
    risk: { lockOn: false, maxLoss: 500, maxTrades: 0, profitLock: 0, warnPct: 80, newsLock: false, counter: true, counterPos: null, symOnly: '',
      sizeMode: 'usd', sizeRisk: 200, sizePct: 1, sizeStop: 20, sizeUnit: 'ticks', sizeSym: '', sizeStopMode: 'auto', sizeAtr: 1, sizeView: 'simple', simplePts: 0, simpleManual: false },
    prop: { on: false, start: 50000, dd: 2500, ddType: 'eod', stopAtStart: true, daily: 0, target: 3000, maxQty: 0, lockNear: 0, enforce: true, consistency: 0, planDays: 0, bestDay: 0, consLock: false, stopOffset: 0, preset: '' },
    news: { on: true, mins: 15, medium: false, sound: true, around: 2 },
    extras: { allOff: false, hideAds: true, streamer: false, streamerChart: true, streamerTicks: false, hideQty: false, oco: false, fastMs: 0, buyColor: '', sellColor: '', eod: 'traded', eodClose: '17:00', streamerStyle: 'blur', brk: true, brkMode: 'ticks', brkRight: 300 },
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
    ui: { x: null, y: null, tab: 'wall', theme: 'auto', px: null, py: null, glass: true, glassDim: 62, closed: {} }
  };
  function readSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('tvwp_settings') || '{}');
      return {
        wall: { ...DEFAULTS.wall, ...s.wall },
        candles: { ...DEFAULTS.candles, ...s.candles },
        extras: { ...DEFAULTS.extras, ...s.extras },
        rec: { ...DEFAULTS.rec, ...s.rec },
        risk: { ...DEFAULTS.risk, ...s.risk },
        prop: { ...DEFAULTS.prop, ...s.prop },
        news: { ...DEFAULTS.news, ...s.news },
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
  // Trade recording keeps going while the daily lockout is on, even with "Turn everything off" (the lockout counts trades from it).
  function recActive() { return !!S.rec.on && (!S.extras.allOff || !!S.risk.lockOn); }
  const IN_APP = /Electron|TradingView\//i.test(navigator.userAgent);

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
  // Cash only (no ticks/points): what the chart hides in Streamer mode unless "hide ticks too" is on
  const CASH_RE = /[+−\-]?\s?(?:[$€£¥]\s?[\d.,]*\d[KMB]?|[\d.,]*\d[KMB]?\s?(?:USD|EUR|GBP|JPY|AUD|CAD|CHF|USDT|USDC|[$€£¥]))/;
  const CASH_RE_G = new RegExp(CASH_RE.source, 'g');
  // Contract counts of your open positions and working orders, so the chart can hide them on position/order lines
  let QTY_SET = new Set();
  const paneCache = new WeakMap();
  function onPane(ctx) {           // the chart area, not the price or time axis
    const c = ctx && ctx.canvas;
    if (!c || typeof c.closest !== 'function') return false;
    let v = paneCache.get(c);
    if (v === undefined) { v = !c.closest('[class*="price-axis"], [class*="time-axis"], [class*="priceAxis"], [class*="timeAxis"]'); paneCache.set(c, v); }
    return v;
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
        if (!S.extras.allOff && typeof args[0] === 'string') {
          const sc = S.extras.streamer && S.extras.streamerChart;
          if (sc) {
            const ticks = !!S.extras.streamerTicks;
            if ((ticks ? MONEY_RE : CASH_RE).test(args[0])) args[0] = args[0].replace(ticks ? MONEY_RE_G : CASH_RE_G, '•••••');
          }
          // contract count on position / order lines (a bare number equal to one of your open sizes)
          if ((sc || S.extras.hideQty) && QTY_SET.size && args[0].length <= 8) {
            const n = args[0].replace(/[\s+\-−,]/g, '');
            if (/^\d+(?:\.\d+)?$/.test(n) && QTY_SET.has(String(+n)) && onPane(this)) args[0] = '•';
          }
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

  // Your own colors for TradingView's Buy / Sell buttons (empty = TradingView's own).
  function applyButtonColors() {
    if (!document.documentElement) return;
    let st = document.getElementById('tvwp-btncolors');
    const b = S.extras.buyColor, sl = S.extras.sellColor;
    if ((!b && !sl) || S.extras.allOff) { if (st) st.remove(); return; }
    if (!st) { st = document.createElement('style'); st.id = 'tvwp-btncolors'; document.documentElement.appendChild(st); }
    const rule = (name, c) => c ? `[data-name="${name}"] { background-color: ${c} !important; border-color: ${c} !important; }
      [data-name="${name}"] > div, [data-name="${name}"] [class*="button"] { background-color: ${c} !important; }
      [data-name="${name}"]:hover { filter: brightness(1.12); }` : '';
    st.textContent = rule('buy-order-button', b) + rule('sell-order-button', sl);
  }
  applyButtonColors();

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
    try { applyAds(); applyStreamer(); applyMute(); applyButtonColors(); } catch (e) {}
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
        const r = indexedDB.open('tvwp', 4);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('wallpapers')) db.createObjectStore('wallpapers', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('sounds')) db.createObjectStore('sounds', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('trades')) db.createObjectStore('trades', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
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
    videosClear() { return this.run('readwrite', s => s.clear(), 'videos'); },
    kvGet(k) { return this.run('readonly', s => s.get(k), 'kv'); },
    kvPut(x) { return this.run('readwrite', s => s.put(x), 'kv'); },
    kvDel(k) { return this.run('readwrite', s => s.delete(k), 'kv'); }
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
      console.warn('[Wick] sound failed', e);
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
    if (S.extras.oco) setTimeout(ocoTick, 60);       // a fill: check right away whether an exit needs cancelling
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
    const out = { since: st.since || Date.now(), seen: st.seen || [], open: st.open || {}, lastFill: st.lastFill || 0 };
    if (!st.since) try { localStorage.setItem(REC_KEY, JSON.stringify(out)); } catch (e) {}
    return out;
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
  function tradeContext(symbol) {
    let broker = '', tf = '';
    try {
      const b = currentBroker(), mi = b && typeof b.metainfo === 'function' ? b.metainfo() : null;
      broker = (mi && (mi.title || mi.name || mi.id)) || '';
      if (broker === 'Paper') broker = 'Paper Trading';
    } catch (e) {}
    try {
      const ch = window.TradingViewApi.activeChart();
      if (symRoot(ch.symbol()) === symRoot(symbol)) tf = String(ch.resolution());   // timeframe of the chart you traded on
    } catch (e) {}
    return { broker, tf };
  }
  // While a trade is open, note where its stop sits (first stop seen), so the journal can show results in R.
  async function captureStops() {
    if (!recActive()) return;
    const st0 = recLoad();
    if (!Object.values(st0.open).some(t => t && t.stop == null)) return;
    const b = currentBroker();
    if (!b || typeof b.orders !== 'function') return;
    let orders = [];
    try { orders = (await b.orders()) || []; } catch (e) { return; }
    await withLock('tvwp-rec', async () => {
      const st = recLoad(); let changed = false;
      for (const sym of Object.keys(st.open)) {
        const t = st.open[sym];
        if (!t || t.stop != null) continue;
        const dir = Math.sign(t.qty) || t.dir || 1;
        const o = orders.find(o => o && o.symbol === sym && +o.side === -dir && [3, 4].includes(+o.type) && [3, 4, 6].includes(+o.status) && +o.stopPrice);
        if (o) { t.stop = +o.stopPrice; changed = true; }
      }
      if (changed) recSave(st);
    });
  }
  function newTrade(f) {
    const ctx = tradeContext(f.symbol);
    return { id: 't' + f.time + Math.random().toString(36).slice(2, 6), symbol: f.symbol, dir: f.side, qty: 0, maxQty: 0,
      entryQty: 0, entryValue: 0, exitQty: 0, exitValue: 0, points: 0, commission: 0, pointValue: f.pointValue,
      openTime: f.time, fills: [], video: false, backfilled: false, broker: ctx.broker, tf: ctx.tf };
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
      stop: t.stop ?? null, risk: t.stop != null && pv ? Math.abs(entry - t.stop) * pv * (t.maxQty || 1) : null,
      fills: t.fills, backfilled: t.backfilled, adopted: !!t.adopted, broker: t.broker || '', tf: t.tf || '', pointValue: pv || null, videoId: t.video && !pendingNoVideo.has(t.id) ? 'v_' + t.id : null
    };
    await DB.tradePut(rec);
    return rec;
  }
  // Applies fills (oldest first) to the open trades. Only one window does this at a time.
  function recProcess(fills, live) {
    if (!recActive()) return Promise.resolve();
    return withLock('tvwp-rec', async () => {
      const st = recLoad();
      const seen = new Set(st.seen);
      const list = fills.map(normFill).filter(Boolean).sort((a, b) => a.time - b.time);
      const opened = [], closed = [];
      for (const f of list) {
        if (seen.has(f.id) || f.time < st.since - 30000) continue;   // 30 s allowance for the broker's clock
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
          t.lastFill = f.time;
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
      journalDirty = true;
      videoSync();
      if (res.recs.length && buildUI.onJournal) buildUI.onJournal();
      if (res.recs.length) folderSync();
    }).catch(e => console.warn('[Wick] journal error', e));
  }
  function recOnExec(ex) {
    if (pageClosing) return;
    const f = normFill(ex);
    if (!f) return;
    recProcess([ex], Date.now() - f.time < 60000);
  }
  /* Keeps the journal's open trades in step with your broker's real positions.
     - A trade the journal thinks is open, but the broker shows no position for, is dropped
       (its exit was missed, e.g. closed while TradingView was shut).
     - A position the broker has that the journal isn't tracking (opened before recording
       was switched on) is picked up, so its exit is recorded correctly. */
  let posCache = { at: 0, list: [], ok: false };
  const reconcileMiss = {};
  async function pollPositions() {
    const b = currentBroker();
    let ok = false, list = [];
    try {
      ok = !!(b && (typeof b.isConnected !== 'function' || b.isConnected()) && typeof b.positions === 'function');
      if (ok) list = ((await b.positions()) || []).filter(p => p && +p.qty);
    } catch (e) { ok = false; }
    posCache = { at: Date.now(), list, ok };
    if (S.extras.hideQty || (S.extras.streamer && S.extras.streamerChart)) {
      const q = new Set(list.map(p => String(Math.abs(+p.qty))));
      try {
        if (ok && typeof b.orders === 'function')
          for (const o of (await b.orders()) || []) if (o && [3, 4, 6].includes(+o.status) && +o.qty) q.add(String(Math.abs(+o.qty)));
      } catch (e) {}
      QTY_SET = q;
    } else if (QTY_SET.size) QTY_SET = new Set();
    return posCache;
  }
  setInterval(() => { if (!S.extras.allOff && (S.extras.hideQty || (S.extras.streamer && S.extras.streamerChart)) && Date.now() - posCache.at > 1200) pollPositions(); }, 1500);
  async function recReconcile() {
    if (!recActive() || pageClosing) return;
    const pc = await pollPositions();
    if (!pc.ok) return;
    await withLock('tvwp-rec', async () => {
      const st = recLoad();
      const now = Date.now();
      let changed = false;
      const quiet = t => now - (t.lastFill || t.openTime) > 20000;    // no fills for 20 s
      for (const sym of Object.keys(st.open)) {
        const t = st.open[sym];
        const pos = pc.list.find(p => p.symbol === sym);
        const match = pos && ((pos.side === -1 ? -1 : 1) === Math.sign(t.qty));
        if (match || !quiet(t)) { delete reconcileMiss[sym]; continue; }
        reconcileMiss[sym] = (reconcileMiss[sym] || 0) + 1;
        if (reconcileMiss[sym] >= 2) {                                    // seen twice in a row: really gone
          delete st.open[sym]; delete reconcileMiss[sym]; changed = true;
          console.warn('[Wick] journal: dropped a trade whose exit was never reported', sym);
        }
      }
      for (const pos of pc.list) {
        if (st.open[pos.symbol]) { delete reconcileMiss['+' + pos.symbol]; continue; }
        const lastAny = st.lastFill || 0;
        reconcileMiss['+' + pos.symbol] = (reconcileMiss['+' + pos.symbol] || 0) + 1;
        if (reconcileMiss['+' + pos.symbol] < 2 || now - lastAny < 20000 || !isFinite(+pos.avgPrice)) continue;
        delete reconcileMiss['+' + pos.symbol];
        const side = pos.side === -1 ? -1 : 1, qty = Math.abs(+pos.qty);
        const t = newTrade({ time: now, symbol: pos.symbol, side, pointValue: 0 });
        t.qty = side * qty; t.entryQty = qty; t.entryValue = +pos.avgPrice * qty; t.maxQty = qty;
        t.adopted = true; t.lastFill = now;
        st.open[pos.symbol] = t; changed = true;
      }
      if (changed) recSave(st);
    });
  }
  setInterval(() => { recReconcile().catch(() => {}); }, 5000);

  let backfilling = false;
  async function recBackfill() {
    if (!recActive() || backfilling) return;
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
      console.warn('[Wick] journal catch-up failed', e);
    } finally { backfilling = false; }
  }

  /* ---- chart video while you're in a trade ---- */
  let vid = null;
  const pendingNoVideo = new Set();   // trades whose video turned out empty
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
  // Video size. "native" = the chart's real screen pixels (sharpest your screen can give, no upscaling).
  const even = n => Math.max(2, Math.round(n / 2) * 2);
  function chartPixels() {
    const cont = document.querySelector('.chart-container.active') || document.querySelector('.chart-container');
    if (!cont) return null;
    const r = cont.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    return r.width > 50 && r.height > 50 ? { w: Math.round(r.width * d), h: Math.round(r.height * d) } : null;
  }
  function recSize() {
    const q = String(S.rec.quality || '720');
    if (q === 'native') {
      const c = chartPixels() || { w: 1920, h: 1080 };
      const k = Math.min(1, 3840 / c.w, 2160 / c.h);              // at most 4K
      return { W: even(c.w * k), H: even(c.h * k) };
    }
    const H = { 540: 540, 720: 720, 1080: 1080, 1440: 1440, 2160: 2160 }[q] || 720;
    return { W: even(H * 16 / 9), H };
  }
  function recBitrate(W, H) {
    if (String(S.rec.quality) === '540') return 3.5e5;             // small enough for Notion's free plan
    return Math.max(2e6, Math.min(25e6, Math.round(W * H * 30 * 0.08)));   // ~5 Mbps at 1080p, ~9 at 1440p, ~20 at 4K
  }
  function startRecording(t, done) {
    const o = recLoad().open[t.symbol];
    if (!o || o.id !== t.id || o.video) { done(); return; }   // trade already closed, or already being filmed
    try {
      const { W, H } = recSize();
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      drawChartFrame(g, cv, t);
      const stream = cv.captureStream(30);
      // 1440p and up: H.264 (.mp4), which graphics cards encode in hardware, so recording doesn't load your CPU. Below that: VP9 (.webm).
      const hw = ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1', 'video/mp4'];
      const sw = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      const mime = (H >= 1440 ? hw.concat(sw) : sw).find(m => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || '';
      const mr = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: recBitrate(W, H) });
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
            if (rec && (!rec.videoId || rec.videoExt !== videoExt(blob.type))) { rec.videoId = rec.videoId || 'v_' + t.id; rec.videoExt = videoExt(blob.type); await DB.tradePut(rec); }
            await videoCleanup();
          } else {
            // nothing was filmed (the trade lasted only a moment): don't leave a play button that plays nothing
            const rec = await DB.tradeGet(t.id);
            if (rec && rec.videoId) { rec.videoId = null; await DB.tradePut(rec); }
            pendingNoVideo.add(t.id);
          }
        } catch (e) { console.warn('[Wick] video save failed', e); }
        if (buildUI.onJournal) buildUI.onJournal();
        folderSync();
        done();
        if (nextVideo) { const n = nextVideo; nextVideo = null; setTimeout(() => videoStart(n), 50); }
      };
      mr.start(1000);
      // remember on the open trade that it has a video
      withLock('tvwp-rec', () => { const st = recLoad(); if (st.open[t.symbol] && st.open[t.symbol].id === t.id) { st.open[t.symbol].video = true; recSave(st); } });
      if (buildUI.onJournal) buildUI.onJournal();
    } catch (e) {
      console.warn('[Wick] video recording unavailable', e);
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
    let old = keys.slice(0, Math.max(0, keys.length - keep));
    if (S.rec.folderOn && old.length) {
      // Keep videos that haven't reached your folder yet (up to 3x the limit), so nothing is lost while it waits.
      let done = new Set();
      try { done = new Set(JSON.parse(localStorage.getItem('tvwp_folder_written') || '[]')); } catch (e) {}
      const waiting = old.filter(k => !done.has(k));
      if (keys.length <= keep * 3) old = old.filter(k => done.has(k));
      else old = old.filter(k => done.has(k)).concat(waiting.slice(0, keys.length - keep * 3));
    }
    if (!old.length) return;
    const gone = new Set(old);
    for (const k of old) await DB.videoDel(k);
    for (const t of (await DB.tradesAll()) || []) {
      if (t.videoId && gone.has(t.videoId)) { t.videoId = null; await DB.tradePut(t); }
    }
    journalDirty = true;
  }
  window.addEventListener('pagehide', () => { if (vid) try { vid.mr.stop(); } catch (e) {} });

  /* ---- journal files: CSV, a full backup, and saving into a real folder ---- */
  const shortSymbol = sym => String(sym).split(':').pop();
  function tradesToCsv(trades) {
    const head = ['Open time', 'Close time', 'Symbol', 'Side', 'Qty', 'Entry', 'Exit', 'Ticks', 'Gross P&L', 'Commission', 'Net P&L', 'Currency', 'Seconds held', 'Caught up', 'Has video'];
    const q = v => { const x = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    const rows = trades.slice().sort((a, b) => a.openTime - b.openTime).map(t => [new Date(t.openTime).toISOString(), new Date(t.closeTime).toISOString(), shortSymbol(t.symbol), t.dir > 0 ? 'Long' : 'Short', t.qty,
      t.entry, t.exit, t.ticks, t.gross !== null && t.gross !== undefined ? +t.gross.toFixed(2) : '', +(+t.commission || 0).toFixed(2), t.net !== null && t.net !== undefined ? +t.net.toFixed(2) : '', t.currency,
      Math.round((t.closeTime - t.openTime) / 1000), t.backfilled ? 'yes' : '', t.videoId ? 'yes' : ''].map(q).join(','));
    return '﻿' + [head.join(','), ...rows].join('\r\n');
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  const videoExt = mime => /mp4/i.test(String(mime || '')) ? 'mp4' : 'webm';
  function videoFileName(t, id, ext) {
    ext = ext || (t && t.videoExt) || 'webm';
    if (!t) return `${id}.${ext}`;
    const d = new Date(t.openTime);
    const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
    const res = (t.net ?? t.ticks ?? 0) > 0 ? 'WIN' : (t.net ?? t.ticks ?? 0) < 0 ? 'LOSS' : 'FLAT';
    return `${stamp} ${t.dir > 0 ? 'Long' : 'Short'} ${t.qty} ${shortSymbol(t.symbol)} ${res}.${ext}`.replace(/[\\/:*?"<>|]/g, '-');
  }
  const FOLDER_DONE = 'tvwp_folder_written';
  const folder = { status: 'off', last: 0, count: 0, error: '' };
  function folderSupported() { return typeof window.showDirectoryPicker === 'function'; }
  async function writeFile(dir, name, data) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
  }
  // Some apps don't have the permission check at all; there the folder is simply usable.
  async function folderPerm(handle, mode, ask) {
    if (typeof handle.queryPermission !== 'function') return 'granted';
    let perm = 'prompt';
    try { perm = await handle.queryPermission({ mode }); } catch (e) {}
    if (perm !== 'granted' && ask && typeof handle.requestPermission === 'function') { try { perm = await handle.requestPermission({ mode }); } catch (e) {} }
    return perm;
  }
  async function folderHandle() { try { const r = await DB.kvGet('folder'); return r && r.handle; } catch (e) { return null; } }
  async function chooseFolder() {
    if (!folderSupported()) throw new Error('This browser can\'t save into folders.');
    const handle = await window.showDirectoryPicker({ id: 'tvwp-journal', mode: 'readwrite', startIn: 'documents' });
    await DB.kvPut({ k: 'folder', handle });
    try { localStorage.removeItem(FOLDER_DONE); } catch (e) {}
    S.rec.folderOn = true; S.rec.folderName = handle.name;
    save('journal');
    await folderSync(true);
  }
  // Copies everything not yet in the folder. Safe to run any time; only one window writes at a time.
  let folderBusy = false, folderAgain = false;
  async function folderSync(interactive) {
    if (!S.rec.folderOn) { folder.status = 'off'; return; }
    if (folderBusy) { folderAgain = true; return; }
    folderBusy = true;
    try {
      const handle = await folderHandle();
      if (!handle) { folder.status = 'none'; return; }
      if ((await folderPerm(handle, 'readwrite', interactive)) !== 'granted') { folder.status = 'needs'; return; }
      await withLock('tvwp-folder', async () => {
        const trades = (await DB.tradesAll()) || [];
        await writeFile(handle, 'trades.csv', new Blob([tradesToCsv(trades)], { type: 'text/csv' }));
        let done = [];
        try { done = JSON.parse(localStorage.getItem(FOLDER_DONE) || '[]'); } catch (e) {}
        const doneSet = new Set(done);
        const byVideo = new Map(trades.filter(t => t.videoId).map(t => [t.videoId, t]));
        const keys = ((await DB.videoKeys()) || []).map(String).filter(k => !doneSet.has(k));
        if (keys.length) {
          const vdir = await handle.getDirectoryHandle('Videos', { create: true });
          for (const k of keys) {
            const v = await DB.videoGet(k);
            if (!v || !v.blob) continue;
            await writeFile(vdir, videoFileName(byVideo.get(k), k, videoExt(v.mime || v.blob.type)), v.blob);
            doneSet.add(k);
            try { localStorage.setItem(FOLDER_DONE, JSON.stringify([...doneSet].slice(-2000))); } catch (e) {}
          }
        }
        folder.count = doneSet.size;
        // full backup; each trade lists its video file so other tools (like the Notion sync) can find it
        const withFiles = trades.map(t => ({ ...t, videoFile: t.videoId && doneSet.has(t.videoId) ? 'Videos/' + videoFileName(t, t.videoId) : null }));
        await writeFile(handle, 'journal-backup.json', new Blob([JSON.stringify({ app: 'Wick', version: VERSION, saved: new Date().toISOString(), trades: withFiles }, null, 1)], { type: 'application/json' }));
      });
      folder.status = 'ok'; folder.last = Date.now(); folder.error = '';
    } catch (e) {
      folder.status = 'error'; folder.error = (e && e.message) || String(e);
      console.warn('[Wick] saving to folder failed', e);
    } finally {
      folderBusy = false;
      if (buildUI.onFolder) buildUI.onFolder();
      if (folderAgain) { folderAgain = false; setTimeout(() => folderSync(), 200); }
    }
  }
  async function restoreFromFolder() {
    const handle = await folderHandle();
    if (!handle) throw new Error('Pick a folder first.');
    if ((await folderPerm(handle, 'read', true)) !== 'granted') throw new Error('Allow access to the folder to restore.');
    const fh = await handle.getFileHandle('journal-backup.json');
    const data = JSON.parse(await (await fh.getFile()).text());
    const have = new Set(((await DB.tradesAll()) || []).map(t => t.id));
    let added = 0;
    for (const t of (data && data.trades) || []) {
      if (!t || !t.id || have.has(t.id) || !isFinite(t.openTime) || !isFinite(t.closeTime)) continue;
      await DB.tradePut({ ...t, videoId: null });
      added++;
    }
    return added;
  }
  // Ask the browser to keep this data even when the disk gets full.
  let storageInfo = { persisted: false, used: 0 };
  async function protectStorage() {
    try {
      if (navigator.storage && navigator.storage.persist) storageInfo.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
      if (navigator.storage && navigator.storage.estimate) storageInfo.used = ((await navigator.storage.estimate()) || {}).usage || 0;
    } catch (e) {}
  }
  setTimeout(() => { protectStorage(); folderSync(); }, 4000);

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
      if (++indErrors === 1) console.warn('[Wick] indicators paused:', e && e.message);
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
        try { IND_DRAW[ind.type](g, ind, d, { ts, ps, fv, W, H }); } catch (e) { console.warn('[Wick] indicator failed', e); }
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
   * Risk: daily limits & lockout, position sizing, prop-firm rules, news.
   * None of this ever places, changes or closes an order.
   * ======================================================= */
  const RISK_KEY = 'tvwp_risk_state';
  // Futures trading days start at 18:00 New York time.
  function tradingDay(ms) { return Math.floor((ms + nyOffset(ms) + SHIFT) / DAY); }
  function nextSessionStart(ms) {
    const day = tradingDay(ms) + 1;
    const wall = day * DAY - SHIFT;               // 18:00 New York, as wall-clock ms
    return wall - nyOffset(wall);
  }
  function riskLoad() {
    let st = null;
    try { st = JSON.parse(localStorage.getItem(RISK_KEY)); } catch (e) {}
    return st || {};
  }
  function riskSave(st) { try { localStorage.setItem(RISK_KEY, JSON.stringify(st)); } catch (e) {} }

  // Live account numbers from TradingView's account panel (works for any broker).
  function acctValues() {
    const out = {};
    try {
      const b = currentBroker();
      if (!b || (typeof b.isConnected === 'function' && !b.isConnected())) return null;
      const info = typeof b.accountManagerInfo === 'function' ? b.accountManagerInfo() : null;
      for (const row of (info && info.summary) || []) {
        const label = String(row.text || '');
        let v = null;
        try { v = row.wValue && typeof row.wValue.value === 'function' ? row.wValue.value() : null; } catch (e) {}
        if (v === null || v === undefined || !isFinite(+v)) continue;
        v = +v;
        if (/unreali[sz]ed|open\s*p/i.test(label)) out.unrealized = v;
        else if (/reali[sz]ed|closed\s*p/i.test(label)) out.realized = v;
        else if (/equity|net\s*liq/i.test(label)) out.equity = v;
        else if (/balance|cash/i.test(label) && out.balance === undefined) out.balance = v;
      }
      try { out.account = String(b.currentAccount()); } catch (e) {}
      if (out.equity === undefined && out.balance !== undefined) out.equity = out.balance + (out.unrealized || 0);
      return out;
    } catch (e) { return null; }
  }
  function openPositionQty() {
    let q = 0;
    if (posCache.ok && Date.now() - posCache.at < 6000) {
      for (const p of posCache.list) q += Math.abs(+p.qty || 0);
      return q;
    }
    for (const p of brk.positions || []) q += Math.abs(+p.qty || 0);
    if (!q) for (const t of Object.values(recLoad().open)) q += Math.abs(t.qty || 0);
    return q;
  }

  /* ---- today's numbers (from the Journal + open P&L) ---- */
  const day = { pnl: 0, closedPnl: 0, trades: 0, day: -1 };
  let journalDirty = true, dayTrades = [], dayLoadedAt = 0;
  async function refreshDay() {
    const today = tradingDay(Date.now());
    if (journalDirty || Date.now() - dayLoadedAt > 5000) {
      journalDirty = false; dayLoadedAt = Date.now();
      try { dayTrades = (await DB.tradesAll()) || []; } catch (e) {}
    }
    const trades = dayTrades;
    const td = trades.filter(t => tradingDay(t.closeTime) === today);
    // trades deleted with "Clear journal" today still count toward today's limits
    const carry = riskLoad().carry, have = new Set(td.map(t => t.id));
    const gone = carry && carry.day === today ? (carry.items || []).filter(x => !have.has(x.id)) : [];
    day.day = today;
    day.trades = td.length + gone.length;
    day.closedPnl = td.reduce((a, t) => a + (t.net || 0), 0) + gone.reduce((a, x) => a + (x.net || 0), 0);
    const av = acctValues();
    day.pnl = day.closedPnl + ((av && av.unrealized) || 0);
  }

  /* ---- lock state ---- */
  let lockMsg = '', pendingLock = '', newsBlock = '';
  function unlockedToday() { const st = riskLoad(); return !!st.unlocked && st.lockDay === tradingDay(Date.now()); }
  function lockedNow() {
    const st = riskLoad();
    return st.lockDay === tradingDay(Date.now()) && !st.unlocked ? st : null;
  }
  function setLock(reason) {
    const st = riskLoad();
    const today = tradingDay(Date.now());
    if (st.lockDay === today && (st.unlocked || st.lockReason)) return;   // already locked, or unlocked early today
    st.lockDay = today; st.lockReason = reason; st.lockedAt = Date.now(); st.unlocked = false;
    riskSave(st);
    bc && bc.postMessage({ type: 'risk' });
    playSound('tone:alarm');
    lockFileWrite();
  }
  function unlockEarly() {
    const st = riskLoad();
    st.unlocked = true; st.unlockedAt = Date.now();
    riskSave(st);
    bc && bc.postMessage({ type: 'risk' });
    applyLock();
    lockFileWrite();
  }
  // Limits can't be loosened while you're locked, or while a limit is hit and you're still in the trade.
  function rulesFrozen() { return !!lockedNow() || !!pendingLock; }

  /* ---- one lock for Chrome and the desktop app: both read and write lockout.json in your Journal folder ---- */
  const LOCK_FILE = 'lockout.json';
  let lockFileAt = 0;
  async function lockFolder(mode) {
    if (!S.rec.folderOn) return null;
    const h = await folderHandle();
    if (!h || (await folderPerm(h, mode, false)) !== 'granted') return null;
    return h;
  }
  async function lockFileWrite() {
    try {
      const h = await lockFolder('readwrite');
      if (!h) return;
      const st = riskLoad();
      await writeFile(h, LOCK_FILE, new Blob([JSON.stringify({ lockDay: st.lockDay ?? null, lockReason: st.lockReason || '', lockedAt: st.lockedAt || 0,
        unlocked: !!st.unlocked, unlockedAt: st.unlockedAt || 0, from: IN_APP ? 'app' : 'browser', saved: Date.now() })], { type: 'application/json' }));
    } catch (e) {}
  }
  async function lockFileSync() {
    if (!S.rec.folderOn || Date.now() - lockFileAt < 10000) return;
    lockFileAt = Date.now();
    try {
      const h = await lockFolder('read');
      if (!h) return;
      let f = null;
      try { f = JSON.parse(await (await (await h.getFileHandle(LOCK_FILE)).getFile()).text()); } catch (e) {}
      const today = tradingDay(Date.now()), st = riskLoad();
      const hereLocked = st.lockDay === today && !!st.lockReason;
      const fileToday = f && f.lockDay === today && !!f.lockReason;
      if (!fileToday) { if (hereLocked) lockFileWrite(); return; }          // tell the other side about our lock
      if (!hereLocked && !st.unlocked) {
        if (f.unlocked) return;                                             // the other side already unlocked early
        const where = f.from === 'app' ? 'desktop app' : 'browser';
        st.lockDay = today; st.lockReason = `${f.lockReason} (in the ${where})`; st.lockedAt = f.lockedAt || Date.now(); st.unlocked = false;
        riskSave(st); bc && bc.postMessage({ type: 'risk' }); playSound('tone:alarm'); applyLock();
      } else if (hereLocked && !st.unlocked && f.unlocked && (f.unlockedAt || 0) >= (st.lockedAt || 0) - 60000) {
        st.unlocked = true; st.unlockedAt = f.unlockedAt; riskSave(st); bc && bc.postMessage({ type: 'risk' }); applyLock();
      }
    } catch (e) {}
  }
  const LOCK_CSS = `
    [data-name="buy-order-button"], [data-name="sell-order-button"], [data-name="order-panel"], [class*="tv-dom-panel"],
    [class*="sellBuyButtonsContainer-"] { pointer-events: none !important; opacity: .28 !important; filter: grayscale(1) !important; }`;
  function blocking() { return (!!lockedNow() || (!!newsBlock && !S.extras.allOff)) && openPositionQty() === 0; }

  /* ---- trading symbols: only the markets you list can be traded (e.g. MNQ while you chart NQ). Closing always works. ---- */
  function symList() {
    return String(S.risk.symOnly || '').split(/[\s,;]+/).map(x => symRoot(x.replace(/[^A-Za-z0-9:!]/g, ''))).filter(Boolean);
  }
  function symAllowed(sym) { const l = symList(); return !l.length || !sym || l.includes(symRoot(sym)); }
  function chartSymbol() { try { return window.TradingViewApi.activeChart().symbol() || ''; } catch (e) { return ''; } }
  function posList() { const fresh = posCache.ok && Date.now() - posCache.at < 6000; return fresh ? posCache.list : (brk.positions || []); }
  function chartSymBlocked() {
    const cs = chartSymbol();
    if (!cs || symAllowed(cs)) return false;
    return !posList().some(p => p && symRoot(p.symbol) === symRoot(cs) && Math.abs(+p.qty || 0) > 0);   // in that market? keep the panel so you can exit
  }
  // The micro you'd trade instead of the chart's market (NQ -> MNQ), if it's on your list.
  function symSwap(cs) {
    const root = symRoot(cs), l = symList();
    const alt = MICRO_OF[root] && l.includes(MICRO_OF[root]) ? MICRO_OF[root] : l.length === 1 ? l[0] : '';
    if (!alt) return '';
    const [ex, tk] = cs.includes(':') ? cs.split(':') : ['', cs];
    const nt = tk.toUpperCase().startsWith(root) ? alt + tk.slice(root.length) : alt + '1!';
    const nex = ex && (MICRO_OF[root] === alt || MINI_OF[alt] === root) ? ex : '';
    return (nex ? nex + ':' : '') + nt;
  }
  let symNotice = 0;
  /* ---- Brackets: cancel the other exit when one fills ----
     For brokers that turn a bracket into two plain orders (Tradovate in TradingView), so a filled take-profit
     leaves the stop behind (or the other way round). Rules, so it can't cancel something you meant to keep:
     - it only remembers exit orders: opposite side to your position, same symbol, no bigger than the position
     - it only cancels those remembered exits, and only after that position has fully closed (or flipped)
     - it never touches entry orders, other symbols, or anything while the broker connection is unclear
     It cancels only. It never places or changes an order. Off until you switch it on. */
  const ocoState = new Map();          // symbol -> { dir, exits: Map(id -> side) }
  let ocoBusy = false, ocoLast = '', ocoLog = [];
  const isWorking = o => o && [3, 6].includes(+o.status);        // 6 = working, 3 = waiting (inactive bracket leg)
  async function ocoTick() {
    if (ocoBusy) return;
    if (!S.extras.oco || S.extras.allOff) { ocoState.clear(); ocoLast = 'off'; return; }
    const b = currentBroker();
    if (!b || typeof b.orders !== 'function' || typeof b.cancelOrder !== 'function') { ocoLast = 'nobroker'; return; }
    ocoBusy = true;
    try {
      if (typeof b.isConnected === 'function' && !b.isConnected()) { ocoLast = 'nobroker'; return; }
      const pc = await pollPositions();
      if (!pc.ok) { ocoLast = 'nobroker'; return; }                // unsure about positions: do nothing
      const orders = ((await b.orders()) || []).filter(isWorking);
      const byId = new Map(orders.map(o => [String(o.id), o]));
      const toCancel = [];
      for (const p of pc.list) {
        const dir = p.side === -1 || +p.qty < 0 ? -1 : 1, size = Math.abs(+p.qty || 0);
        let st = ocoState.get(p.symbol);
        if (st && st.dir !== dir) {                                   // flipped: old exits would now add to the new position
          for (const [id, side] of st.exits) if (byId.has(id) && side === dir) toCancel.push(byId.get(id));
          st = null;
        }
        if (!st) { st = { dir, exits: new Map() }; ocoState.set(p.symbol, st); }
        for (const o of orders) if (o.symbol === p.symbol && +o.side === -dir && Math.abs(+o.qty || 0) <= size) st.exits.set(String(o.id), +o.side);
        for (const id of [...st.exits.keys()]) if (!byId.has(id)) st.exits.delete(id);   // filled or cancelled already
      }
      for (const [sym, st] of [...ocoState]) {
        if (pc.list.some(p => p.symbol === sym)) continue;
        ocoState.delete(sym);                                         // position closed: cancel what's left of its exits
        for (const id of st.exits.keys()) if (byId.has(id)) toCancel.push(byId.get(id));
      }
      for (const o of toCancel) {
        try {
          await b.cancelOrder(o.id);
          ocoLog.unshift({ at: Date.now(), text: `Cancelled ${o.side === 1 ? 'buy' : 'sell'} ${shortSymbol(o.symbol)} ${o.qty} (the other exit)` });
          console.info('[Wick] cancelled the other exit', o.id);
        } catch (e) { ocoLog.unshift({ at: Date.now(), text: `Couldn't cancel order ${o.id}: ${e && e.message || e}` }); }
      }
      ocoLog = ocoLog.slice(0, 5);
      const n = [...ocoState.values()].reduce((a, st) => a + st.exits.size, 0);
      ocoLast = n ? `Watching ${n} exit${n === 1 ? '' : 's'} on ${[...ocoState.keys()].map(shortSymbol).join(', ')}` : 'ready';
    } catch (e) { ocoLast = 'error'; }
    finally { ocoBusy = false; }
  }
  setInterval(() => { if (S.extras.oco && !S.extras.allOff) ocoTick(); }, 400);

  /* ---- Faster order updates ----
     TradingView's Tradovate connection doesn't stream your orders: it asks Tradovate for orders and positions
     about once a second, which is why fills show up ~1 s late. This shortens that wait.
     - demo-type accounts only (that includes prop accounts), never a live brokerage account
     - only while you're in a trade, have working orders, or just placed an order; normal speed when flat
     - if Tradovate starts answering with errors, it goes back to normal for a minute
     It only changes how often TradingView checks. Orders still go out exactly as before. */
  const fastOrig = new WeakMap(), fastErr = new WeakMap(), fastPulse = new WeakMap();
  let fastBoostUntil = 0, fastBackoffUntil = 0, fastInfo = { state: 'off', ms: 0 };
  function tvRequesters() {
    const out = [];
    try {
      const rq = currentBroker()._brokerConnection._requesters;
      for (const name of ['orders', 'positions']) {
        const x = rq && rq[name];
        const r = x && (typeof x._requestInterval === 'number' ? x : x._requester);
        if (r && typeof r._requestInterval === 'number') out.push(r);
      }
    } catch (e) {}
    return out;
  }
  async function fastTick() {
    const reqs = tvRequesters();
    const b = currentBroker();
    if (!reqs.length) { fastInfo = { state: b ? 'unsupported' : 'nobroker', ms: 0 }; return; }
    for (const r of reqs) if (!fastOrig.has(r)) fastOrig.set(r, r._requestInterval || 1000);
    const want = Math.max(100, +S.extras.fastMs || 0);
    let type = ''; try { type = String(b.currentAccountType() || ''); } catch (e) {}
    let working = 0;
    try { working = ((await b.orders()) || []).filter(o => o && [3, 4, 6].includes(+o.status)).length; } catch (e) {}
    const now = Date.now();
    for (const r of reqs) {                                   // Tradovate pushing back? slow down for a minute
      const n = +r._errorsCount || 0, was = fastErr.get(r);
      if (was != null && n > was) fastBackoffUntil = now + 60000;
      fastErr.set(r, n);
    }
    const active = openPositionQty() > 0 || working > 0 || now < fastBoostUntil;
    let state;
    if (!S.extras.fastMs || S.extras.allOff) state = 'off';
    else if (type && type !== 'demo') state = 'live';
    else if (now < fastBackoffUntil) state = 'backoff';
    else state = active ? 'fast' : 'idle';
    for (const r of reqs) {
      const target = state === 'fast' ? want : fastOrig.get(r);
      if (r._requestInterval !== target) r._requestInterval = target;
    }
    // measured speed: requests per second on the orders checker
    const r0 = reqs[0], pi = +r0._currentPulseIndex || 0, prev = fastPulse.get(r0);
    let ms = fastInfo.ms;
    if (prev && now - prev.at >= 2500) { const d = pi - prev.pi; ms = d > 0 ? Math.round((now - prev.at) / d) : 0; fastPulse.set(r0, { pi, at: now }); }
    else if (!prev) fastPulse.set(r0, { pi, at: now });
    fastInfo = { state, ms };
  }
  setInterval(() => { if (S.extras.fastMs || fastInfo.state === 'fast') fastTick(); }, 500);

  /* ---- End-of-day summary: once a day after the futures close, your P&L and trade count ---- */
  let eodNotice = null;
  function nyNow() { const t = Date.now(), w = new Date(t + nyOffset(t)); return { date: w.toISOString().slice(0, 10), mins: w.getUTCHours() * 60 + w.getUTCMinutes(), dow: w.getUTCDay() }; }
  function eodCheck() {
    const mode = S.extras.eod || 'traded';
    if (mode === 'off' || S.extras.allOff) return;
    const n = nyNow();
    if (n.dow === 0 || n.dow === 6) return;                       // no session close on weekends
    const [hh, mm] = String(S.extras.eodClose || '17:00').split(':').map(Number);
    const close = hh * 60 + (mm || 0);
    if (n.mins < close || n.mins > close + 55) return;            // only within the hour after the close
    let last = ''; try { last = localStorage.getItem('tvwp_eod_last') || ''; } catch (e) {}
    if (last === n.date) return;
    if (day.day !== tradingDay(Date.now())) return;               // today's numbers not loaded yet
    if (mode === 'traded' && !day.trades) return;
    try { localStorage.setItem('tvwp_eod_last', n.date); } catch (e) {}   // one window, one notice
    const pnl = S.extras.streamer ? '' : `${money(day.closedPnl)} · `;
    const text = `Day summary: ${pnl}${day.trades} trade${day.trades === 1 ? '' : 's'}${day.trades ? '' : ' today'}.`;
    eodNotice = { until: Date.now() + 15 * 60000, text };
    playSound('tone:chime');
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        const nt = new Notification('Wick · day summary', { body: text.replace('Day summary: ', ''), tag: 'wick-eod-' + n.date, silent: true });
        nt.onclick = () => { window.focus(); nt.close(); buildUI.open && buildUI.open('home'); };
      }
    } catch (e) {}
  }

  function noteBlockedSymbol() { symNotice = Date.now() + 9000; flashBanner(); riskTick(); }
  function applyLock() {
    const on = blocking() || chartSymBlocked();
    let st = document.getElementById('tvwp-lock');
    if (on && !st && document.documentElement) {
      st = document.createElement('style');
      st.id = 'tvwp-lock';
      st.textContent = LOCK_CSS;
      document.documentElement.appendChild(st);
    } else if (!on && st) st.remove();
    renderBanners();
    renderCounter();
  }
  // Backup for anything the CSS doesn't cover: Buy/Sell items in menus and order dialogs.
  function blockClick(e) {
    const symBlock = !blocking() && chartSymBlocked();
    if (!blocking() && !symBlock) return;
    const el = e.target && e.target.closest && e.target.closest('[role="menuitem"], button, [role="button"], [data-name]');
    if (!el || el.closest('#tvwp-host')) return;
    const txt = (el.textContent || '').trim();
    const dn = el.getAttribute('data-name') || '';
    if (/^(buy|sell)\b/i.test(txt) || /^(place|submit)\s+(order|buy|sell)/i.test(txt) || /order-button|order-panel|place-order/i.test(dn)) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (symBlock) noteBlockedSymbol(); else flashBanner();
    }
  }
  for (const ev of ['pointerdown', 'mousedown', 'click']) window.addEventListener(ev, blockClick, true);

  /* ---- order guard: while locked, TradingView turns down new entries however they're placed (buttons, right-click menus,
     the + on the price scale, hotkeys, chart trading). Orders that shrink or close a position always go through, and so does
     closing a position, so you're never stuck in a trade. This only says no; it never places, changes or cancels anything. ---- */
  function entryBlocked() { return !!lockedNow() || !!pendingLock || (!!newsBlock && !S.extras.allOff); }
  // On your last allowed trade: you can manage that trade, but nothing new, and the moment it closes nothing gets through
  // (even before the lock banner appears).
  function lastTradeUsed() {
    const r = S.risk;
    if (!r.lockOn || !(+r.maxTrades > 0) || unlockedToday()) return false;
    let open = 0;
    try { open = Object.keys(recLoad().open || {}).length; } catch (e) {}
    return day.day === tradingDay(Date.now()) && day.trades + open >= +r.maxTrades;
  }
  function orderAllowed(method, o) {
    if (!entryBlocked()) {
      if (!lastTradeUsed()) return true;
      if (method === 'reversePosition' || openPositionQty() === 0) return false;
      o = o || {};
      const fresh = posCache.ok && Date.now() - posCache.at < 6000;
      const list = fresh ? posCache.list : (brk.positions || []);
      return !!list.find(x => x && (x.symbol === o.symbol || symRoot(x.symbol) === symRoot(o.symbol))) || !fresh;
    }
    if (method === 'reversePosition') return false;                       // flips into a new trade; closing still works
    if (openPositionQty() === 0) return false;                            // flat: everything would be a new entry
    o = o || {};
    const fresh = posCache.ok && Date.now() - posCache.at < 6000;
    const list = fresh ? posCache.list : (brk.positions || []);
    const p = list.find(x => x && (x.symbol === o.symbol || symRoot(x.symbol) === symRoot(o.symbol)));
    if (!p) return !fresh;                                                // another market = new entry (unless we can't tell)
    const dir = p.side === -1 || +p.qty < 0 ? -1 : 1;
    return +o.side !== dir;                                               // same side = adding to the trade
  }
  function symbolOk(method, o) {
    if (!symList().length) return true;
    if (method === 'reversePosition') {
      const p = posList().find(x => x && (x.id === o || x.id === (o && o.id)));
      return !p || symAllowed(p.symbol);
    }
    o = o || {};
    if (symAllowed(o.symbol)) return true;
    // another market: only orders that shrink or close a position you already have in it
    const p = posList().find(x => x && symRoot(x.symbol) === symRoot(o.symbol) && Math.abs(+x.qty || 0) > 0);
    if (!p) return false;
    const dir = p.side === -1 || +p.qty < 0 ? -1 : 1;
    return +o.side === -dir && Math.abs(+o.qty || 0) <= Math.abs(+p.qty || 0);
  }
  function symMsg(o) {
    return `Wick: you only trade ${symList().join(', ')}. ${symRoot((o && o.symbol) || chartSymbol()) || 'This market'} orders are turned down (closing a position always works).`;
  }
  function guardMsg() {
    const L = lockedNow();
    if (!L && !pendingLock && !newsBlock && lastTradeUsed()) return `Wick: that would go past your max of ${S.risk.maxTrades} trades for today. You can still manage or close the trade you're in.`;
    if (L || pendingLock) return `Wick: trading is locked for today${L ? ` (${L.lockReason})` : ''}. You can still close or reduce your position. New orders unlock at ${new Date(nextSessionStart(Date.now())).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
    return `Wick: new entries are paused around ${newsBlock}.`;
  }
  function guardBroker(b) {
    if (!b || typeof b !== 'object' || b.__tvwpGuard) return;
    try {
      for (const m of ['placeOrder', 'reversePosition']) {
        const orig = b[m];
        if (typeof orig !== 'function') continue;
        b[m] = function (...args) {
          fastBoostUntil = Date.now() + 15000;              // speed up checks so the fill shows sooner
          const symRule = symList().length > 0;
          if (!S.risk.lockOn && !entryBlocked() && !(symRule && !(m === 'placeOrder' && symAllowed((args[0] || {}).symbol)))) return orig.apply(this, args);
          // a rule applies: re-check it right now (positions from the broker, today's trades from the journal), then decide
          journalDirty = true; posCache.at = 0;
          return (S.risk.lockOn ? riskTick() : pollPositions()).catch(() => {}).then(() => {
            if (!symbolOk(m, args[0])) {
              noteBlockedSymbol();
              console.warn('[Wick] order turned down: not one of your trading symbols');
              throw new Error(symMsg(args[0]));
            }
            if (!orderAllowed(m, args[0])) {
              flashBanner();
              console.warn('[Wick] order turned down by the lockout');
              throw new Error(guardMsg());
            }
            return orig.apply(this, args);
          });
        };
      }
      Object.defineProperty(b, '__tvwpGuard', { value: true });
    } catch (e) {}
  }

  /* ---- position size ---- */
  const FUTURES = {
    NQ: [0.25, 5], MNQ: [0.25, 0.5], ES: [0.25, 12.5], MES: [0.25, 1.25], YM: [1, 5], MYM: [1, 0.5],
    RTY: [0.1, 5], M2K: [0.1, 0.5], GC: [0.1, 10], MGC: [0.1, 1], SI: [0.005, 25], SIL: [0.005, 5],
    CL: [0.01, 10], MCL: [0.01, 1], NG: [0.001, 10], HG: [0.0005, 12.5], '6E': [0.00005, 6.25], '6B': [0.0001, 6.25],
    '6J': [0.0000005, 6.25], ZB: [0.03125, 31.25], ZN: [0.015625, 15.625], BTC: [5, 25], MBT: [5, 0.5]
  };
  async function tickSpec(symbol) {
    const root = symRoot(symbol);
    if (!String(symbol).includes(':') && FUTURES[root]) return { root, tick: FUTURES[root][0], value: FUTURES[root][1], from: 'table' };
    try {
      const b = currentBroker();
      if (b && typeof b.symbolInfo === 'function' && symbol) {
        const info = await b.symbolInfo(symbol);
        const tick = +info.minTick || +info.pipSize;
        const val = (+info.pipValue || 0) * (tick / (+info.pipSize || tick));
        if (tick && val) return { root, tick, value: val, from: 'broker' };
      }
    } catch (e) {}
    if (FUTURES[root]) return { root, tick: FUTURES[root][0], value: FUTURES[root][1], from: 'table' };
    return { root, tick: 0, value: 0, from: 'none' };
  }
  // Average candle range (ATR 14) of the chart, in price. Used as a "typical stop" when you don't set one.
  let atrCache = { key: '', atr: 0 };
  function chartAtr() {
    try {
      const ms = chartWidget().model().mainSeries();
      const b = ms.bars(), l = b.lastIndex(), f = b.firstIndex();
      if (l === null || f === null || l === undefined) return 0;
      const last = b.valueAt(l);
      const key = `${f}|${l}|${last && last[0]}`;
      if (atrCache.key === key) return atrCache.atr;
      const N = 14, rows = [];
      for (let i = Math.max(f, l - N - 1); i <= l; i++) { const v = b.valueAt(i); if (v) rows.push(v); }
      let sum = 0, n = 0;
      for (let i = 1; i < rows.length; i++) {
        const [, , h, lo] = rows[i], pc = rows[i - 1][4];
        sum += Math.max(h - lo, Math.abs(h - pc), Math.abs(lo - pc)); n++;
      }
      atrCache = { key, atr: n ? sum / n : 0 };
      return atrCache.atr;
    } catch (e) { return 0; }
  }
  const MICRO_OF = { NQ: 'MNQ', ES: 'MES', YM: 'MYM', RTY: 'M2K', GC: 'MGC', CL: 'MCL', SI: 'SIL', BTC: 'MBT' };
  const MINI_OF = Object.fromEntries(Object.entries(MICRO_OF).map(([a, b]) => [b, a]));
  async function calcSize() {
    const r = S.risk;
    let chartSym = '';
    try { chartSym = window.TradingViewApi.activeChart().symbol(); } catch (e) {}
    const sym = r.sizeSym || chartSym;
    const spec = await tickSpec(sym);
    const av = acctValues();
    const riskUsd = r.sizeMode === 'pct' ? ((av && (av.equity || av.balance)) || 0) * (+r.sizePct || 0) / 100 : +r.sizeRisk || 0;
    // the stop: automatic (from the chart's average candle) or your own
    const sameAsChart = !r.sizeSym || symRoot(chartSym) === spec.root || MICRO_OF[symRoot(chartSym)] === spec.root || MINI_OF[symRoot(chartSym)] === spec.root;
    const atr = sameAsChart ? chartAtr() : 0;
    let stopTicks, stopSource;
    if (r.sizeView !== 'classic' && r.simpleManual && +r.simplePts > 0 && spec.tick) {
      stopTicks = Math.max(1, Math.round(+r.simplePts / spec.tick));          // "stop in points" box
      stopSource = 'yours';
    } else if (r.sizeView === 'classic' || r.sizeStopMode === 'manual' || !atr || !spec.tick) {
      stopTicks = +r.sizeStop || 0;
      if (r.sizeUnit === 'points' && spec.tick) stopTicks = stopTicks / spec.tick;
      stopSource = r.sizeView === 'classic' || r.sizeStopMode === 'manual' ? 'yours' : 'fallback';
    } else {
      stopTicks = Math.max(1, Math.round(atr * (+r.sizeAtr || 1) / spec.tick));
      stopSource = 'auto';
    }
    const perContract = stopTicks * spec.value;
    const qty = perContract > 0 ? Math.floor(riskUsd / perContract) : 0;
    // the other size of the same market (micro <-> mini), when there is one
    const otherRoot = MICRO_OF[spec.root] || MINI_OF[spec.root] || null;
    const other = otherRoot && FUTURES[otherRoot] ? { root: otherRoot, value: FUTURES[otherRoot][1] * (spec.tick / FUTURES[otherRoot][0]) } : null;
    const otherQty = other && stopTicks ? Math.floor(riskUsd / (stopTicks * other.value)) : null;
    // a few other stop sizes around the main one
    const mults = [0.5, 1, 2, 3];
    const rows = stopTicks ? mults.map(m => {
      const tk = Math.max(1, Math.round(stopTicks * m));
      return { ticks: tk, points: tk * spec.tick, qty: Math.floor(riskUsd / (tk * spec.value)), otherQty: other ? Math.floor(riskUsd / (tk * other.value)) : null, main: m === 1 };
    }) : [];
    return { sym, spec, riskUsd, stopTicks, stopSource, atr, perContract, qty, actual: qty * perContract, other, otherQty, rows,
      needsEquity: r.sizeMode === 'pct' && !(av && (av.equity || av.balance)) };
  }

  /* ---- prop-firm tracker ---- */
  function propState(av) {
    const p = S.prop;
    const st = riskLoad();
    const acct = (av && av.account) || 'default';
    const ps = (st.prop && st.prop[acct]) || { peak: +p.start, eodPeak: +p.start, lastDay: tradingDay(Date.now()), dayStart: null };
    const eq = av && isFinite(av.equity) ? av.equity : null;
    const bal = av && isFinite(av.balance) ? av.balance : eq;
    const today = tradingDay(Date.now());
    if (ps.lastDay !== today) {          // new trading day: end-of-day high-water mark uses yesterday's close
      if (isFinite(ps.lastBal)) ps.eodPeak = Math.max(ps.eodPeak, ps.lastBal);
      ps.lastDay = today; ps.dayStart = bal;
    }
    if (ps.dayStart === null && bal !== null) ps.dayStart = bal;
    if (eq !== null) ps.peak = Math.max(ps.peak, eq);
    if (bal !== null) ps.lastBal = bal;
    // closed profit per trading day, for the consistency rule (keeps the last 180 days)
    if (bal !== null && ps.dayStart !== null) {
      ps.days = ps.days || {};
      ps.days[today] = Math.round((bal - ps.dayStart) * 100) / 100;
      const ks = Object.keys(ps.days);
      if (ks.length > 180) for (const k of ks.sort().slice(0, ks.length - 180)) delete ps.days[k];
    }
    st.prop = st.prop || {}; st.prop[acct] = ps; riskSave(st);
    const base = p.ddType === 'intraday' ? ps.peak : p.ddType === 'eod' ? ps.eodPeak : +p.start;
    let floor = base - (+p.dd || 0);
    if (p.ddType !== 'static' && p.stopAtStart) floor = Math.min(floor, +p.start + (+p.stopOffset || 0));   // trailing stops at the starting balance (+ an offset some firms use)
    const toFloor = eq !== null ? eq - floor : null;
    const dailyUsed = ps.dayStart !== null && eq !== null ? Math.max(0, ps.dayStart - eq) : 0;
    const qty = openPositionQty();
    return { days: ps.days || {}, today, eq, bal, floor, toFloor, ddLeftPct: toFloor !== null && +p.dd ? Math.max(0, Math.min(1, toFloor / +p.dd)) : null,
      profit: eq !== null ? eq - +p.start : null, target: +p.target || 0, dailyUsed, daily: +p.daily || 0, qty, maxQty: +p.maxQty || 0 };
  }

  /* ---- firm presets: one pick fills in the account's rules (still editable after) ---- */
  // Evaluation-phase rules, from public sources (Nov 2026). maxQty is in micros (1 mini = 10 micros).
  // [size, target, max loss, daily loss, max micros]
  const PRESET_FIRMS = [
    { firm: 'Lucid Trading', plans: [
      { id: 'lucidflex', plan: 'Lucid Flex', ddType: 'eod', off: 100, cons: 50, sizes: [[25, 1250, 1000, 0, 20], [50, 3000, 2000, 0, 40], [100, 6000, 3000, 0, 60], [150, 9000, 4500, 0, 100]] },
      { id: 'lucidpro', plan: 'Lucid Pro', ddType: 'eod', off: 100, cons: 0, sizes: [[25, 1250, 1000, 0, 20], [50, 3000, 2000, 1200, 40], [100, 6000, 3000, 1800, 60], [150, 9000, 4500, 2700, 100]] },
      { id: 'luciddirect', plan: 'Lucid Direct (funded)', ddType: 'eod', off: 100, cons: 20, sizes: [[25, 0, 1000, 600, 0], [50, 0, 2000, 1200, 0], [100, 0, 3500, 1800, 0], [150, 0, 4500, 2700, 0]] }
    ] },
    { firm: 'Topstep', plans: [
      { id: 'topstep', plan: 'Topstep Combine', ddType: 'eod', off: 0, cons: 50, sizes: [[50, 3000, 2000, 0, 50], [100, 6000, 3000, 0, 100], [150, 9000, 4500, 0, 150]] }
    ] },
    { firm: 'Take Profit Trader', plans: [
      { id: 'tpt', plan: 'TPT Test', ddType: 'eod', off: 0, cons: 50, sizes: [[25, 1500, 1500, 0, 30], [50, 3000, 2000, 0, 60], [75, 4500, 2500, 0, 90], [100, 6000, 3000, 0, 120], [150, 9000, 4500, 0, 150]] }
    ] },
    { firm: 'MyFundedFutures', plans: [
      { id: 'mffurapid', plan: 'MFFU Rapid', ddType: 'eod', off: 100, cons: 50, sizes: [[25, 1500, 1000, 0, 30], [50, 3000, 2000, 0, 50], [100, 6000, 3000, 0, 100], [150, 9000, 4500, 0, 150]] },
      { id: 'mffupro', plan: 'MFFU Pro', ddType: 'eod', off: 100, cons: 50, sizes: [[50, 3000, 2000, 0, 50], [100, 6000, 3000, 0, 100], [150, 9000, 4500, 0, 150]] }
    ] },
    { firm: 'Tradeify', plans: [
      { id: 'tradeifyselect', plan: 'Tradeify Select', ddType: 'eod', off: 100, cons: 40, sizes: [[25, 1500, 1000, 0, 10], [50, 3000, 2000, 0, 40], [100, 6000, 3000, 0, 80], [150, 9000, 4500, 0, 120]] },
      { id: 'tradeifygrowth', plan: 'Tradeify Growth', ddType: 'eod', off: 100, cons: 0, sizes: [[25, 1500, 1000, 600, 10], [50, 3000, 2000, 1250, 40], [100, 6000, 3500, 2500, 80], [150, 9000, 5000, 3750, 120]] }
    ] },
    { firm: 'FundedNext Futures', plans: [
      { id: 'fnlegacy', plan: 'FundedNext Legacy', ddType: 'eod', off: 0, cons: 40, sizes: [[25, 1250, 1000, 0, 0], [50, 3000, 2000, 0, 0], [100, 6000, 3000, 0, 0]] },
      { id: 'fnrapid', plan: 'FundedNext Rapid', ddType: 'eod', off: 0, cons: 0, sizes: [[25, 1500, 1000, 0, 0], [50, 3000, 2000, 0, 0], [100, 5000, 2500, 0, 0]] }
    ] }
  ];
  const PROP_PRESETS = {};
  for (const f of PRESET_FIRMS) for (const pl of f.plans) for (const [k, target, dd, daily, maxQty] of pl.sizes)
    PROP_PRESETS[`${pl.id}-${k}`] = { firm: f.firm, name: `${pl.plan} ${k}K`, start: k * 1000, dd, ddType: pl.ddType, stopAtStart: true, stopOffset: pl.off, daily, target, maxQty, consistency: pl.cons };
  const presetOptions = () => '<option value="">Custom</option>' + PRESET_FIRMS.map(f =>
    `<optgroup label="${f.firm}">${Object.entries(PROP_PRESETS).filter(([, v]) => v.firm === f.firm).map(([key, v]) => `<option value="${key}">${v.name}</option>`).join('')}</optgroup>`).join('');
  function applyPreset(key) {
    const pr = PROP_PRESETS[key];
    S.prop.preset = pr ? key : '';
    if (!pr) return;
    for (const k of ['start', 'dd', 'ddType', 'stopAtStart', 'stopOffset', 'daily', 'target', 'maxQty', 'consistency']) S.prop[k] = pr[k];
    S.prop.on = true;
  }

  /* ---- consistency rule: your best day can be at most C% of your total profit ----
     need  = total profit you'll need so your best day fits the rule (the target, or more if a big day pushed it up)
     cap   = the most you can make today without raising "need"
     plan  = how to split what's left across the days you want, staying under the cap with a 10% cushion */
  function consPlan(ps) {
    const p = S.prop, C = (+p.consistency || 0) / 100, T = Math.max(0, +p.target || 0);
    if (!(C > 0 && C < 1) || !T) return null;
    const days = (ps && ps.days) || {}, today = ps ? ps.today : tradingDay(Date.now());
    let best = Math.max(0, +p.bestDay || 0), bestWhen = best > 0 ? 'entered' : '';
    for (const [d, v] of Object.entries(days)) if (String(d) !== String(today) && v > best) { best = v; bestWhen = d; }
    const todayP = +days[today] || 0;
    const profit = ps && ps.bal !== null && ps.bal !== undefined ? ps.bal - +p.start : 0;     // closed profit
    const bestAll = Math.max(best, todayP);
    const need = Math.max(T, bestAll / C);
    const cap = Math.max(C * T, best);
    const left = Math.max(0, need - profit);
    const dayMax = C * need;                                         // no single day above this
    // today already has todayP in it, so today can only add up to the room left (none if you're locked for the day)
    const live = !!(ps && ps.eq !== null);
    const room = live && !lockedNow() ? Math.max(0, dayMax * 0.9 - Math.max(0, todayP)) : 0;
    const useToday = live && room >= Math.min(left, dayMax * 0.15);   // skip today if only crumbs are left
    const todayRoomMax = Math.max(0, dayMax - Math.max(0, todayP));     // today, right at the cap
    const fastest = left <= 0 ? 0 : useToday ? (left <= todayRoomMax ? 1 : 1 + Math.ceil((left - todayRoomMax) / dayMax - 1e-9)) : Math.ceil(left / dayMax - 1e-9);
    let n = 0;
    const plan = [];
    if (left > 0) {
      const fullDays = rest => Math.ceil(rest / (dayMax * 0.9) - 1e-9);
      const comfy = useToday ? (left <= room ? 1 : 1 + fullDays(left - room)) : fullDays(left);
      n = Math.max(1, +p.planDays > 0 ? Math.round(+p.planDays) : comfy);
      let rest = left, tot = profit;
      for (let i = 0; i < n; i++) {
        const isToday = useToday && i === 0;
        const daysLeft = n - i;
        let g = rest / daysLeft;
        if (isToday && daysLeft > 1) g = Math.min(g, room);   // (a 1-day plan shows the full amount, with the warning)
        tot += g; rest -= g;
        plan.push({ label: isToday ? 'Day 1 (today)' : `Day ${i + 1}${!live || useToday || i ? '' : ' (next session)'}`, goal: g, total: tot });
      }
    }
    const per = plan.length ? plan[plan.length - 1].goal : 0;
    return { C, T, best, bestWhen, todayP, profit, need, cap, left, dayMax, fastest, n, per, plan,
      tooFew: n > 0 && n < fastest, over: plan.some(d => d.goal > dayMax + 0.5 || (d.label.startsWith('Today') && d.goal + todayP > dayMax + 0.5)),
      pct: profit > 0 ? bestAll / profit : null, ok: profit >= need };
  }

  /* ---- economic news (TradingView's own calendar) ---- */
  let newsEvents = [], newsFetchedAt = 0, newsTriedAt = 0, newsBusy = false, newsWarned = {};
  async function fetchNews() {
    if (!S.news.on || newsBusy) return;
    newsBusy = true; newsTriedAt = Date.now();
    try {
      const from = new Date(Date.now() - 6 * 3600000).toISOString(), to = new Date(Date.now() + 8 * 86400000).toISOString();
      const r = await fetch(`https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=US`);
      const j = await r.json();
      newsEvents = ((j && j.result) || []).map(e => ({ id: e.id, title: e.title, time: Date.parse(e.date), imp: e.importance,
        forecast: e.forecast, previous: e.previous, actual: e.actual, currency: e.currency })).filter(e => isFinite(e.time)).sort((a, b) => a.time - b.time);
      newsFetchedAt = Date.now();
    } catch (e) {
      if (!newsFetchedAt) console.warn('[Wick] news calendar unavailable, will retry in 5 minutes');
    } finally { newsBusy = false; }
  }
  function newsList() {
    const min = S.news.medium ? 0 : 1;
    return newsEvents.filter(e => e.imp >= min);
  }
  function fmtCountdown(ms) {
    const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    return h ? `${h}h ${m}m` : `${m}:${String(sec).padStart(2, '0')}`;
  }

  /* ---- the main check, once a second ---- */
  let banners = [];
  function money(v) { return (v < 0 ? '−' : v > 0 ? '+' : '') + '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function hideMoney(txt) { return S.extras.streamer ? txt.replace(/[+−\-]?\$[\d,]+(\.\d+)?/g, '•••••') : txt; }
  async function riskTick() {
    if (pageClosing) return;
    if ((S.risk.lockOn || S.risk.newsLock || S.prop.on) && Date.now() - posCache.at > 1500) await pollPositions();
    await refreshDay();
    captureStops().catch(() => {});
    guardBroker(currentBroker());
    lockFileSync();
    const r = S.risk, out = [];
    let flat = openPositionQty() === 0;
    // daily limits (keep running with "Turn everything off": that switch is for looks, not for your rules)
    if (!r.lockOn) pendingLock = '';
    if (r.lockOn) {
      const lossHit = +r.maxLoss > 0 && day.pnl <= -Math.abs(+r.maxLoss);
      const tradesHit = +r.maxTrades > 0 && day.trades >= +r.maxTrades && flat;
      const profitHit = +r.profitLock > 0 && day.closedPnl >= +r.profitLock && flat;
      const reason = lossHit ? `Daily loss limit hit (${money(day.pnl)} of ${money(-Math.abs(+r.maxLoss))})`
        : tradesHit ? `Max ${r.maxTrades} trades for today reached` : profitHit ? `Profit goal reached (${money(day.closedPnl)}). Lock it in.` : '';
      if (reason && !lockedNow() && !unlockedToday()) {
        // check the broker right now before locking, so a fill from a second ago isn't missed
        if (flat && Date.now() - posCache.at > 300) { await pollPositions(); flat = openPositionQty() === 0; }
        if (flat) setLock(reason);
        else pendingLock = reason;
      } else pendingLock = '';
    }
    // prop account: reaching the firm's max loss limit or daily loss limit locks you until 6 PM ET,
    // even with the Limits lockout off. In a trade you can still close it; the lock starts once you're flat.
    if (S.prop.on && S.prop.enforce !== false) {
      const ps0 = propState(acctValues()), p = S.prop;
      if (ps0.eq !== null) {
        const buf = Math.max(0, +p.lockNear || 0);
        const atMax = +p.dd > 0 && ps0.toFloor !== null && ps0.toFloor <= buf;
        const dailyHit = ps0.daily > 0 && ps0.dailyUsed >= ps0.daily;
        const preason = atMax ? (ps0.toFloor <= 0 ? `Prop max loss limit reached (${money(ps0.floor)})` : `Only ${money(ps0.toFloor).replace(/^\+/, '')} left before your prop max loss limit`)
          : dailyHit ? `Prop daily loss limit hit (${money(-ps0.dailyUsed)} of ${money(-ps0.daily)})` : '';
        if (preason && !lockedNow() && !unlockedToday()) {
          if (flat && Date.now() - posCache.at > 300) { await pollPositions(); flat = openPositionQty() === 0; }
          if (flat) setLock(preason);
          else if (!pendingLock) pendingLock = preason;
        }
      }
    }
    // consistency cap: optionally stop for the day once today's closed profit reaches the cap
    if (S.prop.on && S.prop.consLock) {
      const cp = consPlan(propState(acctValues()));
      if (cp && cp.todayP > 0 && cp.todayP >= cp.cap && !lockedNow() && !unlockedToday()) {
        const why = `Consistency cap reached for today (${money(cp.todayP)} of ${money(cp.cap).replace(/^\+/, '')})`;
        if (flat && Date.now() - posCache.at > 300) { await pollPositions(); flat = openPositionQty() === 0; }
        if (flat) setLock(why); else if (!pendingLock) pendingLock = why;
      }
    }
    eodCheck();
    if (eodNotice && eodNotice.until > Date.now()) out.push({ kind: 'info', act: 'share', text: eodNotice.text });
    const L = lockedNow();
    if (L) out.push({ kind: 'lock', text: `🔒 Done for today: ${L.lockReason}. Unlocks at ${new Date(nextSessionStart(Date.now())).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` });
    else if (pendingLock) out.push({ kind: 'bad', text: `⚠ ${pendingLock}. Close your position. You can't add to it, and new orders lock once you're flat.` });
    if (symNotice > Date.now() && chartSymBlocked()) {
      const cs = chartSymbol(), sw = symSwap(cs);
      out.push({ kind: 'warn', act: sw ? 'swap' : '', swap: sw, text: `You're on ${symRoot(cs)}. You only trade ${symList().join(', ')}.` });
    }
    if (r.lockOn && S.rec.folderOn && folder.status === 'needs') out.push({ kind: 'info', act: 'folder', text: 'Allow access to your Journal folder so the lockout stays in step with the desktop app.' });
    if (r.lockOn && !L && !pendingLock) {
      if (+r.maxLoss > 0 && day.pnl <= -Math.abs(+r.maxLoss) * (+r.warnPct || 80) / 100)
        out.push({ kind: 'warn', text: `Careful: ${money(day.pnl)} today, limit is ${money(-Math.abs(+r.maxLoss))}.` });
    }
    // prop rules
    if (S.prop.on && !S.extras.allOff) {
      const ps = propState(acctValues());
      if (ps.eq === null) { /* not connected: shown on the Prop tracker page only, not on the chart */ }
      else {
        const p = S.prop;
        const quiet = !!(lockedNow() || pendingLock);   // the lock banner already says it
        if (quiet) {}
        else if (ps.toFloor !== null && ps.toFloor <= 0) out.push({ kind: 'bad', text: `Prop: at the max loss limit (${money(ps.floor)}).` });
        else if (ps.ddLeftPct !== null && ps.ddLeftPct < 0.25) out.push({ kind: ps.ddLeftPct < 0.1 ? 'bad' : 'warn', text: `Prop: only ${money(ps.toFloor).replace(/^\+/, '')} left before the max loss limit.` });
        if (!quiet && ps.daily && ps.dailyUsed >= ps.daily * 0.8) out.push({ kind: ps.dailyUsed >= ps.daily ? 'bad' : 'warn', text: `Prop: daily loss ${money(-ps.dailyUsed)} of ${money(-ps.daily)}.` });
        const cp = consPlan(ps);
        if (cp && !quiet && cp.todayP > 0 && cp.todayP >= cp.cap * 0.8)
          out.push({ kind: cp.todayP >= cp.cap ? 'bad' : 'warn', text: cp.todayP >= cp.cap
            ? `Prop consistency: ${money(cp.todayP)} today is over your ${money(cp.cap).replace(/^\+/, '')} cap. You now need ${money(cp.need).replace(/^\+/, '')} total.`
            : `Prop consistency: ${money(cp.todayP)} today, cap is ${money(cp.cap).replace(/^\+/, '')}. Going over raises the profit you need.` });
        if (ps.maxQty && ps.qty > ps.maxQty) out.push({ kind: 'bad', text: `Prop: ${ps.qty} contracts open, max allowed is ${ps.maxQty}.` });
        if (ps.target && ps.profit >= ps.target) {
          if (cp && !cp.ok) out.push({ kind: 'warn', text: `Prop: ${money(ps.profit)} reaches your target, but the consistency rule needs ${money(cp.need).replace(/^\+/, '')} total.` });
          else out.push({ kind: 'good', text: `Prop: profit target reached (${money(ps.profit)}).` });
        }
      }
    }
    // news
    newsBlock = '';
    if (S.news.on && !S.extras.allOff) {
      if (Date.now() - newsFetchedAt > 30 * 60000 && Date.now() - newsTriedAt > 5 * 60000) fetchNews();
      const now = Date.now(), around = (+S.news.around || 0) * 60000;
      const hi = newsEvents.filter(e => e.imp >= 1);
      for (const e of newsList()) {
        const dt = e.time - now;
        if (dt > -2 * 60000 && dt <= (+S.news.mins || 15) * 60000) {
          const live = dt <= 0;
          out.push({ kind: live ? 'bad' : dt < 2 * 60000 ? 'bad' : 'warn', text: live ? `📰 ${e.title} is out now` : `📰 ${e.title} in ${fmtCountdown(dt)}` });
          if (S.news.sound && !newsWarned[e.id] && dt > 0 && dt <= 60000) { newsWarned[e.id] = 1; playSound('tone:alarm'); }
          break;
        }
      }
      if (r.newsLock && around) {
        const near = hi.find(e => Math.abs(e.time - now) <= around);
        if (near) newsBlock = near.title;
      }
      if (newsBlock) out.push({ kind: 'lock', text: `🔒 New entries paused around ${newsBlock} (±${S.news.around} min).` });
    }
    banners = out;
    applyLock();
    if (buildUI.onRisk) buildUI.onRisk();
  }
  setInterval(riskTick, 1000);
  setTimeout(fetchNews, 3000);

  let bannerSig = '';
  function renderBanners() {
    const box = buildUI.bannerBox;
    if (!box) return;
    // only rebuild when something changed, so a button isn't swapped out mid-click
    const sig = JSON.stringify(banners.map(b => [b.kind, hideMoney(b.text), b.act || '', b.swap || '', b.kind === 'lock' && !!lockedNow()]));
    if (sig === bannerSig && box.childElementCount === banners.length) return;
    bannerSig = sig;
    box.innerHTML = '';
    for (const b of banners) {
      const d = document.createElement('div');
      d.className = 'bn ' + b.kind;
      d.textContent = hideMoney(b.text);
      if (b.kind === 'lock' && lockedNow()) {
        const u = document.createElement('button');
        u.textContent = 'Unlock early';
        u.onclick = () => { S.ui.tab = 'risk'; buildUI.open && buildUI.open('risk'); };
        d.appendChild(u);
      }
      if (b.act === 'swap' && b.swap) {
        const u = document.createElement('button');
        u.textContent = `Switch to ${symRoot(b.swap)}`;
        u.onclick = () => { try { window.TradingViewApi.activeChart().setSymbol(b.swap); } catch (e) {} symNotice = 0; setTimeout(riskTick, 600); };
        d.appendChild(u);
      }
      if (b.act === 'share') {
        const u = document.createElement('button');
        u.textContent = 'Share card';
        u.onclick = () => { eodNotice = null; buildUI.open && buildUI.open('home'); setTimeout(() => buildUI.shareCard && buildUI.shareCard(), 400); riskTick(); };
        d.appendChild(u);
        const x = document.createElement('button');
        x.textContent = '×'; x.title = 'Dismiss';
        x.onclick = () => { eodNotice = null; riskTick(); };
        d.appendChild(x);
      }
      if (b.act === 'folder') {
        const u = document.createElement('button');
        u.textContent = 'Allow';
        u.onclick = () => { folderSync(true).then(() => { lockFileAt = 0; riskTick(); }); };
        d.appendChild(u);
      }
      box.appendChild(d);
    }
  }
  /* ---- trade counter on the chart. Calm while you have room, then it gets louder:
     2 left = amber, 1 left = red, last trade = pulsing red with a red edge around the screen, done = locked. ---- */
  let counterKey = '';
  const CI = {
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
  };
  function renderCounter() {
    const el = buildUI.counterEl, edge = buildUI.edgeEl;
    if (!el) return;
    const r = S.risk, max = +r.maxTrades || 0;
    const show = r.counter !== false && max > 0 && (!S.extras.allOff || r.lockOn);
    if (!show) { el.hidden = true; if (edge) edge.className = 'edge'; counterKey = ''; return; }
    let open = 0;
    try { open = Object.keys(recLoad().open || {}).length; } catch (e) {}
    const closed = day.day === tradingDay(Date.now()) ? day.trades : 0;
    const inTrade = open > 0 && openPositionQty() > 0;
    const left = max - closed;                                   // trades you can still start (counting the one you're in)
    const early = unlockedToday();
    const lvl = !recActive() ? 'off'
      : left <= 0 ? (early ? 'over' : 'done')
      : left === 1 ? (inTrade ? 'last' : 'one')
      : left === 2 && max >= 3 ? 'two'
      : 'calm';
    const tag = { off: 'Recording off', over: 'Over limit', done: 'Done', last: 'Last trade', one: '1 left', two: '2 left', calm: '' }[lvl];
    const icon = lvl === 'done' ? CI.lock : (lvl === 'last' || lvl === 'one' || lvl === 'over') ? CI.warn : '';
    const key = [closed, inTrade, max, lvl].join('|');
    if (key !== counterKey || el.hidden) {
      counterKey = key; el.hidden = false;
      el.className = 'counter ' + lvl;
      const segs = max <= 12 ? Array.from({ length: max }, (_, i) => `<i class="${i < closed ? 'f' : i === closed && inTrade ? 'o' : ''}"></i>`).join('') : '';
      el.innerHTML = `${icon ? `<span class="tc-ic">${icon}</span>` : ''}<span class="tc-lb">Trades</span>` +
        `<span class="tc-n"><b>${Math.min(closed, 999)}</b><span>/${max}</span></span>` +
        (segs ? `<span class="tc-bar">${segs}</span>` : '') + (tag ? `<span class="tc-tag">${tag}</span>` : '');
      el.title = `${closed} of ${max} trades used today${inTrade ? ' (1 open)' : ''}. Drag to move. Turn off in Limits.`;
    }
    if (edge) edge.className = 'edge' + (lvl === 'last' ? ' on' : '');
  }
  function flashBanner() {
    const box = buildUI.bannerBox;
    if (!box) return;
    box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
  }

  /* =========================================================
   * Wallpaper rendering
   * ======================================================= */
  const LAYER = 'tvwp-layer';
  let source = null, sourceId = null, loadToken = 0, animToken = 0, scheduled = false;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const resizeObs = new ResizeObserver(() => schedule());
  const watched = new WeakSet();

  // average brightness 0..1 of an image/frame, for "auto-dim for readability"
  function brightness(img) {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 24;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 24, 24);
      const d = g.getImageData(0, 0, 24, 24).data; let t = 0;
      for (let i = 0; i < d.length; i += 4) t += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      return t / (d.length / 4);
    } catch (e) { return 0.4; }
  }
  async function decodeVideo(blob) {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    Object.assign(v, { muted: true, loop: true, playsInline: true, preload: 'auto', src: url });
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    await new Promise((res, rej) => { v.addEventListener('loadeddata', res, { once: true }); v.addEventListener('error', () => rej(new Error('video')), { once: true }); });
    v.play().catch(() => {});
    return { kind: 'video', video: v, url, lum: brightness(v) };
  }
  async function decode(blob) {
    const type = blob.type;
    if (/^video\//.test(type)) return decodeVideo(blob);
    if ('ImageDecoder' in window && /^image\/(gif|webp|png|apng|avif)$/.test(type)) {
      let ok = false;
      try { ok = await ImageDecoder.isTypeSupported(type); } catch (e) {}
      if (ok) {
        const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type });
        await decoder.tracks.ready;
        await decoder.completed;
        const track = decoder.tracks.selectedTrack;
        if (track && track.frameCount > 1) {
          let lum = 0.4; try { const { image } = await decoder.decode({ frameIndex: 0 }); lum = brightness(image); image.close(); } catch (e) {}
          return { kind: 'anim', decoder, count: track.frameCount, frame: null, lum };
        }
        const { image } = await decoder.decode({ frameIndex: 0 });
        const bmp = await createImageBitmap(image);
        image.close(); decoder.close();
        return { kind: 'static', image: bmp, lum: brightness(bmp) };
      }
    }
    const bmp = await createImageBitmap(blob);
    return { kind: 'static', image: bmp, lum: brightness(bmp) };
  }

  function dispose(src) {
    if (!src) return;
    try {
      if (src.kind === 'static') src.image.close();
      else if (src.kind === 'video') { src.dead = true; src.video.pause(); src.video.removeAttribute('src'); src.video.load(); URL.revokeObjectURL(src.url); }
      else { if (src.frame) src.frame.close(); src.decoder.close(); }
    } catch (e) {}
  }

  function setSource(src, id) {
    animToken++;
    dispose(source);
    source = src; sourceId = id;
    document.querySelectorAll('canvas.' + LAYER).forEach(c => delete c.dataset.key);
    if (src && src.kind === 'anim') runAnimation(src, animToken);
    if (src && src.kind === 'video') runVideo(src, animToken);
    schedule();
  }

  // The settings panel shows your current wallpaper softly behind it.
  let backdropBlob = null, backdropUrl = null;
  function setBackdrop(blob) {
    if (blob === backdropBlob && backdropUrl) return;
    backdropBlob = blob || null;
    if (backdropUrl && backdropUrl.startsWith('blob:')) URL.revokeObjectURL(backdropUrl);
    backdropUrl = null;
    if (typeof blob === 'string') backdropUrl = blob;                 // a video's preview frame (data URL)
    else if (blob) backdropUrl = URL.createObjectURL(blob);
    if (buildUI.applyBackdrop) buildUI.applyBackdrop();
  }
  async function loadWallpaper() {
    const token = ++loadToken;
    const id = S.wall.currentId;
    if (!id) { setBackdrop(null); setSource(null, null); return; }
    if (id === sourceId) return;
    try {
      const wp = await DB.get(id);
      if (token !== loadToken) return;
      setBackdrop(wp && (wp.video ? wp.thumb : wp.blob));
      if (!wp) { setSource(null, null); return; }
      const src = await decode(wp.blob);
      if (token !== loadToken) { dispose(src); return; }
      setSource(src, id);
      S.wall.used = S.wall.used || {}; S.wall.used[id] = Date.now();
      syncPanelSources();
    } catch (e) {
      console.warn('[Wick] could not load wallpaper', e);
      setSource(null, null);
    }
  }

  // Video wallpapers: redraw on each new video frame (about 30 per second), paused while hidden.
  async function runVideo(src, token, live = () => animToken) {
    const v = src.video;
    while (token === live() && !src.dead) {
      if (document.hidden || !S.wall.enabled || S.extras.allOff || !document.querySelector('canvas.' + LAYER)) { if (!v.paused) v.pause(); await sleep(300); continue; }
      if (v.paused) v.play().catch(() => {});
      await new Promise(r => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(() => r()) : setTimeout(r, 33)));
      if (token !== live()) return;
      document.querySelectorAll('canvas.' + LAYER).forEach(cv => drawInto(cv, true));
      await sleep(25);
    }
  }
  async function runAnimation(src, token, live = () => animToken) {
    let i = 0;
    while (token === live()) {
      if (document.hidden || !S.wall.enabled || !document.querySelector('canvas.' + LAYER)) { await sleep(300); continue; }
      const t0 = performance.now();
      let image;
      try { ({ image } = await src.decoder.decode({ frameIndex: i })); }
      catch (e) { i = 0; await sleep(100); continue; }
      if (token !== live()) { image.close(); return; }
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

  // Other wallpapers used by individual charts in a multi-chart layout: id -> decoded source
  const panelSrc = new Map();
  let panelToken = 0;
  async function syncPanelSources() {
    const want = new Set(Object.values(S.wall.perPanel || {}).filter(id => id && id !== sourceId));
    for (const [id, e] of panelSrc) if (!want.has(id)) { e.tok = -1; dispose(e.src); panelSrc.delete(id); }
    for (const id of want) {
      if (panelSrc.has(id)) continue;
      const e = { src: null, tok: ++panelToken };
      panelSrc.set(id, e);
      try {
        const wp = await DB.get(id);
        if (!wp || panelSrc.get(id) !== e) continue;
        e.src = await decode(wp.blob);
        if (e.src.kind === 'anim') runAnimation(e.src, e.tok, () => (panelSrc.get(id) === e ? e.tok : -1));
        if (e.src.kind === 'video') runVideo(e.src, e.tok, () => (panelSrc.get(id) === e ? e.tok : -1));
      } catch (err) { panelSrc.delete(id); }
    }
    refreshWall();
  }
  function sourceFor(cv) {
    const pid = (S.wall.perPanel || {})[cv.dataset.panel];
    if (!pid || pid === sourceId) return { src: source, id: sourceId };
    const e = panelSrc.get(pid);
    return { src: e && e.src, id: pid };
  }
  function drawInto(cv, force) {
    const parent = cv.parentElement;
    if (!parent) return;
    const w = S.wall;
    cv.style.opacity = String(w.opacity);
    cv.style.mixBlendMode = w.blend;
    const { src, id } = sourceFor(cv);
    const img = src && (src.kind === 'static' ? src.image : src.kind === 'video' ? (src.video.readyState >= 2 ? src.video : null) : src.frame);
    if (!img) { if (cv.width) { cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); delete cv.dataset.key; } return; }
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(parent.clientWidth * dpr));
    const H = Math.max(1, Math.round(parent.clientHeight * dpr));
    const zoom = Math.max(1, Math.min(4, +w.zoom || 1)), px = Math.max(0, Math.min(1, w.posX ?? .5)), py = Math.max(0, Math.min(1, w.posY ?? .5));
    let dim = Math.max(0, Math.min(.9, +w.dim || 0));
    if (w.autoDim) dim = Math.max(dim, Math.min(.6, Math.max(0, ((src.lum ?? .4) - .25) * .9)));   // bright pictures get darker
    const blur = Math.max(0, Math.min(30, +w.blur || 0));
    const tint = w.tint ? chartBg() : '';
    const key = `${id}|${W}x${H}|${w.fit}|${zoom}|${px}|${py}|${dim}|${blur}|${tint}`;
    if (!force && cv.dataset.key === key) return;
    cv.dataset.key = key;
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const iw = img.videoWidth || img.displayWidth || img.width, ih = img.videoHeight || img.displayHeight || img.height;
    let dw = W, dh = H;
    if (w.fit !== 'stretch') {
      const sc = w.fit === 'contain' ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih);
      dw = iw * sc; dh = ih * sc;
    }
    dw *= zoom; dh *= zoom;
    const dx = (W - dw) * px, dy = (H - dh) * py;        // the focus point decides which part stays in view
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    if (blur) { const pad = blur * dpr * 2; ctx.filter = `blur(${blur * dpr}px)`; ctx.drawImage(img, dx - pad, dy - pad, dw + pad * 2, dh + pad * 2); ctx.filter = 'none'; }
    else ctx.drawImage(img, dx, dy, dw, dh);
    if (dim) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
    if (tint) { ctx.globalCompositeOperation = 'source-atop'; ctx.globalAlpha = .38; ctx.fillStyle = tint; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  }
  // The chart's own background color (for "tint with TradingView's color")
  let chartBgCache = { at: 0, v: '' };
  function chartBg() {
    if (Date.now() - chartBgCache.at < 5000) return chartBgCache.v;
    let v = '';
    try { v = chartWidget().model().model().properties().childs().paneProperties.childs().background.value(); } catch (e) {}
    if (!v) v = document.documentElement.classList.contains('theme-dark') ? '#131722' : '#ffffff';
    chartBgCache = { at: Date.now(), v };
    return v;
  }

  function renderAll() {
    scheduled = false;
    const anyPanel = Object.values(S.wall.perPanel || {}).some(Boolean);
    if (!S.wall.enabled || (!source && !anyPanel) || S.extras.allOff) {
      document.querySelectorAll('canvas.' + LAYER).forEach(c => c.remove());
      return;
    }
    containers().forEach((c, i) => { const cv = ensureLayer(c); cv.dataset.panel = String(i + 1); drawInto(cv, false); });
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
  const MAX_SIDE = 2560, THUMB = 200, MAX_ANIM = 50e6, MAX_VIDEO = 200e6;

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
      if (/^video\//.test(f.type)) {
        try {
          if (f.size > MAX_VIDEO) { problems.push(`${f.name} is over 200 MB`); continue; }
          const src = await decodeVideo(f);
          const v = src.video; v.pause();
          try { v.currentTime = Math.min(0.5, (v.duration || 1) / 4); await new Promise(r => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 1500); }); } catch (e) {}
          const c = document.createElement('canvas'), sc = Math.min(1, THUMB / Math.max(v.videoWidth, v.videoHeight));
          c.width = Math.max(1, Math.round(v.videoWidth * sc)); c.height = Math.max(1, Math.round(v.videoHeight * sc));
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          const w = v.videoWidth, h = v.videoHeight;
          dispose(src);
          const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
          await DB.put({ id, blob: f, thumb: c.toDataURL('image/jpeg', 0.8), animated: true, video: true, added: Date.now(), name: f.name || '', w, h });
          lastId = id;
        } catch (e) { problems.push(`Couldn't play ${f.name} (MP4 or WebM work best)`); }
        continue;
      }
      try {
        const bmp = await createImageBitmap(f);
        const bmpW = bmp.width, bmpH = bmp.height;
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
        await DB.put({ id, blob, thumb, animated, added: Date.now(), name: f.name || '', w: bmpW || 0, h: bmpH || 0 });
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
  .panel { position: fixed; z-index: 2147483001; isolation: isolate; display: none; grid-template-columns: 204px 1fr;
    width: min(880px, calc(100vw - 24px)); height: min(720px, calc(100vh - 24px));
    background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 16px; overflow: hidden;
    box-shadow: var(--shadow); font-size: 13px; line-height: 1.4; }
  .panel.open { display: grid; }

  /* sidebar */
  aside { background: var(--nav); border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  aside, aside * { box-sizing: border-box; }
  aside { overflow: hidden; }
  aside > * { max-width: 100%; }
  .tabs { scrollbar-width: thin; }
  .brand { display: flex; align-items: center; gap: 9px; padding: 14px 14px 10px; font-weight: 700; font-size: 14px; }
  .logo { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; color: #fff;
    background: linear-gradient(135deg, #5b6cff 0%, #22c3e6 100%); }
  .logo svg { width: 15px; height: 15px; }
  .conn { margin: 0 10px 8px; padding: 9px 10px; border-radius: 10px; background: var(--card); border: 1px solid var(--line); display: flex; gap: 9px; align-items: center; }
  .conn b { display: block; font-size: 12.5px; }
  .conn small { color: var(--muted); font-size: 11.5px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .conn > div { min-width: 0; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; }
  .dot.on { background: var(--good); box-shadow: 0 0 0 3px rgba(34,195,154,.18); }
  .tabs { flex: 1; overflow: auto; padding: 2px 8px 8px; display: flex; flex-direction: column; gap: 1px; }
  .grp { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 4px; width: 100%; cursor: pointer; font-size: 10.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); padding: 10px 8px 4px; }
  .grp i { font-style: normal; font-size: 12px; transform: rotate(90deg); transition: transform .15s; opacity: .7; }
  .grp:hover { color: var(--text); }
  .ng.shut .grp i { transform: rotate(0deg); }
  .ng.shut .ng-b { display: none; }
  .ng-b { display: flex; flex-direction: column; gap: 1px; }
  .tabs button[data-tab] { display: flex; align-items: center; gap: 9px; width: 100%; padding: 6px 9px; border: none; border-radius: 8px;
    background: none; color: var(--text); font: inherit; font-size: 13px; cursor: pointer; text-align: left; opacity: .82; }
  .tabs button svg { width: 16px; height: 16px; flex: none; color: var(--muted); }
  .tabs button[data-tab]:hover { background: var(--card); opacity: 1; }
  .tabs button[data-tab].on { background: var(--accent); color: #fff; opacity: 1; font-weight: 600; box-shadow: 0 4px 14px rgba(91,108,255,.3); }
  .tabs-bottom { flex: none; padding: 4px 8px; border-top: 1px solid var(--line); }
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
  .quick { border-top: 1px solid var(--line); padding: 6px 12px; display: grid; gap: 0; }
  .quick kbd { font-size: 9.5px; padding: 0 4px; margin-left: 4px; color: var(--muted); border: 0; background: none; }
  .quick input[type=checkbox] { width: 26px; height: 15px; }
  .quick input[type=checkbox]::before { width: 11px; height: 11px; }
  .quick input[type=checkbox]:checked::before { transform: translateX(11px); }
  .quick label { display: flex; align-items: center; justify-content: space-between; padding: 4px 2px; font-size: 12px !important; gap: 4px; min-width: 0; font-size: 12.5px; cursor: pointer; }
  .foot { display: flex; align-items: center; gap: 9px; padding: 9px 12px 11px; color: var(--muted); font-size: 11px; border-top: 1px solid var(--line); }
  .foot .me { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 12px; color: #fff; background: linear-gradient(135deg, #5b6cff, #22c3e6); flex: none; }
  .foot b { display: block; color: var(--text); font-size: 12px; }
  .foot small { display: block; font-size: 10.5px; }

  /* main */
  main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  header { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--line); cursor: move; user-select: none; position: relative; z-index: 1; background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: blur(10px); }
  header p { display: none; }
  .hdr-ctl { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); cursor: pointer; white-space: nowrap; }
  .hdr-ctl[hidden] { display: none; }
  .item.moved, .card.moved-card { display: none !important; }
  .card.pg:not(:has(> .item:not(.moved), > .dep:not([hidden]), > .sub, > .row, > .h-chart)) { display: none !important; }
  header .t { flex: 1; min-width: 0; }
  h1 { font-size: 18px; margin: 0; font-weight: 700; letter-spacing: -.01em; }
  header p { margin: 2px 0 0; color: var(--muted); font-size: 12.5px; }
  .pill { font-size: 11.5px; font-weight: 600; padding: 4px 10px; border-radius: 20px; background: var(--card2); color: var(--muted); white-space: nowrap; display: flex; align-items: center; gap: 6px; }
  .pill.live { background: rgba(242,73,92,.14); color: var(--bad); }
  .pill.ok { background: rgba(34,195,154,.13); color: var(--good); }
  .x { width: 28px; height: 28px; border-radius: 8px; border: none; background: none; color: var(--muted); font-size: 20px; line-height: 1; cursor: pointer; }
  .x:hover { background: var(--card2); color: var(--text); }
  main { position: relative; isolation: isolate; }
  .backdrop { position: absolute; inset: 0; z-index: -1; background-size: cover; background-position: center; opacity: 0; transition: opacity .4s; pointer-events: none;
    filter: blur(var(--bdBlur, 2px)) saturate(.9); transform: scale(1.04); }
  .backdrop::after { content: ''; position: absolute; inset: 0; background: color-mix(in srgb, var(--bg) var(--bdDim, 62%), transparent); }
  .panel.glass .backdrop.has { opacity: 1; }
  .panel.glass .card, .panel.glass .sgroup, .panel.glass .status { background: color-mix(in srgb, var(--card) 80%, transparent); backdrop-filter: blur(12px); }
  .content { flex: 1; overflow: auto; padding: 16px 20px 22px; }
  section { display: none; gap: 14px; }
  section.on { display: grid; }

  /* cards & rows */
  .card, .sgroup, .side { background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
  .card .item, .card .sub { border-top: 1px solid var(--line); }
  .card > .item:first-child, .card > .sub:first-child, .card > .dep:first-child > .item:first-child, .card > .dep:first-child > .sub:first-child { border-top: 0; }
  .dep { display: contents; }
  [data-when][hidden], .dep[hidden] { display: none !important; }
  .item { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 11px 14px; min-height: 48px; }
  .item .txt { min-width: 0; }
  .item .txt b { display: block; font-weight: 600; font-size: 13px; }
  .item .txt small { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; line-height: 1.35; }
  .item .txt small b, .item .txt b b { display: inline; font-size: inherit; }
  .item .txt > b { display: flex !important; align-items: center; gap: 6px; }
  .info { all: unset; flex: none; display: inline-grid; place-items: center; width: 15px; height: 15px; border-radius: 50%; cursor: help;
    font: 700 9.5px/1 Georgia, serif; font-style: italic; color: var(--muted); border: 1px solid var(--line); background: transparent; }
  .info:hover, .info:focus-visible { color: var(--text, #e6e8ee); border-color: var(--accent, #6c7cff); }
  .tip { position: fixed; z-index: 2147483647; max-width: 280px; padding: 9px 11px; border-radius: 9px; font: 12px/1.45 Inter, -apple-system, system-ui, sans-serif;
    color: #e8eaf0; background: #232733; border: 1px solid #3a3f4e; box-shadow: 0 10px 28px rgba(0,0,0,.45); pointer-events: none; }
  .tip[hidden] { display: none; }
  .pg-h { padding: 12px 14px 8px !important; font-size: 12.5px !important; font-weight: 600; letter-spacing: 0 !important; text-transform: none !important; color: var(--text) !important; }
  .pg-h-old { font-size: 10.5px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); padding: 6px 4px 0; }
  details.how { padding: 0 4px; }
  details.how summary { cursor: pointer; font-size: 12px; color: var(--muted); list-style: none; display: flex; align-items: center; gap: 6px; }
  details.how summary::-webkit-details-marker { display: none; }
  details.how summary::before { content: '›'; display: inline-block; transition: transform .15s; font-size: 14px; }
  details.how[open] summary::before { transform: rotate(90deg); }
  details.how .hint { margin-top: 6px; line-height: 1.5; }
  .item select, .item input[type=range] { width: 190px; flex: none; }
  .item input[type=number], .item input[inputmode=decimal], .item > input[type=text] { width: 104px; flex: none; }
  .item select { width: 170px; }
  .item #rQualHint { font-size: 11.5px; }
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
  .wp-now { display: grid; grid-template-columns: 260px 1fr; gap: 16px; padding: 14px; align-items: center; }
  .wp-prev { position: relative; aspect-ratio: 16/9; border-radius: 10px; overflow: hidden; background: var(--card2); cursor: crosshair; touch-action: none; }
  .wp-prev img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; user-select: none; }
  .wp-prev img[src=""] { display: none; }
  .wp-prev i { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 2px rgba(0,0,0,.45); pointer-events: none; }
  .wp-prev span { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); font-size: 12px; }
  .wp-prev span[hidden], .wp-prev i[hidden] { display: none; }
  .wp-meta { display: grid; gap: 6px; min-width: 0; }
  .wp-meta .row { flex-wrap: wrap; } #wReplaceBtn[hidden], #wRemove[hidden] { display: none; } .wp-meta a { color: var(--accent2); }
  .panel.drop::after { content: 'Drop to add as wallpaper'; position: absolute; inset: 8px; border: 2px dashed var(--accent); border-radius: 14px; background: rgba(20,22,32,.78);
    display: grid; place-items: center; font: 600 16px Inter, system-ui, sans-serif; color: #fff; z-index: 50; pointer-events: none; }
  .wp-meta b { font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wp-meta small { color: var(--muted); }
  #wPanels { flex-wrap: wrap; }
  .pnlb { width: 64px; height: 40px; border-radius: 8px; border: 1.5px solid var(--line2); background: var(--card2) center/cover; color: var(--text); font: 600 12px Inter, system-ui, sans-serif; cursor: pointer; text-shadow: 0 1px 3px rgba(0,0,0,.7); }
  .pnlb.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accentBg); }
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
  .trow .pnl { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; font-size: 12.5px; white-space: nowrap; }
  .trow .pnl.win { color: var(--good); } .trow .pnl.loss { color: var(--bad); }
  .side-l { color: var(--good); } .side-s { color: var(--bad); }
  .rec-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--bad); margin-right: 6px; animation: blink 1s infinite; }
  @keyframes blink { 50% { opacity: .25; } }
  .player { position: absolute; inset: 0; background: rgba(0,0,0,.6); display: grid; place-items: center; z-index: 5; }
  .player[hidden] { display: none; }
  #kPhraseBox[hidden], #kUnlock[hidden], #kFrozen[hidden] { display: none !important; }
  .pbox { width: min(680px, 92%); background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px; display: grid; gap: 10px; }
  .pbox video { width: 100%; border-radius: 8px; background: #000; max-height: 60vh; }
  .kv { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; font-size: 12.5px; border-bottom: 1px solid rgba(255,255,255,.05); }
  .kv span { color: #9aa1b2; } .kv b { font-weight: 600; text-align: right; } .kv b .hint { display: inline; font-weight: 400; }
  table.plan { width: 100%; border-collapse: collapse; margin: 8px 0 6px; font-size: 12.5px; font-variant-numeric: tabular-nums; }
  table.plan th { text-align: right; font-weight: 500; color: #7d8496; font-size: 11px; padding: 4px 6px; }
  table.plan td { text-align: right; padding: 5px 6px; border-top: 1px solid rgba(255,255,255,.05); }
  table.plan td:first-child, table.plan th:first-child { text-align: left; color: #9aa1b2; }
  .plan-ok { margin: 8px 0; padding: 8px 10px; border-radius: 8px; background: rgba(34,195,154,.12); color: #4fd8b0; font-size: 12.5px; }
  .plan-warn { margin: 8px 0; padding: 8px 10px; border-radius: 8px; background: rgba(242,73,92,.12); color: #ff8a97; font-size: 12.5px; }
  /* journal home */
  .h-bar { display: flex; align-items: center; gap: 8px; }
  .h-stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
  .h-stat { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 11px 12px; min-width: 0; }
  .panel.glass .h-stat { background: color-mix(in srgb, var(--card) 80%, transparent); backdrop-filter: blur(12px); }
  .h-stat span { display: block; font-size: 11px; color: var(--muted); }
  .h-stat b { display: block; font-size: 18px; font-weight: 700; margin: 3px 0 2px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .h-stat small { display: block; font-size: 11px; color: var(--muted); line-height: 1.3; }
  .h-stat b.sm { font-size: 15px; }
  .pos { color: var(--good) !important; } .neg { color: var(--bad) !important; }
  .h-streak { padding: 0 2px; }
  .h-unitnote { padding: 0 2px; } .h-unitnote input { padding: 3px 6px; margin: 0 3px; }
  .h-mid { display: grid; grid-template-columns: 170px 1fr; gap: 10px; align-items: start; }
  .h-today { padding: 12px 14px; }
  .h-today span { font-size: 11.5px; color: var(--muted); } .h-today b { display: block; font-size: 22px; margin: 6px 0 2px; font-variant-numeric: tabular-nums; }
  .h-cal { padding: 10px 12px 12px; }
  .h-cal-h { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; } .h-cal-h b { font-size: 13px; }
  .h-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)) 64px; gap: 5px; }
  .h-grid .hd { font-size: 10.5px; color: var(--muted); text-align: center; padding-bottom: 2px; }
  .h-day { min-height: 46px; border-radius: 8px; background: var(--card2); padding: 5px 6px; font-size: 10.5px; color: var(--muted); display: flex; flex-direction: column; justify-content: space-between; min-width: 0; }
  .h-day.blank { background: transparent; }
  .h-day.today { outline: 1px solid var(--accent); }
  .h-day.win { background: rgba(34,195,154,.18); color: var(--text); } .h-day.loss { background: rgba(242,73,92,.18); color: var(--text); }
  .h-day b { font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .h-day.win b { color: var(--good); } .h-day.loss b { color: var(--bad); }
  .h-wk { min-height: 46px; border-radius: 8px; border: 1px dashed var(--line2); padding: 5px 6px; font-size: 10.5px; color: var(--muted); display: flex; flex-direction: column; justify-content: center; }
  .h-wk b { font-size: 11px; font-variant-numeric: tabular-nums; }
  .h-chart { padding: 4px 10px 12px; } .h-chart svg { width: 100%; height: 170px; display: block; }
  #gBuyReset[hidden], #gSellReset[hidden] { display: none; }
  .oco-st::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 7px; background: var(--muted); vertical-align: 1px; }
  .oco-st.ok::before { background: var(--good); } .oco-st.warn::before { background: #f5a524; }
  .counter { position: fixed; z-index: 2147482998; display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 12px; border-radius: 10px;
    cursor: grab; user-select: none; touch-action: none; font: 600 12px/1 Inter, -apple-system, system-ui, sans-serif; color: #e8eaf0;
    background: rgba(18,20,27,.82); border: 1px solid rgba(255,255,255,.08); box-shadow: 0 6px 18px rgba(0,0,0,.28); backdrop-filter: blur(8px);
    transition: background .4s, border-color .4s, box-shadow .4s, color .4s; }
  .counter[hidden] { display: none; }
  .counter:active { cursor: grabbing; }
  .counter .tc-lb { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #7d8496; }
  .counter .tc-n { font-variant-numeric: tabular-nums; display: flex; align-items: baseline; gap: 1px; }
  .counter .tc-n b { font-size: 15px; font-weight: 700; }
  .counter .tc-n span { color: #7d8496; font-size: 12px; }
  .counter .tc-bar { display: flex; gap: 3px; }
  .counter .tc-bar i { width: 12px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.12); transition: background .4s; }
  .counter .tc-bar i.f { background: #b8bfcf; }
  .counter .tc-bar i.o { background: #22c39a; animation: segblink 1.1s ease-in-out infinite; }
  .counter .tc-tag { font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; padding: 4px 7px; border-radius: 6px; }
  .counter .tc-ic { display: grid; place-items: center; width: 15px; height: 15px; }
  .counter .tc-ic svg { width: 15px; height: 15px; }
  @keyframes segblink { 50% { opacity: .35; } }
  /* 2 left: amber */
  .counter.two { border-color: rgba(245,165,36,.45); }
  .counter.two .tc-bar i.f { background: #f5a524; }
  .counter.two .tc-tag { color: #f5b544; background: rgba(245,165,36,.14); }
  /* 1 left: red, slow breathing */
  .counter.one { color: #ffd9de; background: rgba(46,12,18,.88); border-color: rgba(242,73,92,.7); animation: breathe 2.6s ease-in-out infinite; }
  .counter.one .tc-bar i.f { background: #f2495c; }
  .counter.one .tc-ic, .counter.one .tc-lb, .counter.one .tc-n span { color: #ff7a8a; }
  .counter.one .tc-tag { color: #fff; background: rgba(242,73,92,.85); }
  /* last trade: hot red, heartbeat */
  .counter.last { color: #fff; background: linear-gradient(180deg, rgba(120,14,28,.95), rgba(70,6,16,.95)); border-color: #ff3b52; animation: heartbeat 1.1s ease-in-out infinite; }
  .counter.last .tc-bar i.f { background: #ff8a97; }
  .counter.last .tc-bar i.o { background: #fff; }
  .counter.last .tc-lb, .counter.last .tc-n span { color: #ffb3bc; }
  .counter.last .tc-tag { color: #3a0009; background: #fff; }
  /* done: solid, still, locked */
  .counter.done { color: #fff; background: #b3122a; border-color: #ff3b52; box-shadow: 0 0 0 3px rgba(242,73,92,.25), 0 8px 24px rgba(120,0,20,.5); }
  .counter.done .tc-bar i, .counter.done .tc-bar i.f { background: rgba(255,255,255,.85); }
  .counter.done .tc-lb, .counter.done .tc-n span { color: #ffc2c9; }
  .counter.done .tc-tag { color: #b3122a; background: #fff; }
  .counter.over { border-color: rgba(245,165,36,.6); } .counter.over .tc-tag { color: #1a1300; background: #f5a524; } .counter.over .tc-ic { color: #f5a524; }
  .counter.off { opacity: .6; } .counter.off .tc-tag { color: #9aa1b2; background: rgba(255,255,255,.08); }
  @keyframes breathe { 50% { box-shadow: 0 0 0 4px rgba(242,73,92,.18), 0 6px 18px rgba(0,0,0,.28); } }
  @keyframes heartbeat { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,59,82,.55), 0 6px 18px rgba(0,0,0,.3); transform: scale(1); }
    15% { box-shadow: 0 0 0 6px rgba(255,59,82,.25), 0 0 26px rgba(255,59,82,.55); transform: scale(1.04); } 30% { transform: scale(1); }
    45% { box-shadow: 0 0 0 4px rgba(255,59,82,.2), 0 0 18px rgba(255,59,82,.4); transform: scale(1.02); } }
  /* red edge around the screen during your last trade (never blocks clicks) */
  .edge { position: fixed; inset: 0; z-index: 2147482990; pointer-events: none; opacity: 0; transition: opacity .6s;
    box-shadow: inset 0 0 0 2px rgba(255,59,82,.55), inset 0 0 70px rgba(255,30,60,.28); }
  .edge.on { opacity: 1; animation: edgepulse 2.2s ease-in-out infinite; }
  @keyframes edgepulse { 50% { opacity: .45; } }
  @media (prefers-reduced-motion: reduce) { .counter, .edge.on, .counter .tc-bar i.o { animation: none !important; } }
  .banners { position: fixed; top: 46px; left: 0; right: 0; margin: 0 auto; width: max-content; max-width: min(640px, calc(100vw - 24px)); z-index: 2147482999; display: grid; gap: 6px; justify-items: center; pointer-events: none; }
  .bn { pointer-events: auto; display: flex; align-items: center; gap: 10px; min-width: 0; max-width: 100%; box-sizing: border-box; text-wrap: pretty; padding: 8px 14px; border-radius: 10px; font: 600 12.5px/1.3 Inter, -apple-system, system-ui, sans-serif;
    color: #fff; background: rgba(28,31,40,.94); border: 1px solid #343949; box-shadow: 0 6px 20px rgba(0,0,0,.4); }
  .bn.warn { background: rgba(245,165,36,.95); border-color: #f5a524; color: #1a1300; }
  .bn.bad { background: rgba(242,73,92,.95); border-color: #f2495c; }
  .bn.lock { background: rgba(20,22,30,.97); border-color: #f2495c; box-shadow: 0 0 0 2px rgba(242,73,92,.35), 0 6px 20px rgba(0,0,0,.4); }
  .bn.good { background: rgba(34,195,154,.95); border-color: #22c39a; color: #04140f; }
  .bn button { font: inherit; font-size: 11.5px; padding: 3px 9px; border-radius: 7px; border: 1px solid rgba(255,255,255,.35); background: rgba(255,255,255,.12); color: inherit; cursor: pointer; }
  .banners.flash .bn.lock { animation: shake .4s; }
  @keyframes shake { 25% { transform: translateX(-6px); } 50% { transform: translateX(6px); } 75% { transform: translateX(-3px); } }
  .money { display: flex; align-items: center; gap: 6px; background: var(--card2); border: 1px solid var(--line2); border-radius: 10px; padding: 4px 10px; flex: none; }
  .money:focus-within { border-color: var(--accent); }
  .money span { font-size: 18px; font-weight: 700; color: var(--muted); }
  .money input { width: 120px; border: none; background: none; font-size: 20px; font-weight: 700; padding: 4px 0; }
  details.adv summary { padding: 11px 14px; cursor: pointer; font-weight: 600; font-size: 13px; color: var(--muted); }
  details.adv[open] summary { border-bottom: 1px solid var(--line); }
  details.adv > .item + .item { border-top: 1px solid var(--line); }
  .ztab { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; padding: 7px 0; border-top: 1px solid var(--line); font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .ztab.head { border-top: none; color: var(--muted); font-size: 11.5px; font-weight: 600; }
  .ztab.main { color: var(--accent2); font-weight: 700; }
  .bigout { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 18px; text-align: center; display: grid; gap: 6px; }
  .bigout .n { font-size: 34px; font-weight: 800; letter-spacing: -.02em; }
  .bigout .n small { font-size: 16px; font-weight: 600; color: var(--muted); }
  .meter { display: grid; gap: 4px; }
  .meter .bar { height: 8px; border-radius: 6px; background: var(--card2); overflow: hidden; }
  .meter .bar i { display: block; height: 100%; border-radius: 6px; background: var(--good); }
  .meter .bar i.warn { background: var(--warn); } .meter .bar i.bad { background: var(--bad); }
  .meter .lab { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); }
  .meter .lab b { color: var(--text); font-weight: 600; }
  .nday { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-top: 8px; }
  .nrow { display: grid; grid-template-columns: 64px 1fr auto; gap: 10px; align-items: center; padding: 6px 0; border-top: 1px solid var(--line); font-size: 12.5px; }
  .nrow .imp { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; background: var(--warn); }
  .nrow .imp.hi { background: var(--bad); }
  .nrow small { color: var(--muted); font-size: 11.5px; }
  .nrow.soon { color: var(--bad); font-weight: 600; }
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
    risk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>',
    size: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2"/></svg>',
    prop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M10 21v-6h4v6"/></svg>',
    news: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h13v14a2 2 0 002 2H6a2 2 0 01-2-2V5z"/><path d="M17 9h3v10a2 2 0 01-2 2"/><path d="M8 9h5M8 13h5M8 17h3"/></svg>',
    journal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4z"/><path d="M5 17a3 3 0 013-3h11"/><path d="M9 8h6"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
    extras: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>'
  };
  const PAGES = {
    wall: ['Wallpaper', 'Images and GIFs behind your chart.'],
    candles: ['Candles', 'Your own candle colors. Only changes what you see.'],
    ind: ['Indicators', "Extra indicators on the chart, within your plan's limit."],
    sounds: ['Sounds', 'A sound when your orders fill, per order type.'],
    trading: ['Brackets', 'Win / lose amounts on your take-profit and stop orders.'],
    stream: ['Streamer', 'Hide your P&L and balances while streaming.'],
    home: ['Home', 'Your trading at a glance.'],
    journal: ['Trades', 'Every trade recorded automatically, with an optional chart video.'],
    risk: ['Discipline', 'Daily limits and lockout. Never stops you closing a trade.'],
    size: ['Position size', 'How many contracts to trade for the risk you choose.'],
    prop: ['Prop tracker', 'Your funded-account rules, tracked live.'],
    news: ['News', 'High-impact US economic events, with warnings before they hit.'],
    extras: ['Settings', 'Ads, appearance, shortcuts and info.']
  };
  // A setting row: title, a one-line summary, the control, and optional details behind an (i).
  const item = (title, desc, control, more) => `<div class="item"><div class="txt"><b>${title}${more ? `<button class="info" type="button" tabindex="0" data-tip="${String(more).replace(/"/g, '&quot;')}" aria-label="More about this">i</button>` : ''}</b>${desc ? `<small>${desc}</small>` : ''}</div>${control}</div>`;
  // A titled group of settings. when = '#id' shows it only while that switch is on (or that number is above 0).
  const grp = (title, inner, when) => `<div class="card pg"${when ? ` data-when="${when}"` : ''}>${title ? `<div class="pg-h">${title}</div>` : ''}${inner}</div>`;
  const dep = (when, inner) => `<div class="dep" data-when="${when}">${inner}</div>`;
  const how = (title, inner) => `<details class="how"><summary>${title}</summary><div class="hint">${inner}</div></details>`;
  const NAV = (tab, label) => `<button data-tab="${tab}">${ICON[tab]}<span>${label}</span><span class="badge" data-badge="${tab}" hidden></span></button>`;

  const HTML = `
  <button class="fab" title="Wick (Alt+Shift+W)">${ICON.logo}</button>
  <div class="banners" id="banners"></div>
  <div class="edge" id="tradeEdge"></div>
  <div class="counter" id="tradeCounter" hidden></div>
  <div class="panel">
    <aside>
      <div class="brand"><span class="logo">${ICON.logo}</span><span style="flex:1">Wick</span>
        <button class="power" id="power" title="Turn everything off (Alt+Shift+X)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1011.4 0"/></svg></button></div>
      <div class="conn"><span class="dot" id="connDot"></span><div><b>TradingView</b><small id="connText">Checking…</small></div></div>
      <nav class="tabs">
        <div class="ng" data-grp="charts"><button class="grp" type="button">Charts<i>›</i></button><div class="ng-b">
          ${NAV('wall', 'Wallpaper')}${NAV('candles', 'Candles')}${NAV('ind', 'Indicators')}</div></div>
        <div class="ng" data-grp="trading"><button class="grp" type="button">Trading<i>›</i></button><div class="ng-b">
          ${NAV('risk', 'Discipline')}${NAV('prop', 'Prop tracker')}${NAV('size', 'Position size')}${NAV('trading', 'Brackets')}${NAV('sounds', 'Sounds')}${NAV('news', 'News')}${NAV('stream', 'Streamer')}</div></div>
        <div class="ng" data-grp="journal"><button class="grp" type="button">Journal<i>›</i></button><div class="ng-b">
          ${NAV('home', 'Home')}${NAV('journal', 'Trades')}</div></div>
      </nav>
      <div class="quick">
        <label><span>Wallpaper</span><input type="checkbox" id="qWall"></label>
        <label><span>Candles</span><input type="checkbox" id="qCandles"></label>
        <label><span>Sounds</span><input type="checkbox" id="qSounds"></label>
        <label><span>Streamer <kbd>Alt+Shift+S</kbd></span><input type="checkbox" id="qStream"></label>
      </div>
      <div class="tabs tabs-bottom">${NAV('extras', 'Settings')}</div>
      <div class="foot"><span class="me">W</span><div><b>Wick</b><small>v${VERSION} · Alt+Shift+W</small></div></div>
    </aside>
    <main><div class="backdrop" id="backdrop"></div>
      <header><div class="t"><h1 id="pgTitle"></h1><p id="pgSub"></p></div><span class="pill" id="pill"></span><label class="hdr-ctl" id="hdrCtl" hidden><span id="hdrCtlLbl"></span></label><button class="x" title="Close">×</button></header>
      <div class="offbar" id="offbar">Everything is turned off. Your settings are saved. <button class="btn primary slim" id="powerOn">Turn back on</button></div>
      <div class="content">

    <section data-tab="wall">
      <div class="card">${item('Show wallpaper', 'Images, GIFs and animated WebP behind your candles.', '<input type="checkbox" id="wEnabled">')}</div>
      <div class="card wp-now">
        <div class="wp-prev" id="wPrev" title="Click or drag to choose what stays in view"><img id="wPrevImg" alt=""><i id="wDot"></i><span id="wPrevEmpty">No wallpaper yet</span></div>
        <div class="wp-meta">
          <b id="wName">—</b><small id="wSize"></small>
          <div class="row"><label class="btn slim">＋ Add<input type="file" id="file" accept="image/*,video/mp4,video/webm" multiple hidden></label><label class="btn slim" id="wReplaceBtn">⟲ Replace<input type="file" id="wReplace" accept="image/*,video/mp4,video/webm" hidden></label><button class="btn slim" id="wRemove">Remove</button><button class="btn slim" id="next">Next →</button></div>
          <small class="hint">Images, GIFs and videos (MP4 / WebM). Or drop files anywhere on this window.<br>Click or drag the picture to choose what stays in view · <a href="#" id="wCenter">Center</a></small>
          <div class="msg" id="wMsg"></div>
        </div>
      </div>
      ${grp('Look', `
        ${item('Fit', '', '<div class="seg" id="wFit"><button data-v="cover">Fill</button><button data-v="contain">Fit</button><button data-v="stretch">Stretch</button></div>')}
        ${item('Zoom <span class="hint" id="wZoomVal"></span>', '', '<input type="range" id="wZoom" min="1" max="3" step="0.05">')}
        ${item('Dim <span class="hint" id="wDimVal"></span>', 'Darkens the picture so candles stand out.', '<input type="range" id="wDim" min="0" max="0.8" step="0.02">')}
        ${item('Blur <span class="hint" id="wBlurVal"></span>', '', '<input type="range" id="wBlur" min="0" max="20" step="1">')}
        ${item('Auto-dim for readability', 'Darkens bright pictures so candles stay easy to read.', '<input type="checkbox" id="wAutoDim">')}
        ${item('Tint with TradingView\'s color', 'Blends the picture toward your chart background.', '<input type="checkbox" id="wTint">')}
        ${item('Strength <span class="hint" id="opVal"></span>', 'How strongly the image shows through.', '<input type="range" id="opacity" min="0.05" max="1" step="0.05">')}
        ${item('Blend', 'Match this to your chart theme.', `<select id="blend">
          <option value="lighten">Dark chart – subtle</option><option value="screen">Dark chart – vivid</option>
          <option value="darken">Light chart – subtle</option><option value="multiply">Light chart – vivid</option></select>`)}
        <div class="row" style="padding:4px 14px 12px"><button class="btn slim" id="wReset">Reset look</button></div>`)}
      ${grp('Your wallpapers <small class="hint" style="display:inline;font-weight:400">· recently used first · click one to use it</small>', '<div class="sub"><div class="grid" id="grid"></div></div>')}
      ${grp('Per-chart wallpaper', `<div class="sub">
        <div class="hint" id="wPanelHint">For layouts with more than one chart: pick a chart, then its wallpaper.</div>
        <div class="row" id="wPanels"></div>
        <div class="row"><span class="hint" id="wPanelLbl" style="flex:1"></span><select id="wPanelPick"></select></div>
      </div>`)}
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
        ${item('Order sounds', 'Plays when your orders fill.', '<input type="checkbox" id="sEnabled">', 'Works with any broker connected in TradingView, including Tradovate and NinjaTrader.')}
        ${dep('#sEnabled', `
          ${item('Volume <span class="hint" id="sVolVal"></span>', '', '<input type="range" id="sVol" min="0.05" max="1" step="0.05">')}
          ${item('One sound for all fills', 'Same sound for every order type.', '<input type="checkbox" id="sOne">')}
          ${item("Mute TradingView's own fill sound", 'So you only hear yours.', '<input type="checkbox" id="sMuteTV">')}`)}
      </div>
      <div class="dep" data-when="#sEnabled"><div class="sgroup" id="sFills"><h3>Fills</h3></div></div>
      <div class="dep" data-when="#sEnabled"><div class="sgroup" id="sOther"><h3>Other order events</h3></div></div>
      <div class="sgroup" data-when="#sEnabled"><h3>Your sounds</h3>
        <div class="chips" id="sChips"></div>
        <label class="btn">＋ Upload sounds (MP3, WAV…)<input type="file" id="sFile" accept="audio/*" multiple hidden></label>
        <div class="msg" id="sMsg"></div>
      </div>
      <div class="last" id="sLast"></div>
      <div class="hint" data-when="#sEnabled">Click the chart once after opening it, so the browser allows sound.</div>
    </section>

    <section data-tab="home">
      <div class="h-bar"><div class="seg" id="hUnit"><button data-v="usd">$</button><button data-v="pct">%</button><button data-v="r">R</button><button data-v="points">Points</button><button data-v="ticks">Ticks</button></div>
        <div class="seg" id="hRange"><button data-v="month">Month</button><button data-v="all">All time</button></div>
        <span style="flex:1"></span><button class="btn primary slim" id="hShare">Share P&amp;L</button></div>
      <div class="hint h-unitnote" id="hUnitNote" hidden></div>
      <div class="h-stats" id="hStats"></div>
      <div class="h-streak hint" id="hStreak"></div>
      <div class="h-mid">
        <div class="card h-today" id="hToday"></div>
        <div class="card h-cal"><div class="h-cal-h"><b id="hMonth"></b><span style="flex:1"></span><button class="btn slim" id="hPrev">‹</button><button class="btn slim" id="hNext">›</button></div><div class="h-grid" id="hGrid"></div></div>
      </div>
      <div class="card"><div class="pg-h">P&amp;L <span class="hint" style="display:inline;font-weight:400">· line: running total · bars: each day</span></div><div class="h-chart" id="hChart"></div></div>
      <div class="hint" id="hEmpty" hidden>Your recorded trades show up here. Turn on <b>Trades → Recording</b> and take a trade.</div>
    </section>

    <section data-tab="journal">
      ${grp('Recording', `
        ${item('Record my trades', 'Entry, exit, size, P&amp;L and time held.', '<input type="checkbox" id="rOn">')}
        ${dep('#rOn', `
          ${item('Record chart video', 'Films the chart for each trade.', '<input type="checkbox" id="rVideo">', 'From entry until a few seconds after exit. Keeps recording in a background tab. No permission pop-ups.')}
          ${dep('#rVideo', `
            ${item('Video quality', '<span id="rQualHint"></span>', '<select id="rQuality"><option value="540">Small (fits Notion free)</option><option value="720">720p</option><option value="1080">1080p</option><option value="1440">1440p</option><option value="2160">4K</option><option value="native">Native</option></select>', 'Small fits Notion\'s free plan (about 2 minutes). Native records at your chart\'s real screen pixels, the sharpest your screen can give. 1440p and up record as MP4 on your graphics card when it supports that.')}
            ${item('Keep videos', 'Older videos are deleted. Trades are kept.', '<select id="rKeep"><option value="10">Last 10</option><option value="25">Last 25</option><option value="50">Last 50</option><option value="100">Last 100</option></select>')}`)}`)}`)}
      <div class="status" id="rStats"></div>
      <div class="sgroup" id="rList"><h3>Recent trades</h3></div>
      ${grp('Save to a folder', `
        ${item('Save to a folder', 'Trades and videos as normal files.', '<input type="checkbox" id="fOn">', 'Copies trades.csv, a backup file and every video into a folder you pick. Needed for Notion sync, and for the lockout to stay in step between Chrome and the desktop app.')}
        ${dep('#fOn', `<div class="sub">
          <div class="row"><span class="hint" id="fStatus" style="flex:1"></span><button class="btn slim" id="fPick">Choose folder…</button><button class="btn slim" id="fReconnect" hidden>Allow access again</button></div>
          <div class="row"><button class="btn slim" id="fRestore">Restore trades from folder</button><span class="hint" id="fStore" style="flex:1;text-align:right"></span></div>
          <div class="msg" id="fMsg"></div>
        </div>`)}`)}
      <div class="row"><button class="btn" id="rCsv">⬇ Export CSV (Excel)</button><button class="btn" id="rClear">Clear journal</button></div>
      ${how('How recording works', `Keeps recording when TradingView is in a background tab or minimized, and catches up on trades made while it was closed, including trades placed on your broker's own app. In Chrome, add tradingview.com to Settings → Performance → Memory Saver → "Always keep these sites active".`)}
      <div class="player" id="rPlayer" hidden><div class="pbox"><div class="row between"><b id="rPTitle"></b><button class="x" id="rPClose">×</button></div><video id="rVideoEl" controls playsinline></video><div class="row"><a class="btn" id="rPDown" download>⬇ Download video</a></div></div></div>
    </section>

    <section data-tab="risk">
      <div class="status" id="kStatus"></div>
      ${grp('Daily limits', `
        ${item('Daily lockout', 'Stop trading for the day when a limit is hit.', '<input type="checkbox" id="kOn">', 'TradingView turns down every new order (buttons, order panel, price ladder, right-click menus, hotkeys) until the next session at 6 PM ET. You can always close a trade you\'re in.')}
        ${item('Max daily loss ($)', 'Closed trades today plus open P&amp;L.', '<input type="number" id="kLoss" min="0" max="1000000" step="50">')}
        ${item('Max trades per day', '0 = no limit.', '<input type="number" id="kTrades" min="0" max="100" step="1">', 'Once your last trade closes (win or loss), you\'re locked until 6 PM ET. During that last trade you can manage it, but not open another market.')}
        ${item('Stop after a profit of ($)', 'Lock in a good day. 0 = off.', '<input type="number" id="kProfit" min="0" max="1000000" step="50">')}`)}
      ${grp('Markets', `
        ${item('Trading symbols', 'e.g. MNQ, MGC. Empty = all.', '<input type="text" id="kSyms" placeholder="All" autocomplete="off" spellcheck="false" style="text-transform:uppercase">', 'Only these markets can be traded. Orders on anything else (like NQ while you chart it) are turned down, with a one-click switch to your micro. Closing a position always works.')}`)}
      ${grp('On the chart', `
        ${item('Trade counter', 'Trades used of your max.', '<input type="checkbox" id="kCounter">', 'Turns amber with 2 left, red with 1 left, pulses with a red screen edge on your last trade, and locks when you\'re done. Drag it anywhere.')}
        ${item('Warn me at', 'Share of the loss limit.', '<select id="kWarn"><option value="50">50%</option><option value="70">70%</option><option value="80">80%</option><option value="90">90%</option></select>')}`)}
      <div class="hint" id="kFrozen" hidden>🔒 Your limits can't be changed until the lock ends at 6 PM ET.</div>
      <div class="card" id="kLockCard" hidden>
        <div class="sub"><b id="kLockReason"></b><div class="hint">Unlocking early means breaking your own rule. You have to wait 5 minutes, then type a sentence.</div>
          <div class="row"><button class="btn" id="kUnlock">Unlock early</button></div>
          <div id="kPhraseBox" hidden><div class="hint">Type exactly: <b>I am breaking my own trading rules</b></div>
            <div class="row"><input type="text" id="kPhrase" autocomplete="off" spellcheck="false" style="flex:1"></div>
            <div class="row"><button class="btn" id="kConfirm" disabled>Unlock for the rest of today</button><button class="btn slim" id="kCancel">Stay locked</button></div></div></div>
      </div>
      ${how('How the lockout works', `If you hit a limit while in a trade, you can still close or shrink it, but not add to it. New orders lock as soon as you're flat. With <b>Journal → Save to a folder</b> set to the same folder in Chrome and the desktop app, a lock in one locks the other. "Turn everything off" doesn't stop the lockout. It covers TradingView only, not your broker's own app.`)}
    </section>

    <section data-tab="size">
      <div class="card">
        ${item('Calculator style', '',  '<div class="seg" id="zView"><button data-v="simple">Simple</button><button data-v="classic">Classic</button></div>')}
      </div>
      <div class="card">
        ${item('<span id="zRiskLbl">How much do you want to risk?</span>', '<span id="zRiskSub">Per trade, in dollars.</span>', '<div class="money"><span id="zUnitSym">$</span><input type="number" id="zRisk" min="0" max="1000000" step="any"></div>')}
        ${item('Stop', '<span id="zStopSub">Auto: a typical stop from your chart. Manual: type your stop in points.</span>', '<div class="row" style="flex:none"><div class="seg" id="zStopSeg"><button data-v="auto">Auto</button><button data-v="manual">Manual</button></div><div class="money" id="zPtsBox"><input type="number" id="zPts" min="0" max="100000" step="any" placeholder="0" style="width:80px;font-size:16px"><span style="font-size:13px">pts</span></div></div>')}
      </div>
      <div class="bigout" id="zOut"></div>
      <div class="sgroup" id="zTable"><h3>With a tighter or wider stop</h3></div>
      <details class="card adv" id="zAdv">
        <summary>Options: symbol, your own stop, % of account</summary>
        ${item('Symbol', 'Uses your chart by default.', '<select id="zSym"></select>')}
        ${item('Risk as', '', '<select id="zMode"><option value="usd">Dollars</option><option value="pct">% of account</option></select>')}
        ${item('Stop', 'Automatic uses your chart\'s average candle.', '<select id="zStopMode"><option value="auto">Automatic</option><option value="manual">I\'ll set it</option></select>')}
        ${item('Automatic stop size', 'How many average candles away your stop usually is.', '<select id="zAtr"><option value="0.5">½ candle</option><option value="1">1 candle</option><option value="1.5">1½ candles</option><option value="2">2 candles</option><option value="3">3 candles</option></select>')}
        ${item('My stop', '', '<div class="row" style="flex:none"><input type="number" id="zStop" min="0" max="100000" step="any"><select id="zUnit" style="width:100px"><option value="ticks">Ticks</option><option value="points">Points</option></select></div>')}
      </details>
    </section>

    <section data-tab="prop">
      <div class="card">
        ${item('Track a prop account', 'Uses the account connected in TradingView.', '<input type="checkbox" id="pOn">')}
        ${item('Firm preset', 'Fills in your account\'s rules.', `<select id="pPreset">${presetOptions()}</select>`, 'Evaluation rules for Lucid, Topstep, Take Profit Trader, MyFundedFutures, Tradeify and FundedNext: profit target, max loss limit and how it trails, daily loss limit, consistency and max contracts (in micros). Every field stays editable. Firms change rules often, so check your dashboard.')}
      </div>
      ${dep('#pOn', `
        <div class="card"><div class="sub" id="pLive"></div></div>
        ${grp('Account', `
          ${item('Starting balance ($)', '', '<input type="number" id="pStart" min="0" max="10000000" step="1000">')}
          ${item('Max loss limit ($)', 'Your firm\'s max loss (drawdown).', '<input type="number" id="pDd" min="0" max="1000000" step="100">')}
          ${item('Max loss type', 'Check your firm\'s rules.', '<select id="pType"><option value="eod">Trailing, end of day</option><option value="intraday">Trailing, intraday</option><option value="static">Static</option></select>', 'End of day trails your highest closing balance. Intraday trails your highest equity, including open P&amp;L. Static never moves.')}
          ${item('Trailing stops at starting balance', 'Most firms do.', '<input type="checkbox" id="pStop">', 'Most firms stop trailing once the limit reaches your starting balance.')}
          ${dep('#pStop', item('Stops at start plus ($)', 'Lucid uses +$100. Usually 0.', '<input type="number" id="pOff" min="0" max="100000" step="50">', 'Where the max loss limit stops trailing, above your starting balance. Lucid: start + $100, so $50,100 on a 50K.'))}
          ${item('Daily loss limit ($)', 'Your firm\'s. 0 = none.', '<input type="number" id="pDaily" min="0" max="1000000" step="50">')}
          ${item('Max contracts', '0 = no limit.', '<input type="number" id="pMax" min="0" max="1000" step="1">')}`)}
        ${grp('Locks', `
          ${item('Lock trading at these limits', 'Max loss or daily loss locks until 6 PM ET.', '<input type="checkbox" id="pEnforce">', 'Hitting the max loss or daily loss limit locks new orders until 6 PM ET, even with the Limits lockout off. You can always close a trade you\'re in.')}
          ${dep('#pEnforce', item('Stop early, with this much left ($)', '0 = lock right at the limit.', '<input type="number" id="pLock" min="0" max="1000000" step="50">', 'Locks before the max loss limit. 200 = lock when $200 is left.'))}`)}`)}
      ${grp('Target &amp; consistency', `
        ${item('Profit target ($)', '', '<input type="number" id="pTarget" min="0" max="10000000" step="100">')}
        ${item('Consistency rule (%)', 'Best day ≤ this % of profit. 0 = off.', '<input type="number" id="pCons" min="0" max="99" step="5">', 'Your best day can be at most this % of your total profit. Common: 30% to 50%. Check how your firm counts it.')}
        ${dep('#pCons', `
          ${item('Days to plan for', '0 = suggest.', '<input type="number" id="pDays" min="0" max="60" step="1">', 'How many more trading days you want to take to reach the target. 0 suggests a comfortable number.')}
          ${item('Best day before Wick tracked ($)', 'Only if you started earlier.', '<input type="number" id="pBest" min="0" max="1000000" step="50">', 'If you started this account before Wick was tracking it, enter your best day so far.')}
          ${item('Stop for the day at the cap', 'Locks once today reaches the cap.', '<input type="checkbox" id="pConsLock">', 'Once today\'s closed profit reaches the consistency cap, new orders lock until 6 PM ET.')}`)}
        <div class="sub" id="pPlan"></div>`)}
      ${dep('#pOn', '<div class="row"><button class="btn slim" id="pReset">Reset high-water mark to current equity</button></div>')}
    </section>

    <section data-tab="news">
      <div class="card">
        ${item('News warnings', 'A countdown before high-impact events.', '<input type="checkbox" id="nOn">')}
        ${dep('#nOn', `
          ${item('Warn me', '', '<select id="nMins"><option value="5">5 min before</option><option value="10">10 min before</option><option value="15">15 min before</option><option value="30">30 min before</option><option value="60">1 hour before</option></select>')}
          ${item('Include medium impact', '', '<input type="checkbox" id="nMed">')}
          ${item('Beep 1 minute before', '', '<input type="checkbox" id="nSound">')}
          ${item('Pause new entries', 'Around high-impact news.', '<input type="checkbox" id="nLock">', 'Covers the Buy/Sell buttons for a few minutes either side of high-impact news. Never blocks closing a trade.')}
          ${dep('#nLock', item('Pause window', '', '<select id="nAround"><option value="1">± 1 min</option><option value="2">± 2 min</option><option value="5">± 5 min</option><option value="10">± 10 min</option></select>'))}`)}
      </div>
      ${dep('#nOn', `<div class="sgroup" id="nList"><h3>Upcoming (New York time)</h3></div>
      <div class="hint">US events from TradingView's economic calendar. Refreshes every 30 minutes.</div>`)}
    </section>

    <section data-tab="trading">
      ${grp('Brackets', `
        ${item('Cancel the other exit when one fills', 'For Tradovate-style brackets. Cancels only.', '<input type="checkbox" id="xOco">', 'When your take-profit or stop fills and the position is closed, Wick cancels the exit that\'s left. It only cancels exit orders that were sitting there while you were in that position, never entry orders or other symbols, and it never places or changes an order. Try it on a demo account first.')}
        <div class="item"><div class="txt"><small id="ocoStatus" class="oco-st">Off</small></div></div>
        <div class="sub" id="ocoLog" hidden></div>`)}
      <div class="card">
        ${item('Show win / lose on TP & SL orders', 'For Tradovate-style brackets.', '<input type="checkbox" id="xBrk">')}
        ${item('Show as', '', '<select id="xBrkMode"><option value="ticks">Ticks</option><option value="money">Money</option><option value="both">Ticks + money</option></select>')}
        ${item('Distance from right edge', 'Slide labels so they sit next to your order labels.', '<input type="number" id="xBrkRight" min="0" max="800" step="10">')}
      </div>
      <div class="hint">Win / lose labels only read your orders. "Cancel the other exit" can cancel orders, and only exits.</div>
    </section>

    <section data-tab="stream">
      <div class="card">
        ${item('Streamer mode', 'Hide P&L, balance, equity and margin. Shortcut: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>', '<input type="checkbox" id="xStream">')}
        ${item('Also on the chart', 'Mask P&amp;L and contract counts on your lines.', '<input type="checkbox" id="xStreamChart">')}
        ${dep('#xStreamChart', item('Hide ticks and points too', 'Off = ticks stay visible.', '<input type="checkbox" id="xStreamTicks">'))}
        ${item('Hide contract count', 'On position and order lines. Ticks stay.', '<input type="checkbox" id="xHideQty">', 'Hides how many contracts you have open on the chart\'s position and order lines, even with Streamer mode off. P&amp;L in ticks or money stays as it is.')}
        ${item('Style', '', '<select id="xStreamStyle"><option value="blur">Blur</option><option value="hide">Cover completely</option></select>')}
      </div>
      <div class="hint">Covers the account panel, money columns in your history tables, and amounts on the chart. Prices and symbols stay visible.</div>
    </section>

    <section data-tab="extras">
      ${grp('Chart buttons', `
        ${item('Buy button', '', '<div class="row"><span class="hint" id="gBuyLbl"></span><input type="color" id="gBuy"><button class="btn slim" id="gBuyReset">Reset</button></div>')}
        ${item('Sell button', '', '<div class="row"><span class="hint" id="gSellLbl"></span><input type="color" id="gSell"><button class="btn slim" id="gSellReset">Reset</button></div>')}`)}
      ${grp('Day summary', `
        ${item('End-of-day notification', 'After the futures close: your P&amp;L and trade count, with a share card.', '<select id="gEod"><option value="traded">When I traded</option><option value="always">Always</option><option value="off">Off</option></select>', 'Shows once a day, on the chart and as a computer notification (if you allow notifications). With Streamer mode on, the amount is left out.')}
        ${item('Session closes at (New York time)', '', '<select id="gEodClose"><option value="16:00">4:00 PM</option><option value="16:15">4:15 PM</option><option value="17:00">5:00 PM</option></select>')}`)}
      ${grp('Order updates', `
        ${item('Faster order updates', 'Demo and prop accounts only.', '<select id="gFast"><option value="0">Off (TradingView\'s 1 s)</option><option value="500">Every 500 ms</option><option value="250">Every 250 ms</option><option value="150">Every 150 ms</option></select>', 'TradingView checks Tradovate for your orders and positions about once a second, so fills show up late. This checks more often while you\'re in a trade, have working orders, or just placed one, and goes back to normal when you\'re flat. It doesn\'t make fills happen sooner at the exchange; it shows them sooner, so sounds, the journal, brackets and the lockout react sooner. Only on demo-type accounts (that includes prop accounts). If Tradovate pushes back with errors, it slows down for a minute.')}
        <div class="item"><div class="txt"><small id="gFastSt" class="oco-st">Off</small></div></div>`)}
      <div class="card">
        ${item('Turn everything off', 'Your settings stay saved.', '<input type="checkbox" id="gAllOff">', 'Stops every feature at once, except the daily lockout if it\'s on. Shortcut: Alt+Shift+X.')}
        ${item('Hide ads', "Hides TradingView's ad pop-ups on the chart.", '<input type="checkbox" id="xAds">')}
        ${item('Theme', 'Auto follows your TradingView theme.', '<div class="seg" id="gTheme"><button data-v="auto">Auto</button><button data-v="dark">Dark</button><button data-v="light">Light</button></div>')}
        ${item('Glass panel', 'Your wallpaper shows softly behind this window.', '<input type="checkbox" id="gGlass">')}
        ${dep('#gGlass', item('Backdrop dim <span class="hint" id="gDimVal"></span>', '', '<input type="range" id="gDim" min="30" max="90" step="2">'))}
        ${item('Button position', 'Drag the button anywhere.', '<button class="btn slim" id="gResetPos">Reset</button>')}
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
    for (const ev of ['keydown', 'keypress', 'keyup']) {
      host.addEventListener(ev, e => { if (inOurField(e)) e.stopPropagation(); });
    }
    // Last resort: if TradingView already swallowed a key before we could stop it (it can get there
    // first in the desktop app), type the character into our box ourselves.
    host.addEventListener('keydown', e => { if (inOurField(e)) typeSwallowed(e); }, true);
    root.addEventListener('click', e => {
      const row = e.target.closest && e.target.closest('.item');
      if (!row || e.target.closest('input, select, button, a, .seg, label, textarea')) return;
      const boxes = [...row.querySelectorAll('input[type=text]')].filter(i => i.offsetParent !== null);
      if (boxes.length === 1) { boxes[0].focus(); boxes[0].select(); }
    });
    root.addEventListener('focusout', e => {
      const t = e.target;
      if (t && t.__tvwpDirty) { t.__tvwpDirty = false; t.dispatchEvent(new Event('change', { bubbles: true })); }
    }, true);
    root.innerHTML = `<style>${CSS}</style>${HTML}`;
    const textify = el => { el.type = 'text'; el.inputMode = 'decimal'; el.autocomplete = 'off'; el.spellcheck = false; };
    root.querySelectorAll('input[type=number]').forEach(textify);
    new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches && n.matches('input[type=number]')) textify(n);
      if (n.querySelectorAll) n.querySelectorAll('input[type=number]').forEach(textify);
    } }).observe(root, { childList: true, subtree: true });
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
    // (i) details: one floating tip for the whole panel
    const tip = document.createElement('div');
    tip.className = 'tip'; tip.hidden = true; root.appendChild(tip);
    const showTip = el => {
      tip.textContent = el.dataset.tip; tip.hidden = false;
      const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      let x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
      let y = r.bottom + 8; if (y + h > innerHeight - 8) y = r.top - h - 8;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    };
    root.addEventListener('pointerover', e => { const el = e.target.closest && e.target.closest('button.info'); if (el) showTip(el); });
    root.addEventListener('pointerout', e => { if (e.target.closest && e.target.closest('button.info')) tip.hidden = true; });
    root.addEventListener('focusin', e => { if (e.target.matches && e.target.matches('button.info')) showTip(e.target); });
    root.addEventListener('focusout', e => { if (e.target.matches && e.target.matches('button.info')) tip.hidden = true; });
    root.addEventListener('click', e => { const el = e.target.closest && e.target.closest('button.info'); if (el) { e.preventDefault(); e.stopPropagation(); tip.hidden ? showTip(el) : (tip.hidden = true); } }, true);
    $('.content').addEventListener('scroll', () => { tip.hidden = true; });
    // show settings only when the switch they depend on is on
    function syncDeps() {
      root.querySelectorAll('[data-when]').forEach(el => {
        const c = root.querySelector(el.dataset.when);
        const on = !c ? true : c.type === 'checkbox' ? c.checked : +String(c.value).replace(/[^\d.]/g, '') > 0;
        if (el.hidden === on) el.hidden = !on;
      });
    }
    buildUI.syncDeps = syncDeps;
    buildUI.applyBackdrop = () => {
      const bd = $('#backdrop');
      bd.style.backgroundImage = backdropUrl ? `url("${backdropUrl}")` : '';
      bd.classList.toggle('has', !!backdropUrl && !S.extras.allOff);
      panel.classList.toggle('glass', S.ui.glass !== false);
      panel.style.setProperty('--bdDim', Math.max(20, Math.min(95, +S.ui.glassDim || 62)) + '%');
    };
    buildUI.applyBackdrop();
    root.addEventListener('change', () => requestAnimationFrame(syncDeps));
    root.addEventListener('input', () => requestAnimationFrame(syncDeps));
    setInterval(() => { if (panel.classList.contains('open')) syncDeps(); }, 600);
    // Each page's main on/off switch sits in the title bar, like a window toolbar.
    const MASTER = { wall: ['wEnabled', 'Show'], candles: ['cEnabled', 'On'], journal: ['rOn', 'Recording'], sounds: ['sEnabled', 'On'], stream: ['xStream', 'On'], risk: ['kOn', 'Lockout'], prop: ['pOn', 'Tracking'], news: ['nOn', 'On'] };
    const masterHome = {};
    function placeMaster(t) {
      const slot = $('#hdrCtl');
      for (const [tab, [id]] of Object.entries(MASTER)) {           // put every switch back home first
        const el = root.getElementById ? root.getElementById(id) : $('#' + id);
        if (!el) continue;
        if (!masterHome[id]) {
          const row = el.closest('.item');
          masterHome[id] = { parent: el.parentNode, next: el.nextSibling, row, card: row && row.parentNode };
        }
        const h = masterHome[id];
        if (el.parentNode !== h.parent) h.parent.insertBefore(el, h.next);
        if (h.row) h.row.classList.remove('moved');
        if (h.card && h.card.classList) h.card.classList.remove('moved-card');
      }
      const m = MASTER[t];
      if (!m) { slot.hidden = true; return; }
      const el = $('#' + m[0]), h = masterHome[m[0]];
      if (!el || !h) { slot.hidden = true; return; }
      $('#hdrCtlLbl').textContent = m[1];
      slot.appendChild(el); slot.hidden = false;
      if (h.row) h.row.classList.add('moved');
      // a card that held only that switch disappears
      if (h.card && h.card.classList && h.card.classList.contains('card') && ![...h.card.children].some(c => c !== h.row && !(c.classList && c.classList.contains('pg-h'))))
        h.card.classList.add('moved-card');
    }
    function showTab(t) {
      if (!PAGES[t]) t = 'wall';
      root.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
      root.querySelectorAll('section').forEach(s => s.classList.toggle('on', s.dataset.tab === t));
      $('#pgTitle').textContent = PAGES[t][0];
      $('#pgSub').textContent = PAGES[t][1];
      placeMaster(t);
      if (t === 'home') renderHome();
      if (t === 'wall' && typeof renderWallUI === 'function') renderWallUI();
      $('.content').scrollTop = 0;
      syncDeps();
    }
    S.ui.closed = S.ui.closed || {};
    root.querySelectorAll('.ng').forEach(g => {
      const k = g.dataset.grp;
      g.classList.toggle('shut', !!S.ui.closed[k]);
      g.querySelector('.grp').onclick = () => { S.ui.closed[k] = !S.ui.closed[k]; g.classList.toggle('shut', S.ui.closed[k]); save(null); };
    });
    root.querySelectorAll('.tabs button[data-tab]').forEach(b => b.onclick = () => {
      S.ui.tab = b.dataset.tab; save(null); showTab(b.dataset.tab); placePanel();
    });

    /* ---- wallpaper tab ---- */
    let wallList = [];
    async function renderGrid() {
      const grid = $('#grid');
      let list = [];
      try { list = await DB.all(); } catch (e) {}
      const used = S.wall.used || {};
      list.sort((a, b) => (used[b.id] || b.added || 0) - (used[a.id] || a.added || 0));   // recently used first
      wallList = list;
      grid.innerHTML = '';
      if (!list.length) { grid.innerHTML = '<div class="empty">No wallpapers yet — add some images or GIFs</div>'; renderPanels(); return; }
      for (const w of list) {
        const d = document.createElement('div');
        d.className = 'thumb' + (w.id === S.wall.currentId ? ' active' : '');
        const img = document.createElement('img');
        img.src = w.thumb;
        d.appendChild(img);
        if (w.animated) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = w.video ? 'VIDEO' : 'GIF'; d.appendChild(t); }
        const del = document.createElement('button');
        del.className = 'del'; del.title = 'Remove'; del.textContent = '×';
        d.appendChild(del);
        d.onclick = () => { S.wall.currentId = w.id; S.wall.enabled = true; save('wall'); loadWallpaper().then(renderWallUI); renderWallUI(); };
        del.onclick = async e => {
          e.stopPropagation();
          await DB.del(w.id);
          for (const k of Object.keys(S.wall.perPanel || {})) if (S.wall.perPanel[k] === w.id) delete S.wall.perPanel[k];
          if (S.wall.currentId === w.id) {
            const rest = list.filter(x => x.id !== w.id);
            S.wall.currentId = rest.length ? rest[0].id : null;
            loadWallpaper();
          }
          save('wall'); syncPanelSources();
          bc && bc.postMessage({ type: 'list' });
          renderWallUI();
        };
        grid.appendChild(d);
      }
      renderPanels();
    }
    function renderPreview() {
      const w = S.wall, cur = wallList.find(x => x.id === w.currentId);
      $('#wPrevImg').src = (cur && cur.video ? cur.thumb : backdropUrl) || (cur && cur.thumb) || '';
      $('#wPrevImg').style.objectFit = w.fit === 'contain' ? 'contain' : w.fit === 'stretch' ? 'fill' : 'cover';
      $('#wPrevImg').style.objectPosition = `${(w.posX ?? .5) * 100}% ${(w.posY ?? .5) * 100}%`;
      $('#wPrevEmpty').hidden = !!(backdropUrl || cur);
      $('#wDot').hidden = !(backdropUrl || cur);
      $('#wDot').style.left = (w.posX ?? .5) * 100 + '%'; $('#wDot').style.top = (w.posY ?? .5) * 100 + '%';
      $('#wName').textContent = cur ? (cur.name || (cur.animated ? 'Animated wallpaper' : 'Wallpaper')) : 'No wallpaper';
      $('#wSize').textContent = cur ? [cur.video ? 'Video' : cur.animated ? 'GIF' : 'Image', cur.w && cur.h ? `${cur.w} × ${cur.h}` : ''].filter(Boolean).join(' · ') : 'Add an image, GIF or video to start.';
      $('#wReplaceBtn').hidden = $('#wRemove').hidden = !cur;
    }
    function renderPanels() {
      const n = Math.max(1, containers().length), pp = S.wall.perPanel || {};
      if (renderPanels.sel == null || renderPanels.sel > n) renderPanels.sel = 1;
      const thumbOf = id => (wallList.find(x => x.id === id) || {}).thumb;
      $('#wPanels').innerHTML = Array.from({ length: n }, (_, i) => {
        const k = i + 1, t = thumbOf(pp[k] || S.wall.currentId);
        return `<button class="pnlb${k === renderPanels.sel ? ' on' : ''}" data-k="${k}" style="${t ? `background-image:url('${t}')` : ''}">${k}</button>`;
      }).join('');
      $('#wPanelHint').hidden = n > 1;
      const k = renderPanels.sel;
      $('#wPanelLbl').textContent = n > 1 ? `Chart ${k}` : 'Chart 1 (only chart on screen)';
      $('#wPanelPick').innerHTML = '<option value="">Same as main wallpaper</option>' +
        wallList.map((w, i) => `<option value="${w.id}">${(w.name || (w.animated ? 'GIF' : 'Image') + ' ' + (i + 1)).replace(/</g, '&lt;')}</option>`).join('');
      $('#wPanelPick').value = pp[k] || '';
      root.querySelectorAll('#wPanels .pnlb').forEach(b => b.onclick = () => { renderPanels.sel = +b.dataset.k; renderPanels(); });
    }
    $('#wPanelPick').onchange = e => {
      S.wall.perPanel = S.wall.perPanel || {};
      if (e.target.value) S.wall.perPanel[renderPanels.sel] = e.target.value; else delete S.wall.perPanel[renderPanels.sel];
      save('wall'); syncPanelSources(); renderPanels();
    };
    function renderWallUI() {
      const w = S.wall;
      $('#wEnabled').checked = w.enabled;
      $('#opacity').value = w.opacity; $('#opVal').textContent = Math.round(w.opacity * 100) + '%';
      $('#blend').value = w.blend;
      root.querySelectorAll('#wFit button').forEach(b => b.classList.toggle('on', b.dataset.v === (w.fit || 'cover')));
      $('#wZoom').value = w.zoom || 1; $('#wZoomVal').textContent = Math.round((w.zoom || 1) * 100) + '%';
      $('#wDim').value = w.dim || 0; $('#wDimVal').textContent = Math.round((w.dim || 0) * 100) + '%';
      $('#wBlur').value = w.blur || 0; $('#wBlurVal').textContent = (w.blur || 0) + ' px';
      $('#wAutoDim').checked = !!w.autoDim; $('#wTint').checked = !!w.tint;
      renderGrid().then(renderPreview);
      renderPreview();
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
      save('wall'); loadWallpaper().then(renderWallUI); renderWallUI();
    };
    $('#wEnabled').onchange = e => { S.wall.enabled = e.target.checked; save('wall'); refreshWall(); };
    let wallSaveT = null;
    const wallLive = (fn) => e => { fn(e); refreshWall(); renderPreview(); clearTimeout(wallSaveT); wallSaveT = setTimeout(() => save('wall'), 250); };
    $('#opacity').oninput = wallLive(e => { S.wall.opacity = parseFloat(e.target.value); $('#opVal').textContent = Math.round(S.wall.opacity * 100) + '%'; });
    $('#wZoom').oninput = wallLive(e => { S.wall.zoom = +e.target.value; $('#wZoomVal').textContent = Math.round(S.wall.zoom * 100) + '%'; });
    $('#wDim').oninput = wallLive(e => { S.wall.dim = +e.target.value; $('#wDimVal').textContent = Math.round(S.wall.dim * 100) + '%'; });
    $('#wBlur').oninput = wallLive(e => { S.wall.blur = +e.target.value; $('#wBlurVal').textContent = S.wall.blur + ' px'; });
    $('#blend').onchange = e => { S.wall.blend = e.target.value; save('wall'); refreshWall(); };
    root.querySelectorAll('#wFit button').forEach(b => b.onclick = () => { S.wall.fit = b.dataset.v; save('wall'); refreshWall(); renderWallUI(); });
    $('#wAutoDim').onchange = e => { S.wall.autoDim = e.target.checked; save('wall'); refreshWall(); };
    $('#wTint').onchange = e => { S.wall.tint = e.target.checked; chartBgCache.at = 0; save('wall'); refreshWall(); };
    $('#wCenter').onclick = e => { e.preventDefault(); S.wall.posX = .5; S.wall.posY = .5; save('wall'); refreshWall(); renderPreview(); };
    // Remove / Replace the wallpaper you're using now
    async function removeWallpaper(id) {
      await DB.del(id);
      for (const k of Object.keys(S.wall.perPanel || {})) if (S.wall.perPanel[k] === id) delete S.wall.perPanel[k];
      if (S.wall.used) delete S.wall.used[id];
      if (S.wall.currentId === id) {
        const rest = (await DB.all()).sort((a, b) => ((S.wall.used || {})[b.id] || b.added || 0) - ((S.wall.used || {})[a.id] || a.added || 0));
        S.wall.currentId = rest.length ? rest[0].id : null;
        loadWallpaper();
      }
      save('wall'); syncPanelSources(); bc && bc.postMessage({ type: 'list' });
    }
    $('#wRemove').onclick = async () => { if (S.wall.currentId) { await removeWallpaper(S.wall.currentId); renderWallUI(); } };
    $('#wReplace').onchange = async e => {
      const f = [...e.target.files]; e.target.value = '';
      if (!f.length) return;
      const old = S.wall.currentId;
      $('#wMsg').textContent = 'Replacing…';
      const problems = await addFiles(f.slice(0, 1));
      if (!problems.length && old && old !== S.wall.currentId) {
        for (const k of Object.keys(S.wall.perPanel || {})) if (S.wall.perPanel[k] === old) S.wall.perPanel[k] = S.wall.currentId;
        await DB.del(old); if (S.wall.used) delete S.wall.used[old]; save('wall'); syncPanelSources();
      }
      $('#wMsg').textContent = problems.join(' · ');
      renderWallUI();
    };
    // drop images / GIFs / videos anywhere on the Wick window
    {
      let depth = 0;
      const isFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
      panel.addEventListener('dragenter', e => { if (!isFiles(e)) return; e.preventDefault(); depth++; panel.classList.add('drop'); });
      panel.addEventListener('dragover', e => { if (isFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
      panel.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; panel.classList.remove('drop'); } });
      panel.addEventListener('drop', async e => {
        if (!isFiles(e)) return;
        e.preventDefault(); depth = 0; panel.classList.remove('drop');
        const files = [...e.dataTransfer.files].filter(f => /^(image|video)\//.test(f.type));
        if (!files.length) return;
        S.ui.tab = 'wall'; showTab('wall');
        $('#wMsg').textContent = 'Adding…';
        const problems = await addFiles(files);
        $('#wMsg').textContent = problems.join(' · ');
        renderWallUI();
      });
    }
    $('#wReset').onclick = () => { Object.assign(S.wall, { zoom: 1, posX: .5, posY: .5, dim: 0, blur: 0, fit: 'cover' }); save('wall'); refreshWall(); renderWallUI(); };
    // focus point: click or drag on the preview
    {
      const pv = $('#wPrev'); let drag = false;
      const setPos = e => {
        const r = pv.getBoundingClientRect();
        S.wall.posX = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100) / 100;
        S.wall.posY = Math.round(Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) * 100) / 100;
        renderPreview(); refreshWall();
      };
      pv.addEventListener('pointerdown', e => { drag = true; pv.setPointerCapture(e.pointerId); setPos(e); e.preventDefault(); });
      pv.addEventListener('pointermove', e => { if (drag) setPos(e); });
      pv.addEventListener('pointerup', () => { if (drag) { drag = false; save('wall'); } });
    }

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
    $('#xStreamChart').onchange = e => { S.extras.streamerChart = e.target.checked; save('extras'); applyStreamer(); pollPositions(); };
    $('#xStreamTicks').onchange = e => { S.extras.streamerTicks = e.target.checked; save('extras'); applyStreamer(); };
    $('#xHideQty').onchange = e => { S.extras.hideQty = e.target.checked; save('extras'); pollPositions().then(applyStreamer); };
    $('#xStreamStyle').onchange = e => { S.extras.streamerStyle = e.target.value; save('extras'); applyStreamer(); };
    $('#xBrk').onchange = e => { S.extras.brk = e.target.checked; save('extras'); brkPoll(); brkKick(); };
    $('#xOco').onchange = e => { S.extras.oco = e.target.checked; save('extras'); ocoTick().then(renderOco); };
    function renderOco() {
      const st = $('#ocoStatus'); if (!st) return;
      const txt = !S.extras.oco ? 'Off' : ocoLast === 'nobroker' ? 'Waiting for your broker in TradingView' : ocoLast === 'error' ? 'Couldn\'t read your orders. Retrying.' : ocoLast === 'ready' || !ocoLast ? 'On · no TP/SL open' : 'On · ' + ocoLast;
      st.textContent = txt;
      st.className = 'oco-st ' + (!S.extras.oco ? '' : ocoLast === 'nobroker' || ocoLast === 'error' ? 'warn' : 'ok');
      const lg = $('#ocoLog');
      lg.hidden = !ocoLog.length;
      lg.innerHTML = ocoLog.map(x => `<div class="hint">${new Date(x.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })} · ${x.text}</div>`).join('');
    }
    setInterval(() => { if (panel.classList.contains('open') && S.ui.tab === 'trading') renderOco(); }, 700);
    $('#xBrkMode').onchange = e => { S.extras.brkMode = e.target.value; save('extras'); brkKick(); };
    $('#xBrkRight').onchange = e => {
      const v = Math.min(800, Math.max(0, parseInt(e.target.value, 10) || 0));
      e.target.value = v; S.extras.brkRight = v; save('extras'); brkKick();
    };
    function renderStreamUI() {
      $('#xBrk').checked = S.extras.brk !== false; $('#xOco').checked = !!S.extras.oco; renderOco();
      $('#xBrkMode').value = S.extras.brkMode || 'ticks';
      $('#xBrkRight').value = S.extras.brkRight ?? 300;
      $('#xStream').checked = !!S.extras.streamer;
      $('#xStreamChart').checked = S.extras.streamerChart !== false;
      $('#xStreamTicks').checked = !!S.extras.streamerTicks; $('#xHideQty').checked = !!S.extras.hideQty;
      $('#xStreamStyle').value = S.extras.streamerStyle || 'blur';
      fab.classList.toggle('live', !!S.extras.streamer);
    }
    buildUI.onStreamer = () => { renderStreamUI(); renderQuick(); renderStatus(); };
    renderStreamUI();
    /* ---- risk pages ---- */
    buildUI.bannerBox = $('#banners');
    buildUI.counterEl = $('#tradeCounter');
    buildUI.edgeEl = $('#tradeEdge');
    {
      const el = buildUI.counterEl;
      const place = () => {
        const p = S.risk.counterPos;
        if (p && isFinite(p.x) && isFinite(p.y)) {
          el.style.left = Math.round(Math.min(Math.max(0, p.x), 1) * (innerWidth - el.offsetWidth)) + 'px';
          el.style.top = Math.round(Math.min(Math.max(0, p.y), 1) * (innerHeight - el.offsetHeight)) + 'px';
          el.style.right = 'auto';
        } else { el.style.left = 'auto'; el.style.right = '90px'; el.style.top = '50px'; }
      };
      place(); addEventListener('resize', place);
      let drag = null;
      el.addEventListener('pointerdown', e => { const b = el.getBoundingClientRect(); drag = { dx: e.clientX - b.left, dy: e.clientY - b.top }; el.setPointerCapture(e.pointerId); e.preventDefault(); });
      el.addEventListener('pointermove', e => {
        if (!drag) return;
        const x = Math.min(Math.max(0, e.clientX - drag.dx), innerWidth - el.offsetWidth), y = Math.min(Math.max(0, e.clientY - drag.dy), innerHeight - el.offsetHeight);
        el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto';
      });
      el.addEventListener('pointerup', () => {
        if (!drag) return; drag = null;
        const b = el.getBoundingClientRect();
        S.risk.counterPos = { x: b.left / Math.max(1, innerWidth - b.width), y: b.top / Math.max(1, innerHeight - b.height) };
        save('risk');
      });
      new ResizeObserver(() => { if (S.risk.counterPos) place(); }).observe(el);
    }
    buildUI.open = tab => { toggle(true); S.ui.tab = tab; showTab(tab); };
    // sec is the settings section name; always read S[sec] at the time of the change (S is replaced when another tab saves)
    const FROZEN = new Set(['#pPreset', '#pOff', '#pCons', '#pConsLock', '#kOn', '#kLoss', '#kTrades', '#kProfit', '#pLock', '#kSyms', '#pOn', '#pDd', '#pDaily', '#pEnforce', '#pType', '#pStart', '#pStop']);
    const frozenNo = id => { if (!FROZEN.has(id) || !rulesFrozen()) return false; renderRiskInputs(); renderRiskPages(); flashBanner(); return true; };
    const bindNum = (id, sec, key) => { $(id).onchange = e => { if (frozenNo(id)) return; const v = parseFloat(e.target.value); if (isFinite(v) && v >= 0) { S[sec][key] = v; save(sec); } else e.target.value = S[sec][key]; riskTick(); renderRiskPages(); }; };
    const bindSel = (id, sec, key, numeric) => { $(id).onchange = e => { if (frozenNo(id)) return; S[sec][key] = numeric ? +e.target.value : e.target.value; save(sec); riskTick(); renderRiskPages(); if (sec === 'risk') renderRiskInputs(); }; };
    const bindChk = (id, sec, key, after) => { $(id).onchange = e => { if (frozenNo(id)) return; S[sec][key] = e.target.checked; if (after) after(); save(sec); riskTick(); renderRiskPages(); }; };
    bindChk('#kCounter', 'risk', 'counter', () => renderCounter());
    bindChk('#kOn', 'risk', 'lockOn', () => { if (S.risk.lockOn && !S.rec.on) { S.rec.on = true; recStartFresh(); save('journal'); } });
    $('#kSyms').onchange = e => {
      if (frozenNo('#kSyms')) return;
      S.risk.symOnly = [...new Set(String(e.target.value).split(/[\s,;]+/).map(x => symRoot(x.replace(/[^A-Za-z0-9:!]/g, ''))).filter(Boolean))].join(', ');
      e.target.value = S.risk.symOnly; save('risk'); riskTick();
    };
    bindNum('#kLoss', 'risk', 'maxLoss'); bindNum('#kTrades', 'risk', 'maxTrades'); bindNum('#kProfit', 'risk', 'profitLock');
    bindSel('#kWarn', 'risk', 'warnPct', true);
    $('#zSym').innerHTML = '<option value="">Chart symbol (auto)</option>' + Object.keys(FUTURES).map(k => `<option value="${k}">${k}</option>`).join('');
    bindSel('#zSym', 'risk', 'sizeSym'); bindSel('#zMode', 'risk', 'sizeMode'); bindSel('#zUnit', 'risk', 'sizeUnit');
    bindSel('#zStopMode', 'risk', 'sizeStopMode'); bindSel('#zAtr', 'risk', 'sizeAtr', true);
    root.querySelectorAll('#zView button').forEach(bt => bt.onclick = () => { S.risk.sizeView = bt.dataset.v; save('risk'); renderRiskInputs(); renderSize(); });
    root.querySelectorAll('#zStopSeg button').forEach(bt => bt.onclick = () => {
      S.risk.simpleManual = bt.dataset.v === 'manual'; save('risk'); renderRiskInputs(); renderSize();
      if (S.risk.simpleManual) { const i = $('#zPts'); i.focus(); i.select(); }
    });
    $('#zPts').oninput = e => {
      const raw = e.target.value.trim(), v = raw === '' ? 0 : parseFloat(raw);
      if (isFinite(v) && v >= 0) { S.risk.simplePts = v; S.risk.simpleManual = true; save('risk'); renderSize(); }
    };
    for (const id of ['#zSym', '#zMode', '#zUnit', '#zStopMode', '#zAtr']) $(id).addEventListener('change', () => renderSize());
    $('#zRisk').oninput = e => {
      const raw = e.target.value.trim(), v = raw === '' ? 0 : parseFloat(raw);
      if (isFinite(v) && v >= 0) { S.risk[S.risk.sizeMode === 'pct' ? 'sizePct' : 'sizeRisk'] = v; save('risk'); renderSize(); }
    };
    $('#zStop').oninput = e => { const v = parseFloat(e.target.value); if (isFinite(v) && v >= 0) { S.risk.sizeStop = v; save('risk'); renderSize(); } };
    bindChk('#pOn', 'prop', 'on'); bindNum('#pStart', 'prop', 'start'); bindNum('#pDd', 'prop', 'dd');
    bindSel('#pType', 'prop', 'ddType'); bindChk('#pStop', 'prop', 'stopAtStart'); bindNum('#pDaily', 'prop', 'daily');
    bindNum('#pTarget', 'prop', 'target'); bindNum('#pMax', 'prop', 'maxQty'); bindNum('#pLock', 'prop', 'lockNear'); bindChk('#pEnforce', 'prop', 'enforce'); bindNum('#pOff', 'prop', 'stopOffset');
    $('#pPreset').onchange = e => {
      if (rulesFrozen()) { e.target.value = S.prop.preset || ''; flashBanner(); return; }
      applyPreset(e.target.value); save('prop'); riskTick(); renderRiskInputs(); renderRiskPages(); syncDeps();
    };
    bindNum('#pCons', 'prop', 'consistency'); bindNum('#pDays', 'prop', 'planDays'); bindNum('#pBest', 'prop', 'bestDay'); bindChk('#pConsLock', 'prop', 'consLock');
    $('#pReset').onclick = () => {
      const av = acctValues(); const st = riskLoad(); const acct = (av && av.account) || 'default';
      if (st.prop && st.prop[acct] && av && isFinite(av.equity)) { st.prop[acct].peak = av.equity; st.prop[acct].eodPeak = av.balance ?? av.equity; riskSave(st); }
      riskTick();
    };
    bindChk('#nOn', 'news', 'on', () => { if (S.news.on) fetchNews().then(renderNews); });
    bindSel('#nMins', 'news', 'mins', true); bindChk('#nMed', 'news', 'medium', () => renderNews()); bindChk('#nSound', 'news', 'sound');
    bindChk('#nLock', 'risk', 'newsLock'); bindSel('#nAround', 'news', 'around', true);
    const UNLOCK_PHRASE = 'I am breaking my own trading rules';
    let unlockTimer = null;
    const unlockReset = () => {
      clearInterval(unlockTimer); unlockTimer = null;
      $('#kUnlock').textContent = 'Unlock early'; $('#kUnlock').hidden = false;
      $('#kPhraseBox').hidden = true; $('#kPhrase').value = ''; $('#kConfirm').disabled = true;
    };
    $('#kUnlock').onclick = () => {
      if (unlockTimer) { unlockReset(); return; }
      let n = Math.max(1, +window.__tvwpUnlockSecs || 300);
      const show = () => { $('#kUnlock').textContent = `Wait ${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}… (click to cancel)`; };
      show();
      unlockTimer = setInterval(() => {
        if (!lockedNow()) { unlockReset(); return; }
        if (--n > 0) { show(); return; }
        clearInterval(unlockTimer); unlockTimer = 1;   // waited; now the phrase
        $('#kUnlock').hidden = true; $('#kPhraseBox').hidden = false; $('#kPhrase').focus();
      }, 1000);
    };
    const phraseOk = () => $('#kPhrase').value.trim().replace(/\s+/g, ' ').toLowerCase() === UNLOCK_PHRASE.toLowerCase();
    $('#kPhrase').oninput = () => { $('#kConfirm').disabled = !phraseOk(); };
    for (const ev of ['paste', 'drop']) $('#kPhrase').addEventListener(ev, e => e.preventDefault());
    $('#kConfirm').onclick = () => { if (!phraseOk() || !lockedNow()) return; unlockReset(); unlockEarly(); renderRiskPages(); };
    $('#kCancel').onclick = unlockReset;
    function renderRiskInputs() {
      const r = S.risk, p = S.prop, n = S.news;
      $('#kOn').checked = !!r.lockOn; $('#kLoss').value = r.maxLoss; $('#kTrades').value = r.maxTrades; $('#kCounter').checked = r.counter !== false; if ($('#kSyms').getRootNode().activeElement !== $('#kSyms')) $('#kSyms').value = r.symOnly || ''; $('#kProfit').value = r.profitLock; $('#kWarn').value = String(r.warnPct);
      $('#zSym').value = r.sizeSym || ''; $('#zMode').value = r.sizeMode; $('#zRisk').value = r.sizeMode === 'pct' ? r.sizePct : r.sizeRisk; $('#zStop').value = r.sizeStop; $('#zUnit').value = r.sizeUnit;
      $('#zStopMode').value = r.sizeStopMode || 'auto'; $('#zAtr').value = String(r.sizeAtr || 1);
      $('#zUnitSym').textContent = r.sizeMode === 'pct' ? '%' : '$';
      $('#zRiskSub').textContent = r.sizeMode === 'pct' ? 'Per trade, as % of your account.' : 'Per trade, in dollars.';
      const classic = r.sizeView === 'classic';
      root.querySelectorAll('#zView button').forEach(bt => bt.classList.toggle('on', bt.dataset.v === (classic ? 'classic' : 'simple')));
      if ($('#zPts') !== root.activeElement) $('#zPts').value = +r.simplePts > 0 ? r.simplePts : '';
      root.querySelectorAll('#zStopSeg button').forEach(bt => bt.classList.toggle('on', bt.dataset.v === (r.simpleManual ? 'manual' : 'auto')));
      $('#zPtsBox').style.display = r.simpleManual ? '' : 'none';
      $('#zStopSub').textContent = r.simpleManual ? 'Type your stop in points.' : 'A typical stop from your chart (switch to Manual to type your own).';
      $('#zPts').closest('.item').style.display = classic ? 'none' : '';
      // Classic: the old layout (symbol, risk, your stop) always open; no automatic stop or table
      const adv = $('#zAdv');
      if (classic) adv.open = true;
      adv.querySelector('summary').style.display = classic ? 'none' : '';
      $('#zStopMode').closest('.item').style.display = classic ? 'none' : '';
      $('#zStop').closest('.item').style.display = classic || r.sizeStopMode === 'manual' ? '' : 'none';
      $('#zAtr').closest('.item').style.display = classic || r.sizeStopMode === 'manual' ? 'none' : '';
      $('#zStop').closest('.item').querySelector('.txt b').textContent = classic ? 'Stop distance' : 'My stop';
      $('#pOn').checked = !!p.on; $('#pStart').value = p.start; $('#pDd').value = p.dd; $('#pType').value = p.ddType; $('#pStop').checked = !!p.stopAtStart;
      $('#pDaily').value = p.daily; $('#pTarget').value = p.target; $('#pMax').value = p.maxQty; $('#pLock').value = p.lockNear; $('#pEnforce').checked = p.enforce !== false; $('#pOff').value = p.stopOffset || 0;
      presetSync();
      $('#pCons').value = p.consistency || 0; $('#pDays').value = p.planDays || 0; $('#pBest').value = p.bestDay || 0; $('#pConsLock').checked = !!p.consLock;
      $('#nOn').checked = !!n.on; $('#nMins').value = String(n.mins); $('#nMed').checked = !!n.medium; $('#nSound').checked = !!n.sound;
      $('#nLock').checked = !!r.newsLock; $('#nAround').value = String(n.around);
    }
    // the preset shows only while the fields still match it
    function presetSync() {
      const p = S.prop, pr = PROP_PRESETS[p.preset], sel = $('#pPreset');
      const v = pr && ['start', 'dd', 'ddType', 'daily', 'target', 'consistency'].every(k => String(pr[k]) === String(p[k])) ? p.preset : '';
      if (sel && sel.value !== v && sel.getRootNode().activeElement !== sel) sel.value = v;
    }
    function renderConsPlan() {
      presetSync();
      const box = $('#pPlan');
      if (!box) return;
      const p = S.prop;
      if (!(+p.consistency > 0)) { box.innerHTML = '<span class="hint">Set your firm\'s consistency rule above to get a day-by-day plan to your profit target.</span>'; return; }
      if (!(+p.target > 0)) { box.innerHTML = '<span class="hint">Set a profit target above to plan your days.</span>'; return; }
      const av = p.on ? acctValues() : null;
      const ps = av ? propState(av) : null;
      const cp = consPlan(ps);
      if (!cp) { box.innerHTML = '<span class="hint">Consistency must be between 1% and 99%.</span>'; return; }
      const hide = S.extras.streamer;
      const usd = v => hide ? '•••••' : '$' + Math.round(v).toLocaleString();
      const pc = v => Math.round(v * 100) + '%';
      const rows = [];
      if (ps && ps.bal !== null && ps.bal !== undefined && +p.start > 0 && Math.abs(ps.bal - +p.start) > Math.max(+p.dd || 0, +p.start * 0.1) * 1.5)
        rows.push(`<div class="plan-warn">Your connected account (${usd(ps.bal)}) doesn't look like a ${usd(+p.start)} account. Pick the right size above, or select the matching account in TradingView's trading panel.</div>`);
      if (ps && ps.eq !== null) {
        rows.push(meter('Profit (closed)', usd(cp.profit), cp.need ? Math.max(0, cp.profit) / cp.need : 0, cp.ok ? '' : 'warn'));
        rows.push(`<div class="kv"><span>Best day</span><b>${cp.best > 0 || cp.todayP > 0 ? usd(Math.max(cp.best, cp.todayP)) : 'none yet'}${cp.pct !== null ? ` · ${pc(cp.pct)} of profit (rule ${pc(cp.C)})` : ''}</b></div>`);
        rows.push(`<div class="kv"><span>Profit you need</span><b>${usd(cp.need)}${cp.need > cp.T + 0.5 ? ` <span class="hint">(raised from ${usd(cp.T)} by your best day)</span>` : ''}</b></div>`);
        rows.push(meter(`Today vs. cap (${usd(cp.cap)})`, usd(cp.todayP), cp.cap ? Math.max(0, cp.todayP) / cp.cap : 0, cp.todayP >= cp.cap ? 'bad' : cp.todayP >= cp.cap * .8 ? 'warn' : ''));
      } else {
        rows.push(`<div class="kv"><span>Most you can make in one day</span><b>${usd(cp.cap)}</b></div>`);
      }
      if (cp.ok && cp.left <= 0) rows.push(`<div class="plan-ok">✓ Target reached and within the ${pc(cp.C)} consistency rule.</div>`);
      else {
        rows.push(`<div class="kv"><span>Fastest possible</span><b>${cp.fastest} day${cp.fastest === 1 ? '' : 's'} <span class="hint">(right at the ${usd(cp.dayMax)} cap)</span></b></div>`);
        if (cp.tooFew || cp.over) rows.push(`<div class="plan-warn">${cp.n} day${cp.n === 1 ? ' isn\'t' : 's aren\'t'} enough to stay under ${usd(cp.dayMax)} a day. The goals below would break the ${pc(cp.C)} rule. Plan at least ${Math.max(cp.fastest, 1)} day${cp.fastest === 1 ? '' : 's'}.</div>`);
        const list = cp.plan.slice(0, 20).map(d => `<tr><td>${d.label}</td><td>${usd(d.goal)}</td><td>${usd(d.total)}</td></tr>`);
        rows.push(`<div class="kv"><span>Your plan</span><b>${cp.n} day${cp.n === 1 ? '' : 's'}${cp.n > 1 ? `, about ${usd(cp.per)} a day` : ''}</b></div>`);
        rows.push(`<table class="plan"><tr><th></th><th>Goal</th><th>Total profit</th></tr>${list.join('')}${cp.n > 20 ? `<tr><td colspan="3" class="hint">…and ${cp.n - 20} more days</td></tr>` : ''}</table>`);
        rows.push(`<div class="hint">Stop around your goal each day. A day over ${usd(cp.dayMax)} raises the profit you need. Goals keep a 10% cushion under the cap, since some firms count a day right at the limit as a break.</div>`);
      }
      box.innerHTML = rows.join('');
    }
    function meter(label, value, frac, cls) {
      const pct = Math.max(0, Math.min(100, Math.round((frac || 0) * 100)));
      return `<div class="meter"><div class="lab"><span>${label}</span><b>${value}</b></div><div class="bar"><i class="${cls || ''}" style="width:${pct}%"></i></div></div>`;
    }
    function renderRiskPages() {
      const r = S.risk, hide = S.extras.streamer, m = v => hide ? '•••••' : money(v);
      // limits
      const L = lockedNow();
      $('#kStatus').innerHTML = !r.lockOn ? 'Lockout is off.'
        : `<b>Today:</b> ${m(day.pnl)} · ${day.trades} trade${day.trades === 1 ? '' : 's'}${L ? ' · <b style="color:var(--bad)">Locked</b>' : unlockedToday() ? ' · Unlocked early' : ''}${S.rec.on ? '' : ' · <b>Turn on Journal → Record my trades</b> (the lockout counts your trades from it)'}`;
      $('#kLockCard').hidden = !L;
      const fz = rulesFrozen();
      for (const id of FROZEN) { const el = $(id); if (el.disabled !== fz) el.disabled = fz; }
      $('#kFrozen').hidden = !fz;
      if (L) $('#kLockReason').textContent = hideMoney('🔒 ' + L.lockReason);
      // prop
      const pl = $('#pLive');
      if (!S.prop.on) pl.innerHTML = '<span class="hint">Switch on <b>Track a prop account</b> to see your numbers here.</span>';
      else {
        const ps = propState(acctValues());
        if (ps.eq === null) pl.innerHTML = '<span class="hint">Connect your prop account in TradingView (Trade panel) to track it.</span>';
        else {
          const left = ps.ddLeftPct ?? 0;
          pl.innerHTML = [
            meter('Equity', m(ps.eq).replace(/^\+/, ''), 1, ''),
            meter(`Room before max loss limit (${m(ps.floor).replace(/^\+/, '')})`, m(ps.toFloor), left, left < 0.1 ? 'bad' : left < 0.25 ? 'warn' : ''),
            ps.target ? meter(`Profit toward target (${m(ps.target)})`, m(ps.profit), ps.profit / ps.target, ps.profit >= ps.target ? '' : 'warn') : '',
            ps.daily ? meter(`Daily loss used (limit ${m(-ps.daily)})`, m(-ps.dailyUsed), ps.dailyUsed / ps.daily, ps.dailyUsed >= ps.daily ? 'bad' : ps.dailyUsed >= ps.daily * .8 ? 'warn' : '') : '',
            ps.maxQty ? meter('Contracts open', `${ps.qty} / ${ps.maxQty}`, ps.qty / ps.maxQty, ps.qty > ps.maxQty ? 'bad' : '') : ''
          ].join('');
        }
      }
      renderConsPlan();
      renderNews();
      const rb = root.querySelector('[data-badge="risk"]');
      rb.hidden = !L; rb.textContent = 'locked';
    }
    async function renderSize() {
      const out = $('#zOut'), tab = $('#zTable');
      const c = await calcSize();
      tab.querySelectorAll('.ztab, .empty').forEach(e => e.remove());
      tab.style.display = 'none';
      if (!c.spec.value) { out.innerHTML = `<span class="hint">${c.sym ? `Couldn't find contract values for ${String(c.sym).split(':').pop()}. Pick a symbol under Options.` : 'Open a chart, or pick a symbol under Options.'}</span>`; return; }
      if (c.needsEquity) { out.innerHTML = '<span class="hint">"% of account" needs your account connected in TradingView. Or switch to Dollars under Options.</span>'; return; }
      if (!c.riskUsd) { out.innerHTML = '<span class="hint">Type how much you want to risk above.</span>'; return; }
      if (S.risk.sizeView !== 'classic' && S.risk.simpleManual && !(+S.risk.simplePts > 0)) { out.innerHTML = '<span class="hint">Type your stop in points above, or switch the stop back to Auto.</span>'; return; }
      if (!c.stopTicks) { out.innerHTML = '<span class="hint">Set your stop under Options, or switch the stop back to Automatic.</span>'; return; }
      const hide = S.extras.streamer;
      const usd = v => hide ? '•••••' : '$' + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      if (S.risk.sizeView === 'classic') {
        const alt = c.qty === 0 && c.other && c.otherQty >= 1 ? c.other : null;
        out.innerHTML = `<div class="n">${c.qty} <small>${c.spec.root} contract${c.qty === 1 ? '' : 's'}</small></div>
          <div>Risk per contract <b>$${c.perContract.toFixed(2)}</b> · total <b>$${c.actual.toFixed(2)}</b> of ${hide ? '•••••' : '$' + c.riskUsd.toFixed(2)}</div>
          ${alt ? `<div class="hint">Too big for 1 ${c.spec.root}. That's <b>${c.otherQty} ${alt.root}</b> instead ($${(c.stopTicks * alt.value).toFixed(2)} each).</div>` : ''}
          <div class="hint">${c.stopTicks} ticks stop · 1 tick = ${c.spec.tick} = $${(+c.spec.value).toFixed(2)} per contract (${c.spec.from === 'broker' ? 'from your broker' : 'standard contract specs'})</div>`;
        return;
      }
      const pts = c.stopTicks * c.spec.tick;
      const fmtPts = v => (+v.toFixed(6)).toLocaleString(undefined, { maximumFractionDigits: 4 });
      const stopTxt = c.stopSource === 'auto' ? `a typical stop of about <b>${c.stopTicks} ticks</b> (${fmtPts(pts)} points)`
        : `your stop of <b>${c.stopTicks} ticks</b> (${fmtPts(pts)} points)`;
      let main;
      if (c.qty >= 1) main = `<div class="n">≈ ${c.qty} <small>${c.spec.root}</small></div>`;
      else if (c.other && c.otherQty >= 1) main = `<div class="n">≈ ${c.otherQty} <small>${c.other.root}</small></div><div class="hint">Less than 1 ${c.spec.root}, so use the ${c.other.root} instead.</div>`;
      else main = `<div class="n">0 <small>${c.spec.root}</small></div><div class="hint">Even 1 contract risks more than ${usd(c.riskUsd)} with this stop.</div>`;
      const otherLine = c.qty >= 1 && c.other && c.otherQty ? `<div class="hint">or about <b>${c.otherQty} ${c.other.root}</b></div>` : '';
      out.innerHTML = `${main}${otherLine}
        <div>with ${stopTxt}, risking about ${usd(c.qty >= 1 ? c.actual : c.other && c.otherQty >= 1 ? c.otherQty * c.stopTicks * c.other.value : c.riskUsd)}</div>
        <div class="hint">${c.stopSource === 'auto' ? `Typical stop = ${S.risk.sizeAtr || 1} average candle${(+S.risk.sizeAtr || 1) === 1 ? '' : 's'} on your chart's current timeframe. ` : c.stopSource === 'fallback' ? 'No chart data for this symbol, so it uses your stop from Options. ' : ''}1 tick = ${c.spec.tick} = $${(+c.spec.value).toFixed(2)} per ${c.spec.root} (${c.spec.from === 'broker' ? 'from your broker' : 'standard contract specs'}).</div>`;
      if (c.rows.length) {
        tab.style.display = '';
        const head = document.createElement('div');
        head.className = 'ztab head';
        head.innerHTML = `<span>Stop</span><span>${c.spec.root}</span><span>${c.other ? c.other.root : ''}</span>`;
        tab.appendChild(head);
        for (const row of c.rows) {
          const d = document.createElement('div');
          d.className = 'ztab' + (row.main ? ' main' : '');
          d.innerHTML = `<span>${row.ticks} ticks · ${fmtPts(row.points)} pts</span><span>${row.qty}</span><span>${row.otherQty ?? ''}</span>`;
          tab.appendChild(d);
        }
      }
    }
    function renderNews() {
      const box = $('#nList');
      box.querySelectorAll('.nrow, .nday, .empty').forEach(e => e.remove());
      const list = newsList().filter(e => e.time > Date.now() - 60 * 60000).slice(0, 30);
      if (!list.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = S.news.on ? (newsFetchedAt ? 'No events coming up.' : 'Loading…') : 'News warnings are off.'; box.appendChild(e); return; }
      let lastDay = '';
      for (const ev of list) {
        const d = new Date(ev.time);
        const dayLbl = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
        if (dayLbl !== lastDay) { const h = document.createElement('div'); h.className = 'nday'; h.textContent = dayLbl; box.appendChild(h); lastDay = dayLbl; }
        const row = document.createElement('div');
        const dt = ev.time - Date.now();
        row.className = 'nrow' + (dt > -2 * 60000 && dt < 15 * 60000 ? ' soon' : '');
        const fx = [ev.actual !== null && ev.actual !== undefined ? `Actual ${ev.actual}` : '', ev.forecast !== null && ev.forecast !== undefined ? `Fcst ${ev.forecast}` : '', ev.previous !== null && ev.previous !== undefined ? `Prev ${ev.previous}` : ''].filter(Boolean).join(' · ');
        row.innerHTML = `<span>${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}</span>
          <span><span class="imp ${ev.imp >= 1 ? 'hi' : ''}"></span>${String(ev.title).replace(/[<>&]/g, '')}<br><small>${fx}</small></span>
          <small>${dt > 0 ? 'in ' + fmtCountdown(dt) : 'out'}</small>`;
        box.appendChild(row);
      }
    }
    buildUI.onRisk = () => { if (panel.classList.contains('open')) { renderRiskPages(); const cur = root.querySelector('section.on'); if (cur && cur.dataset.tab === 'size') renderSize(); } };

    /* ---- journal ---- */
    const money = (v, cur) => (v > 0 ? '+' : v < 0 ? '\u2212' : '') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (cur || 'USD');
    const fmtPx = v => { const n = +v, a = Math.abs(n); return n.toLocaleString(undefined, { maximumFractionDigits: a >= 100 ? 2 : a >= 1 ? 4 : 6 }); };
    const fmtDur = ms => { const sec = Math.max(0, Math.round(ms / 1000)); return sec < 60 ? sec + 's' : sec < 3600 ? Math.floor(sec / 60) + 'm ' + (sec % 60) + 's' : Math.floor(sec / 3600) + 'h ' + Math.floor(sec % 3600 / 60) + 'm'; };
    const shortSym = sym => String(sym).split(':').pop();
    /* ---- Journal Home: stats, calendar, P&L chart, share card ---- */
    S.ui.hUnit = S.ui.hUnit || 'usd'; S.ui.hRange = S.ui.hRange || 'month';
    var hMonth = null;                         // first trading day number of the month shown
    const dayDate = d => new Date(d * DAY);    // trading day number -> its calendar date (UTC fields)
    let homeBase = 50000;
    const tradeVal = (t, unit) => {
      if (unit === 'pct') return t.net == null ? null : t.net / homeBase * 100;
      if (unit === 'r') { const risk = +t.risk > 0 ? +t.risk : +S.ui.hRisk || 100; return t.net == null ? null : t.net / risk; }
      if (unit === 'ticks') return t.ticks == null ? null : t.ticks * (t.qty || 1);
      if (unit === 'points') return t.entry != null && t.exit != null ? (t.exit - t.entry) * t.dir * (t.qty || 1) : null;
      return t.net == null ? null : t.net;
    };
    function fmtVal(v, unit, opts = {}) {
      if (v == null || !isFinite(v)) return '—';
      if (unit === 'usd' && S.extras.streamer) return '•••';
      const sign = v > 0 ? '+' : v < 0 ? '−' : '';
      const a = Math.abs(v);
      if (unit === 'usd') return sign + '$' + a.toLocaleString(undefined, { maximumFractionDigits: opts.cents ? 2 : 0 });
      if (unit === 'pct') return sign + a.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: a < 10 ? 2 : 1 }) + '%';
      if (unit === 'r') return sign + a.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 1 }) + 'R';
      if (unit === 'points') return sign + a.toLocaleString(undefined, { maximumFractionDigits: 2 }) + (opts.short ? '' : ' pts');
      return sign + Math.round(a).toLocaleString() + (opts.short ? '' : ' ticks');
    }
    function homeData(trades, unit, range) {
      const today = tradingDay(Date.now());
      const days = new Map();                  // day -> { v, n, w }
      for (const t of trades) {
        const v = tradeVal(t, unit); if (v == null) continue;
        const d = tradingDay(t.closeTime), e = days.get(d) || { v: 0, n: 0, w: 0 };
        e.v += v; e.n++; if (v > 0) e.w++; days.set(d, e);
      }
      const m0 = hMonth, d0 = dayDate(m0), m1 = Math.floor(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1) / DAY);
      const inRange = d => range === 'all' || (d >= m0 && d < m1);
      const list = trades.filter(t => tradeVal(t, unit) != null && inRange(tradingDay(t.closeTime)));
      const vals = list.map(t => tradeVal(t, unit));
      const wins = vals.filter(v => v > 0), losses = vals.filter(v => v < 0);
      const gw = wins.reduce((a, b) => a + b, 0), gl = -losses.reduce((a, b) => a + b, 0);
      const dayList = [...days.entries()].filter(([d]) => inRange(d)).sort((a, b) => a[0] - b[0]);
      // streaks (trades in time order, days in order)
      const streak = arr => { let cur = 0, best = 0; for (const x of arr) { cur = x > 0 ? cur + 1 : 0; best = Math.max(best, cur); } return { cur, best }; };
      const tStreak = streak(list.slice().sort((a, b) => a.closeTime - b.closeTime).map(t => tradeVal(t, unit)));
      const dStreak = streak(dayList.map(([, e]) => e.v));
      return { today, days, m0, m1, net: vals.reduce((a, b) => a + b, 0), n: vals.length, w: wins.length, l: losses.length,
        pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : null), avgW: wins.length ? gw / wins.length : null, avgL: losses.length ? -gl / losses.length : null,
        dayList, dW: dayList.filter(([, e]) => e.v > 0).length, tStreak, dStreak };
    }
    async function renderHome() {
      let trades = [];
      try { trades = (await DB.tradesAll()) || []; } catch (e) {}
      const unit = S.ui.hUnit || 'usd', range = S.ui.hRange || 'month';
      // % is of your prop starting balance if the prop tracker is on, else your account balance
      const av = acctValues();
      homeBase = S.prop.on && +S.prop.start > 0 ? +S.prop.start : (av && (+av.balance || +av.equity)) || +S.ui.hBase || 50000;
      const note = $('#hUnitNote');
      if (unit === 'pct') { note.hidden = false; note.innerHTML = `% of ${S.extras.streamer ? '•••' : '$' + Math.round(homeBase).toLocaleString()} (${S.prop.on && +S.prop.start > 0 ? 'prop starting balance' : av ? 'your account balance' : 'default'}).`; }
      else if (unit === 'r' && root.activeElement && root.activeElement.id === 'hRisk') { /* typing: leave it */ }
      else if (unit === 'r') {
        const withStop = trades.filter(t => +t.risk > 0).length;
        note.hidden = false;
        note.innerHTML = `1R = the risk to your stop at entry (${withStop} of ${trades.length} trades had one). Trades without a stop use <input type="text" inputmode="decimal" id="hRisk" style="width:70px"> $ as 1R.`;
        const ri = $('#hRisk'); ri.value = S.ui.hRisk || 100;
        ri.onchange = () => { const v = parseFloat(String(ri.value).replace(/[^\d.]/g, '')); if (v > 0) { S.ui.hRisk = v; save(null); renderHome(); } };
      } else note.hidden = true;
      if (hMonth == null) { const d = dayDate(tradingDay(Date.now())); hMonth = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY); }
      root.querySelectorAll('#hUnit button').forEach(b => b.classList.toggle('on', b.dataset.v === unit));
      root.querySelectorAll('#hRange button').forEach(b => b.classList.toggle('on', b.dataset.v === range));
      const D = homeData(trades, unit, range);
      const cls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : '';
      const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
      const tile = (label, value, sub, c = '') => `<div class="h-stat"><span>${label}</span><b class="${c}${String(value).length > 9 ? ' sm' : ''}">${value}</b><small>${sub}</small></div>`;
      $('#hStats').innerHTML = [
        tile('Net P&amp;L', fmtVal(D.net, unit), `${D.n} trade${D.n === 1 ? '' : 's'} · ${D.w} won · ${D.l} lost`, cls(D.net)),
        tile('Profit factor', D.pf == null ? '—' : D.pf === Infinity ? '∞' : D.pf.toFixed(2), 'Won ÷ lost'),
        tile('Winning trades', pct(D.w, D.n), `${D.w} of ${D.n}`),
        tile('Winning days', pct(D.dW, D.dayList.length), `${D.dW} of ${D.dayList.length} day${D.dayList.length === 1 ? '' : 's'}`),
        tile('Avg win / loss', D.avgW == null && D.avgL == null ? '—' : `${fmtVal(D.avgW, unit, { short: true })} / ${fmtVal(D.avgL, unit, { short: true })}`, D.avgW && D.avgL ? `Ratio ${(D.avgW / -D.avgL).toFixed(2)}` : '')
      ].join('');
      $('#hStreak').textContent = D.n ? `Trades: ${D.tStreak.cur} win${D.tStreak.cur === 1 ? '' : 's'} in a row · best ${D.tStreak.best}   ·   Days: ${D.dStreak.cur} in a row · best ${D.dStreak.best}` : '';
      // today
      const te = D.days.get(D.today) || { v: 0, n: 0, w: 0 };
      const tdd = dayDate(D.today);
      $('#hToday').innerHTML = `<span>Today · ${tdd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span><b class="${cls(te.v)}">${te.n ? fmtVal(te.v, unit) : '—'}</b><span>${te.n ? `${te.n} trade${te.n === 1 ? '' : 's'} · ${te.w} won` : 'No trades yet'}</span>`;
      // calendar (Mon-Fri + week total)
      const d0 = dayDate(D.m0);
      $('#hMonth').textContent = d0.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Week'].map(h => `<div class="hd">${h}</div>`);
      let wd = (d0.getUTCDay() + 6) % 7;                         // 0 = Monday
      let day = D.m0 - Math.min(wd, 5);
      if (wd >= 5) day = D.m0 + (7 - wd);                        // month starts on a weekend
      while (day < D.m1) {
        let wk = 0, wn = 0;
        for (let i = 0; i < 5; i++, day++) {
          const dt = dayDate(day), inMonth = day >= D.m0 && day < D.m1, e = D.days.get(day);
          if (e && inMonth) { wk += e.v; wn += e.n; }
          cells.push(!inMonth ? '<div class="h-day blank"></div>' :
            `<div class="h-day${e ? (e.v > 0 ? ' win' : e.v < 0 ? ' loss' : '') : ''}${day === D.today ? ' today' : ''}"><span>${dt.getUTCDate()}</span>${e ? `<b>${fmtVal(e.v, unit, { short: true })}</b><span>${e.n} trade${e.n === 1 ? '' : 's'}</span>` : ''}</div>`);
        }
        day += 2;                                                // skip the weekend
        cells.push(`<div class="h-wk">${wn ? `<b class="${cls(wk)}">${fmtVal(wk, unit, { short: true })}</b><span>${wn} trade${wn === 1 ? '' : 's'}</span>` : ''}</div>`);
      }
      $('#hGrid').innerHTML = cells.join('');
      // chart: daily bars + running total
      const dl = D.dayList, W = 640, H = 170, pad = 22;
      if (!dl.length) $('#hChart').innerHTML = '<div class="hint" style="padding:30px 0;text-align:center">No trades in this range yet.</div>';
      else {
        let run = 0; const pts = dl.map(([d, e]) => ({ d, v: e.v, r: (run += e.v) }));
        const lo = Math.min(0, ...pts.map(p => Math.min(p.v, p.r))), hi = Math.max(0, ...pts.map(p => Math.max(p.v, p.r)));
        const y = v => pad / 2 + (hi - v) / ((hi - lo) || 1) * (H - pad * 1.5);
        const step = (W - 20) / pts.length, bw = Math.max(3, Math.min(26, step * .55));
        const x = i => 10 + step * (i + .5);
        const bars = pts.map((p, i) => `<rect x="${x(i) - bw / 2}" y="${Math.min(y(p.v), y(0))}" width="${bw}" height="${Math.max(1, Math.abs(y(p.v) - y(0)))}" rx="2" fill="${p.v >= 0 ? 'var(--good)' : 'var(--bad)'}" opacity=".55"><title>${dayDate(p.d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}: ${fmtVal(p.v, unit)}</title></rect>`).join('');
        const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join('');
        const lab = (i) => `<text x="${x(i)}" y="${H - 4}" font-size="10" text-anchor="middle" fill="var(--muted)">${dayDate(pts[i].d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}</text>`;
        const every = Math.max(1, Math.ceil(pts.length / 8));
        $('#hChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line2)" stroke-dasharray="3 4"/>${bars}<path d="${line}" fill="none" stroke="var(--accent2)" stroke-width="2.2" vector-effect="non-scaling-stroke"/>${pts.map((p, i) => i % every === 0 || i === pts.length - 1 ? lab(i) : '').join('')}</svg>`;
      }
      $('#hEmpty').hidden = trades.length > 0;
      homeLast = { D, unit, range, trades };
    }
    var homeLast = null;
    root.querySelectorAll('#hUnit button').forEach(b => b.onclick = () => { S.ui.hUnit = b.dataset.v; save(null); renderHome(); });
    root.querySelectorAll('#hRange button').forEach(b => b.onclick = () => { S.ui.hRange = b.dataset.v; save(null); renderHome(); });
    const shiftMonth = k => { const d = dayDate(hMonth); hMonth = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1) / DAY); renderHome(); };
    $('#hPrev').onclick = () => shiftMonth(-1);
    $('#hNext').onclick = () => shiftMonth(1);
    setInterval(() => { if (panel.classList.contains('open') && S.ui.tab === 'home') renderHome(); }, 5000);
    // Share card: a PNG of today's (or this month's) result you can post. Streamer mode leaves the $ amount out.
    buildUI.shareCard = () => $('#hShare').click();
    $('#hShare').onclick = async () => {
      if (!homeLast) await renderHome();
      const { D, unit } = homeLast;
      const te = D.days.get(D.today);
      const useToday = !!(te && te.n);
      const v = useToday ? te.v : D.net, n = useToday ? te.n : D.n, w = useToday ? te.w : D.w;
      const title = useToday ? 'Today · ' + dayDate(D.today).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
        : dayDate(D.m0).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 630;
      const g = cv.getContext('2d');
      const bg = g.createLinearGradient(0, 0, 1200, 630); bg.addColorStop(0, '#12141c'); bg.addColorStop(1, '#1d2040');
      g.fillStyle = bg; g.fillRect(0, 0, 1200, 630);
      if (backdropUrl) { try { const im = new Image(); im.src = backdropUrl; await im.decode(); const k = Math.max(1200 / im.width, 630 / im.height); g.globalAlpha = .28; g.drawImage(im, (1200 - im.width * k) / 2, (630 - im.height * k) / 2, im.width * k, im.height * k); g.globalAlpha = 1; } catch (e) {} }
      const glow = g.createRadialGradient(950, 120, 0, 950, 120, 520); glow.addColorStop(0, v >= 0 ? 'rgba(34,195,154,.35)' : 'rgba(242,73,92,.35)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = glow; g.fillRect(0, 0, 1200, 630);
      g.fillStyle = '#e8eaf0'; g.font = '700 34px Inter, system-ui, sans-serif'; g.fillText('Wick', 70, 95);
      g.fillStyle = '#9aa1b2'; g.font = '500 30px Inter, system-ui, sans-serif'; g.fillText(title, 70, 200);
      const big = unit === 'usd' && S.extras.streamer ? `${n} trade${n === 1 ? '' : 's'}` : fmtVal(v, unit);
      g.fillStyle = unit === 'usd' && S.extras.streamer ? '#e8eaf0' : v >= 0 ? '#22c39a' : '#f2495c'; g.font = '800 132px Inter, system-ui, sans-serif'; g.fillText(big, 64, 345);
      g.fillStyle = '#c9ccd6'; g.font = '500 32px Inter, system-ui, sans-serif';
      g.fillText(`${n} trade${n === 1 ? '' : 's'}  ·  ${w} won  ·  ${n ? Math.round(w / n * 100) : 0}% win rate`, 70, 425);
      // mini running total
      let run = 0; const pts = D.dayList.map(([, e]) => (run += e.v));
      if (pts.length > 1) {
        const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), X = i => 70 + i * (1060 / (pts.length - 1)), Y = p => 560 - (p - lo) / ((hi - lo) || 1) * 80;
        g.strokeStyle = '#7f8cff'; g.lineWidth = 4; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(i), Y(p)) : g.moveTo(X(i), Y(p))); g.stroke();
      }
      g.fillStyle = '#6b7286'; g.font = '500 22px Inter, system-ui, sans-serif'; g.fillText('Recorded automatically · Wick for TradingView', 70, 605);
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      let copied = false;
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); copied = true; } catch (e) {}
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `wick-pnl-${new Date().toISOString().slice(0, 10)}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      $('#hShare').textContent = copied ? 'Copied + saved ✓' : 'Saved ✓';
      setTimeout(() => { $('#hShare').textContent = 'Share P&L'; }, 2500);
    };

    let journalCache = [];
    async function renderJournal() {
      $('#rOn').checked = !!S.rec.on;
      $('#rVideo').checked = !!S.rec.video;
      $('#rQuality').value = S.rec.quality || '720';
      renderQualHint();
      $('#rKeep').value = String(S.rec.keep || 25);
      let trades = [];
      try { trades = (await DB.tradesAll()) || []; } catch (e) {}
      trades.sort((a, b) => b.closeTime - a.closeTime);
      journalCache = trades;
      const hide = S.extras.streamer;
      const today = tradingDay(Date.now());
      const td = trades.filter(t => tradingDay(t.closeTime) === today);
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
        del.onclick = async () => { await DB.tradeDel(t.id); if (t.videoId) await DB.videoDel(t.videoId); journalDirty = true; renderJournal(); };
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
      $('#rPDown').download = `trade-${shortSym(t.symbol)}-${new Date(t.openTime).toISOString().replace(/[:.]/g, '-')}.${videoExt(v.mime || v.blob.type)}`;
      $('#rPlayer').hidden = false;
    }
    $('#rPClose').onclick = () => { $('#rPlayer').hidden = true; $('#rVideoEl').pause(); };
    $('#rOn').onchange = e => {
      if (!e.target.checked && S.risk.lockOn) { e.target.checked = true; $('#fMsg').textContent = 'The daily lockout counts your trades from the journal, so recording stays on. Turn off Limits → Daily lockout first (not possible while locked).'; return; }
      S.rec.on = e.target.checked; if (S.rec.on) recStartFresh(); save('journal'); renderJournal();
    };
    $('#rVideo').onchange = e => { S.rec.video = e.target.checked; save('journal'); renderJournal(); };
    $('#rQuality').onchange = e => { S.rec.quality = e.target.value; save('journal'); renderQualHint(); };
    function renderQualHint() {
      const c = chartPixels(), { W, H } = recSize(), mb = recBitrate(W, H) * 60 / 8 / 1e6;
      const up = c && String(S.rec.quality) !== 'native' && H > c.h * 1.05;
      $('#rQualHint').textContent = `${W}×${H}, up to about ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB per minute.` +
        (c ? ` Your chart is ${c.w}×${c.h} pixels right now${up ? ', so this is upscaled: bigger files, not sharper. Native gives the sharpest video your screen can.' : '.'}` : '') +
        '';
      // ask the browser whether this size can be encoded on the graphics card
      const mc = navigator.mediaCapabilities, tok = (renderQualHint.tok = (renderQualHint.tok || 0) + 1);
      if (H < 1440 || !mc || typeof mc.encodingInfo !== 'function') return;
      const ct = ['video/mp4;codecs=avc1.640033', 'video/mp4'].find(m => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } });
      if (!ct) { $('#rQualHint').textContent += ' This browser can\'t record MP4, so this size runs on your CPU and may stutter.'; return; }
      mc.encodingInfo({ type: 'record', video: { contentType: ct, width: W, height: H, bitrate: recBitrate(W, H), framerate: 30 } }).then(info => {
        if (tok !== renderQualHint.tok) return;
        $('#rQualHint').textContent += info && info.supported && info.powerEfficient ? ' Recorded on your graphics card (MP4), so it barely uses your CPU.'
          : info && info.supported ? ' Your graphics card can\'t take this size, so it runs on your CPU and may stutter. Try 1080p or Native.'
          : ' This size isn\'t supported here. Try 1080p or Native.';
      }).catch(() => {});
    }
    $('#rKeep').onchange = e => { S.rec.keep = +e.target.value; save('journal'); videoCleanup().then(renderJournal); };
    $('#rCsv').onclick = () => {
      const url = URL.createObjectURL(new Blob([tradesToCsv(journalCache)], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url; a.download = `trade-journal-${new Date().toISOString().slice(0, 10)}.csv`;
      root.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    function renderFolder() {
      $('#fOn').checked = !!S.rec.folderOn;
      const name = S.rec.folderName ? `“${S.rec.folderName}”` : 'a folder';
      const st = folder.status;
      $('#fStatus').textContent = !folderSupported() ? "This app can't save into folders. Use Download / Export CSV instead."
        : !S.rec.folderOn ? 'Off. Trades and videos stay inside the app.'
        : st === 'needs' ? `Saving to ${name} paused: allow access again (the browser asks after a restart).`
        : st === 'none' ? 'Choose a folder to start saving.'
        : st === 'error' ? `Couldn't save to ${name}: ${folder.error}`
        : st === 'ok' ? `Saving to ${name} · ${folder.count} video${folder.count === 1 ? '' : 's'} · last saved ${new Date(folder.last).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : `Saving to ${name}…`;
      $('#fPick').hidden = !folderSupported();
      $('#fPick').textContent = S.rec.folderName ? 'Change folder…' : 'Choose folder…';
      $('#fReconnect').hidden = st !== 'needs';
      $('#fRestore').hidden = !folderSupported() || !S.rec.folderName;
      const mb = storageInfo.used / 1048576;
      $('#fStore').textContent = `In the app: ${mb < 1 ? '<1' : Math.round(mb)} MB${storageInfo.persisted ? ' · protected from cleanup' : ''}`;
    }
    buildUI.onFolder = () => { if (panel.classList.contains('open')) renderFolder(); };
    $('#fPick').onclick = async () => {
      $('#fMsg').textContent = '';
      try { await chooseFolder(); } catch (e) { if (e && e.name !== 'AbortError') $('#fMsg').textContent = e.message || String(e); }
      renderFolder();
    };
    $('#fReconnect').onclick = () => folderSync(true).then(renderFolder);
    $('#fOn').onchange = async e => {
      S.rec.folderOn = e.target.checked; save('journal');
      if (S.rec.folderOn && !(await folderHandle())) { try { await chooseFolder(); } catch (err) { S.rec.folderOn = !!(await folderHandle()); save('journal'); } }
      else folderSync(true);
      renderFolder();
    };
    $('#fRestore').onclick = async () => {
      $('#fMsg').textContent = '';
      try { const n = await restoreFromFolder(); journalDirty = true; $('#fMsg').textContent = n ? `Restored ${n} trade${n === 1 ? '' : 's'}.` : 'Nothing to restore: every trade in the backup is already here.'; renderJournal(); }
      catch (err) { $('#fMsg').textContent = err && err.name === 'NotFoundError' ? 'No journal-backup.json in that folder yet.' : (err.message || String(err)); }
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
      try {
        const today = tradingDay(Date.now()), st = riskLoad();
        const prev = st.carry && st.carry.day === today ? st.carry.items || [] : [];
        const ids = new Set(prev.map(x => x.id));
        const add = ((await DB.tradesAll()) || []).filter(t => tradingDay(t.closeTime) === today && !ids.has(t.id)).map(t => ({ id: t.id, net: t.net || 0 }));
        st.carry = { day: today, items: prev.concat(add) }; riskSave(st);
      } catch (e) {}
      await DB.tradesClear(); await DB.videosClear(); journalDirty = true;
      renderJournal();
    };
    buildUI.onJournal = () => { if (panel.classList.contains('open')) renderJournal(); };

    $('#xAds').onchange = e => { S.extras.hideAds = e.target.checked; save('extras'); applyAds(); };
    const setBtn = (key, v) => { S.extras[key] = v; save('extras'); applyButtonColors(); renderBtnColors(); };
    $('#gBuy').oninput = e => setBtn('buyColor', e.target.value);
    $('#gSell').oninput = e => setBtn('sellColor', e.target.value);
    $('#gBuyReset').onclick = () => setBtn('buyColor', '');
    $('#gSellReset').onclick = () => setBtn('sellColor', '');
    function renderBtnColors() {
      $('#gBuy').value = S.extras.buyColor || '#2962ff'; $('#gBuyLbl').textContent = S.extras.buyColor ? '' : "TradingView's own";
      $('#gSell').value = S.extras.sellColor || '#f23645'; $('#gSellLbl').textContent = S.extras.sellColor ? '' : "TradingView's own";
      $('#gBuyReset').hidden = !S.extras.buyColor; $('#gSellReset').hidden = !S.extras.sellColor;
    }
    $('#gEod').onchange = e => {
      S.extras.eod = e.target.value; save('extras');
      try { if (e.target.value !== 'off' && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (er) {}
    };
    $('#gEodClose').onchange = e => { S.extras.eodClose = e.target.value; save('extras'); };
    $('#gFast').onchange = e => { S.extras.fastMs = +e.target.value; save('extras'); fastTick().then(renderFast); };
    function renderFast() {
      const st = $('#gFast') && $('#gFastSt'); if (!st) return;
      const f = fastInfo, ms = f.ms ? `checking every ${f.ms} ms` : '';
      const txt = { off: 'Off · TradingView checks about once a second', nobroker: 'Waiting for your broker in TradingView', unsupported: 'Not available for this broker (works with Tradovate)',
        live: 'Paused · this is a live account (demo and prop only)', backoff: 'Slowed down for a minute · Tradovate answered with errors',
        idle: 'On · normal speed while you\'re flat', fast: 'On · fast' }[f.state] || 'Off';
      $('#gFastSt').textContent = txt + (ms && f.state !== 'off' ? ` · ${ms}` : '');
      $('#gFastSt').className = 'oco-st ' + (f.state === 'fast' || f.state === 'idle' ? 'ok' : f.state === 'off' ? '' : 'warn');
    }
    setInterval(() => { if (panel.classList.contains('open') && S.ui.tab === 'extras') { if (!S.extras.fastMs) fastTick(); renderFast(); } }, 1000);
    $('#gGlass').onchange = e => { S.ui.glass = e.target.checked; save(null); buildUI.applyBackdrop(); };
    $('#gDim').oninput = e => { S.ui.glassDim = +e.target.value; $('#gDimVal').textContent = e.target.value + '%'; buildUI.applyBackdrop(); };
    $('#gDim').onchange = () => save(null);
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
      $('#gFast').value = String(S.extras.fastMs || 0); renderFast();
      renderBtnColors(); $('#gEod').value = S.extras.eod || 'traded'; $('#gEodClose').value = S.extras.eodClose || '17:00';
      $('#gGlass').checked = S.ui.glass !== false; $('#gDim').value = S.ui.glassDim || 62; $('#gDimVal').textContent = (S.ui.glassDim || 62) + '%';
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
      $('#connText').textContent = connected ? (name || 'Broker') + ' · connected' : 'No broker connected';
      $('#connText').title = $('#connText').textContent;
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

    function renderAllUI() { renderOff(); renderQuick(); renderStatus(); applyTheme(); renderWallUI(); renderCandleUI(); renderSoundUI(); renderIndUI(); renderJournal(); renderFolder(); protectStorage().then(renderFolder); renderRiskInputs(); renderRiskPages(); renderSize(); $('#xAds').checked = !!S.extras.hideAds; renderStreamUI(); showTab(S.ui.tab || 'wall'); }
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
      if (t === 'extras') { applyAds(); applyStreamer(); brkKick(); applyButtonColors(); }
      if (t === 'alloff') applyAllOff();
      if (t === 'journal' && buildUI.onJournal) buildUI.onJournal();
      if (t === 'risk') applyLock();
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
