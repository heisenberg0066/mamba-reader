'use strict';
// Node-level tests (no Electron): MuPDF worker, store, notes, backup. Run: node test/run-tests.js
const fs = require('fs'); const path = require('path'); const os = require('os'); const assert = require('assert');
const createStore = require('../src/store'); const notes = require('../src/notes'); const docclient = require('../src/docclient');
let passed = 0, failed = 0; const results = [];
async function t(name, fn) { try { await fn(); passed++; results.push('PASS  ' + name); } catch (e) { failed++; results.push('FAIL  ' + name + '  — ' + (e && e.message)); } }
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-test-')); const docs = docclient();
  const M = await import('mupdf');
  // build a sample PDF with MuPDF itself (3 pages of text + outline-free)
  const pdfFile = path.join(dir, 'sample.pdf');
  {
    const doc = new M.PDFDocument(); const font = doc.addSimpleFont(new M.Font('Times-Roman'));
    for (let i = 0; i < 3; i++) {
      const res = doc.addObject({ Font: { F1: font } });
      const content = `BT /F1 18 Tf 72 760 Td (Chapter ${i + 1}) Tj ET BT /F1 12 Tf 72 720 Td (The quick brown fox jumps over the lazy dog. Page ${i + 1} keyword${i + 1}.) Tj ET BT /F1 12 Tf 72 700 Td (Mamba Reader keeps your notes offline.) Tj ET`;
      doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, res, content));
    }
    fs.writeFileSync(pdfFile, doc.saveToBuffer('compress').asUint8Array());
  }
  let info;
  await t('worker opens PDF', async () => { info = await docs.call('open', { file: pdfFile }); assert.strictEqual(info.pageCount, 3); assert.deepStrictEqual(info.pages[0].map(Math.round), [595, 842]); assert.strictEqual(info.kind, 'pdf'); });
  await t('render JPEG at scale 2', async () => { const b = await docs.call('render', { docId: info.docId, page: 1, scale: 2 }); assert(b[0] === 0xff && b[1] === 0xd8); });
  await t('cover thumbnail', async () => { const b = await docs.call('cover', { docId: info.docId, width: 200 }); assert(b.length > 1000); });
  await t('text lines (top-left coordinates)', async () => { const l = await docs.call('text', { docId: info.docId, page: 0 }); assert(l.length >= 3); const ch = l.find((x) => /Chapter 1/.test(x.t)); assert(ch && ch.y < 100 && ch.x > 60 && ch.x < 80, JSON.stringify(ch)); });
  await t('search returns quads + snippet', async () => { const h = await docs.call('search', { docId: info.docId, query: 'keyword2' }); assert.strictEqual(h.length, 1); assert.strictEqual(h[0].page, 1); assert.strictEqual(h[0].quads[0].length, 8); assert(/keyword2/.test(h[0].snippet)); });
  await t('search is case-insensitive across pages', async () => { const h = await docs.call('search', { docId: info.docId, query: 'MAMBA reader' }); assert.strictEqual(h.length, 3); });
  await t('export annotated PDF writes real annotations', async () => {
    const out = path.join(dir, 'annotated.pdf');
    const annots = [{ type: 'highlight', page: 0, rects: [[72, 70, 200, 14]], color: '#ffd400', comment: 'c' }, { type: 'underline', page: 0, rects: [[72, 110, 200, 14]] }, { type: 'strike', page: 1, rects: [[72, 110, 200, 14]] }, { type: 'ink', page: 1, points: [[100, 300], [200, 350]], width: 2 }, { type: 'rect', page: 2, rect: [100, 100, 100, 50], width: 2 }, { type: 'ellipse', page: 2, rect: [100, 200, 100, 50], width: 2 }, { type: 'arrow', page: 2, points: [[100, 400], [300, 450]], width: 2 }, { type: 'text', page: 2, rect: [100, 500, 200, 30], content: 'Hello', fontSize: 12 }, { type: 'note', page: 0, rect: [500, 50, 20, 20], content: 'note' }];
    const r = await docs.call('exportAnnotated', { docId: info.docId, annots, out }); assert.strictEqual(r.count, 9);
    const c = await docs.call('annotCount', { file: out }); assert.strictEqual(c.count, 9); assert(c.types.Highlight && c.types.FreeText && c.types.Ink && c.types.Text);
  });
  await t('original untouched after export', async () => { const d = M.Document.openDocument(fs.readFileSync(pdfFile), 'application/pdf'); let n = 0; for (let i = 0; i < 3; i++) n += d.loadPage(i).getAnnotations().length; assert.strictEqual(n, 0); });
  await t('image file opens as 1-page book', async () => { const jpg = path.join(dir, 'p.jpg'); fs.writeFileSync(jpg, await docs.call('render', { docId: info.docId, page: 0, scale: 1 })); const i2 = await docs.call('open', { file: jpg }); assert.strictEqual(i2.pageCount, 1); assert.strictEqual(i2.kind, 'image'); });
  await t('Convert flipbook html (folder mode, relative pages) opens', async () => {
    const fb = path.join(dir, 'book-flipbook'); fs.mkdirSync(path.join(fb, 'pages'), { recursive: true });
    for (let i = 0; i < 2; i++) fs.writeFileSync(path.join(fb, 'pages', `p${i + 1}.jpg`), await docs.call('render', { docId: info.docId, page: i, scale: 1 }));
    fs.writeFileSync(path.join(fb, 'index.html'), `<html><meta name="mamba-flipbook" content="1"><script>window.MF_DATA=${JSON.stringify({ title: 'FB', rtl: true, pages: [{ src: 'pages/p1.jpg', w: 595, h: 842 }, { src: 'pages/p2.jpg', w: 595, h: 842 }] })};</script></html>`);
    const cache = path.join(dir, 'fb.pdf'); const i3 = await docs.call('open', { file: path.join(fb, 'index.html'), cachePdf: cache }); assert.strictEqual(i3.pageCount, 2); assert.strictEqual(i3.kind, 'flipbook'); assert.strictEqual(i3.rtl, true); assert(fs.existsSync(cache));
  });
  await t('non-flipbook html is rejected', async () => { const f = path.join(dir, 'x.html'); fs.writeFileSync(f, '<p>hi</p>'); await assert.rejects(docs.call('open', { file: f })); });
  const store = createStore(path.join(dir, 'data'));
  await t('store: library + sidecar data', () => { const l = store.lib(); l.books.a = { id: 'a', title: 'A', path: pdfFile }; store.saveLib(l); store.saveBookData('a', { annotations: [{ id: 1, page: 0, type: 'highlight', updated: '2026-01-01' }], bookmarks: [] }); assert.strictEqual(store.lib().books.a.title, 'A'); assert.strictEqual(store.bookData('a').annotations.length, 1); });
  await t('store: stable id from content', () => { const id1 = store.idFor(pdfFile); const cp = path.join(dir, 'copy.pdf'); fs.copyFileSync(pdfFile, cp); assert.strictEqual(store.idFor(cp), id1); assert.strictEqual(id1.length, 16); });
  await t('store: minutes per day', () => { store.addMinutes('a', 2, '2026-10-18'); const s = store.addMinutes('a', 1.5, '2026-10-18'); assert.strictEqual(s.days['2026-10-18'], 3.5); assert.strictEqual(s.books.a['2026-10-18'], 3.5); });
  await t('store: backup roundtrip with merge (newest wins)', async () => {
    const zip = path.join(dir, 'b.zip'); await store.exportBackup(zip); const s2 = createStore(path.join(dir, 'data2'));
    s2.saveBookData('a', { annotations: [{ id: 1, page: 0, type: 'highlight', updated: '2025-01-01', comment: 'old' }, { id: 2, page: 1, type: 'ink', updated: '2025-01-01' }], bookmarks: [] });
    const r = await s2.importBackup(zip); const d = s2.bookData('a'); assert.strictEqual(d.annotations.length, 2); assert.strictEqual(d.annotations.find((x) => x.id === 1).comment, undefined); assert(r.books >= 1);
  });
  await t('notes: markdown/text/html', () => {
    const b = { title: 'Bok', author: 'X', pageCount: 3 }; const data = { annotations: [{ type: 'highlight', page: 0, text: 'citat', comment: 'kommentar', color: '#ffd400' }, { type: 'note', page: 1, content: 'lapp' }], bookmarks: [{ page: 2, title: 'bm' }] };
    const md = notes.toMarkdown(b, data, [{ word: 'hej', translation: 'hello', bookTitle: 'Bok', page: 0 }]); assert(/# Bok/.test(md) && /citat/.test(md) && /lapp/.test(md) && /hej/.test(md) && /bm/.test(md));
    assert(/kommentar/.test(notes.toText(b, data, []))); assert(/<html/i.test(notes.toHtml(b, data, [])));
  });
  await t('notes: vocabulary CSV escapes quotes', () => { const c = notes.vocabCsv([{ word: 'a"b', translation: 'x,y', page: 0 }]); assert(c.includes('"a""b","x,y"')); });
  docs.terminate();
  console.log(results.join('\n')); console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
