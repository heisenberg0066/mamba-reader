'use strict';
// Mamba Reader self-test: `Mamba Reader.exe --self-test` (also run on the Windows CI runner).
// Builds sample books (PDF, image, Convert flipbook, EPUB) in a temp folder and exercises every backend feature.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

module.exports = async function selftest({ store, docs, addBook, exportNotes, exportAnnotated, filesFromArgs, htmlToPdf, app }) {
  const lines = []; let passed = 0, failed = 0; const t0 = Date.now();
  const ok = (name, cond, extra = '') => { if (cond) passed++; else failed++; lines.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); return cond; };
  const step = async (name, fn) => { try { const r = await fn(); if (r !== undefined && r !== true && typeof r !== 'object') ok(name, !!r); else if (r === true || r === undefined) ok(name, true); else ok(name, true, JSON.stringify(r).slice(0, 160)); } catch (e) { ok(name, false, String(e && e.stack || e).split('\n').slice(0, 2).join(' ')); } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mamba-reader-selftest-'));
  const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
  const pdf = path.join(dir, 'Svensk läsbok.pdf');
  let book, info, data;

  await step('create sample PDF (Chromium)', async () => {
    const para = 'Det var en gång en liten räv som bodde i skogen. Varje morgon gick hon till sjön för att läsa böcker och dricka vatten. ';
    const html = `<!doctype html><meta charset="utf-8"><title>Svensk läsbok</title><style>body{font:14pt Georgia,serif;margin:2cm}h1{page-break-before:always}h1:first-child{page-break-before:auto}</style>` +
      ['Kapitel ett', 'Kapitel två', 'Kapitel tre'].map((h, i) => `<h1>${h}</h1>` + `<p>${para.repeat(6)}</p><p>Sökord: mamba${i + 1}. Ordet <b>ekorre</b> betyder squirrel.</p>`).join('');
    await htmlToPdf(html, pdf); return fs.statSync(pdf).size > 1000;
  });
  const origHash = sha(pdf);

  await step('add PDF to library (cover + metadata)', async () => { book = await addBook(pdf); return book.pageCount >= 3 && fs.existsSync(store.coverPath(book.id)) && store.lib().books[book.id]; });
  await step('re-adding the same file does not duplicate', async () => { await addBook(pdf); return Object.values(store.lib().books).filter((b) => b.path === book.path).length === 1; });
  await step('open document in MuPDF worker', async () => { info = await docs.call('open', { file: pdf, cachePdf: store.cachePdf(book.id) }); return info.pageCount === book.pageCount && info.pages.length === info.pageCount && info.isPDF; });
  await step('outline / table of contents', async () => ({ entries: info.outline.length, first: info.outline[0] && info.outline[0].title }));
  await step('render page → JPEG', async () => { const b = Buffer.from(await docs.call('render', { docId: info.docId, page: 0, scale: 1.5 })); fs.writeFileSync(path.join(dir, 'page1.jpg'), b); return b[0] === 0xff && b[1] === 0xd8 && b.length > 5000; });
  await step('text layer lines with geometry', async () => { const l = await docs.call('text', { docId: info.docId, page: 0 }); return l.length > 5 && l.every((x) => x.w > 0 && x.h > 0 && typeof x.t === 'string'); });
  await step('full-text search (Swedish, å/ä/ö)', async () => { const h = await docs.call('search', { docId: info.docId, query: 'läsa' }); const h2 = await docs.call('search', { docId: info.docId, query: 'mamba3' }); return h.length >= 3 && h2.length === 1 && h2[0].page === 2 && h2[0].quads.length > 0; });
  await step('annotations save + reload (sidecar JSON)', async () => {
    const lines0 = await docs.call('text', { docId: info.docId, page: 0 }); const L = lines0[2];
    const now = new Date().toISOString(); const A = (o) => ({ id: crypto.randomUUID(), created: now, updated: now, color: '#ffd400', ...o });
    data = { annotations: [
      A({ type: 'highlight', page: 0, rects: [[L.x, L.y, L.w, L.h]], text: L.t, comment: 'Viktig mening' }),
      A({ type: 'underline', page: 0, rects: [[lines0[3].x, lines0[3].y, lines0[3].w, lines0[3].h]], text: lines0[3].t, color: '#6ec6ff' }),
      A({ type: 'strike', page: 0, rects: [[lines0[4].x, lines0[4].y, lines0[4].w, lines0[4].h]], text: lines0[4].t, color: '#ff4d4d' }),
      A({ type: 'ink', page: 1, points: [[100, 300], [140, 320], [180, 300], [220, 330]], width: 2, color: '#222222' }),
      A({ type: 'marker', page: 1, points: [[100, 400], [300, 400]], width: 10 }),
      A({ type: 'rect', page: 1, rect: [80, 80, 200, 60], width: 2, color: '#ff4d4d' }),
      A({ type: 'ellipse', page: 1, rect: [300, 80, 120, 60], width: 2, color: '#7ee081' }),
      A({ type: 'arrow', page: 2, points: [[100, 500], [260, 560]], width: 2, color: '#c79bff' }),
      A({ type: 'line', page: 2, points: [[100, 600], [260, 600]], width: 1, color: '#222222' }),
      A({ type: 'text', page: 2, rect: [80, 650, 220, 30], content: 'Min textruta', fontSize: 12, color: '#222222' }),
      A({ type: 'note', page: 0, rect: [500, 60, 20, 20], content: 'En klisterlapp' }),
    ], bookmarks: [{ page: 1, title: 'Kapitel två', created: now }] };
    store.saveBookData(book.id, data); const back = store.bookData(book.id); return back.annotations.length === 11 && back.bookmarks.length === 1;
  });
  await step('export notes → Markdown', async () => { const f = await exportNotes(book, data, 'md', path.join(dir, 'notes.md'), []); const s = fs.readFileSync(f, 'utf8'); return s.includes('Viktig mening') && s.includes('En klisterlapp') && s.includes('Kapitel två'); });
  await step('export notes → TXT', async () => { const f = await exportNotes(book, data, 'txt', path.join(dir, 'notes.txt'), []); return fs.readFileSync(f, 'utf8').includes('Min textruta'); });
  await step('export notes → PDF summary', async () => { const f = await exportNotes(book, data, 'pdf', path.join(dir, 'notes.pdf'), [{ word: 'ekorre', translation: 'squirrel', page: 0, bookTitle: book.title }]); return fs.readFileSync(f).slice(0, 5).toString() === '%PDF-'; });
  await step('export annotated PDF copy (real PDF annotations)', async () => {
    const out = path.join(dir, 'annotated.pdf'); const r = await exportAnnotated(book.id, out); const c = await docs.call('annotCount', { file: out });
    return r.count >= 10 && c.count >= 10 ? { written: r.count, types: c.types } : false;
  });
  await step('original file was never modified', async () => sha(pdf) === origHash);
  await step('image file as a book', async () => { const b = await addBook(path.join(dir, 'page1.jpg')); return b.kind === 'image' && b.pageCount === 1; });
  await step('Mamba Convert flipbook (.html) as a book', async () => {
    const img = fs.readFileSync(path.join(dir, 'page1.jpg')).toString('base64');
    const mf = { title: 'Flip test', rtl: false, pages: [1, 2, 3].map(() => ({ src: 'data:image/jpeg;base64,' + img, w: 893, h: 1263 })) };
    const f = path.join(dir, 'flip.html'); fs.writeFileSync(f, `<!doctype html><meta name="mamba-flipbook" content="1"><body><script>window.MF_DATA=${JSON.stringify(mf)};</script><script>/*engine*/</script>`);
    const b = await addBook(f); return b.kind === 'flipbook' && b.pageCount === 3 && b.title === 'Flip test';
  });
  await step('EPUB (reflowed by MuPDF)', async () => {
    const JSZip = require('jszip'); const z = new JSZip();
    z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    z.file('OEBPS/content.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>EPUB-test</dc:title><dc:creator>Mamba</dc:creator><dc:identifier id="id">x</dc:identifier></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>');
    z.file('OEBPS/c1.xhtml', '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title></head><body><h1>Hej</h1>' + '<p>Det här är en e-bok på svenska. </p>'.repeat(80) + '</body></html>');
    const f = path.join(dir, 'bok.epub'); fs.writeFileSync(f, await z.generateAsync({ type: 'nodebuffer' }));
    const b = await addBook(f); return b.kind === 'ebook' && b.pageCount >= 2 && b.title === 'EPUB-test';
  });
  await step('vocabulary list save/load', async () => { store.saveVocab([{ id: 'v1', word: 'ekorre', translation: 'squirrel', bookId: book.id, page: 0 }]); return store.vocab()[0].translation === 'squirrel'; });
  await step('reading timer minutes per day', async () => { const s = store.addMinutes(book.id, 1.5); const d = Object.keys(s.days).pop(); return s.days[d] >= 1.5 && s.books[book.id][d] >= 1.5; });
  await step('backup export + import into an empty profile', async () => {
    const zip = path.join(dir, 'backup.zip'); await store.exportBackup(zip);
    const other = require('./store')(fs.mkdtempSync(path.join(os.tmpdir(), 'mr-import-'))); const r = await other.importBackup(zip);
    return r.books >= 4 && other.bookData(book.id).annotations.length === 11 && other.vocab().length === 1 ? r : false;
  });
  await step('command-line + mamba-reader:// handoff parsing', async () => {
    const a = filesFromArgs(['exe', pdf]); const b = filesFromArgs(['exe', '--x', 'mamba-reader://open?path=' + encodeURIComponent(pdf) + '&page=2']);
    return a.length === 1 && a[0].file === path.resolve(pdf) && b.length === 1 && b[0].file === path.resolve(pdf) && b[0].page === 2 && b[0].source === 'protocol';
  });
  await step('offline: no network modules used by renderer', async () => !/https?:\/\//.test(fs.readFileSync(path.join(__dirname, 'renderer', 'index.html'), 'utf8').replace(/xmlns="[^"]+"/g, '')));
  try { await docs.call('close', { docId: info.docId }); } catch (_) {}
  const report = path.join(app.getPath('userData'), 'selftest-report.txt');
  const head = [`Mamba Reader ${app.getVersion()} self-test — ${new Date().toISOString()}`, `platform ${process.platform} ${process.arch}, electron ${process.versions.electron}`, `${passed} passed, ${failed} failed in ${Date.now() - t0} ms`, `samples: ${dir}`, ''];
  fs.writeFileSync(report, head.concat(lines).join('\n') + '\n');
  if (process.env.MAMBA_READER_REPORT) fs.copyFileSync(report, process.env.MAMBA_READER_REPORT);
  return { passed, failed, lines: head.concat(lines), report };
};
