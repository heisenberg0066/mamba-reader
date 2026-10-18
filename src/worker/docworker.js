'use strict';
// MuPDF document worker (worker_threads). All heavy PDF/EPUB work happens here so the UI never blocks.
const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
let M = null; const docs = new Map(); let nextId = 1;
const mime = (p) => ({ pdf: 'application/pdf', epub: 'application/epub+zip', xps: 'application/oxps', oxps: 'application/oxps', cbz: 'application/x-cbz', fb2: 'application/x-fictionbook', mobi: 'application/x-mobipocket-ebook', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff' }[path.extname(p).slice(1).toLowerCase()] || 'application/pdf');

function flattenOutline(items, level = 0, out = []) {
  for (const it of items || []) { out.push({ title: (it.title || '').trim(), page: typeof it.page === 'number' ? it.page : -1, level }); if (it.down) flattenOutline(it.down, level + 1, out); }
  return out;
}

/** Build a PDF from a list of image buffers (used for Convert flipbooks and image folders). */
function imagesToPdf(bufs) {
  const out = new M.Buffer(); const w = new M.DocumentWriter(out, 'pdf', '');
  for (const b of bufs) {
    const d = M.Document.openDocument(b.data, b.mime); const pg = d.loadPage(0); const dev = w.beginPage(pg.getBounds()); pg.run(dev, M.Matrix.identity); w.endPage();
  }
  w.close(); return Buffer.from(out.asUint8Array());
}

function readFlipbook(file) {
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/window\.MF_DATA=(\{.*?\});<\/script>/s);
  if (!m) throw new Error('Not a Mamba flipbook');
  const data = JSON.parse(m[1]); const dir = path.dirname(file);
  const bufs = data.pages.map((p) => {
    if (p.src.startsWith('data:')) { const [, mt, b64] = p.src.match(/^data:([^;]+);base64,(.*)$/s); return { data: Buffer.from(b64, 'base64'), mime: mt }; }
    const f = path.resolve(dir, decodeURI(p.src)); return { data: fs.readFileSync(f), mime: mime(f) };
  });
  return { pdf: imagesToPdf(bufs), title: data.title, rtl: !!data.rtl };
}

const H = {
  async open({ file, cachePdf, layout }) {
    let buf, magic = mime(file), extra = {};
    const ext = path.extname(file).toLowerCase();
    if (ext === '.html' || ext === '.htm') {
      if (cachePdf && fs.existsSync(cachePdf) && fs.statSync(cachePdf).mtimeMs >= fs.statSync(file).mtimeMs) { buf = fs.readFileSync(cachePdf); }
      else { const fb = readFlipbook(file); buf = fb.pdf; extra = { title: fb.title, rtl: fb.rtl }; if (cachePdf) { fs.mkdirSync(path.dirname(cachePdf), { recursive: true }); fs.writeFileSync(cachePdf, buf); } }
      if (!extra.title) { try { const m = fs.readFileSync(file, 'utf8').match(/"title":"([^"]*)"/); if (m) extra.title = JSON.parse('"' + m[1] + '"'); const r = fs.readFileSync(file, 'utf8').match(/"rtl":(true|false)/); if (r) extra.rtl = r[1] === 'true'; } catch (_) {} }
      magic = 'application/pdf'; extra.kind = 'flipbook';
    } else buf = fs.readFileSync(file);
    const doc = M.Document.openDocument(buf, magic);
    if (doc.needsPassword && doc.needsPassword()) throw new Error('This document is password protected');
    let reflow = false;
    try { if (['.epub', '.fb2', '.mobi', '.xhtml'].includes(ext)) { const L = layout || { w: 450, h: 640, em: 12 }; doc.layout(L.w, L.h, L.em); reflow = true; } } catch (_) {}
    const n = doc.countPages(); const pages = [];
    for (let i = 0; i < n; i++) { const b = doc.loadPage(i).getBounds(); pages.push([+(b[2] - b[0]).toFixed(2), +(b[3] - b[1]).toFixed(2)]); }
    let outline = []; try { outline = flattenOutline(doc.loadOutline()); } catch (_) {}
    const id = nextId++; docs.set(id, { doc, file, buf, magic, textCache: new Map() });
    const meta = (k) => { try { return doc.getMetaData(k) || ''; } catch (_) { return ''; } };
    return { docId: id, pageCount: n, pages, outline, title: extra.title || meta('info:Title'), author: meta('info:Author'), isPDF: doc.isPDF(), reflow, kind: extra.kind || (reflow ? 'ebook' : magic.startsWith('image/') ? 'image' : 'pdf'), rtl: !!extra.rtl };
  },
  render({ docId, page, scale, quality = 88 }) {
    const d = docs.get(docId); const pg = d.doc.loadPage(page);
    const pix = pg.toPixmap(M.Matrix.scale(scale, scale), M.ColorSpace.DeviceRGB, false, true);
    const out = Buffer.from(pix.asJPEG(quality, false)); pix.destroy && pix.destroy(); return out;
  },
  text({ docId, page }) {
    const d = docs.get(docId); if (d.textCache.has(page)) return d.textCache.get(page);
    const j = JSON.parse(d.doc.loadPage(page).toStructuredText('preserve-whitespace').asJSON());
    const lines = [];
    for (const b of j.blocks || []) for (const l of b.lines || []) { if (!l.text || !l.text.trim()) continue; lines.push({ x: l.bbox.x, y: l.bbox.y, w: l.bbox.w, h: l.bbox.h, t: l.text, s: (l.font && l.font.size) || l.bbox.h, f: (l.font && l.font.family) || 'sans-serif', wm: l.wmode || 0 }); }
    d.textCache.set(page, lines); return lines;
  },
  search({ docId, query, max = 500 }) {
    const d = docs.get(docId); const hits = []; const n = d.doc.countPages(); const q = String(query || '').trim(); if (!q) return hits;
    for (let i = 0; i < n && hits.length < max; i++) {
      const res = d.doc.loadPage(i).search(q, 'ignore-case'); if (!res || !res.length) continue;
      const lines = H.text({ docId, page: i });
      for (const quads of res) {
        const q0 = quads[0]; const y = (q0[1] + q0[5]) / 2;
        const line = lines.find((l) => y >= l.y - 1 && y <= l.y + l.h + 1) || { t: '' };
        hits.push({ page: i, quads, snippet: line.t.trim().slice(0, 160) });
      }
    }
    return hits;
  },
  pageText({ docId, page }) { return H.text({ docId, page }).map((l) => l.t).join('\n'); },
  cover({ docId, width = 320 }) {
    const d = docs.get(docId); const pg = d.doc.loadPage(0); const b = pg.getBounds(); const s = width / (b[2] - b[0]);
    const pix = pg.toPixmap(M.Matrix.scale(s, s), M.ColorSpace.DeviceRGB, false, true); return Buffer.from(pix.asJPEG(80, false));
  },
  /** Write a copy of the document with real PDF annotations (originals are never touched). */
  exportAnnotated({ docId, annots, out, author = 'Mamba Reader' }) {
    const d = docs.get(docId);
    let pdf;
    if (d.doc.isPDF()) pdf = M.Document.openDocument(d.buf, 'application/pdf').asPDF();
    else { // reflowable / image docs: rasterise into a fresh PDF first
      const ob = new M.Buffer(); const w = new M.DocumentWriter(ob, 'pdf', '');
      for (let i = 0; i < d.doc.countPages(); i++) { const pg = d.doc.loadPage(i); const dev = w.beginPage(pg.getBounds()); pg.run(dev, M.Matrix.identity); w.endPage(); }
      w.close(); pdf = M.Document.openDocument(ob.asUint8Array(), 'application/pdf').asPDF();
    }
    const rgb = (hex) => { const h = (hex || '#ffd400').replace('#', ''); return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]; };
    let count = 0;
    for (const a of annots) {
      const page = pdf.loadPage(a.page); let an = null;
      const quad = (r) => [r[0], r[1], r[0] + r[2], r[1], r[0], r[1] + r[3], r[0] + r[2], r[1] + r[3]];
      if (a.type === 'highlight' || a.type === 'underline' || a.type === 'strike') {
        an = page.createAnnotation({ highlight: 'Highlight', underline: 'Underline', strike: 'StrikeOut' }[a.type]);
        an.setQuadPoints(a.rects.map(quad)); an.setColor(rgb(a.color)); if (a.type === 'highlight') an.setOpacity(0.5);
        if (a.comment) an.setContents(a.comment);
      } else if (a.type === 'ink' || a.type === 'marker') {
        an = page.createAnnotation('Ink'); an.setInkList([a.points.map((p) => [p[0], p[1]])]); an.setColor(rgb(a.color)); an.setBorderWidth(a.width || 2); if (a.type === 'marker') an.setOpacity(0.4);
      } else if (a.type === 'rect' || a.type === 'ellipse') {
        an = page.createAnnotation(a.type === 'rect' ? 'Square' : 'Circle'); an.setRect([a.rect[0], a.rect[1], a.rect[0] + a.rect[2], a.rect[1] + a.rect[3]]); an.setColor(rgb(a.color)); an.setBorderWidth(a.width || 2);
      } else if (a.type === 'line' || a.type === 'arrow') {
        an = page.createAnnotation('Line'); an.setLine(a.points[0], a.points[1]); an.setColor(rgb(a.color)); an.setBorderWidth(a.width || 2); if (a.type === 'arrow') an.setLineEndingStyles('None', 'OpenArrow');
      } else if (a.type === 'text') {
        an = page.createAnnotation('FreeText'); an.setRect([a.rect[0], a.rect[1], a.rect[0] + a.rect[2], a.rect[1] + a.rect[3]]); an.setContents(a.content || ''); an.setDefaultAppearance('Helv', a.fontSize || 12, rgb(a.color || '#111111'));
      } else if (a.type === 'note') {
        an = page.createAnnotation('Text'); an.setRect([a.rect[0], a.rect[1], a.rect[0] + 20, a.rect[1] + 20]); an.setContents(a.content || ''); an.setColor(rgb(a.color || '#ffd400')); try { an.setIcon('Comment'); } catch (_) {}
      }
      if (an) { try { an.setAuthor(author); } catch (_) {} an.update(); count++; }
    }
    fs.writeFileSync(out, Buffer.from(pdf.saveToBuffer('garbage=1,compress=yes').asUint8Array()));
    return { out, count };
  },
  annotCount({ file }) { const d = M.Document.openDocument(fs.readFileSync(file), 'application/pdf'); let n = 0; const types = {}; for (let i = 0; i < d.countPages(); i++) { const pg = d.loadPage(i); for (const a of pg.getAnnotations()) { n++; const t = a.getType(); types[t] = (types[t] || 0) + 1; } } return { count: n, types }; },
  close({ docId }) { const d = docs.get(docId); if (d) { try { d.doc.destroy && d.doc.destroy(); } catch (_) {} docs.delete(docId); } return true; },
};

parentPort.on('message', async ({ id, cmd, args }) => {
  try {
    if (!M) M = await import('mupdf');
    const r = await H[cmd](args || {});
    if (Buffer.isBuffer(r)) parentPort.postMessage({ id, result: r }, [r.buffer].filter((b) => b.byteLength === r.length && b.byteLength > 0 && r.byteOffset === 0)); else parentPort.postMessage({ id, result: r });
  } catch (e) { parentPort.postMessage({ id, error: String(e && e.message || e) }); }
});
