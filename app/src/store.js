// Wick's shared data on this PC: settings, trades (with deletions), the lockout, and chart videos.
// Everything lives in one folder (%APPDATA%\Wick\data on Windows).
'use strict';
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.videoDir = path.join(dir, 'videos');
    fs.mkdirSync(this.videoDir, { recursive: true });
    this.file = name => path.join(dir, name);
    this.settings = this.read('settings.json', { data: null, at: 0 });
    this.trades = this.read('trades.json', {});          // id -> trade record
    this.tomb = this.read('deleted.json', {});           // id -> when it was deleted
    this.risk = this.read('lockout.json', null);
    this.prefs = this.read('app.json', { tvOnStart: false, tvWatch: true, login: true });
    this.timers = {};
    this.videos = new Map();                             // id -> { file, mime, size }
    for (const f of fs.readdirSync(this.videoDir)) {
      const m = /^(v_[^.]+)\.(mp4|webm)$/.exec(f);
      if (m) this.videos.set(m[1], { file: path.join(this.videoDir, f), mime: m[2] === 'mp4' ? 'video/mp4' : 'video/webm', size: fs.statSync(path.join(this.videoDir, f)).size });
    }
  }
  read(name, fallback) {
    try { return JSON.parse(fs.readFileSync(this.file(name), 'utf8')); } catch (e) { return fallback; }
  }
  // Writes go to a temp file first, so a crash never leaves a half-written journal.
  write(name, value, now) {
    clearTimeout(this.timers[name]);
    const go = () => {
      const f = this.file(name), tmp = f + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(value));
      fs.renameSync(tmp, f);
    };
    if (now) go(); else this.timers[name] = setTimeout(go, 400);
  }
  flush() {
    for (const k of Object.keys(this.timers)) clearTimeout(this.timers[k]);
    this.write('settings.json', this.settings, true); this.write('trades.json', this.trades, true);
    this.write('deleted.json', this.tomb, true); this.write('app.json', this.prefs, true);
    if (this.risk) this.write('lockout.json', this.risk, true);
  }

  /* settings: newest wins */
  setSettings(data, at) {
    if (!data || !(at > (this.settings.at || 0))) return false;
    this.settings = { data, at };
    this.write('settings.json', this.settings);
    return true;
  }

  /* trades: newest edit wins; a deletion sticks */
  putTrades(recs) {
    const changed = [];
    for (const r of recs || []) {
      if (!r || typeof r.id !== 'string' || this.tomb[r.id]) continue;
      const cur = this.trades[r.id];
      if (cur && (cur.upd || 0) >= (r.upd || 0)) continue;
      if (cur && cur.videoId && !r.videoId) r.videoId = cur.videoId;
      this.trades[r.id] = r; changed.push(r);
    }
    if (changed.length) this.write('trades.json', this.trades);
    return changed;
  }
  delTrades(ids) {
    const gone = [];
    for (const id of ids || []) {
      if (typeof id !== 'string') continue;
      this.tomb[id] = Date.now();
      if (this.trades[id]) { delete this.trades[id]; gone.push(id); }
      this.delVideo('v_' + id);
    }
    this.write('trades.json', this.trades); this.write('deleted.json', this.tomb);
    return ids || [];
  }
  // What a window is missing, what it has that we don't, and what was deleted.
  diff(have) {
    have = have && typeof have === 'object' ? have : {};
    const recs = [], want = [], tomb = [];
    for (const [id, r] of Object.entries(this.trades)) if (!(id in have) || (have[id] || 0) < (r.upd || r.closeTime || 0)) recs.push(r);
    for (const [id, upd] of Object.entries(have)) {
      if (this.tomb[id]) { tomb.push(id); continue; }
      const r = this.trades[id];
      if (!r || (r.upd || r.closeTime || 0) < (upd || 0)) want.push(id);
    }
    return { recs, want, tomb };
  }

  /* lockout: a lock for today sticks unless someone unlocked it early (after the lock) */
  mergeRisk(f) {
    if (!f || typeof f !== 'object') return false;
    const cur = this.risk;
    let next = cur;
    if (!cur || (f.lockDay ?? -1) > (cur.lockDay ?? -1)) next = { ...f };
    else if (f.lockDay === cur.lockDay) {
      next = { ...cur };
      if (f.lockReason && (!cur.lockReason || (f.lockedAt || 0) < (cur.lockedAt || 0))) { next.lockReason = f.lockReason; next.lockedAt = f.lockedAt; next.from = f.from; }
      if (f.unlocked && (f.unlockedAt || 0) > (cur.unlockedAt || 0)) { next.unlocked = true; next.unlockedAt = f.unlockedAt; }
    }
    if (JSON.stringify(next) === JSON.stringify(cur)) return false;
    this.risk = next; this.write('lockout.json', next);
    return true;
  }

  /* videos */
  videoPath(id, mime) { return path.join(this.videoDir, `${id}.${/mp4/i.test(mime || '') ? 'mp4' : 'webm'}`); }
  addVideo(id, file, mime) {
    this.videos.set(id, { file, mime: /mp4/i.test(mime || '') ? 'video/mp4' : 'video/webm', size: fs.statSync(file).size });
    const t = this.trades[id.slice(2)];
    if (t && t.videoId !== id) { t.videoId = id; t.videoExt = /mp4/i.test(mime || '') ? 'mp4' : 'webm'; t.upd = Date.now(); this.write('trades.json', this.trades); return t; }
    return null;
  }
  delVideo(id) {
    const v = this.videos.get(id);
    if (!v) return;
    try { fs.unlinkSync(v.file); } catch (e) {}
    this.videos.delete(id);
  }
  // Keep the newest N videos (your "Keep videos" setting). Trades are always kept.
  trimVideos(keep) {
    keep = Math.max(1, +keep || 25);
    const ids = [...this.videos.keys()].sort();
    const old = ids.slice(0, Math.max(0, ids.length - keep));
    for (const id of old) this.delVideo(id);
    return old;
  }
}
module.exports = { Store };
