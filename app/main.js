// Wick app: runs in the tray, opens the TradingView desktop app with Wick loaded, and keeps one
// journal, one set of settings and one lockout for Chrome and the desktop app.
'use strict';
const { app, BrowserWindow, Tray, Menu, dialog, shell, Notification, nativeImage, net, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { Store } = require('./src/store');
const { startServer } = require('./src/server');
const { scriptManager } = require('./src/script');
const { tradingView } = require('./src/tv');

app.setAppUserModelId('com.antoniog06.wick');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const userDir = process.env.WICK_DATA_DIR || app.getPath('userData');
const dataDir = path.join(userDir, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const logFile = path.join(userDir, 'wick.log');
function log(m) {
  const line = `${new Date().toISOString()}  ${m}\n`;
  try { if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2e6) fs.renameSync(logFile, logFile + '.old'); fs.appendFileSync(logFile, line); } catch (e) {}
  if (!app.isPackaged) process.stdout.write(line);
}
process.on('uncaughtException', e => log('crash: ' + (e && e.stack || e)));

const store = new Store(dataDir);
const savePrefs = () => store.write('app.json', store.prefs);
const script = scriptManager({ bundled: path.join(__dirname, 'wick.user.js'), cacheFile: path.join(userDir, 'wick.user.js'), fetch: (u, o) => net.fetch(u, o), log });
const tv = tradingView({ prefs: store.prefs, savePrefs, script, log, attach: l => server && server.attach(l) });
const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
const update = { state: 'idle', version: '', pct: 0, error: '' };
let win = null, tray = null, server = null, quitting = false, toldTray = !!store.prefs.toldTray;

/* ---------- window ---------- */
let titleBar = { color: '#15171e', symbolColor: '#c9cdd6', height: 52 };
function makeWindow() {
    win = new BrowserWindow({
      width: 1200, height: 820, minWidth: 820, minHeight: 420, title: 'Wick', icon, backgroundColor: '#15171e', show: false,
      // Wick draws its own title bar (Windows keeps its own minimize / maximize / close buttons)
      titleBarStyle: 'hidden', titleBarOverlay: process.platform === 'win32' ? titleBar : false,
      autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
    });
    win.removeMenu();
    win.loadURL(`${server.url}/home`);
    // links (like the releases page) open in your browser
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(server.url)) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
    win.on('close', e => {
      if (quitting) return;
      e.preventDefault();
      if (dock.on) { undock(true); return; }
      win.hide();
      if (!toldTray && Notification.isSupported()) {
        toldTray = store.prefs.toldTray = true; savePrefs();
        new Notification({ title: 'Wick is still running', body: 'It keeps your journal and lockout working in the tray. Right-click the tray icon to quit.', icon }).show();
      }
    });
    win.on('closed', () => { win = null; });
    win.on('focus', () => { if (dock.on) win.setAlwaysOnTop(true, 'floating'); });
    win.on('blur', () => { if (dock.on) setTimeout(followTv, 120); });
}
function showWindow() {
  if (!win) { makeWindow(); win.once('ready-to-show', () => win.show()); return; }
  if (dock.on) undock(false);
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

/* ---------- docked to TradingView ---------- */
// The Wick button in the TradingView desktop app opens this window over the right side of TradingView.
// It moves and resizes with TradingView, hides when TradingView is minimized, and drops behind other apps.
const dock = { on: false, link: null, normal: null };
function toDip(g) {
  // the page reports CSS pixels; with TradingView zoomed in or out those differ from screen units
  const d = screen.getDisplayNearestPoint({ x: Math.round(g.x), y: Math.round(g.y) });
  let z = (g.dpr || 1) / (d.scaleFactor || 1); if (Math.abs(z - 1) < 0.03) z = 1;
  return { x: g.x, y: g.y, w: g.w * z, h: g.h * z, top: Math.max(0, (g.h - g.ih) * z), z };
}
function dockBounds(g) {
  const d = toDip(g);
  const top = Math.round(d.top + 46 * d.z);              // below TradingView's own top toolbar
  const w = Math.round(Math.min(1180, Math.max(820, d.w * 0.6), d.w - 16));
  return { x: Math.round(d.x + d.w - w - 8), y: Math.round(d.y + top), width: Math.max(320, w), height: Math.round(Math.max(380, d.h - top - 10)) };
}
function setDock(link, open, geo) {
  if (geo) link.geo = geo;
  if (!open) { if (dock.on && dock.link === link) undock(true); return; }
  if (!link.geo) return;
  if (!win) makeWindow();
  if (!dock.on && win.isVisible() && !win.isMinimized()) dock.normal = win.getBounds();
  if (win.isMaximized()) win.unmaximize();
  dock.on = true; dock.link = link;
  win.setMinimumSize(320, 300);
  win.setBounds(dockBounds(link.geo));
  log('docked to TradingView ' + JSON.stringify(win.getBounds()));
  win.setAlwaysOnTop(true, 'floating');
  win.show(); win.focus();
  link.send(JSON.stringify({ t: 'docked', open: true }));
}
function undock(hide) {
  const link = dock.link;
  dock.on = false; dock.link = null;
  if (link && link.readyState === 1) link.send(JSON.stringify({ t: 'docked', open: false }));
  log('undocked' + (hide ? ' (hidden)' : ''));
  if (!win) return;
  win.setAlwaysOnTop(false);
  if (hide) win.hide();
  win.setMinimumSize(820, 420);
  if (dock.normal) win.setBounds(dock.normal); else win.setBounds({ width: 1200, height: 820 });
  if (hide) return;
  win.center && !dock.normal && win.center();
}
function followTv() {
  if (!dock.on || !win || !dock.link || !dock.link.geo) return;
  const g = dock.link.geo;
  if (!g.vis) { if (win.isVisible()) { win.hide(); log('TradingView minimized: dock hidden'); } return; }
  const b = dockBounds(g), c = win.getBounds();
  if (b.x !== c.x || b.y !== c.y || b.width !== c.width || b.height !== c.height) win.setBounds(b);
  const front = g.focus || win.isFocused();
  if (!win.isVisible()) { win.showInactive(); log('dock shown again'); }
  win.setAlwaysOnTop(front, 'floating');
  if (front && !win.isFocused()) win.moveTop();
}

/* ---------- tray ---------- */
function buildTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'tray.png')));
  tray.setToolTip('Wick');
  tray.on('click', showWindow);
  refreshTray();
}
function refreshTray() {
  if (!tray) return;
  const s = tv.state;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Wick', click: showWindow },
    { label: s.linked ? 'Show TradingView' : 'Open TradingView with Wick', enabled: s.found || !s.path, click: () => openTradingView() },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: !!store.prefs.login, click: i => setPref('login', i.checked) },
    { label: update.state === 'ready' ? `Restart to update (v${update.version})` : 'Check for updates', click: () => update.state === 'ready' ? installUpdate() : checkUpdate(true) },
    { type: 'separator' },
    { label: 'Quit Wick', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.setToolTip(`Wick · ${s.linked ? `TradingView open (${s.charts} chart${s.charts === 1 ? '' : 's'})` : 'TradingView closed'}`);
}

