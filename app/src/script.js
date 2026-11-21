// The Wick script that runs inside TradingView. The app ships with a copy and fetches newer ones from GitHub.
'use strict';
const fs = require('fs');
const path = require('path');

const RAW = 'https://raw.githubusercontent.com/antoniog06/tv-wallpaper/main/tvwp.user.js';
const verOf = code => { const m = /@version\s+([\d.]+)/.exec(code || ''); return m ? m[1] : '0'; };
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 4; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

function scriptManager({ bundled, cacheFile, fetch, log }) {
  let code = '';
  const load = f => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } };
  const a = load(bundled), b = load(cacheFile);
  code = b && newer(verOf(b), verOf(a)) ? b : a;
  async function update() {
    try {
      const r = await fetch(RAW + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const next = await r.text();
      if (!/==UserScript==/.test(next) || !newer(verOf(next), verOf(code))) return false;
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, next);
      code = next; log('script updated to ' + verOf(next));
      return true;
    } catch (e) { log('script update check failed: ' + e.message); return false; }
  }
  return { code: () => code, version: () => verOf(code), update };
}
module.exports = { scriptManager, verOf };
