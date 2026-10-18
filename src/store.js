'use strict';
// JSON sidecar storage in app-data. Originals are never modified.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const localDay = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
module.exports = function createStore(root) {
  const p = (...a) => path.join(root, ...a);
  ['data', 'covers', 'cache'].forEach((d) => fs.mkdirSync(p(d), { recursive: true }));
  const read = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return def; } };
  const write = (f, obj) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj, null, 1)); fs.renameSync(tmp, f); };
  const S = {
    root,
    lib: () => read(p('library.json'), { books: {} }),
    saveLib: (l) => write(p('library.json'), l),
    bookData: (id) => read(p('data', `${id}.json`), { annotations: [], bookmarks: [] }),
    saveBookData: (id, d) => write(p('data', `${id}.json`), { ...d, savedAt: new Date().toISOString() }),
    vocab: () => read(p('vocab.json'), []), saveVocab: (v) => write(p('vocab.json'), v),
    stats: () => read(p('stats.json'), { days: {}, books: {} }), saveStats: (s) => write(p('stats.json'), s),
    settings: () => read(p('settings.json'), { lang: 'en', theme: 'light', mode: 'flip' }), saveSettings: (s) => write(p('settings.json'), s),
    coverPath: (id) => p('covers', `${id}.jpg`), cachePdf: (id) => p('cache', `${id}.pdf`),
    /** Stable id from file content (survives renames/moves). */
    idFor(file) {
      const st = fs.statSync(file); const fd = fs.openSync(file, 'r'); const h = crypto.createHash('sha1');
      const n = Math.min(st.size, 1 << 20); const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, 0); h.update(b);
      if (st.size > n) { const t = Math.min(65536, st.size - n); const b2 = Buffer.alloc(t); fs.readSync(fd, b2, 0, t, st.size - t); h.update(b2); }
      fs.closeSync(fd); h.update(String(st.size)); return h.digest('hex').slice(0, 16);
    },
    addMinutes(bookId, min, day = localDay()) {
      const s = S.stats(); s.days[day] = +((s.days[day] || 0) + min).toFixed(2);
      if (bookId) { s.books[bookId] = s.books[bookId] || {}; s.books[bookId][day] = +((s.books[bookId][day] || 0) + min).toFixed(2); }
      S.saveStats(s); return s;
    },
    async exportBackup(dest) {
      const JSZip = require('jszip'); const z = new JSZip();
      for (const f of ['library.json', 'vocab.json', 'stats.json', 'settings.json']) if (fs.existsSync(p(f))) z.file(f, fs.readFileSync(p(f)));
      for (const f of fs.readdirSync(p('data'))) if (f.endsWith('.json')) z.file(`data/${f}`, fs.readFileSync(p('data', f)));
      for (const f of fs.readdirSync(p('covers'))) z.file(`covers/${f}`, fs.readFileSync(p('covers', f)));
      z.file('mamba-reader-backup.json', JSON.stringify({ app: 'Mamba Reader', version: 1, created: new Date().toISOString() }));
      fs.writeFileSync(dest, await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })); return dest;
    },
    /** Merge a backup: books/vocab/stats merged, annotation files merged by annotation id (newest wins). */
    async importBackup(src) {
      const JSZip = require('jszip'); const z = await JSZip.loadAsync(fs.readFileSync(src));
      if (!z.file('mamba-reader-backup.json')) throw new Error('Not a Mamba Reader backup');
      const j = async (n, def) => (z.file(n) ? JSON.parse(await z.file(n).async('string')) : def);
      const lib = S.lib(); const inLib = await j('library.json', { books: {} }); let books = 0;
      for (const [id, b] of Object.entries(inLib.books)) { if (!lib.books[id]) books++; lib.books[id] = { ...b, ...(lib.books[id] || {}), tags: [...new Set([...(b.tags || []), ...((lib.books[id] || {}).tags || [])])] }; }
      S.saveLib(lib);
      const voc = S.vocab(); const ids = new Set(voc.map((v) => v.id)); (await j('vocab.json', [])).forEach((v) => { if (!ids.has(v.id)) voc.push(v); }); S.saveVocab(voc);
      const st = S.stats(); const inSt = await j('stats.json', { days: {}, books: {} });
      for (const [d, m] of Object.entries(inSt.days || {})) st.days[d] = Math.max(st.days[d] || 0, m);
      for (const [b, days] of Object.entries(inSt.books || {})) { st.books[b] = st.books[b] || {}; for (const [d, m] of Object.entries(days)) st.books[b][d] = Math.max(st.books[b][d] || 0, m); }
      S.saveStats(st);
      let annots = 0;
      for (const name of Object.keys(z.files).filter((n) => /^data\/[^/]+\.json$/.test(n))) {
        const id = path.basename(name, '.json'); const cur = S.bookData(id); const inc = JSON.parse(await z.file(name).async('string'));
        const map = new Map(cur.annotations.map((a) => [a.id, a]));
        for (const a of inc.annotations || []) { const c = map.get(a.id); if (!c) annots++; if (!c || (a.updated || '') > (c.updated || '')) map.set(a.id, a); }
        const bm = new Map(cur.bookmarks.map((b) => [b.page, b])); (inc.bookmarks || []).forEach((b) => { if (!bm.has(b.page)) bm.set(b.page, b); });
        S.saveBookData(id, { ...inc, ...cur, annotations: [...map.values()], bookmarks: [...bm.values()] });
      }
      for (const name of Object.keys(z.files).filter((n) => /^covers\/[^/]+\.jpg$/.test(n))) { const f = p('covers', path.basename(name)); if (!fs.existsSync(f)) fs.writeFileSync(f, await z.file(name).async('nodebuffer')); }
      return { books, annotations: annots };
    },
  };
  return S;
};
