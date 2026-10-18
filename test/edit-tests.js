'use strict';
// PDF editor engine tests (Node, no Electron): node test/edit-tests.js
const fs = require('fs'); const path = require('path'); const os = require('os'); const crypto = require('crypto');
const { makeFixture } = require('./edit-fixture');
const { saveEdit, editedName } = require('../src/pdfedit');
const docs = require('../src/docclient')();
let passed = 0, failed = 0; const lines = [];
const ok = (n, c, x = '') => { c ? passed++ : failed++; lines.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-edit-'));
  const fx = await makeFixture(); const file = path.join(dir, 'invoice.pdf'), mfile = path.join(dir, 'appendix.pdf');
  fs.writeFileSync(file, fx.main); fs.writeFileSync(mfile, fx.merge); const h0 = hash(file);
  const info = await docs.call('open', { file }); const docId = info.docId;
  const e0 = await docs.call('editInfo', { docId, page: 0 });
  const L = (s) => e0.lines.find((l) => l.text.includes(s));
  ok('editInfo finds text lines with their style', !!L('Invoice for') && L('Invoice for').bold && L('Invoice for').font === 'Helvetica' && Math.abs(L('Invoice for').size - 22) < 0.5, JSON.stringify(L('Invoice for') && { f: L('Invoice for').font, b: L('Invoice for').bold, s: L('Invoice for').size, c: L('Invoice for').color }));
  ok('editInfo reads the text colour', L('Invoice for') && L('Invoice for').color === '#1a3399', L('Invoice for') && L('Invoice for').color);
  ok('editInfo finds the image', e0.images.length === 1 && Math.abs(e0.images[0].bbox[2] - 120) < 1, JSON.stringify(e0.images));
  ok('editInfo finds the form fields', ['name', 'agree', 'city'].every((n) => e0.widgets.some((w) => w.name === n)), e0.widgets.map((w) => `${w.name}:${w.type}`).join(','));
  const e1 = await docs.call('editInfo', { docId, page: 1 }); ok('serif text maps to Times', e1.lines[0] && e1.lines[0].font === 'Times', e1.lines[0] && e1.lines[0].fontName);
  const imgPng = await docs.call('imagePng', { docId, page: 0, i: 0 }); ok('existing image can be extracted as PNG', imgPng.slice(1, 4).toString() === 'PNG', imgPng.length + ' B');
  // ---- an edit like the UI produces
  const tot = L('Total amount'), del = L('will be deleted'), sec = L('Secret'), im = e0.images[0];
  const pad = (b) => [b[0] - 1, b[1] + b[3] * 0.15, b[2] + 2, b[3] * 0.7];
  const items = {
    'o:0': [
      { t: 'erase', what: 'text', rect: pad(tot.bbox) },
      { t: 'text', rect: [tot.bbox[0], tot.bbox[1], 300, tot.bbox[3]], text: 'Total amount: 990 SEK (Sälj)', font: tot.font, bold: tot.bold, italic: tot.italic, size: tot.size, color: tot.color, baseline: tot.baseline - tot.bbox[1] },
      { t: 'erase', what: 'text', rect: pad(del.bbox) },
      { t: 'erase', what: 'image', rect: im.bbox },
      { t: 'image', rect: [300, im.bbox[1] - 40, 180, 120], data: 'data:image/png;base64,' + imgPng.toString('base64') },
      { t: 'image', rect: [400, 60, 60, 60], data: 'data:image/png;base64,' + fx.png.toString('base64') },
      { t: 'redact', rect: [sec.bbox[0] - 2, sec.bbox[1] - 2, sec.bbox[2] + 4, sec.bbox[3] + 4] },
      { t: 'whiteout', rect: [40, 780, 200, 30], color: '#ffffff' },
      { t: 'text', rect: [300, 120, 200, 40], text: 'New note line one\nline two', font: 'Times', bold: false, italic: true, size: 12, color: '#cc0000', align: 'right' },
    ],
    'o:2': [{ t: 'text', rect: [60, 120, 200, 20], text: 'Added on rotated page', font: 'Helvetica', size: 12, color: '#000000' }],
    'b:1': [{ t: 'text', rect: [72, 72, 300, 20], text: 'Blank page note', font: 'Courier', bold: true, size: 14, color: '#000000' }],
    'm1:0': [{ t: 'erase', what: 'text', rect: [0, 0, 400, 300] }, { t: 'text', rect: [40, 40, 300, 30], text: 'Merged and edited', font: 'Helvetica', size: 16, color: '#000000' }],
  };
  const out = editedName(file); ok('Save names the copy "(edited)"', path.basename(out) === 'invoice (edited).pdf', path.basename(out));
  const model = {
    sources: [{ id: 'o', file }, { id: 'm1', file: mfile }],
    pages: [{ src: 'o', index: 0 }, { blank: true, id: 1, size: [595, 842] }, { src: 'm1', index: 0 }, { src: 'o', index: 2, rot: 90 }], // page 2 deleted, reordered, rotated
    items, forms: [{ name: 'name', value: 'Ammar Andersson' }, { name: 'agree', value: true }, { name: 'city', value: 'Malmö' }], out,
  };
  let r; try { r = await saveEdit(model, docs); ok('save writes the edited PDF', fs.existsSync(out), JSON.stringify(r)); } catch (e) { ok('save writes the edited PDF', false, e.stack); }
  ok('original file is untouched', hash(file) === h0);
  const x = await docs.call('inspect', { file: out }); const t0 = x.pages[0].text.map((l) => l.t).join(' | ');
  ok('page operations: delete, blank insert, merge, order', x.pageCount === 4 && x.pages[1].text.some((l) => /Blank page note/.test(l.t)) && x.pages[2].text.some((l) => /Merged and edited/.test(l.t)) && x.pages[3].text.some((l) => /Rotated page text/.test(l.t)), x.pages.map((p) => p.text.map((l) => l.t).join('/')).join(' || '));
  ok('replaced text: old value gone, new value present', !/1250/.test(t0) && /990 SEK \(Sälj\)/.test(t0), t0);
  const nl = x.pages[0].text.find((l) => /990 SEK/.test(l.t));
  ok('replacement keeps position and size', nl && Math.abs(nl.x - tot.bbox[0]) < 2 && Math.abs(nl.size - tot.size) < 0.6, nl && JSON.stringify({ x: nl.x, ox: tot.bbox[0], s: nl.size, f: nl.font }));
  ok('deleted text is gone', !/will be deleted/.test(t0));
  ok('neighbouring text is untouched', /Keep this line exactly as it is\./.test(t0) && /Invoice for Ammar Andersson/.test(t0));
  ok('redaction removes the text under it', !/4711/.test(t0) && !/Secret/.test(t0));
  const imgs = x.pages[0].images;
  ok('moved image: old place empty, new place filled, plus the inserted image', imgs.length === 2 && !imgs.some((b) => Math.abs(b[0] - im.bbox[0]) < 2 && Math.abs(b[1] - im.bbox[1]) < 2) && imgs.some((b) => Math.abs(b[0] - 300) < 2 && Math.abs(b[2] - 180) < 2) && imgs.some((b) => Math.abs(b[0] - 400) < 2), JSON.stringify(imgs.map((b) => b.map(Math.round))));
  ok('new multi-line text box', /New note line one/.test(t0) && /line two/.test(t0));
  ok('rotated page: rotation applied on top of the existing one', x.pages[3].rotate === 180, 'rotate=' + x.pages[3].rotate);
  const rp = x.pages[3].text.find((l) => /Added on rotated page/.test(l.t));
  const e2 = await docs.call('editInfo', { docId, page: 2 });
  ok('text added on a rotated page lands where it was placed', !!rp, rp && JSON.stringify({ x: rp.x, y: rp.y, size: x.pages[3].size, origSize: e2.size }));
  const out3 = path.join(dir, 'rot-only.pdf');
  await saveEdit({ sources: [{ id: 'o', file }], pages: [{ src: 'o', index: 2 }], items: { 'o:2': items['o:2'] }, forms: [], out: out3 }, docs);
  const x3 = await docs.call('inspect', { file: out3 }); const r3 = x3.pages[0].text.find((l) => /Added on rotated page/.test(l.t));
  ok('rotated page: added text appears exactly at its display position', r3 && Math.abs(r3.x - 60) < 1.5 && r3.y > 112 && r3.y < 124 && r3.w > r3.h, r3 && JSON.stringify({ x: r3.x, y: r3.y, w: r3.w, h: r3.h }));
  const f = Object.fromEntries((x.fields || []).map((w) => [w.name, w.value]));
  ok('form fields filled', f.name === 'Ammar Andersson' && f.agree && f.agree !== 'Off' && f.city === 'Malmö', JSON.stringify(f));
  // Save As over the original is allowed when the user explicitly picks it
  const r2 = await saveEdit({ ...model, pages: [{ src: 'o', index: 0 }], items: {}, forms: [], out: file }, docs).catch((e) => ({ error: e.message }));
  const x2 = await docs.call('inspect', { file }); ok('Save As over the original (explicit) works', !r2.error && x2.pageCount === 1, JSON.stringify(r2));
  docs.terminate();
  console.log(lines.join('\n')); console.log(`EDIT: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
