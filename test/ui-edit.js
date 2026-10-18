// Runs inside the Mamba Reader renderer (MAMBA_READER_UITEST=test/ui-edit.js). Drives the PDF editor with real
// (OS-level) mouse and keyboard events through webContents.sendInputEvent, saves, and checks the saved PDF.
(async () => {
  const lines = []; let passed = 0, failed = 0;
  const ok = (n, c, x = '') => { c ? passed++ : failed++; lines.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (_) {} await sleep(80); } return null; };
  const step = async (n, fn) => { try { const r = await fn(); ok(n, r !== false && r != null, typeof r === 'string' ? r : ''); } catch (e) { ok(n, false, String(e && e.stack || e)); } };
  const $ = (s) => document.querySelector(s); const $$ = (s) => [...document.querySelectorAll(s)];
  const I = api.test.input; const shot = (n) => api.test.shot(n);
  const reveal = async (y) => { const m = $('#edMain'); const r = m.getBoundingClientRect(); if (y < r.top + 40 || y > r.bottom - 40) { const d = y - (r.top + r.height / 2); m.scrollTo({ top: m.scrollTop + d, behavior: 'instant' }); let last = -1; for (let i = 0; i < 30 && m.scrollTop !== last; i++) { last = m.scrollTop; await sleep(60); } await sleep(150); } };
  const pagePt = async (i, fx, fy) => { const pe = () => $(`#edMain .edpage[data-i="${i}"]`).getBoundingClientRect(); let r = pe(); await reveal(r.top + r.height * fy); r = pe(); return [Math.round(r.left + r.width * fx), Math.round(r.top + r.height * fy)]; };
  const centerV = async (e) => { let r = e.getBoundingClientRect(); await reveal(r.top + r.height / 2); return center(e); };
  const center = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; };
  const click = async (x, y, n = 1) => { await I({ type: 'mouseMove', x, y }); await I({ type: 'mouseDown', x, y, button: 'left', clickCount: n }); await I({ type: 'mouseUp', x, y, button: 'left', clickCount: n }); await sleep(120); };
  const dragTo = async (x0, y0, x1, y1, steps = 8) => { await I({ type: 'mouseMove', x: x0, y: y0 }); await I({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 }); for (let i = 1; i <= steps; i++) { await I({ type: 'mouseMove', x: Math.round(x0 + (x1 - x0) * i / steps), y: Math.round(y0 + (y1 - y0) * i / steps), button: 'left' }); await sleep(16); } await I({ type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1 }); await sleep(200); };
  const type = async (s) => { for (const ch of s) { await I({ type: 'char', keyCode: ch }); await sleep(6); } await sleep(80); };
  const key = async (k, mods = []) => { await I({ type: 'keyDown', keyCode: k, modifiers: mods }); await I({ type: 'keyUp', keyCode: k, modifiers: mods }); await sleep(80); };
  const E = window.Editor; const dir = await api.test.fixtures(); const sep = dir.includes('\\') ? '\\' : '/'; const file = dir + sep + 'invoice.pdf';
  const h0 = await api.test.hash(file); const allOps = () => Object.values(E.items).flat();
  await api.test.size(1440, 960); await api.setSettings({ lang: 'en' }); await sleep(300);
  const lineEl = (txt) => $$('#edMain .edpage[data-i="0"] .edline').find((e) => e.title.includes(txt));

  await step('Convert-style handoff "--edit <file>" opens the editor', async () => { await api.test.deliver(['--edit', file]); return !!(await until(() => document.body.classList.contains('editing') && $$('#edMain .edpage').length === 3 && $('#edMain .edpage img').complete)); });
  await step('handoff logged with mode "edit"', async () => /"mode":"edit"/.test(await api.test.handoffLog()));
  await step('page lines are detected for editing', async () => { E.setTool('text'); return !!(await until(() => lineEl('Total amount'))); });

  await step('click a line and retype it (real mouse + keyboard)', async () => {
    const [x, y] = await centerV(lineEl('Total amount')); await click(x, y);
    const ed = await until(() => $('.edtext[contenteditable="true"]')); if (!ed) return false;
    await key('a', ['control']); await type('Total amount: 990 SEK'); await click(1000, 120); // click elsewhere → commit
    const op = allOps().find((o) => o.t === 'text' && /990 SEK/.test(o.text)); return op ? `${op.font} ${op.size}pt ${op.color}${op.bold ? ' bold' : ''}` : false;
  });
  await shot('editor-1-text');
  await step('delete a line by clearing it', async () => {
    const [x, y] = await centerV(lineEl('will be deleted')); await click(x, y); await until(() => $('.edtext[contenteditable="true"]'));
    await key('a', ['control']); await key('Backspace'); await click(1000, 120);
    return allOps().some((o) => o.t === 'erase' && o.what === 'text') && !allOps().some((o) => o.t === 'text' && /deleted/.test(o.text));
  });
  await step('add a new text box (Swedish characters)', async () => {
    E.setTool('addtext'); const [px, py] = await pagePt(0, 0.55, 0.12); await click(px, py);
    await until(() => $('.edtext[contenteditable="true"]')); await type('Hej från Mamba – åäö'); await click(1000, 120);
    return allOps().some((o) => o.t === 'text' && o.text === 'Hej från Mamba – åäö');
  });
  await step('add Arabic text (rendered with shaping on save)', async () => {
    E.setTool('addtext'); const [px, py] = await pagePt(0, 0.55, 0.18); await click(px, py);
    await until(() => $('.edtext[contenteditable="true"]')); await type('مرحبا بك'); await click(1000, 120); return allOps().some((o) => o.t === 'text' && o.text === 'مرحبا بك');
  });
  await step('drag an existing image to a new place', async () => {
    E.setTool('select'); const im = $('#edMain .edpage[data-i="0"] .edoimg'); const [x, y] = await centerV(im); await dragTo(x, y, x + 260, y - 30);
    return !!(await until(() => allOps().some((o) => o.t === 'image' && o.img === 0) && allOps().some((o) => o.t === 'erase' && o.what === 'image')));
  });
  await step('resize it with the corner handle', async () => {
    const it = $('#edMain .editem.it-image.sel') || $('#edMain .editem.it-image'); const f = E.findOp(it.dataset.id); E.select({ kind: 'item', id: f.op.id }); await sleep(80);
    const w0 = f.op.rect[2]; const [hx, hy] = await centerV($('#edMain .editem.sel .hdl')); await dragTo(hx, hy, hx + 60, hy + 40); return f.op.rect[2] > w0 + 20 ? `${w0.toFixed(0)} → ${f.op.rect[2].toFixed(0)} pt` : false;
  });
  await step('replace that image with a chosen photo', async () => { await api.test.nextPick(dir + sep + 'photo.png'); const it = E.findOp(E.sel.id).op; const d0 = it.data; await E.replaceSel(); return it.data !== d0; });
  await step('insert a new image', async () => {
    await api.test.nextPick(dir + sep + 'photo.png'); E.setTool('image'); const [px, py] = await pagePt(0, 0.62, 0.62); await click(px, py);
    return !!(await until(() => allOps().filter((o) => o.t === 'image').length >= 2));
  });
  await step('whiteout an area by dragging', async () => { E.setTool('whiteout'); await pagePt(0, 0.76, 0.83); const pr = $('#edMain .edpage[data-i="0"]').getBoundingClientRect(); const [ax, ay, bx, by] = [pr.left + pr.width * 0.62, pr.top + pr.height * 0.80, pr.left + pr.width * 0.9, pr.top + pr.height * 0.86].map(Math.round); await dragTo(ax, ay, bx, by); return allOps().some((o) => o.t === 'whiteout'); });
  await step('redact the secret line', async () => { E.setTool('text'); await sleep(50); const se = lineEl('Secret'); await centerV(se); const s = se.getBoundingClientRect(); E.setTool('redact'); await sleep(50); await dragTo(Math.round(s.left - 4), Math.round(s.top - 3), Math.round(s.right + 4), Math.round(s.bottom + 3)); return allOps().some((o) => o.t === 'redact'); });
  await step('signature: draw with the mouse, save and place', async () => {
    await E.signDialog('signature'); const cv = await until(() => $('.sigcv')); const r = cv.getBoundingClientRect();
    const pts = [[0.1, 0.6], [0.2, 0.3], [0.3, 0.7], [0.4, 0.35], [0.5, 0.65], [0.62, 0.4], [0.75, 0.6], [0.88, 0.45]].map(([a, b]) => [Math.round(r.left + a * r.width), Math.round(r.top + b * r.height)]);
    await I({ type: 'mouseMove', x: pts[0][0], y: pts[0][1] }); await I({ type: 'mouseDown', x: pts[0][0], y: pts[0][1], button: 'left', clickCount: 1 });
    for (const [x, y] of pts.slice(1)) { await I({ type: 'mouseMove', x, y, button: 'left' }); await sleep(20); } await I({ type: 'mouseUp', x: pts.at(-1)[0], y: pts.at(-1)[1], button: 'left', clickCount: 1 });
    await shot('editor-2-signature'); $('#sigUse').click(); await until(() => E.tool === 'place');
    const [sx, sy] = await pagePt(0, 0.7, 0.92); await click(sx, sy);
    return allOps().filter((o) => o.t === 'image').length >= 3 && (await api.sigList()).length === 1;
  });
  await step('typed signature in handwriting font is saved for reuse', async () => { await E.signDialog('signature'); await sleep(150); const [tx, ty] = center($$('.sigdlg .seg button')[1]); await click(tx, ty); const inp = await until(() => $('.sigpane input')); await shot('dbg-type'); if (!inp) throw new Error('no input; tabs=' + $$('.sigdlg .seg button').map((b) => b.className + ':' + b.textContent).join(',') + ' pane=' + $('.sigpane').innerHTML.slice(0, 200)); await sleep(100); const [ix, iy] = center(inp); await click(ix, iy); await type('Ammar A.'); $('#sigUse').click(); const n = await until(async () => (await api.sigList()).length === 2); await until(() => !$('.sigdlg')); E.setTool('select'); if (!n) throw new Error('sigs=' + (await api.sigList()).length + ' modal=' + !!$('.sigdlg') + ' val=' + inp.value); return true; });
  await step('date stamp', async () => { E.dateStamp(); const [dx, dy] = await pagePt(0, 0.12, 0.95); await click(dx, dy); if (!allOps().some((o) => o.t === 'text' && /^\d{4}-\d\d-\d\d$/.test(o.text))) throw new Error('tool=' + E.tool + ' modal=' + !!$('.modal:not(.hidden), .sigdlg') + ' at ' + dx + ',' + dy + ' ' + JSON.stringify(E.pending)); return true; });
  await step('fill form fields on the page', async () => {
    const inp = $('#edMain .edpage[data-i="0"] .edfield input[type=text]'); const [x, y] = await centerV(inp); await click(x, y); await type('Ammar Andersson'); await key('Tab');
    const cb = $('#edMain .edpage[data-i="0"] .edfield input[type=checkbox]'); const [cx, cy] = await centerV(cb); await click(cx, cy);
    const sel = $('#edMain .edpage[data-i="0"] .edfield select'); sel.value = 'Malmö'; sel.dispatchEvent(new Event('change'));
    return E.forms.name === 'Ammar Andersson' && E.forms.agree === true && E.forms.city === 'Malmö' ? JSON.stringify(E.forms) : JSON.stringify(E.forms) && false;
  });
  await step('undo / redo', async () => { document.activeElement && document.activeElement.blur(); await click(1000, 120); const n = allOps().length; const f = JSON.stringify(E.forms); await key('z', ['control']); const a = JSON.stringify(E.forms) !== f || allOps().length !== n; await key('y', ['control']); return a && JSON.stringify(E.forms) === f && allOps().length === n; });
  await step('pages: rotate, insert blank, delete, merge another PDF, reorder', async () => {
    const th = () => $$('#edPages .edth'); th()[2].querySelector('.tha button').click(); await sleep(100); // rotate page 3
    th()[0].querySelectorAll('.tha button')[1].click(); await sleep(100); // blank after page 1
    th()[2].querySelectorAll('.tha button')[2].click(); await sleep(100); // delete original page 2 (now 3rd)
    await api.test.nextPick(dir + sep + 'appendix.pdf'); await E.merge(); await sleep(200);
    E.movePage(3, 1); // appendix to position 2
    return E.pages.length === 4 && E.pages[1].src === 'm1' && E.pages[2].blank && E.pages[3].rot === 90 ? E.pages.map((p) => p.blank ? 'blank' : p.src + p.index + (p.rot ? '⟳' : '')).join(',') : false;
  });
  await shot('editor-3-edits');
  let out;
  await step('Save writes "<name> (edited).pdf", original untouched', async () => { const r = await E.save(false); if (!r) throw new Error('save returned ' + JSON.stringify(r) + ' ' + ($('#toast') || {}).textContent); out = r && r.out; return r && /invoice \(edited( \d+)?\)\.pdf$/.test(r.out) && (await api.test.hash(file)) === h0 ? `${r.out.split(/[\\/]/).pop()} (${r.pages} pages, ${r.drawn} drawn, ${r.removed} removed, ${r.filled} fields)` : (() => { throw new Error(JSON.stringify(r)); })(); });
  let x; await step('saved PDF can be inspected', async () => { x = await api.test.inspect(out); return x.pageCount === 4; });
  const T = (i) => (x ? x.pages[i].text.map((l) => l.t).join(' | ') : '');
  await step('saved: text replaced and deleted, others intact', () => (!/1250/.test(T(0)) && /990 SEK/.test(T(0)) && !/will be deleted/.test(T(0)) && /Keep this line exactly as it is\./.test(T(0)) ? T(0) : false));
  await step('saved: new Swedish text is real text', () => /Hej från Mamba – åäö/.test(T(0)));
  await step('saved: redacted text is gone', () => !/4711/.test(T(0)));
  await step('saved: images (moved+replaced, inserted, signature, Arabic text)', () => (x.pages[0].images.length >= 4 ? x.pages[0].images.length + ' images' : (() => { throw new Error(JSON.stringify(x.pages[0].images) + ' ops=' + JSON.stringify(allOps().map((o) => o.t))); })()));
  await step('saved: date stamp', () => /\d{4}-\d\d-\d\d/.test(T(0)));
  await step('saved: page order, merge, blank, rotation', () => (/Merged appendix/.test(T(1)) && x.pages[2].text.length === 0 && /Rotated page text/.test(T(3)) && x.pages[3].rotate === 180) ? `rot=${x.pages[3].rotate}` : false);
  await step('saved: form values', () => { const f = Object.fromEntries(x.fields.map((w) => [w.name, w.value])); return f.name === 'Ammar Andersson' && f.agree !== 'Off' && f.city === 'Malmö' ? JSON.stringify(f) : false; });
  await step('saved file opens in the reader', async () => { await E.close(true); const a = await window.__reader.Lib.add([out]); await window.__reader.R.open(a[0].id, 0); return !!(await until(() => document.querySelector('.pgv img') && document.querySelector('.pgv img').naturalWidth > 0)); });
  await sleep(800); await shot('editor-4-result');
  return { passed, failed, lines };
})();
