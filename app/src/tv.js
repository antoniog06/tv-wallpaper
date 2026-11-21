// The TradingView desktop app: find it, open it with a local debug connection, and load Wick into its chart windows.
'use strict';
const { execFile } = require('child_process');
const WebSocket = require('ws');

const DEBUG_PORT = 9222;
const PAGE_RE = process.env.WICK_TV_PAGE_RE ? new RegExp(process.env.WICK_TV_PAGE_RE) : /^https:\/\/([a-z0-9-]+\.)*tradingview\.com\//i;
const run = (cmd, args) => new Promise(res => execFile(cmd, args, { windowsHide: true, timeout: 15000 }, (err, out) => res(err ? '' : String(out))));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(path) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2000);
  try { const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}${path}`, { signal: ctl.signal }); return r.ok ? await r.json() : null; }
  catch (e) { return null; } finally { clearTimeout(t); }
}

// One request over the page's debug connection.
function cdp(wsUrl, method, params) {
  return new Promise(resolve => {
    let done = false; const finish = v => { if (done) return; done = true; try { ws.close(); } catch (e) {} resolve(v); };
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
    const timer = setTimeout(() => finish(null), 15000);
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method, params })));
    ws.on('message', d => { try { const m = JSON.parse(String(d)); if (m.id === 1) { clearTimeout(timer); finish(m.result || { error: m.error }); } } catch (e) {} });
    ws.on('error', () => { clearTimeout(timer); finish(null); });
  });
}

// The link to one TradingView window, over its debug connection. Looks like a WebSocket to the server.
// (TradingView pages may not be allowed to open connections to this PC themselves.)
const { EventEmitter } = require('events');
function openLink(target, onReady, log) {
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  const link = new EventEmitter();
  let n = 10;
  link.readyState = 0; link.origin = 'cdp'; link.bufferedAmount = 0; link.targetId = target.id;
  link.send = str => {
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({ id: n++, method: 'Runtime.evaluate', params: { expression: `window.__wickLinkRecv && window.__wickLinkRecv(${JSON.stringify(String(str))})` } }));
    link.bufferedAmount = ws.bufferedAmount;
  };
  link.close = () => { try { ws.close(); } catch (e) {} };
  ws.on('open', () => {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.addBinding', params: { name: '__wickLink' } }));
    ws.send(JSON.stringify({ id: 2, method: 'Runtime.enable' }));
  });
  ws.on('message', d => {
    let m; try { m = JSON.parse(String(d)); } catch (e) { return; }
    if (m.id === 2 && link.readyState === 0) { link.readyState = 1; onReady(link); return; }
    if (m.method === 'Runtime.bindingCalled' && m.params && m.params.name === '__wickLink') {
      const p = String(m.params.payload || '');
      if (p[0] === 'B') link.emit('message', Buffer.from(p.slice(1), 'base64'), true);
      else link.emit('message', p.slice(1), false);
    }
  });
  ws.on('close', () => { link.readyState = 3; link.emit('close'); });
  ws.on('error', e => log('link error: ' + e.message));
  return link;
}

function tradingView({ prefs, savePrefs, script, log, attach }) {
  const st = { found: false, running: false, linked: false, charts: 0, path: prefs.tvPath || '' };
  const injected = new Map();   // target id -> script version
  const links = new Map();      // target id -> link

  async function find() {
    if (process.platform !== 'win32') return st.path = process.env.WICK_TV_EXE || '';
    if (st.path && require('fs').existsSync(st.path)) return st.path;
    let p = (await run('powershell.exe', ['-NoProfile', '-Command', "(Get-AppxPackage -Name '*TradingView*' | Select-Object -First 1).InstallLocation"])).trim();
    if (p) p = require('path').join(p, 'TradingView.exe');
    if (!p || !require('fs').existsSync(p)) {
      p = (await run('powershell.exe', ['-NoProfile', '-Command',
        "foreach($r in @(\"$env:LOCALAPPDATA\\Programs\",$env:ProgramFiles,${env:ProgramFiles(x86)})){ if($r -and (Test-Path $r)){ $h=Get-ChildItem $r -Filter TradingView.exe -Recurse -ErrorAction SilentlyContinue|Select-Object -First 1; if($h){$h.FullName;break} } }"])).trim();
    }
    st.path = p && require('fs').existsSync(p) ? p : '';
    if (st.path !== prefs.tvPath) { prefs.tvPath = st.path; savePrefs(); }
    return st.path;
  }
  async function isRunning() {
    if (process.platform !== 'win32') return !!(await getJson('/json/version'));
    return /TradingView\.exe/i.test(await run('tasklist.exe', ['/FI', 'IMAGENAME eq TradingView.exe', '/NH']));
  }
  async function portUp() { return !!(await getJson('/json/version')); }

  // Loads Wick into every TradingView page that doesn't have it yet (and again after a reload).
  async function injectAll() {
    const list = await getJson('/json/list');
    if (!list) { st.linked = false; st.charts = 0; injected.clear(); for (const l of links.values()) l.close(); links.clear(); return; }
    st.linked = true;
    const pages = list.filter(t => t.type === 'page' && PAGE_RE.test(t.url || '') && t.webSocketDebuggerUrl);
    st.charts = pages.filter(t => /\/chart/i.test(t.url)).length;
    for (const [id, l] of links) if (!pages.some(t => t.id === id) || l.readyState === 3) { l.close(); links.delete(id); }
    for (const t of pages) {
      if (!links.has(t.id) && attach) {
        // the link first, so it's there when Wick starts in the page
        const l = openLink(t, ready => attach(ready), log);
        links.set(t.id, l);
        for (let i = 0; i < 40 && l.readyState === 0; i++) await sleep(50);
      }
      const chk = await cdp(t.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: 'window.__tvwpLoaded || false', returnByValue: true });
      const have = chk && chk.result && chk.result.value;
      if (have) { injected.set(t.id, have); continue; }
      const expr = `(function(){ if (window.__tvwpLoaded) return 'already'; window.__wickHost = 'app';\n${script.code()}\n; return 'injected'; })()`;
      const r = await cdp(t.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: expr, returnByValue: true });
      const res = !r ? 'no reply' : r.exceptionDetails ? 'error: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text) : r.result && r.result.value;
      log(`inject ${res} -> ${t.url.slice(0, 90)}`);
    }
  }
  async function bringToFront() {
    const list = (await getJson('/json/list')) || [];
    const t = list.find(x => x.type === 'page' && PAGE_RE.test(x.url || '') && x.webSocketDebuggerUrl);
    if (t) await cdp(t.webSocketDebuggerUrl, 'Page.bringToFront', {});
  }
  async function launch() {
    const exe = await find();
    if (!exe) throw new Error('TradingView desktop app not found');
    if (process.platform === 'win32') {
      // Started the same way Explorer would (the Store version doesn't allow starting its exe directly).
      await run('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -ArgumentList '--remote-debugging-port=${DEBUG_PORT}'`]);
    } else {
      require('child_process').spawn(exe, [`--remote-debugging-port=${DEBUG_PORT}`], { detached: true, stdio: 'ignore' }).unref();
    }
    for (let i = 0; i < 90 && !(await portUp()); i++) await sleep(500);
    if (!(await portUp())) throw new Error("TradingView didn't open its debug connection");
    log('TradingView started with Wick');
  }
  async function closeIt() {
    if (process.platform === 'win32') await run('taskkill.exe', ['/IM', 'TradingView.exe', '/F']);
    for (let i = 0; i < 20 && (await isRunning()); i++) await sleep(300);
  }
  async function refresh() {
    st.found = !!(await find());
    st.running = await isRunning();
    try { await injectAll(); } catch (e) { log('inject loop: ' + e.message); }
    if (st.linked) { st.running = true; st.found = true; }
    return st;
  }
  return { state: st, refresh, launch, closeIt, bringToFront, portUp, isRunning, find };
}
module.exports = { tradingView, DEBUG_PORT };
