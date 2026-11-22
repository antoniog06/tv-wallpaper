// The link between Wick windows: Chrome tabs, TradingView desktop windows and the Wick app window.
// Listens on 127.0.0.1 only, and only accepts TradingView pages and Wick's own window.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 47823;
const TV_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*tradingview\.com$/i;

function startServer({ store, script, homeHtml, hooks, log }) {
  const SELF = `http://127.0.0.1:${PORT}`;
  const clients = new Set();
  const uploads = new Map();     // ws -> { id, file, tmp, stream, mime, bytes }

  const server = http.createServer((req, res) => {
    // Only answer requests addressed to this PC by number (blocks DNS-rebinding tricks).
    if (!/^(127\.0\.0\.1|localhost):\d+$/i.test(req.headers.host || '')) { res.writeHead(403); return res.end(); }
    const url = new URL(req.url, SELF);
    if (url.pathname === '/home') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(homeHtml());
    }
    if (url.pathname === '/wick.user.js') {
      if (req.headers.origin && req.headers.origin !== SELF) { res.writeHead(403); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(script.code());
    }
    const vm = /^\/video\/(v_[A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (vm && req.method === 'GET') return sendVideo(req, res, vm[1], url.searchParams.has('download'));
    if (url.pathname === '/ping') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('wick'); }
    res.writeHead(404); res.end();
  });

  function sendVideo(req, res, id, download) {
    const v = store.videos.get(id);
    if (!v) { res.writeHead(404); return res.end(); }
    let size; try { size = fs.statSync(v.file).size; } catch (e) { res.writeHead(404); return res.end(); }
    const head = { 'Content-Type': v.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    if (download) head['Content-Disposition'] = `attachment; filename="trade-${id.slice(2)}.${path.extname(v.file).slice(1)}"`;
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      let start = m[1] === '' ? Math.max(0, size - +m[2]) : +m[1];
      let end = m[1] !== '' && m[2] !== '' ? Math.min(+m[2], size - 1) : size - 1;
      if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(v.file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...head, 'Content-Length': size });
    fs.createReadStream(v.file).pipe(res);
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  server.on('upgrade', (req, sock, head) => {
    const origin = req.headers.origin || '';
    const okHost = /^(127\.0\.0\.1|localhost):\d+$/i.test(req.headers.host || '');
    const okOrigin = TV_ORIGIN.test(origin) || origin === SELF;
    if (!okHost || !okOrigin || new URL(req.url, SELF).pathname !== '/wick') { sock.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return sock.destroy(); }
    wss.handleUpgrade(req, sock, head, ws => { ws.origin = origin; wss.emit('connection', ws, req); });
  });

  const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const others = (from, m) => { for (const c of clients) if (c !== from && c.kind) send(c, m); };
  const everyone = m => { for (const c of clients) if (c.kind) send(c, m); };

  // A window's link: a WebSocket (Chrome, the app window) or the debug connection (TradingView desktop app).
  function attach(ws) {
    clients.add(ws);
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const up = uploads.get(ws);
        if (up && up.stream) { up.stream.write(data); up.bytes += data.length; }
        return;
      }
      let m; try { m = JSON.parse(String(data)); } catch (e) { return; }
      try { handle(ws, m); } catch (e) { log('message failed: ' + (e && e.stack || e)); }
    });
    ws.on('close', () => {
      clients.delete(ws);
      if (hooks.gone) hooks.gone(ws);
      const up = uploads.get(ws);
      if (up) { try { up.stream.destroy(); fs.unlinkSync(up.tmp); } catch (e) {} uploads.delete(ws); }
      status();
    });
  }
  wss.on('connection', attach);

  function handle(ws, m) {
    switch (m.t) {
      case 'hello': {
        // The app's own window is the only one that may run app commands.
        ws.kind = m.kind === 'home' && ws.origin === SELF ? 'home' : (m.kind === 'desktop' || ws.origin === 'cdp') ? 'desktop' : 'browser';
        ws.ver = String(m.ver || ''); ws.page = String(m.url || '');
        if (store.setSettings(m.settings, m.settingsAt)) { others(ws, { t: 'settings', data: store.settings.data, at: store.settings.at }); onSettings(); }
        else if (store.settings.data) send(ws, { t: 'settings', data: store.settings.data, at: store.settings.at });
        if (m.risk && store.mergeRisk(m.risk)) others(ws, { t: 'risk', data: store.risk });
        if (store.risk) send(ws, { t: 'risk', data: store.risk });
        log(`linked: ${ws.kind} ${ws.ver} ${ws.page.slice(0, 80)}`);
        status();
        break;
      }
      case 'settings':
        log(`settings from ${ws.kind} (${m.part || '?'})`);
        if (store.setSettings(m.data, m.at)) { others(ws, { t: 'settings', data: store.settings.data, at: store.settings.at }); onSettings(); }
        break;
      case 'risk':
        if (store.mergeRisk(m.data)) others(ws, { t: 'risk', data: store.risk });
        break;
      case 'tsync': {
        const d = store.diff(m.have);
        send(ws, { t: 'tsync', recs: d.recs, want: d.want, tomb: d.tomb, videos: [...store.videos.keys()] });
        break;
      }
      case 'trades': {
        const changed = store.putTrades(m.recs);
        if (changed.length) { others(ws, { t: 'trades', recs: changed }); status(); }
        break;
      }
      case 'tdel': {
        const ids = store.delTrades(m.ids);
        if (ids.length) { others(ws, { t: 'tdel', ids }); status(); }
        break;
      }
      case 'vbegin': {
        const wall = m.kind === 'wall';
        if (typeof m.id !== 'string' || !(wall ? /^[A-Za-z0-9_-]{4,40}$/ : /^v_[A-Za-z0-9_-]+$/).test(m.id)) return;
        if (wall && (store.walls[m.id] || store.wallTomb[m.id])) return;
        const file = wall ? store.wallPath(m.id, m.mime) : store.videoPath(m.id, m.mime), tmp = file + '.part';
        const prev = uploads.get(ws); if (prev) try { prev.stream.destroy(); } catch (e) {}
        uploads.set(ws, { kind: wall ? 'wall' : 'video', meta: wall ? m.meta : null, id: m.id, file, tmp, mime: m.mime, size: +m.size || 0, bytes: 0, stream: fs.createWriteStream(tmp) });
        break;
      }
      case 'vend': {
        const up = uploads.get(ws);
        if (!up || up.id !== m.id) return;
        uploads.delete(ws);
        up.stream.end(() => {
          if (up.size && up.bytes !== up.size) { try { fs.unlinkSync(up.tmp); } catch (e) {} log(`video ${up.id} incomplete (${up.bytes}/${up.size})`); return; }
          try { fs.renameSync(up.tmp, up.file); } catch (e) { log('file save failed: ' + e.message); return; }
          if (up.kind === 'wall') {
            const info = store.addWall(up.id, up.file, up.mime, up.meta);
            if (info) { others(ws, { t: 'wnew', wall: info }); log(`wallpaper saved ${up.id} ${(up.bytes / 1048576).toFixed(1)} MB`); }
            return;
          }
          const t = store.addVideo(up.id, up.file, up.mime);
          for (const id of store.trimVideos(store.settings.data && store.settings.data.rec && store.settings.data.rec.keep)) log('trimmed ' + id);
          everyone({ t: 'videos', ids: [up.id] });
          if (t) everyone({ t: 'trades', recs: [t] });
          log(`video saved ${up.id} ${(up.bytes / 1048576).toFixed(1)} MB`);
          status();
        });
        break;
      }
      case 'geo':
        ws.geo = m.geo;
        if (hooks.geo) hooks.geo(ws);
        break;
      case 'dock':
        if (ws.kind === 'desktop' && hooks.dock) hooks.dock(ws, !!m.open, m.geo);
        break;
      case 'wsync':
        send(ws, { t: 'wsync', list: store.wallList(), tomb: Object.keys(store.wallTomb) });
        break;
      case 'wdel': {
        const ids = store.delWalls(m.ids);
        if (ids.length) others(ws, { t: 'wdel', ids });
        break;
      }
      case 'vget': {
        // a window that can't load the video address directly gets it through the link
        const v = m.kind === 'wall' ? store.walls[m.id] : store.videos.get(m.id);
        if (!v) { send(ws, { t: 'vdata', kind: m.kind || 'video', id: m.id, missing: true, last: true }); return; }
        const step = 384 * 1024, size = v.size; let i = 0;
        const fd = fs.openSync(v.file, 'r');
        const pump = () => {
          if (ws.readyState !== 1) { fs.closeSync(fd); return; }
          if (ws.bufferedAmount > 8 * 1048576) return setTimeout(pump, 30);
          const buf = Buffer.alloc(Math.min(step, size - i * step));
          fs.readSync(fd, buf, 0, buf.length, i * step);
          const last = (i + 1) * step >= size;
          send(ws, { t: 'vdata', kind: m.kind || 'video', id: m.id, i, mime: v.mime, size, last, b64: buf.toString('base64') });
          i++;
          if (last) fs.closeSync(fd); else setImmediate(pump);
        };
        pump();
        break;
      }
      case 'cmd':
        if (ws.kind !== 'home') return;
        Promise.resolve(hooks.command(m, ws)).then(() => status()).catch(e => log('cmd failed: ' + e.message));
        break;
    }
  }
  function onSettings() { if (hooks.onSettings) hooks.onSettings(store.settings.data); }

  function counts() {
    const c = { desktop: 0, browser: 0, home: 0 };
    for (const x of clients) if (x.kind) c[x.kind]++;
    return c;
  }
  let lastStatus = '';
  function status(force) {
    const m = { t: 'status', ...hooks.status(), clients: counts(), trades: Object.keys(store.trades).length, videos: store.videos.size };
    const s = JSON.stringify(m);
    if (!force && s === lastStatus) return;
    lastStatus = s;
    everyone(m);
  }
  setInterval(() => status(), 2000);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve({ port: PORT, url: SELF, status, counts, attach, close: () => server.close() }));
  });
}
module.exports = { startServer, PORT };