/* ---------- preferences ---------- */
function applyLogin() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!store.prefs.login, args: ['--hidden'] });
}
function setPref(key, on) {
  if (!['tvOnStart', 'tvWatch', 'login'].includes(key)) return;
  store.prefs[key] = !!on; savePrefs();
  if (key === 'login') applyLogin();
  refreshTray(); server && server.status(true);
}

/* ---------- TradingView ---------- */
let opening = false;
async function openTradingView() {
  if (opening) return; opening = true;
  try {
    if (await tv.portUp()) { await tv.bringToFront(); return; }
    if (!(await tv.find())) {
      const r = await dialog.showMessageBox({ type: 'info', title: 'Wick', message: "The TradingView desktop app isn't installed on this PC.", detail: 'Install it from tradingview.com/desktop, then open it from Wick.', buttons: ['Open download page', 'OK'], defaultId: 0 });
      if (r.response === 0) shell.openExternal('https://www.tradingview.com/desktop/');
      return;
    }
    if (await tv.isRunning()) {
      const r = await dialog.showMessageBox(win && win.isVisible() ? win : null, { type: 'question', title: 'Wick', message: 'TradingView is open without Wick.',
        detail: 'Close it and reopen it with Wick? Your positions and orders stay at your broker; only the window restarts.', buttons: ['Reopen with Wick', 'Not now'], defaultId: 0, cancelId: 1 });
      if (r.response !== 0) return;
      await tv.closeIt();
    }
    await tv.launch();
    await tv.refresh();
  } catch (e) {
    log('open TradingView failed: ' + e.message);
    dialog.showMessageBox({ type: 'warning', title: 'Wick', message: "Couldn't open TradingView with Wick.", detail: e.message + '\n\nIf it keeps happening, quit TradingView fully (including its tray icon) and try again.' });
  } finally { opening = false; refreshTray(); server && server.status(true); }
}
let warnedPid = false;
async function watchTradingView() {
  const was = JSON.stringify(tv.state);
  await tv.refresh();
  // TradingView opened from its own shortcut can't load Wick: offer to reopen it.
  if (tv.state.running && !tv.state.linked) {
    if (!warnedPid && store.prefs.tvWatch !== false && Notification.isSupported()) {
      warnedPid = true;
      const n = new Notification({ title: 'TradingView is open without Wick', body: 'Click to reopen it with Wick (your positions stay at your broker).', icon });
      n.on('click', () => openTradingView()); n.show();
    }
  } else if (!tv.state.running) warnedPid = false;
  if (JSON.stringify(tv.state) !== was) { refreshTray(); server && server.status(true); }
}

