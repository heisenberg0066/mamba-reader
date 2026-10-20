// Layout regression check, runs inside the Mamba Reader renderer (MAMBA_READER_UITEST=test/ui-layout.js).
// For Flip and Scroll mode at several window sizes (and whatever device scale factor the app was started with,
// e.g. --force-device-scale-factor=1.25 / 1.5 to mimic Windows 125%/150%) it checks with DOM bounding boxes that
// every reader control is visible, inside the window, not covered by something else and not overlapping its
// neighbours, and that scroll-mode pages do not overlap. A screenshot is saved for every case.
(async () => {
  let S_; const lines = []; let passed = 0, failed = 0;
  const ok = (n, c, x = '') => { c ? passed++ : failed++; lines.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch (_) {} await sleep(60); } return null; };
  const { R, Lib } = window.__reader; const $ = (s) => document.querySelector(s); const $$ = (s) => [...document.querySelectorAll(s)];
  const dpr = window.devicePixelRatio || 1; const tag = '@' + Math.round(dpr * 100);
  // physical screen sizes (what the user sees on Windows), converted to CSS pixels for the current scale factor;
  // a bit of height is taken off for the Windows title bar + taskbar
  const screens = [[1366, 768], [1280, 720], [1920, 1080], [1000, 700]];
  const sizes = screens.map(([w, h]) => [Math.round(w / dpr), Math.round((h - 80) / dpr), `${w}x${h}`]);
  const prefix = (typeof window.__layoutPrefix === 'string' ? window.__layoutPrefix : '');
  await api.setSettings({ lang: 'en', theme: 'light', mode: 'flip' });
  const pdf = Lib.books.find((b) => b.kind === 'pdf');
  await R.open(pdf.id, 0);
  const visible = (e) => { if (!e || !e.isConnected) return false; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const label = (e) => '#' + (e.id || e.dataset.tool || e.dataset.v || e.dataset.p || e.dataset.lang || e.dataset.x || e.title || e.className || e.tagName);
  // every interactive control in the header, the annotation tool bar and the sidebar tabs (items that were moved
  // into the closed ⋯ menu are skipped here and checked separately with the menu open)
  const controls = (root = document) => [...root.querySelectorAll('.top .brand, .top button, .top input, .top select, .top .timer, #readerBar .btitle, #tools > button, #tools > select, #tools .cf, #sideTabs > button')]
    .filter((e) => !e.closest('.hidden') && getComputedStyle(e).display !== 'none' && !(e.closest('.menu') && root === document));
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const check = (name) => {
    const errs = []; const cs = controls(); const W = innerWidth, H = innerHeight;
    const rects = cs.map((e) => [e, e.getBoundingClientRect()]);
    for (const [e, r] of rects) {
      if (!visible(e) || r.width < 8 || r.height < 8) { errs.push(`${label(e)} zero/tiny size ${Math.round(r.width)}x${Math.round(r.height)}`); continue; }
      if (r.left < -0.5 || r.right > W + 0.5 || r.top < -0.5 || r.bottom > H + 0.5) { errs.push(`${label(e)} outside window (${Math.round(r.left)}..${Math.round(r.right)} of ${W})`); continue; }
      if (e.matches('.top button, .top select') && r.height > 40) errs.push(`${label(e)} label wrapped/squashed (${Math.round(r.width)}x${Math.round(r.height)})`);
      if (e.matches('.top button') && e.scrollWidth > e.clientWidth + 1) errs.push(`${label(e)} label clipped`);
      if (e.matches('#readerBar .btitle') && r.width < 40) errs.push(`book title squashed to ${Math.round(r.width)}px`);
      const cx = Math.min(W - 1, r.left + Math.min(r.width / 2, 10)), cy = r.top + r.height / 2; const hit = document.elementFromPoint(cx, cy);
      if (!hit || !(e === hit || e.contains(hit))) errs.push(`${label(e)} covered by ${hit ? label(hit) : 'nothing'}`);
      // clipped by an overflow:hidden ancestor
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const ps = getComputedStyle(p); if (ps.overflow !== 'visible' || ps.overflowX !== 'visible') { const pr = p.getBoundingClientRect(); if (r.left < pr.left - 0.5 || r.right > pr.right + 0.5) { errs.push(`${label(e)} clipped by ${label(p)}`); } break; } }
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const [a, ra] = rects[i], [b, rb] = rects[j]; if (a.contains(b) || b.contains(a)) continue;
      const o = inter(ra, rb); if (o > 2) errs.push(`${label(a)} overlaps ${label(b)} (${Math.round(o)}px²)`);
    }
    const top = $('.top').getBoundingClientRect(), tools = $('#tools').getBoundingClientRect(), viewer = $('#viewer').getBoundingClientRect();
    if (tools.top < top.bottom - 0.5) errs.push('tool bar overlaps the header');
    if (viewer.top < tools.bottom - 0.5) errs.push('viewer overlaps the tool bar');
    if (viewer.height < 150 || viewer.width < 200) errs.push(`viewer too small ${Math.round(viewer.width)}x${Math.round(viewer.height)}`);
    if ($('#side').getBoundingClientRect().width > 0 && $('#side').getBoundingClientRect().width < 150) errs.push('sidebar collapsed');
    if (R.mode === 'scroll') {
      const ws = $$('#scrollView .pgw').map((w) => w.getBoundingClientRect()); const sv = $('#scrollView');
      if (!ws.length) errs.push('no pages in scroll view');
      for (let i = 1; i < ws.length; i++) if (ws[i].top < ws[i - 1].bottom - 0.5) errs.push(`page ${i + 1} overlaps page ${i}`);
      if (ws.some((r) => r.width < 100)) errs.push('page has no width');
      if (sv.scrollWidth > sv.clientWidth + 1) errs.push(`pages wider than the view (${sv.scrollWidth} > ${sv.clientWidth})`);
    }
    // the ⋯ menu: open it and check that everything inside is reachable
    if ($('#moreWrap') && !$('#moreWrap').classList.contains('hidden')) {
      $('#moreBtn').click(); const mc = controls($('#moreMenu'));
      if (!mc.length) errs.push('⋯ menu is empty');
      for (const e of mc) { const r = e.getBoundingClientRect(); if (r.width < 8 || r.height < 8 || r.left < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5) { errs.push(`⋯ menu: ${label(e)} not visible`); continue; } const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 10), r.top + r.height / 2); if (!hit || !(e === hit || e.contains(hit))) errs.push(`⋯ menu: ${label(e)} covered by ${hit ? label(hit) : 'nothing'}`); }
      $('#moreBtn').click();
    }
    ok(name, !errs.length, errs.slice(0, 8).join('; ') + (errs.length > 8 ? ` (+${errs.length - 8} more)` : ''));
    return errs;
  };
  const setMode = async (m) => { $(`#modeSeg button[data-v="${m}"]`).click(); await until(() => R.mode === m && (m === 'flip' ? R.flip : $$('#scrollView .pgw').length), 4000); await sleep(700); };
  for (const [w, h, scr] of sizes) {
    await api.test.size(w, h); await sleep(500);
    for (const m of ['flip', 'scroll']) {
      await setMode(m); if (m === 'scroll') R.setZoom(R.zoom); await sleep(600);
      check(`${m} ${scr}${tag} (${innerWidth}x${innerHeight} css): all reader controls visible, no overlap`);
      await api.test.shot(`${prefix}${m}-${scr}${tag}`);
      if (m === 'scroll' && $('#moreWrap') && !$('#moreWrap').classList.contains('hidden')) { $('#moreBtn').click(); await sleep(150); await api.test.shot(`${prefix}${m}-${scr}${tag}-more-menu`); $('#moreBtn').click(); }
    }
  }
  // Arabic (right-to-left, longer labels) at the narrowest size
  { const [w, h, scr] = sizes[3]; await api.test.size(w, h); S_ = await api.setSettings({ lang: 'ar' }); document.querySelector('.lang button[data-lang="ar"]').click(); await sleep(600);
    for (const m of ['scroll', 'flip']) { await setMode(m); check(`${m} ${scr}${tag} Arabic RTL: all reader controls visible, no overlap`); }
    await api.test.shot(`${prefix}flip-${scr}${tag}-arabic`);
    document.querySelector('.lang button[data-lang="en"]').click(); await sleep(400); }
  // scroll mode: highlight + comment on every page, through the real tool bar buttons and selection pop-up
  await api.test.size(sizes[0][0], sizes[0][1]); await sleep(400); await setMode('scroll');
  const visPage = (i) => [...document.querySelectorAll(`#scrollView .pgv[data-page="${i}"]`)][0];
  const selectSpan = (sp) => { const rg = document.createRange(); rg.selectNodeContents(sp); getSelection().removeAllRanges(); getSelection().addRange(rg); sp.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); };
  const nPages = R.info.pageCount; const made = [];
  for (let i = 0; i < nPages; i++) {
    R.go(i, true); await sleep(300);
    const p = await until(() => visPage(i) && visPage(i)._tl.children.length > 3 && visPage(i)); if (!p) { ok(`scroll page ${i + 1}: page + text layer rendered`, false); continue; }
    p.scrollIntoView({ block: 'center' }); await sleep(200);
    // 1) highlight tool from the tool bar
    $('#tools [data-tool="highlight"]').click(); const b1 = R.data.annotations.length; selectSpan(p._tl.children[2]); await sleep(150);
    const hl = R.data.annotations.length === b1 + 1 && R.data.annotations.at(-1).page === i && !!p._svg.querySelector(`[data-id="${R.data.annotations.at(-1).id}"]`);
    $('#tools [data-tool="select"]').click();
    // 2) select text → pop-up → 💬 comment
    selectSpan(p._tl.children[3]); await until(() => !$('#selPop').classList.contains('hidden'), 2000);
    const cbtn = [...document.querySelectorAll('#selPop button')].find((b) => b.textContent === '💬'); cbtn.click(); await sleep(80);
    $('#annPop textarea').value = 'comment p' + (i + 1); $('#annPop .primary').click(); await sleep(80);
    const a = R.data.annotations.at(-1); const cm = a.page === i && a.comment === 'comment p' + (i + 1) && !!p._ol.querySelector('.nt');
    if (hl && cm) made.push(R.data.annotations.at(-2).id, a.id);
    ok(`scroll page ${i + 1}: highlight tool + comment work`, hl && cm, `highlight ${hl}, comment ${cm}`);
  }
  await setMode('flip'); await setMode('scroll'); await sleep(300);
  ok('annotations made in scroll mode survive Flip ↔ Scroll', made.every((id) => R.byId(id)) && made.length === nPages * 2, `${made.length} kept`);
  R.flushSave(); await sleep(300); const saved = (await api.test.bookData(pdf.id)).annotations; ok('scroll-mode annotations saved', made.every((id) => saved.some((x) => x.id === id)));
  for (const id of made) R.remove(id); R.flushSave();
  // state survives switching modes back and forth
  await api.test.size(sizes[0][0], sizes[0][1]); await sleep(400);
  await setMode('scroll'); R.go(2, true); await sleep(500); const pg = R.cur; R.setTool('highlight');
  await setMode('flip'); const keepF = R.tool === 'highlight' && $('#tools [data-tool="highlight"]').classList.contains('on');
  await setMode('scroll'); await sleep(400);
  ok('mode switch keeps page and tool', pg === 2 && R.cur === 2 && keepF && R.tool === 'highlight', `page ${pg}->${R.cur}, tool ${R.tool}`);
  R.setTool('select');
  return { passed, failed, lines };
})()
