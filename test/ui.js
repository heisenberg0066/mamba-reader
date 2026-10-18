// Runs inside the Mamba Reader renderer (MAMBA_READER_UITEST=test/ui.js). Library must already hold the self-test samples.
(async () => {
  const lines = []; let passed = 0, failed = 0;
  const ok = (n, c, x = '') => { c ? passed++ : failed++; lines.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch (_) {} await sleep(60); } return null; };
  const step = async (n, fn) => { try { const r = await fn(); ok(n, r !== false && r != null, typeof r === 'string' ? r : ''); } catch (e) { ok(n, false, String(e && e.message || e)); } };
  const { R, Lib } = window.__reader; const $ = (s) => document.querySelector(s); const $$ = (s) => [...document.querySelectorAll(s)];
  const ptr = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  const drag = async (p, pts) => { const r = p.getBoundingClientRect(); const P = pts.map(([fx, fy]) => [r.left + fx * r.width, r.top + fy * r.height]); ptr(p, 'pointerdown', ...P[0]); for (const q of P.slice(1)) { ptr(p, 'pointermove', ...q); await sleep(10); } ptr(p, 'pointerup', ...P[P.length - 1]); await sleep(60); };
  const visPage = (i) => $$(`.pgv[data-page="${i}"]`).find((p) => p.getBoundingClientRect().width > 50 && !p.closest('.mf-leaf'));
  const shot = (n) => api.test.shot(n);
  await api.test.size(1400, 900); await sleep(400);
  await api.setSettings({ lang: 'en', theme: 'light', mode: 'flip' });
  const pdf = Lib.books.find((b) => b.kind === 'pdf'); const n0 = (await api.test.bookData(pdf.id)).annotations.length;
  await step('library shows sample books with covers', () => $$('#shelf .book').length >= 4 && $$('#shelf .book img').length >= 4);
  await step('library search filters', async () => { $('#libSearch').value = 'epub'; $('#libSearch').oninput(); const n = $$('#shelf .book').length; $('#libSearch').value = ''; $('#libSearch').oninput(); return n === 1; });
  await step('tags: add tag and filter by it', async () => { await api.libUpdate(pdf.id, { tags: ['svenska', 'skola'] }); await Lib.load(); return $$('#tagBar .tag').length === 3 && $$('#shelf .book .bt span').length === 2; });
  await shot('01-library');
  await step('open PDF in flip mode', async () => { await R.open(pdf.id, 0); return R.mode === 'flip' && !!(await until(() => visPage(0) && visPage(0)._img.complete && visPage(0)._img.naturalWidth > 0)); });
  await step('text layer built', async () => !!(await until(() => visPage(0)._tl.children.length > 5)));
  await step('existing annotations drawn', () => visPage(0)._svg.querySelectorAll('.hit').length >= 3);
  await step('select text → popup → highlight in green', async () => {
    const sp = visPage(0)._tl.children[6]; const rg = document.createRange(); rg.setStart(sp.firstChild, 0); rg.setEnd(sp.firstChild, Math.min(20, sp.textContent.length));
    getSelection().removeAllRanges(); getSelection().addRange(rg); sp.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await until(() => !$('#selPop').classList.contains('hidden'), 2000); const before = R.data.annotations.length;
    $$('#selPop button')[1].click(); return R.data.annotations.length === before + 1 && R.data.annotations.at(-1).type === 'highlight' && R.data.annotations.at(-1).color === '#7ee081' && R.data.annotations.at(-1).text.length > 3;
  });
  await step('highlight tool on selection (auto apply)', async () => {
    R.setTool('highlight'); const sp = visPage(0)._tl.children[8]; const rg = document.createRange(); rg.selectNodeContents(sp); getSelection().removeAllRanges(); getSelection().addRange(rg);
    const before = R.data.annotations.length; sp.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await sleep(120); R.setTool('select'); return R.data.annotations.length === before + 1;
  });
  await step('drawing tools lock page-turning', () => { R.setTool('ink'); const l = R.flip.locked; R.setTool('select'); return l && !R.flip.locked; });
  await step('pen stroke', async () => { R.setTool('ink'); const b = R.data.annotations.length; await drag(visPage(0), [[0.2, 0.6], [0.3, 0.65], [0.4, 0.6], [0.5, 0.66]]); return R.data.annotations.length === b + 1 && R.data.annotations.at(-1).points.length >= 3; });
  await step('marker stroke', async () => { R.setTool('marker'); const b = R.data.annotations.length; await drag(visPage(0), [[0.2, 0.72], [0.6, 0.72]]); return R.data.annotations.length === b + 1 && R.data.annotations.at(-1).type === 'marker'; });
  await step('rectangle, ellipse, line, arrow', async () => { const b = R.data.annotations.length; for (const [tl, y] of [['rect', 0.78], ['ellipse', 0.78], ['line', 0.9], ['arrow', 0.93]]) { R.setTool(tl); await drag(visPage(0), tl === 'ellipse' ? [[0.55, y], [0.75, y + 0.06]] : [[0.15, y], [0.4, y + 0.05]]); } return R.data.annotations.length === b + 4; });
  await step('eraser removes a pen stroke', async () => { R.setTool('eraser'); const p = visPage(0); const b = R.data.annotations.filter((a) => a.type === 'ink' && a.page === 0).length; const r = p.getBoundingClientRect(); const a = R.data.annotations.filter((x) => x.type === 'ink' && x.page === 0).at(-1); const [x, y] = a.points[1]; ptr(p, 'pointerdown', r.left + (x / R.pw(0)) * r.width, r.top + (y / R.ph(0)) * r.height); ptr(p, 'pointerup', 0, 0); await sleep(60); return R.data.annotations.filter((a) => a.type === 'ink' && a.page === 0).length === b - 1; });
  await step('undo (Ctrl+Z) brings it back', async () => { R.setTool('select'); const b = R.data.annotations.length; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); await sleep(50); return R.data.annotations.length === b + 1; });
  await step('sticky note with text', async () => { R.setTool('note'); const p = visPage(0); const r = p.getBoundingClientRect(); ptr(p, 'pointerdown', r.left + r.width * 0.85, r.top + r.height * 0.5); await sleep(80); const ta = $('#annPop textarea'); ta.value = 'Kom ihåg detta'; $('#annPop .primary').click(); R.setTool('select'); const a = R.data.annotations.at(-1); return a.type === 'note' && a.content === 'Kom ihåg detta'; });
  await step('comment on a highlight', async () => { const a = R.data.annotations.find((x) => x.type === 'highlight' && x.page === 0); R.annPop(a, { clientX: 300, clientY: 300 }); $('#annPop textarea').value = 'kommentar'; $('#annPop .primary').click(); return a.comment === 'kommentar' && !!visPage(0)._ol.querySelector('.nt'); });
  await step('text box', async () => { R.setTool('text'); const p = visPage(0); const r = p.getBoundingClientRect(); ptr(p, 'pointerdown', r.left + r.width * 0.1, r.top + r.height * 0.05); await sleep(100); const tb = visPage(0).querySelector('.tb:focus') || [...visPage(0).querySelectorAll('.tb')].at(-1); tb.innerText = 'Anteckning'; tb.dispatchEvent(new Event('input')); R.setTool('select'); return R.data.annotations.at(-1).type === 'text' && R.data.annotations.at(-1).content === 'Anteckning'; });
  await step('annotations panel lists, filters & searches', async () => { R.showPanel('notes'); R.renderNotes(); const all = $$('#noteList .it').length; $('#noteType').value = 'highlight'; R.renderNotes(); const hl = $$('#noteList .it').length; $('#noteType').value = ''; $('#noteSearch').value = 'ihåg'; R.renderNotes(); const s = $$('#noteList .it').length; $('#noteSearch').value = ''; R.renderNotes(); return all >= 15 && hl >= 3 && hl < all && s === 1 ? `${all} items` : false; });
  await shot('02-flip-annotations');
  await step('autosave to sidecar JSON', async () => { R.flushSave(); await sleep(200); const d = await api.test.bookData(pdf.id); return d.annotations.length === R.data.annotations.length && d.annotations.length > n0 ? `${d.annotations.length} saved` : false; });
  await step('page flip forward (animated)', async () => { R.next(); return !!(await until(() => R.cur >= 1 && !R.flip.state().animating, 3000)); });
  await step('go-to-page input', async () => { $('#pgInput').value = '3'; $('#pgInput').onchange({ target: $('#pgInput') }); return !!(await until(() => R.flip.state().visible.includes(2) && !R.flip.state().animating, 3000)); });
  await step('bookmark with B key', async () => { const b = R.data.bookmarks.length; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true })); return R.data.bookmarks.length !== b && $('#bmBtn').textContent.length === 1; });
  await step('full-text search + jump', async () => { R.showPanel('search'); $('#searchInput').value = 'mamba1'; R.runSearch(); await until(() => $$('#searchList .it').length === 1, 3000); $$('#searchList .it')[0].click(); return !!(await until(() => R.flip.state().visible.includes(0) && !R.flip.state().animating, 3000)) && !!(await until(() => visPage(0) && visPage(0)._svg.querySelector('.srch'))); });
  await step('outline panel', () => { R.showPanel('outline'); return $$('#outlineList > div').length === 3; });
  await step('thumbnails panel', async () => { R.showPanel('thumbs'); return !!(await until(() => $$('#thumbList img').filter((i) => i.complete && i.naturalWidth).length >= 3)); });
  await step('zoom in flip mode', async () => { R.zoomBy(1.5); await sleep(50); const z = $('#zoomVal').textContent; R.setZoom(1); return z === '150%'; });
  await step('save a vocabulary word from a selection', async () => {
    const sp = visPage(0)._tl.children[3]; const rg = document.createRange(); rg.setStart(sp.firstChild, 0); rg.setEnd(sp.firstChild, sp.textContent.indexOf(' ') > 0 ? sp.textContent.indexOf(' ') : 3); getSelection().removeAllRanges(); getSelection().addRange(rg);
    const info = R.selectionInfo(); const b = Lib.vocab.length; R.wordPop(info, { clientX: 400, clientY: 300 }); $$('#annPop input')[1].value = 'översättning'; $('#annPop .primary').click(); await sleep(150); R.showPanel('words');
    return Lib.vocab.length === b + 1 && Lib.vocab.at(-1).translation === 'översättning' && $$('#wordList .it').length >= 1;
  });
  await step('scroll mode with lazy pages', async () => { $$('#modeSeg button')[1].click(); await sleep(300); return R.mode === 'scroll' && !!(await until(() => $$('#scrollView .pgv').length >= 1 && $('#scrollView .pgv img').complete)); });
  await step('scroll mode go to page 3', async () => { R.go(2, true); await sleep(400); return R.cur === 2; });
  await step('scroll mode zoom', async () => { const w0 = R.wrappers[0]._w; R.zoomBy(1.25); await sleep(200); const w1 = R.wrappers[0]._w; R.setZoom(1); return w1 > w0 * 1.2; });
  await step('annotations visible in scroll mode', async () => { await sleep(300); R.go(0, true); const r = await until(() => visPage(0) && visPage(0)._svg.querySelectorAll('.hit').length >= 6); if (!r) throw new Error('hits=' + (visPage(0) ? visPage(0)._svg.querySelectorAll('.hit').length : 'nopage') + ' p0annots=' + R.data.annotations.filter((a) => a.page === 0).length); return true; });
  R.go(0, true); await sleep(600); await shot('03-scroll-mode');
  await step('sepia theme', async () => { $('#themeSel').value = 'sepia'; await $('#themeSel').onchange({ target: $('#themeSel') }); await sleep(300); return document.body.classList.contains('theme-sepia'); });
  await shot('04-sepia');
  await step('dark theme', async () => { $('#themeSel').value = 'dark'; await $('#themeSel').onchange({ target: $('#themeSel') }); $$('#modeSeg button')[0].click(); await sleep(900); return document.body.classList.contains('theme-dark'); });
  await shot('05-dark-flip');
  $('#themeSel').value = 'light'; await $('#themeSel').onchange({ target: $('#themeSel') });
  await step('Arabic RTL interface', async () => { $('.lang button[data-lang="ar"]').click(); await sleep(300); return document.documentElement.dir === 'rtl' && $('#backLib').title.length > 0 && /[\u0600-\u06FF]/.test(document.body.innerText); });
  R.showPanel('notes'); await sleep(300); await shot('06-arabic');
  $('.lang button[data-lang="en"]').click(); await sleep(200);
  await step('reading progress & resume position saved', async () => { R.go(2, true); await sleep(900); await R.close(); await sleep(300); const b = Lib.books.find((x) => x.id === pdf.id); return b.lastPage >= 1 && b.progress > 0.9 && b.lastOpened ? `page ${b.lastPage + 1}` : false; });
  await step('continue-reading card on library', () => $$('#continueRow .cont').length === 1);
  await step('vocabulary manager modal', async () => { $('#vocabOpen').click(); await sleep(100); const n = $$('#mBody table tr').length; await shot('07-vocabulary'); $('#mClose').click(); return n >= 3; });
  await step('open EPUB', async () => { const b = Lib.books.find((x) => x.kind === 'ebook'); await R.open(b.id, 0); return !!(await until(() => visPage(0) && visPage(0)._img.naturalWidth > 0)); });
  await shot('08-epub');
  await step('open Convert flipbook (.html)', async () => { const b = Lib.books.find((x) => x.kind === 'flipbook'); await R.open(b.id, 0); return R.info.pageCount === 3 && !!(await until(() => visPage(0) && visPage(0)._img.naturalWidth > 0)); });
  await step('mamba-reader:// handoff opens the book', async () => {
    await R.close(); const url = 'mamba-reader://open?path=' + encodeURIComponent(pdf.path) + '&page=2'; await api.test.deliver([url]);
    const opened = await until(() => R.book && R.book.id === pdf.id && R.cur === 1, 6000); await sleep(300); const log = await api.test.handoffLog();
    if (!opened || !/"event":"opened".*"source":"protocol"/.test(log)) throw new Error('book=' + (R.book && R.book.id) + ' want ' + pdf.id + ' cur=' + R.cur + ' log=' + log.slice(-500));
    return opened && /"event":"received".*"source":"protocol"/.test(log) && /"event":"opened".*"source":"protocol"/.test(log);
  });
  await step('file-path argument handoff opens the book', async () => {
    const epub = Lib.books.find((x) => x.kind === 'ebook'); await api.test.deliver([epub.path]); const opened = await until(() => R.book && R.book.id === epub.id, 6000); await sleep(300); const log = await api.test.handoffLog();
    return opened && /"event":"opened".*"source":"argv"/.test(log);
  });
  return { passed, failed, lines };
})()