/* ---------- updates ---------- */
let updater = null;
function setupUpdater() {
  if (!app.isPackaged) return;
  try { updater = require('electron-updater').autoUpdater; } catch (e) { log('updater unavailable: ' + e.message); return; }
  updater.autoDownload = true; updater.autoInstallOnAppQuit = true;
  updater.logger = { info: m => log('update: ' + m), warn: m => log('update warn: ' + m), error: m => log('update error: ' + m), debug: () => {} };
  const set = (o) => { Object.assign(update, o); refreshTray(); server && server.status(true); };
  updater.on('checking-for-update', () => set({ state: 'checking' }));
  updater.on('update-available', i => set({ state: 'downloading', version: i.version, pct: 0 }));
  updater.on('update-not-available', () => set({ state: 'none' }));
  updater.on('download-progress', p => set({ state: 'downloading', pct: p.percent }));
  updater.on('update-downloaded', i => {
    set({ state: 'ready', version: i.version });
    if (Notification.isSupported()) { const n = new Notification({ title: `Wick ${i.version} is ready`, body: 'It installs when Wick restarts. Click to restart now.', icon }); n.on('click', installUpdate); n.show(); }
  });
  updater.on('error', e => set({ state: 'error', error: String(e && e.message || e).split('\n')[0] }));
}
function checkUpdate() { script.update(); if (updater) updater.checkForUpdates().catch(() => {}); else { update.state = 'none'; server && server.status(true); } }
function installUpdate() { if (!updater || update.state !== 'ready') return; quitting = true; store.flush(); updater.quitAndInstall(true, true); }

/* ---------- start ---------- */
app.on('second-instance', () => showWindow());
app.on('window-all-closed', e => { /* stay in the tray */ });
app.on('before-quit', () => { quitting = true; try { store.flush(); } catch (e) {} });

app.whenReady().then(async () => {
  log(`Wick ${app.getVersion()} starting (script v${script.version()})`);
  try {
    server = await startServer({
      store, script, log,
      homeHtml: () => fs.readFileSync(path.join(__dirname, 'home.html'), 'utf8'),
      hooks: {
        status: () => ({ appVersion: app.getVersion(), scriptVersion: script.version(), tv: { ...tv.state }, update: { ...update }, prefs: { tvOnStart: !!store.prefs.tvOnStart, tvWatch: store.prefs.tvWatch !== false, login: !!store.prefs.login }, dataDir }),
        geo: link => { if (dock.on && dock.link === link) followTv(); },
        dock: (link, open, geo) => setDock(link, open, geo),
        gone: link => { if (dock.on && dock.link === link) undock(true); },
        command: async m => {
          if (m.name === 'dockClose') return dock.on ? undock(true) : null;
          if (m.name === 'theme') {
            titleBar = m.light ? { color: '#f6f7fb', symbolColor: '#3b3f4a', height: 52 } : { color: '#15171e', symbolColor: '#c9cdd6', height: 52 };
            if (win && process.platform === 'win32') try { win.setTitleBarOverlay(titleBar); } catch (e) {}
            return;
          }
          if (m.name === 'openTv') return openTradingView();
          if (m.name === 'pref') return setPref(m.key, m.on);
          if (m.name === 'checkUpdate') return checkUpdate();
          if (m.name === 'installUpdate') return installUpdate();
          if (m.name === 'openData') return shell.openPath(dataDir);
        }
      }
    });
  } catch (e) {
    dialog.showErrorBox('Wick', `Wick couldn't start its local link (port 47823 is in use).\n\n${e.message}`);
    app.exit(1); return;
  }
  log('link ready at ' + server.url);
  buildTray();
  applyLogin();
  setupUpdater();
  if (!process.argv.includes('--hidden')) showWindow();
  await tv.refresh(); refreshTray();
  if (store.prefs.tvOnStart && !tv.state.linked) openTradingView();
  setInterval(watchTradingView, 2500);
  script.update();
  setInterval(() => script.update(), 30 * 60000);
  if (updater) { setTimeout(() => updater.checkForUpdates().catch(() => {}), 8000); setInterval(() => updater.checkForUpdates().catch(() => {}), 4 * 3600000); }
});
