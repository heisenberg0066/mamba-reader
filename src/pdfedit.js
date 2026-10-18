'use strict';
// Saving a visual PDF edit.
//  Stage 1 (MuPDF, worker thread): real removal of edited/deleted text, moved/deleted images and redacted areas,
//           plus form-field values. Gives back each page's page→display transform.
//  Stage 2 (pdf-lib): new text boxes, images, signatures, stamps and whiteouts drawn into the page content, then
//           page order / rotation / blank pages / merged PDFs. The original file is never modified unless the
//           caller explicitly passes it as `out` (Save As over the original).
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');

const FONT = {
  Helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
  Times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
  Courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
};
const fontKey = (fam, b, i) => StandardFonts[(FONT[fam] || FONT.Helvetica)[(b ? 1 : 0) + (i ? 2 : 0)]];
const col = (h) => { const x = String(h || '#000000').replace('#', ''); const v = (k) => parseInt(x.slice(k, k + 2), 16) / 255 || 0; return rgb(v(0), v(2), v(4)); };
const inv = ([a, b, c, d, e, f]) => { const det = a * d - b * c; return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]; };
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const dataBytes = (u) => { const m = /^data:([^;]+);base64,(.*)$/s.exec(u || ''); if (!m) throw new Error('bad image data'); return { mime: m[1], bytes: Buffer.from(m[2], 'base64') }; };
const keyOf = (p) => (p.blank ? 'b:' + p.id : `${p.src}:${p.index}`);

/** Place a display-space box on a pdf-lib page: returns {x, y, rotate, sx, sy} for its bottom-left corner. */
function placer(ctm) {
  const m = inv(ctm);
  return (x, y) => {
    const [px, py] = apply(m, x, y); const [qx, qy] = apply(m, x + 1, y); const [rx, ry] = apply(m, x, y - 1);
    const ang = Math.atan2(qy - py, qx - px) * 180 / Math.PI;
    return { x: px, y: py, rotate: degrees(Math.round(ang * 1000) / 1000), sx: Math.hypot(qx - px, qy - py), sy: Math.hypot(rx - px, ry - py) };
  };
}

async function saveEdit(model, docs) {
  const { sources, pages, items = {}, forms = [], out } = model;
  if (!out) throw new Error('no output file');
  if (!pages || !pages.length) throw new Error('the document has no pages left');
  // ---- stage 1 per source
  const stage = {};
  for (const s of sources) {
    const edits = {};
    for (const [k, ops] of Object.entries(items)) {
      const [src, idx] = k.split(':'); if (src !== s.id) continue;
      for (const op of ops) {
        const e = (edits[idx] = edits[idx] || { text: [], image: [], redact: [] });
        if (op.t === 'erase' && op.what === 'text') e.text.push(op.rect);
        else if (op.t === 'erase' && op.what === 'image') e.image.push({ rect: op.rect, pixels: !!op.pixels });
        else if (op.t === 'redact') e.redact.push(op.rect);
      }
    }
    const r = await docs.call('editStage1', { file: s.file, edits, forms: s.id === 'o' ? forms : [] });
    stage[s.id] = { ...r, doc: await PDFDocument.load(r.pdf, { ignoreEncryption: true, updateMetadata: false }) };
  }
  // ---- stage 2: assemble on the original document so its form, outline and metadata survive
  const base = stage.o.doc; const origPages = base.getPages();
  const fonts = new Map(); const font = async (f) => { const k = fontKey(f.font, f.bold, f.italic); if (!fonts.has(k)) fonts.set(k, await base.embedFont(k)); return fonts.get(k); };
  const imgCache = new Map();
  const embed = async (data) => { if (imgCache.has(data)) return imgCache.get(data); const { mime, bytes } = dataBytes(data); const im = /jpe?g/.test(mime) ? await base.embedJpg(bytes) : await base.embedPng(bytes); imgCache.set(data, im); return im; };
  const finalPages = []; let drawn = 0;
  for (const p of pages) {
    let pg, ctm;
    if (p.blank) { const [w, h] = p.size || [595.28, 841.89]; pg = base.addPage([w, h]); base.removePage(base.getPageCount() - 1); ctm = [1, 0, 0, -1, 0, h]; }
    else if (p.src === 'o') { pg = origPages[p.index]; ctm = stage.o.ctms[p.index]; }
    else { [pg] = await base.copyPages(stage[p.src].doc, [p.index]); ctm = stage[p.src].ctms[p.index]; }
    const place = placer(ctm);
    for (const op of items[keyOf(p)] || []) {
      const [x, y, w, h] = op.rect;
      if (op.t === 'whiteout') { const a = place(x, y + h); pg.drawRectangle({ x: a.x, y: a.y, width: w * a.sx, height: h * a.sy, rotate: a.rotate, color: col(op.color || '#ffffff'), borderWidth: 0 }); drawn++; }
      else if (op.t === 'image') { const im = await embed(op.data); const a = place(x, y + h); pg.drawImage(im, { x: a.x, y: a.y, width: w * a.sx, height: h * a.sy, rotate: a.rotate, opacity: op.opacity ?? 1 }); drawn++; }
      else if (op.t === 'text') {
        if (op.png) { const im = await embed(op.png); const a = place(x, y + h); pg.drawImage(im, { x: a.x, y: a.y, width: w * a.sx, height: h * a.sy, rotate: a.rotate }); drawn++; continue; }
        const f = await font(op); const size = op.size || 12; const lh = size * (op.lineHeight || 1.2); const base0 = op.baseline != null ? op.baseline : size * 0.8;
        const lines = String(op.text || '').split('\n');
        lines.forEach((ln, i) => {
          if (!ln) return; let tw; try { tw = f.widthOfTextAtSize(ln, size); } catch (_) { ln = ln.replace(/[^\x20-\x7e\xa0-\xff]/g, '?'); tw = f.widthOfTextAtSize(ln, size); }
          const dx = op.align === 'center' ? (w - tw) / 2 : op.align === 'right' ? w - tw : 0;
          const a = place(x + dx, y + base0 + i * lh);
          pg.drawText(ln, { x: a.x, y: a.y, size: size * a.sx, font: f, color: col(op.color), rotate: a.rotate });
        });
        drawn++;
      }
    }
    if (p.rot) pg.setRotation(degrees((((pg.getRotation().angle || 0) + p.rot) % 360 + 360) % 360));
    finalPages.push(pg);
  }
  // rebuild the page tree in the requested order (pages that are not listed are deleted)
  while (base.getPageCount()) base.removePage(0);
  for (const pg of finalPages) base.addPage(pg);
  base.setModificationDate(new Date()); base.setProducer('Mamba Reader PDF editor (offline)');
  const bytes = await base.save({ useObjectStreams: true });
  const tmp = path.join(path.dirname(out), `.${path.basename(out)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, bytes); fs.renameSync(tmp, out);
  return { out, pages: finalPages.length, drawn, removed: Object.values(stage).reduce((a, s) => a + s.removed, 0), filled: stage.o.filled, size: bytes.length };
}

/** "<name> (edited).pdf", "<name> (edited 2).pdf", … next to the original. */
function editedName(file) {
  const dir = path.dirname(file), b = path.basename(file, path.extname(file)).replace(/ \(edited(?: \d+)?\)$/, '');
  for (let i = 1; ; i++) { const f = path.join(dir, `${b} (edited${i > 1 ? ' ' + i : ''}).pdf`); if (!fs.existsSync(f)) return f; }
}
module.exports = { saveEdit, editedName, placer };
