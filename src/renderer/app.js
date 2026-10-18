'use strict';
/* global I18N, api, MambaFlip */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') e.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v); else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v); } kids.flat().forEach((c) => c != null && e.append(c.nodeType ? c : String(c))); return e; };
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v); return e; };
const debounce = (fn, ms) => { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const COLORS = ['#ffd400', '#7ee081', '#6ec6ff', '#ff8fc7', '#ffa64d', '#c79bff', '#ff4d4d', '#222222'];

let S = { lang: 'en', theme: 'light', mode: 'flip' };
const t = (k, v) => { let s = (I18N[S.lang] && I18N[S.lang][k]) ?? I18N.en[k] ?? k; if (v) for (const [a, b] of Object.entries(v)) s = s.split(`{${a}}`).join(b); return s; };
function toast(m, ms = 2800) { const e = $('#toast'); e.textContent = m; e.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.add('hidden'), ms); }
function applyI18n() {
  document.documentElement.lang = S.lang; document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
  $$('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
  $$('[data-i18n-title]').forEach((e) => { e.title = t(e.dataset.i18nTitle); });
  $$('[data-i18n-ph]').forEach((e) => { e.placeholder = t(e.dataset.i18nPh); });
  $$('.lang button').forEach((b) => b.classList.toggle('on', b.dataset.lang === S.lang));
  Lib.render(); if (R.book) { R.renderSide(); }
}
function setTheme(th) { document.body.classList.remove('theme-light', 'theme-sepia', 'theme-dark'); document.body.classList.add('theme-' + th); $('#themeSel').value = th; }

// ======================= LIBRARY =======================
const Lib = {
  books: [], tag: null, stats: { days: {}, books: {} }, vocab: [],
  async load() { this.books = await api.libList(); this.stats = await api.stats(); this.vocab = await api.vocab(); this.render(); },
  async add(paths) {
    const res = await api.libAdd(paths); const bad = res.filter((r) => r.error); if (bad.length) toast(bad.map((b) => `${b.path.split(/[\\/]/).pop()}: ${b.error}`).join('\n'), 5000);
    await this.load(); return res.filter((r) => !r.error);
  },
  render() {
    const q = ($('#libSearch').value || '').toLowerCase(); const sort = $('#libSort').value;
    const tags = [...new Set(this.books.flatMap((b) => b.tags || []))].sort();
    $('#tagBar').replaceChildren(...(tags.length ? [el('span', { class: 'tag' + (!this.tag ? ' on' : ''), onclick: () => { this.tag = null; this.render(); } }, '★ all'), ...tags.map((tg) => el('span', { class: 'tag' + (this.tag === tg ? ' on' : ''), onclick: () => { this.tag = this.tag === tg ? null : tg; this.render(); } }, '#' + tg))] : []));
    let list = this.books.filter((b) => (!this.tag || (b.tags || []).includes(this.tag)) && (!q || [b.title, b.author, b.path, ...(b.tags || [])].join(' ').toLowerCase().includes(q)));
    const by = { recent: (a, b) => (b.lastOpened || '').localeCompare(a.lastOpened || ''), title: (a, b) => a.title.localeCompare(b.title), added: (a, b) => (b.added || '').localeCompare(a.added || ''), progress: (a, b) => (b.progress || 0) - (a.progress || 0) };
    list.sort(by[sort] || by.recent);
    $('#libEmpty').classList.toggle('hidden', this.books.length > 0);
    $('#shelf').replaceChildren(...list.map((b) => this.card(b)));
    const last = [...this.books].filter((b) => b.lastOpened && !b.missing).sort(by.recent)[0];
    $('#continueRow').replaceChildren(...(last && !q && !this.tag ? [el('div', { class: 'cont', onclick: () => R.open(last.id) }, el('img', { src: last.cover || '' }), el('div', {}, el('div', { class: 'muted small' }, t('continueReading')), el('b', {}, last.title), el('div', { class: 'small muted' }, t('progress', { p: Math.round((last.progress || 0) * 100), c: (last.lastPage || 0) + 1, n: last.pageCount || '?' }))))] : []));
    this.renderStats();
  },
  card(b) {
    const pct = Math.round((b.progress || 0) * 100);
    const c = el('div', { class: 'book', title: b.path, onclick: () => (b.missing ? this.relink(b) : R.open(b.id)) },
      el('div', { class: 'cv' }, b.cover ? el('img', { src: b.cover + '?v=' + encodeURIComponent(b.added || ''), loading: 'lazy', alt: '' }) : null, el('span', { class: 'kind' }, b.kind || 'pdf'), b.missing ? el('div', { class: 'miss' }, t('missing'), el('br'), t('relink')) : null),
      el('div', { class: 't' }, b.title), el('div', { class: 'a' }, [b.author, b.lastOpened ? t('progress', { p: pct, c: (b.lastPage || 0) + 1, n: b.pageCount }) : t('never')].filter(Boolean).join(' · ')),
      el('div', { class: 'pb' }, el('div', { style: { width: pct + '%' } })), el('div', { class: 'bt' }, (b.tags || []).map((tg) => el('span', {}, '#' + tg))),
      el('button', { class: 'more', onclick: (e) => { e.stopPropagation(); this.menu(b, e); } }, '⋯'));
    return c;
  },
  menu(b, e) {
    const pop = $('#annPop'); pop.replaceChildren(el('b', {}, b.title),
      el('button', { onclick: async () => { const v = await promptBox(t('tagsPrompt'), (b.tags || []).join(', ')); if (v != null) { await api.libUpdate(b.id, { tags: v.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean) }); this.load(); } hidePops(); } }, '🏷 ' + t('editTags')),
      el('button', { onclick: async () => { const v = await promptBox(t('rename'), b.title); if (v) { await api.libUpdate(b.id, { title: v }); this.load(); } hidePops(); } }, '✎ ' + t('rename')),
      el('button', { onclick: () => { api.show(b.path); hidePops(); } }, '📁 ' + t('showFolder')),
      el('button', { onclick: () => { this.relink(b); hidePops(); } }, '🔗 ' + t('relink')),
      el('button', { onclick: async () => { await api.libRemove(b.id); hidePops(); this.load(); } }, '🗑 ' + t('remove')));
    showPopAt(pop, e.clientX, e.clientY);
  },
  async relink(b) { const r = await api.libRelink(b.id); if (r) this.load(); },
  renderStats() {
    const days = this.stats.days || {}; const today = new Date();
    const key = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    $('#stToday').textContent = Math.round(days[key(today)] || 0);
    let streak = 0; for (let i = 0; i < 3650; i++) { const d = new Date(today - i * 864e5); if ((days[key(d)] || 0) > 0) streak++; else if (i > 0) break; }
    $('#stStreak').textContent = streak; $('#stTotal').textContent = Math.round(Object.values(days).reduce((a, b) => a + b, 0));
    const week = [...Array(7)].map((_, i) => new Date(today - (6 - i) * 864e5)); const max = Math.max(10, ...week.map((d) => days[key(d)] || 0));
    $('#weekChart').replaceChildren(...week.map((d) => el('div', { style: { height: ((days[key(d)] || 0) / max) * 100 + '%' }, title: `${key(d)}: ${Math.round(days[key(d)] || 0)} min` }, el('span', {}, d.toLocaleDateString(S.lang === 'ar' ? 'ar' : 'en', { weekday: 'narrow' })))));
    $('#vocabCount').textContent = this.vocab.length;
    $('#timer').textContent = '⏱ ' + t('minRead', { m: Math.round(days[key(today)] || 0) });
  },
};

// ======================= READER =======================
const R = {
  book: null, info: null, data: null, docId: 0, mode: 'flip', zoom: 1, cur: 0, tool: 'select', color: COLORS[0], width: 2,
  live: new Set(), textCache: new Map(), hits: [], undo: [], flip: null, lastAct: Date.now(),
  pw(i) { return this.info.pages[i][0]; }, ph(i) { return this.info.pages[i][1]; },
  async open(id, page) {
    hidePops(); await this.close(true);
    let r; try { r = await api.openBook(id); } catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 5000); return null; }
    Object.assign(this, { book: r.book, info: r.info, data: { annotations: [], bookmarks: [], ...r.data }, docId: r.info.docId, textCache: new Map(), hits: [], undo: [] });
    document.body.classList.add('reading'); showView('reader');
    $('#bookTitle').textContent = this.book.title; $('#editBtn').classList.toggle('hidden', !/\.pdf$/i.test(this.book.path || '')); $('#pgTotal').textContent = '/ ' + this.info.pageCount;
    this.cur = Math.min(this.info.pageCount - 1, page != null ? page : this.book.lastPage || 0);
    this.mode = this.book.mode || S.mode || 'flip';
    this.buildView(); this.renderSide(); this.buildThumbs(); this.updateBar();
    return r;
  },
  async close(silent) {
    if (!this.book) return; this.flushSave(); if (this.flip) { this.flip.destroy(); this.flip = null; }
    $('#scrollView').replaceChildren(); this.live.clear(); await api.closeBook(this.book.id); this.book = null;
    if (!silent) { document.body.classList.remove('reading'); showView('library'); Lib.load(); }
  },
  // ---------- views ----------
  buildView() {
    $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === this.mode));
    const flipHost = $('#flipHost'), scroll = $('#scrollView');
    if (this.flip) { this.flip.destroy(); this.flip = null; } scroll.replaceChildren(); this.live.clear();
    flipHost.classList.toggle('hidden', this.mode !== 'flip'); scroll.classList.toggle('hidden', this.mode !== 'scroll');
    const start = this.cur;
    if (this.mode === 'flip') {
      this._building = true; this.flip = new MambaFlip(flipHost, { embedded: true, toolbar: false, thumbs: false, keyboard: false, noDrag: '.tl span, .tb, .nt', title: this.book.title, rtl: !!this.book.rtl,
        pages: this.info.pages.map(([w, h]) => ({ src: '', w, h })), renderPage: (i, d, w, h) => d.append(this.pageView(i, w, h, true)), onChange: (st) => { if (!this._building) this.onPage(st.visible[0]); } });
      this._building = false; this.flip.go(start, true); this.cur = start; this.onPage(this.flip.state().visible[0]); this.flip.setNavLocked(this.tool !== 'select');
      const origZoom = this.flip.applyZoom.bind(this.flip); this.flip.applyZoom = () => { origZoom(); this.zoomLabel(); this.refreshRes(); };
    } else { this.cur = start; this.buildScroll(); }
    this.zoomLabel();
  },
  buildScroll() {
    const view = $('#scrollView'); const maxW = Math.max(...this.info.pages.map((p) => p[0]));
    const fit = Math.min(view.clientWidth - 48, 980) * this.zoom; view.replaceChildren(); this.wrappers = [];
    if (this.io) this.io.disconnect();
    this.io = new IntersectionObserver((ents) => ents.forEach((en) => { const w = en.target; const i = +w.dataset.page; if (en.isIntersecting) { if (!w.firstChild) w.append(this.pageView(i, w._w, w._h)); } else if (w.firstChild) { this.live.delete(w.firstChild); w.replaceChildren(); } }), { root: view, rootMargin: '1200px 0px' });
    this.info.pages.forEach(([pw, ph], i) => { const w = Math.round(fit * pw / maxW), h = Math.round(w * ph / pw); const d = el('div', { class: 'pgw', 'data-page': i, style: { width: w + 'px', height: h + 'px' } }); d._w = w; d._h = h; view.append(d); this.wrappers.push(d); this.io.observe(d); });
    view.onscroll = () => { this.lastAct = Date.now(); this.scrollSpy(); };
    requestAnimationFrame(() => this.go(this.cur, true));
  },
  scrollSpy: debounce(function () { const view = $('#scrollView'); const mid = view.scrollTop + view.clientHeight * 0.35; let i = 0; for (const w of this.wrappers) { if (w.offsetTop <= mid) i = +w.dataset.page; else break; } if (i !== this.cur) this.onPage(i); }, 80),
  go(i, instant) {
    i = Math.max(0, Math.min(this.info.pageCount - 1, i | 0));
    if (this.mode === 'flip' && this.flip) this.flip.go(i, instant); else if (this.wrappers) { this.wrappers[i].scrollIntoView({ block: 'start', behavior: instant ? 'auto' : 'smooth' }); this.onPage(i); }
  },
  next() { if (this.mode === 'flip') this.flip.next(); else this.go(this.cur + 1); },
  prev() { if (this.mode === 'flip') this.flip.prev(); else this.go(this.cur - 1); },
  onPage(i) {
    if (i == null) return; this.cur = i; this.updateBar();
    $$('#thumbList .th').forEach((th) => th.classList.toggle('on', +th.dataset.page === i));
    const on = $(`#thumbList .th[data-page="${i}"]`); if (on && $('#p-thumbs').classList.contains('on')) on.scrollIntoView({ block: 'nearest' });
    this.saveProgress();
  },
  saveProgress: debounce(function () { if (!this.book) return; const n = this.info.pageCount; const last = this.flip ? Math.max(this.cur, ...this.flip.state().visible) : this.cur; api.libUpdate(this.book.id, { lastPage: this.cur, progress: n > 1 ? Math.min(1, (last + 1) / n) : 1, lastOpened: new Date().toISOString(), mode: this.mode }); }, 500),
  updateBar() { if (!this.info) return; const vis = this.flip ? this.flip.state().visible : [this.cur]; $('#pgInput').value = vis.map((x) => x + 1).join('–'); $('#bmBtn').textContent = this.data.bookmarks.some((b) => vis.includes(b.page)) ? '★' : '☆'; $('#bmBtn').classList.toggle('on', $('#bmBtn').textContent === '★'); },
  zoomLabel() { const z = this.mode === 'flip' && this.flip ? this.flip.zoom : this.zoom; $('#zoomVal').textContent = Math.round(z * 100) + '%'; },
  setZoom(z) {
    if (this.mode === 'flip') { this.flip.setZoom(z); return; }
    const view = $('#scrollView'); const frac = this.wrappers && this.wrappers[this.cur] ? (view.scrollTop - this.wrappers[this.cur].offsetTop) / this.wrappers[this.cur]._h : 0;
    this.zoom = Math.max(0.3, Math.min(4, z)); const keep = this.cur; this.buildScroll(); this.zoomLabel();
    requestAnimationFrame(() => { const w = this.wrappers[keep]; view.scrollTop = w.offsetTop + frac * w._h; });
  },
  zoomBy(f) { this.setZoom((this.mode === 'flip' ? this.flip.zoom : this.zoom) * f); },
  refreshRes: debounce(function () { const z = this.flip ? this.flip.zoom : 1; for (const p of [...this.live]) { if (!p.isConnected) { this.live.delete(p); continue; } const src = this.src(+p.dataset.page, p._w * z); if (p._img.dataset.src !== src) { p._img.src = src; p._img.dataset.src = src; } } }, 250),
  src(i, cssW) { const s = Math.min(5, Math.ceil(((cssW * (window.devicePixelRatio || 1)) / this.pw(i)) * 4) / 4); return `mrpage://render/${this.docId}/${i}?s=${s}`; },
  // ---------- page view ----------
  pageView(i, w, h) {
    const p = el('div', { class: 'pgv tool-' + this.tool, 'data-page': i }); p._w = w; p.style.setProperty('--s', w / this.pw(i));
    const img = el('img', { class: 'bmp', alt: '', draggable: 'false', decoding: 'async' }); img.src = img.dataset.src = this.src(i, w); p._img = img;
    const tl = el('div', { class: 'tl' }); const svg = sv('svg', { class: 'al', viewBox: `0 0 ${this.pw(i)} ${this.ph(i)}`, preserveAspectRatio: 'none' }); const ol = el('div', { class: 'ol' });
    p.append(img, tl, svg, ol); p._tl = tl; p._svg = svg; p._ol = ol;
    this.live.add(p); this.drawAnnots(p); this.buildText(p, i); this.bindPage(p, i);
    return p;
  },
  async buildText(p, i) {
    let lines = this.textCache.get(i); if (!lines) { try { lines = await api.text(this.docId, i); } catch (_) { lines = []; } this.textCache.set(i, lines); }
    const s = p._w / this.pw(i); const ctx = (R._ctx = R._ctx || document.createElement('canvas').getContext('2d'));
    const frag = document.createDocumentFragment();
    for (const l of lines) {
      const fs = Math.max(1, l.h * s * 0.92); ctx.font = `${fs}px sans-serif`; const mw = ctx.measureText(l.t).width || 1;
      const sp = document.createElement('span'); sp.textContent = l.t; sp.style.cssText = `left:${l.x * s}px;top:${l.y * s}px;font-size:${fs}px;font-family:sans-serif;transform:scaleX(${(l.w * s) / mw})`; frag.appendChild(sp);
    }
    p._tl.replaceChildren(frag);
  },
  pagesFor(i) { const out = []; for (const p of [...this.live]) { if (!p.isConnected) { this.live.delete(p); continue; } if (+p.dataset.page === i) out.push(p); } return out; },
  redraw(i) { this.pagesFor(i).forEach((p) => this.drawAnnots(p)); },
  drawAnnots(p) {
    const i = +p.dataset.page; const svg = p._svg, ol = p._ol; svg.replaceChildren(); ol.replaceChildren();
    for (const a of this.data.annotations) {
      if (a.page !== i) continue; const c = a.color || COLORS[0]; let g;
      if (a.type === 'highlight' || a.type === 'underline' || a.type === 'strike') {
        g = sv('g', { class: 'hit', 'data-id': a.id });
        for (const [x, y, w, h] of a.rects) {
          g.append(sv('rect', { x, y, width: w, height: h, fill: a.type === 'highlight' ? c : 'transparent', 'fill-opacity': a.type === 'highlight' ? 0.4 : 0, style: a.type === 'highlight' ? 'mix-blend-mode:multiply' : '' }));
          if (a.type === 'underline') g.append(sv('rect', { x, y: y + h * 0.9, width: w, height: Math.max(0.8, h * 0.07), fill: c }));
          if (a.type === 'strike') g.append(sv('rect', { x, y: y + h * 0.48, width: w, height: Math.max(0.8, h * 0.07), fill: c }));
        }
        if (a.comment) { const r = a.rects[a.rects.length - 1]; ol.append(el('div', { class: 'nt', title: a.comment, style: { left: ((r[0] + r[2]) / this.pw(i)) * 100 + '%', top: (r[1] / this.ph(i)) * 100 + '%' }, onclick: (e) => this.annPop(a, e) }, '💬')); }
      } else if (a.type === 'ink' || a.type === 'marker') {
        g = sv('path', { class: 'hit', 'data-id': a.id, d: pathD(a.points), fill: 'none', stroke: c, 'stroke-width': a.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': a.type === 'marker' ? 0.4 : 1 });
      } else if (a.type === 'rect') g = sv('rect', { class: 'hit', 'data-id': a.id, x: a.rect[0], y: a.rect[1], width: a.rect[2], height: a.rect[3], fill: 'none', stroke: c, 'stroke-width': a.width });
      else if (a.type === 'ellipse') g = sv('ellipse', { class: 'hit', 'data-id': a.id, cx: a.rect[0] + a.rect[2] / 2, cy: a.rect[1] + a.rect[3] / 2, rx: a.rect[2] / 2, ry: a.rect[3] / 2, fill: 'none', stroke: c, 'stroke-width': a.width });
      else if (a.type === 'line' || a.type === 'arrow') {
        g = sv('g', { class: 'hit', 'data-id': a.id }); const [[x1, y1], [x2, y2]] = a.points;
        g.append(sv('line', { x1, y1, x2, y2, stroke: c, 'stroke-width': a.width, 'stroke-linecap': 'round' }), sv('line', { x1, y1, x2, y2, stroke: 'transparent', 'stroke-width': Math.max(8, a.width * 3) }));
        if (a.type === 'arrow') { const ang = Math.atan2(y2 - y1, x2 - x1), L = 6 + a.width * 3; g.append(sv('path', { d: `M${x2 - L * Math.cos(ang - 0.45)},${y2 - L * Math.sin(ang - 0.45)} L${x2},${y2} L${x2 - L * Math.cos(ang + 0.45)},${y2 - L * Math.sin(ang + 0.45)}`, fill: 'none', stroke: c, 'stroke-width': a.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })); }
      } else if (a.type === 'text') {
        const tb = el('div', { class: 'tb', contenteditable: 'true', 'data-id': a.id, spellcheck: 'false', style: { left: (a.rect[0] / this.pw(i)) * 100 + '%', top: (a.rect[1] / this.ph(i)) * 100 + '%', width: (a.rect[2] / this.pw(i)) * 100 + '%', minHeight: (a.rect[3] / this.ph(i)) * 100 + '%', fontSize: `calc(var(--s) * ${a.fontSize || 12}px)`, '--tc': c } });
        tb.textContent = a.content || '';
        tb.addEventListener('input', () => { a.content = tb.innerText; a.updated = new Date().toISOString(); this.save(false); });
        tb.addEventListener('blur', () => { if (!tb.innerText.trim()) this.remove(a.id); else { this.save(); this.renderNotes(); } });
        tb.addEventListener('pointerdown', (e) => { if (this.tool === 'eraser') { e.preventDefault(); this.remove(a.id); } e.stopPropagation(); });
        tb.addEventListener('contextmenu', (e) => { e.preventDefault(); this.annPop(a, e); });
        ol.append(tb);
      } else if (a.type === 'note') {
        ol.append(el('div', { class: 'nt', 'data-id': a.id, title: a.content || '', style: { left: (a.rect[0] / this.pw(i)) * 100 + '%', top: (a.rect[1] / this.ph(i)) * 100 + '%', color: c }, onpointerdown: (e) => { e.stopPropagation(); if (this.tool === 'eraser') this.remove(a.id); else this.annPop(a, e); } }, '🗨'));
      }
      if (g) svg.append(g);
    }
    for (const h of this.hits) if (h.page === i) for (const q of h.quads) { const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]]; svg.append(sv('rect', { class: 'srch', x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) })); }
    svg.onpointerdown = null;
    $$('.hit', svg).forEach((g) => g.addEventListener('pointerdown', (e) => { const a = this.byId(g.dataset.id); if (!a) return; if (this.tool === 'eraser') { e.stopPropagation(); this.remove(a.id); } else if (this.tool === 'select') { e.stopPropagation(); this.annPop(a, e); } }));
  },
  pt(p, e) { const r = p.getBoundingClientRect(); const i = +p.dataset.page; return [((e.clientX - r.left) / r.width) * this.pw(i), ((e.clientY - r.top) / r.height) * this.ph(i)]; },
  bindPage(p, i) {
    p.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; const tool = this.tool; this.lastAct = Date.now();
      if (['select', 'highlight', 'underline', 'strike'].includes(tool)) return;
      e.preventDefault(); e.stopPropagation(); hidePops();
      const start = this.pt(p, e);
      if (tool === 'note') { const a = this.add({ type: 'note', page: i, rect: [start[0], start[1], 20, 20], content: '', color: this.color }); this.annPop(a, e, true); return; }
      if (tool === 'text') { const a = this.add({ type: 'text', page: i, rect: [start[0], start[1], Math.min(220, this.pw(i) - start[0]), 28], content: '', fontSize: 12, color: this.color === '#ffd400' ? '#222222' : this.color }); setTimeout(() => { const tb = $(`.pgv[data-page="${i}"] .tb[data-id="${a.id}"]`); if (tb) tb.focus(); }, 30); return; }
      try { p.setPointerCapture(e.pointerId); } catch (_) {}
      if (tool === 'eraser') { const er = (ev) => { const hit = document.elementsFromPoint(ev.clientX, ev.clientY).find((x) => x.closest && x.closest('.hit')); if (hit) this.remove(hit.closest('.hit').dataset.id); }; er(e); p.onpointermove = er; p.onpointerup = () => { p.onpointermove = p.onpointerup = null; }; return; }
      const pts = [start]; let prev = null;
      const preview = (d) => { if (prev) prev.remove(); prev = d; p._svg.append(d); };
      const draw = () => {
        const c = this.color; const w = tool === 'marker' ? this.width * 5 : this.width; const [a, b] = [pts[0], pts[pts.length - 1]];
        if (tool === 'ink' || tool === 'marker') preview(sv('path', { d: pathD(pts), fill: 'none', stroke: c, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': tool === 'marker' ? 0.4 : 1 }));
        else if (tool === 'rect') preview(sv('rect', { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), fill: 'none', stroke: c, 'stroke-width': w }));
        else if (tool === 'ellipse') preview(sv('ellipse', { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, rx: Math.abs(b[0] - a[0]) / 2, ry: Math.abs(b[1] - a[1]) / 2, fill: 'none', stroke: c, 'stroke-width': w }));
        else preview(sv('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: c, 'stroke-width': w }));
      };
      p.onpointermove = (ev) => { const q = this.pt(p, ev); const l = pts[pts.length - 1]; if (tool === 'ink' || tool === 'marker') { if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 0.8) pts.push(q); } else pts[1] = q; draw(); };
      p.onpointerup = () => {
        p.onpointermove = p.onpointerup = null; if (prev) prev.remove(); const [a, b] = [pts[0], pts[pts.length - 1]];
        const w = tool === 'marker' ? this.width * 5 : this.width; const r4 = (v) => Math.round(v * 100) / 100;
        if ((tool === 'ink' || tool === 'marker') && pts.length > 1) this.add({ type: tool, page: i, points: pts.map(([x, y]) => [r4(x), r4(y)]), color: this.color, width: w });
        else if ((tool === 'rect' || tool === 'ellipse') && Math.abs(b[0] - a[0]) > 2 && Math.abs(b[1] - a[1]) > 2) this.add({ type: tool, page: i, rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])].map(r4), color: this.color, width: w });
        else if ((tool === 'line' || tool === 'arrow') && pts.length > 1 && Math.hypot(b[0] - a[0], b[1] - a[1]) > 3) this.add({ type: tool, page: i, points: [a, b].map(([x, y]) => [r4(x), r4(y)]), color: this.color, width: w });
      };
    });
  },
  // ---------- annotation model ----------
  byId(id) { return this.data.annotations.find((a) => a.id === id); },
  snapshot() { this.undo.push(JSON.stringify(this.data.annotations)); if (this.undo.length > 100) this.undo.shift(); },
  add(a) { this.snapshot(); const now = new Date().toISOString(); a = { id: uid(), created: now, updated: now, ...a }; this.data.annotations.push(a); this.redraw(a.page); this.save(); this.renderNotes(); return a; },
  update(a, patch) { this.snapshot(); Object.assign(a, patch, { updated: new Date().toISOString() }); this.redraw(a.page); this.save(); this.renderNotes(); },
  remove(id) { const a = this.byId(id); if (!a) return; this.snapshot(); this.data.annotations = this.data.annotations.filter((x) => x.id !== id); this.redraw(a.page); this.save(); this.renderNotes(); hidePops(); },
  undoLast() { const s = this.undo.pop(); if (!s) return; const before = new Set(this.data.annotations.map((a) => a.page)); this.data.annotations = JSON.parse(s); new Set([...before, ...this.data.annotations.map((a) => a.page)]).forEach((pg) => this.redraw(pg)); this.save(); this.renderNotes(); },
  save(immediate = true) { this._dirty = true; if (immediate) this.flushSoon(); else this.flushSoon(); },
  flushSoon: debounce(function () { this.flushSave(); }, 350),
  flushSave() { if (this._dirty && this.book) { this._dirty = false; api.saveBook(this.book.id, this.data); } },
  // ---------- selection ----------
  selectionInfo() {
    const sel = getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0); const node = range.commonAncestorContainer; const host = (node.nodeType === 1 ? node : node.parentElement); if (!host || !host.closest('.pgv, .scrollview, .mf-book')) return null;
    const rects = [...range.getClientRects()]; const per = new Map();
    for (const p of [...this.live]) {
      if (!p.isConnected) continue; const pr = p._tl.getBoundingClientRect(); const i = +p.dataset.page;
      for (const r of rects) {
        if (r.width < 1 || r.height < 1 || r.right < pr.left || r.left > pr.right || r.bottom < pr.top || r.top > pr.bottom) continue;
        const sx = this.pw(i) / pr.width, sy = this.ph(i) / pr.height;
        const rr = [(r.left - pr.left) * sx, (r.top - pr.top) * sy, r.width * sx, r.height * sy];
        if (!per.has(i)) per.set(i, { page: i, el: p, rects: [] }); per.get(i).rects.push(rr);
      }
    }
    const text = sel.toString().replace(/\s+/g, ' ').trim(); if (!text || !per.size) return null;
    const pages = [...per.values()].map((x) => ({ ...x, rects: mergeRects(x.rects) }));
    const last = rects[rects.length - 1]; const ctxLine = (host.closest('span') || host).textContent;
    return { text, pages, x: last.right, y: last.bottom, context: ctxLine };
  },
  applyMark(type, info, color) { const ids = []; info.pages.forEach((pg, k) => { const a = this.add({ type, page: pg.page, rects: pg.rects.map((r) => r.map((v) => Math.round(v * 100) / 100)), text: k === 0 ? info.text : info.text, color: color || this.color }); ids.push(a); }); getSelection().removeAllRanges(); return ids; },
  onMouseUp(e) {
    if (!this.book || e.target.closest('.pop, .tools, .top, .side')) return;
    setTimeout(() => {
      const info = this.selectionInfo(); if (!info) return;
      if (['highlight', 'underline', 'strike'].includes(this.tool)) { this.applyMark(this.tool, info); return; }
      if (this.tool !== 'select') return; this.selPop(info);
    }, 10);
  },
  selPop(info) {
    const pop = $('#selPop');
    pop.replaceChildren(...COLORS.slice(0, 5).map((c) => el('button', { title: t('t_highlight'), onclick: () => { this.applyMark('highlight', info, c); hidePops(); } }, el('span', { class: 'dot', style: { background: c } }))),
      el('button', { title: t('t_underline'), onclick: () => { this.applyMark('underline', info); hidePops(); } }, el('u', {}, 'U')), el('button', { title: t('t_strike'), onclick: () => { this.applyMark('strike', info, '#ff4d4d'); hidePops(); } }, el('s', {}, 'S')),
      el('button', { title: t('comment'), onclick: (e) => { const [a] = this.applyMark('highlight', info); this.annPop(a, e, true); } }, '💬'),
      el('button', { title: t('copy'), onclick: () => { navigator.clipboard.writeText(info.text).catch(() => {}); hidePops(); } }, '⧉'),
      el('button', { title: t('saveWord'), onclick: (e) => this.wordPop(info, e) }, 'Aa+'),
      el('button', { title: t('searchSel'), onclick: () => { this.showPanel('search'); $('#searchInput').value = info.text.slice(0, 80); this.runSearch(); hidePops(); } }, '⌕'));
    showPopAt(pop, info.x, info.y + 6);
  },
  annPop(a, e, focus) {
    const pop = $('#annPop'); const isMark = ['highlight', 'underline', 'strike'].includes(a.type); const field = isMark || a.type === 'ink' || a.type === 'marker' || ['rect', 'ellipse', 'line', 'arrow'].includes(a.type) ? 'comment' : 'content';
    const ta = el('textarea', { placeholder: a.type === 'note' ? t('noteText') : t('addComment') }); ta.value = a[field] || '';
    pop.replaceChildren(el('div', { class: 'row' }, el('b', {}, t('t_' + a.type)), el('span', { class: 'muted small' }, `· ${t('page')} ${a.page + 1}`)), a.text ? el('q', { class: 'small' }, a.text.slice(0, 200)) : null,
      el('div', { class: 'row wrap' }, COLORS.map((c) => el('span', { class: 'cf' + (a.color === c ? ' on' : ''), style: { background: c }, onclick: () => { this.update(a, { color: c }); this.annPop(a, e); } }))),
      a.type === 'text' ? null : ta,
      el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => { if (a.type !== 'text') this.update(a, { [field]: ta.value.trim() }); hidePops(); if (a.type === 'note' && !ta.value.trim() && !a.content) this.remove(a.id); } }, t('save')), el('button', { onclick: () => this.remove(a.id) }, '🗑 ' + t('delete')), el('button', { onclick: () => { hidePops(); if (a.type === 'note' && !a.content) this.remove(a.id); } }, t('cancel'))));
    showPopAt(pop, e.clientX, e.clientY + 8); if (focus) setTimeout(() => ta.focus(), 20);
  },
  wordPop(info, e) {
    const pop = $('#annPop'); const word = info.text.split(' ').slice(0, 6).join(' ');
    const w = el('input', { value: word }), tr = el('input', { placeholder: t('translation') }), nt = el('textarea', { placeholder: t('notes') });
    pop.replaceChildren(el('b', {}, t('saveWord')), w, tr, nt, el('div', { class: 'muted small' }, (info.context || '').slice(0, 140)),
      el('div', { class: 'row' }, el('button', { class: 'primary', onclick: async () => { Lib.vocab.push({ id: uid(), word: w.value.trim(), translation: tr.value.trim(), note: nt.value.trim(), bookId: this.book.id, bookTitle: this.book.title, page: info.pages[0].page, context: (info.context || '').slice(0, 300), created: new Date().toISOString() }); await api.saveVocab(Lib.vocab); hidePops(); getSelection().removeAllRanges(); this.renderWords(); toast('✓ ' + w.value); } }, t('save')), el('button', { onclick: hidePops }, t('cancel'))));
    showPopAt(pop, e.clientX, e.clientY + 8); setTimeout(() => tr.focus(), 20);
  },
  setTool(tool) {
    this.tool = tool; $$('#tools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
    for (const p of [...this.live]) { if (!p.isConnected) { this.live.delete(p); continue; } p.className = 'pgv tool-' + tool; }
    if (this.flip) this.flip.setNavLocked(tool !== 'select');
  },
  toggleBookmark() {
    const p = this.cur; const i = this.data.bookmarks.findIndex((b) => b.page === p);
    if (i >= 0) { this.data.bookmarks.splice(i, 1); toast(t('unbookmarked')); } else { const ln = (this.textCache.get(p) || [])[0]; this.data.bookmarks.push({ page: p, title: ln ? ln.t.trim().slice(0, 60) : '', created: new Date().toISOString() }); toast(t('bookmarked', { p: p + 1 })); }
    this.save(); this.updateBar(); this.renderBookmarks();
  },
  // ---------- sidebar ----------
  showPanel(name) { $('#side').classList.remove('closed'); $$('#sideTabs button').forEach((b) => b.classList.toggle('on', b.dataset.p === name)); $$('.spanel').forEach((p) => p.classList.toggle('on', p.id === 'p-' + name)); this.panel = name; if (name === 'search') setTimeout(() => $('#searchInput').focus(), 20); },
  renderSide() { this.renderOutline(); this.renderNotes(); this.renderBookmarks(); this.renderWords(); if (!this.panel) this.showPanel('thumbs'); },
  buildThumbs() {
    const box = $('#thumbList'); if (this.tio) this.tio.disconnect();
    this.tio = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { const img = en.target.querySelector('img'); if (!img.src) img.src = this.src(+en.target.dataset.page, 110); } }), { root: $('#p-thumbs'), rootMargin: '400px' });
    box.replaceChildren(...this.info.pages.map(([w, h], i) => { const d = el('div', { class: 'th' + (i === this.cur ? ' on' : ''), 'data-page': i, onclick: () => this.go(i) }, el('div', { class: 'im', style: { '--ar': w / h } }, el('img', { alt: '', loading: 'lazy' })), i + 1); this.tio.observe(d); return d; }));
  },
  renderOutline() { const o = this.info.outline || []; $('#outlineList').replaceChildren(...(o.length ? o.map((x) => el('div', { style: { paddingInlineStart: 6 + x.level * 14 + 'px' }, onclick: () => x.page >= 0 && this.go(x.page) }, x.title || '—', x.page >= 0 ? el('span', {}, x.page + 1) : null)) : [el('div', { class: 'muted' }, t('noOutline'))])); },
  runSearch: debounce(async function () {
    const q = $('#searchInput').value.trim(); const old = new Set(this.hits.map((h) => h.page)); this.hits = [];
    if (q.length < 2) { $('#searchList').replaceChildren(); $('#searchInfo').textContent = ''; old.forEach((p) => this.redraw(p)); return; }
    const hits = await api.search(this.docId, q); this.hits = hits; new Set([...old, ...hits.map((h) => h.page)]).forEach((p) => this.redraw(p));
    $('#searchInfo').textContent = hits.length ? t('results', { n: hits.length }) : t('noResults');
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    $('#searchList').replaceChildren(...hits.slice(0, 300).map((h) => { const it = el('div', { class: 'it', onclick: () => this.go(h.page) }, el('div', { class: 'm' }, `${t('page')} ${h.page + 1}`)); const sn = el('div'); sn.innerHTML = escapeHtml(h.snippet).replace(re, (m) => `<mark>${m}</mark>`); it.append(sn); return it; }));
  }, 300),
  renderNotes() {
    if (!this.data) return; const q = ($('#noteSearch').value || '').toLowerCase(); const type = $('#noteType').value; const col = this.noteColor;
    const used = [...new Set(this.data.annotations.map((a) => a.color).filter(Boolean))];
    $('#noteColors').replaceChildren(...used.map((c) => el('span', { class: 'cf' + (col === c ? ' on' : ''), style: { background: c }, onclick: () => { this.noteColor = col === c ? null : c; this.renderNotes(); } })));
    const list = this.data.annotations.filter((a) => (!type || (type === 'shape' ? ['ink', 'marker', 'rect', 'ellipse', 'line', 'arrow'].includes(a.type) : a.type === type)) && (!col || a.color === col) && (!q || [a.text, a.comment, a.content].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => a.page - b.page || (a.rects ? a.rects[0][1] : a.rect ? a.rect[1] : 0) - (b.rects ? b.rects[0][1] : b.rect ? b.rect[1] : 0));
    $('#noteList').replaceChildren(...(list.length ? list.map((a) => el('div', { class: 'it', style: { '--c': a.color }, onclick: () => this.jump(a) },
      el('div', { class: 'm' }, el('span', { class: 'dot', style: { background: a.color } }), t('t_' + a.type), ' · ', `${t('page')} ${a.page + 1}`),
      a.text ? el('q', {}, a.text.slice(0, 160)) : null, a.content ? el('div', {}, a.content.slice(0, 200)) : null, a.comment ? el('div', {}, '💬 ' + a.comment) : null,
      el('button', { class: 'x', onclick: (e) => { e.stopPropagation(); this.remove(a.id); } }, '✕'))) : [el('div', { class: 'muted small' }, t('noNotes'))]));
  },
  jump(a) { this.go(a.page); setTimeout(() => this.pagesFor(a.page).forEach((p) => { p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash'); const h = p.querySelector(`[data-id="${a.id}"]`); if (h && h.animate) h.animate([{ opacity: 0.2 }, { opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], { duration: 1200 }); }), this.mode === 'flip' ? 750 : 400); },
  renderBookmarks() {
    const bm = [...(this.data ? this.data.bookmarks : [])].sort((a, b) => a.page - b.page);
    $('#bmList').replaceChildren(...(bm.length ? bm.map((b) => { const inp = el('input', { value: b.title || '', onclick: (e) => e.stopPropagation(), onchange: () => { b.title = inp.value; this.save(); } }); return el('div', { class: 'it', onclick: () => this.go(b.page) }, el('div', { class: 'm' }, '★ ' + `${t('page')} ${b.page + 1}`), inp, el('button', { class: 'x', onclick: (e) => { e.stopPropagation(); this.data.bookmarks = this.data.bookmarks.filter((x) => x !== b); this.save(); this.renderBookmarks(); this.updateBar(); } }, '✕')); }) : [el('div', { class: 'muted small' }, t('noBookmarks'))]));
  },
  renderWords() {
    if (!this.book) return; const list = Lib.vocab.filter((v) => v.bookId === this.book.id);
    $('#wordList').replaceChildren(...list.map((v) => el('div', { class: 'it', onclick: () => this.go(v.page) }, el('div', { class: 'm' }, `${t('page')} ${v.page + 1}`), el('b', {}, v.word), v.translation ? el('div', {}, '→ ' + v.translation) : null, v.note ? el('div', { class: 'muted small' }, v.note) : null,
      el('button', { class: 'x', onclick: async (e) => { e.stopPropagation(); Lib.vocab = Lib.vocab.filter((x) => x.id !== v.id); await api.saveVocab(Lib.vocab); this.renderWords(); } }, '✕'))));
  },
};
function pathD(pts) { if (!pts.length) return ''; let d = `M${pts[0][0]},${pts[0][1]}`; for (let i = 1; i < pts.length; i++) d += ` L${pts[i][0]},${pts[i][1]}`; if (pts.length === 1) d += ` l0.1,0.1`; return d; }
function mergeRects(rs) {
  rs = rs.filter((r) => r[2] > 0.3 && r[3] > 0.3).sort((a, b) => a[1] - b[1] || a[0] - b[0]); const out = [];
  for (const r of rs) {
    const m = out.find((o) => Math.abs(o[1] - r[1]) < Math.max(2, r[3] * 0.4) && Math.abs(o[3] - r[3]) < Math.max(3, r[3] * 0.5) && r[0] <= o[0] + o[2] + 3 && r[0] + r[2] >= o[0] - 3);
    if (m) { const x0 = Math.min(m[0], r[0]), y0 = Math.min(m[1], r[1]), x1 = Math.max(m[0] + m[2], r[0] + r[2]), y1 = Math.max(m[1] + m[3], r[1] + r[3]); m[0] = x0; m[1] = y0; m[2] = x1 - x0; m[3] = y1 - y0; } else out.push([...r]);
  }
  return out;
}
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function showPopAt(pop, x, y) { pop.classList.remove('hidden'); const r = pop.getBoundingClientRect(); pop.style.left = Math.max(6, Math.min(innerWidth - r.width - 6, x - r.width / 2)) + 'px'; pop.style.top = Math.max(6, Math.min(innerHeight - r.height - 6, y)) + 'px'; }
function hidePops() { $('#selPop').classList.add('hidden'); $('#annPop').classList.add('hidden'); $('#exportMenu').classList.add('hidden'); }
function promptBox(label, value) { return new Promise((res) => { const pop = $('#annPop'); const inp = el('input', { value: value || '' }); const ok = () => { hidePops(); res(inp.value); }; inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') { hidePops(); res(null); } }); pop.replaceChildren(el('b', {}, label), inp, el('div', { class: 'row' }, el('button', { class: 'primary', onclick: ok }, t('save')), el('button', { onclick: () => { hidePops(); res(null); } }, t('cancel')))); showPopAt(pop, innerWidth / 2, innerHeight / 3); setTimeout(() => inp.focus(), 20); }); }
function showView(v) { $$('.view').forEach((x) => x.classList.toggle('active', x.id === v)); }

// ---------- vocabulary manager ----------
function openVocab() {
  const body = $('#mBody'); $('#mTitle').textContent = t('allWords');
  const q = el('input', { class: 'search', placeholder: '⌕' }); const table = el('table', { class: 'vt' });
  const draw = () => {
    const s = q.value.toLowerCase(); const list = Lib.vocab.filter((v) => !s || [v.word, v.translation, v.note, v.bookTitle].join(' ').toLowerCase().includes(s));
    table.replaceChildren(el('tr', {}, el('th', {}, t('word')), el('th', {}, t('translation')), el('th', {}, t('notes')), el('th', {}, t('book')), el('th')), ...list.map((v) => {
      const cell = (k) => { const i = el('input', { value: v[k] || '' }); i.onchange = () => { v[k] = i.value; api.saveVocab(Lib.vocab); }; return el('td', {}, i); };
      return el('tr', {}, cell('word'), cell('translation'), cell('note'), el('td', { class: 'small muted', title: v.context || '' }, `${v.bookTitle || ''} · p.${(v.page || 0) + 1}`), el('td', {}, el('button', { onclick: async () => { Lib.vocab = Lib.vocab.filter((x) => x !== v); await api.saveVocab(Lib.vocab); draw(); } }, '✕')));
    }));
  };
  q.oninput = draw; draw();
  body.replaceChildren(el('div', { class: 'row' }, q, el('button', { onclick: async () => { const p = await api.vocabCsv(); if (p) toast(t('exported', { p })); } }, '⬇ ' + t('exportCsv'))), table);
  $('#modal').classList.remove('hidden');
}

// ======================= wiring =======================
function wire() {
  $('#homeBtn').onclick = () => R.close(); $('#backLib').onclick = () => R.close();
  $('#openBooks').onclick = async () => { const p = await api.pickFiles(); if (p.length) { const added = await Lib.add(p); if (added.length === 1) R.open(added[0].id); } };
  $('#libSearch').oninput = () => Lib.render(); $('#libSort').onchange = () => Lib.render();
  $('#editBtn').onclick = () => { if (R.book && window.Editor) Editor.open(R.book.path); };
  $('#vocabOpen').onclick = openVocab; $('#mClose').onclick = () => $('#modal').classList.add('hidden');
  $('#bkExport').onclick = async () => { const p = await api.backupExport(); if (p) toast(t('backupSaved') + ': ' + p, 4000); };
  $('#bkImport').onclick = async () => { try { const r = await api.backupImport(); if (r) { toast(t('imported', { b: r.books, a: r.annotations })); Lib.load(); } } catch (e) { toast(String(e.message || e)); } };
  $$('.lang button').forEach((b) => (b.onclick = async () => { S = await api.setSettings({ lang: b.dataset.lang }); applyI18n(); }));
  $('#themeSel').onchange = async (e) => { S = await api.setSettings({ theme: e.target.value }); setTheme(S.theme); };
  $('#sideToggle').onclick = () => { $('#side').classList.toggle('closed'); setTimeout(() => R.flip ? R.flip.relayout() : R.mode === 'scroll' && R.setZoom(R.zoom), 50); };
  $$('#sideTabs button').forEach((b) => (b.onclick = () => R.showPanel(b.dataset.p)));
  $$('#modeSeg button').forEach((b) => (b.onclick = async () => { if (R.mode === b.dataset.v) return; R.mode = b.dataset.v; S = await api.setSettings({ mode: R.mode }); R.buildView(); R.saveProgress(); }));
  $('#prevPg').onclick = () => (R.book && R.book.rtl && R.mode === 'flip' ? R.next() : R.prev()); $('#nextPg').onclick = () => (R.book && R.book.rtl && R.mode === 'flip' ? R.prev() : R.next());
  $('#pgInput').onchange = (e) => { const v = parseInt(e.target.value, 10); if (v) R.go(v - 1); };
  $('#zoomIn').onclick = () => R.zoomBy(1.2); $('#zoomOut').onclick = () => R.zoomBy(1 / 1.2); $('#zoomVal').onclick = () => R.setZoom(1);
  $('#bmBtn').onclick = () => R.toggleBookmark();
  $('#fsBtn').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  $('#exportBtn').onclick = (e) => { e.stopPropagation(); $('#exportMenu').classList.toggle('hidden'); };
  $$('#exportMenu button').forEach((b) => (b.onclick = async () => { hidePops(); R.flushSave(); try { const r = b.dataset.x === 'annotated' ? await api.exportAnnotated(R.book.id) : await api.exportNotes(R.book.id, b.dataset.x, Lib.vocab); if (r) { const p = r.out || r; toast(t('exported', { p }), 4500); api.show(p); } } catch (err) { toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 5000); } }));
  $$('#tools [data-tool]').forEach((b) => (b.onclick = () => R.setTool(b.dataset.tool)));
  $('#colorPick').replaceChildren(...COLORS.map((c) => el('span', { class: 'cf' + (c === R.color ? ' on' : ''), style: { background: c }, onclick: (e) => { R.color = c; $$('#colorPick .cf').forEach((x) => x.classList.toggle('on', x === e.target)); } })));
  $('#widthSel').onchange = (e) => { R.width = +e.target.value; };
  $('#searchInput').oninput = () => R.runSearch(); $('#noteSearch').oninput = () => R.renderNotes(); $('#noteType').onchange = () => R.renderNotes();
  document.addEventListener('mouseup', (e) => R.onMouseUp(e));
  document.addEventListener('pointerdown', (e) => { R.lastAct = Date.now(); if (!e.target.closest('.pop') && !e.target.closest('#exportBtn')) hidePops(); }, true);
  document.addEventListener('keydown', (e) => {
    R.lastAct = Date.now(); if (!R.book || $('#library').classList.contains('active')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) { if (e.key === 'Escape') e.target.blur(); return; }
    const k = e.key; const rtl = R.book.rtl && R.mode === 'flip';
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); R.undoLast(); return; }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'f') { e.preventDefault(); R.showPanel('search'); return; }
    if ((e.ctrlKey || e.metaKey) && (k === '=' || k === '+')) { e.preventDefault(); R.zoomBy(1.2); return; }
    if ((e.ctrlKey || e.metaKey) && k === '-') { e.preventDefault(); R.zoomBy(1 / 1.2); return; }
    if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && R.mode === 'flip')) { e.preventDefault(); rtl ? R.prev() : R.next(); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); rtl ? R.next() : R.prev(); }
    else if (k === 'Home') R.go(0); else if (k === 'End') R.go(R.info.pageCount - 1);
    else if (k === 'b' || k === 'B') R.toggleBookmark(); else if (k === 'Escape') { hidePops(); R.setTool('select'); }
    else if (k === 'F11') { e.preventDefault(); $('#fsBtn').click(); } else if (k === 'h' || k === 'H') R.setTool('highlight'); else if (k === 'p' || k === 'P') R.setTool('ink'); else if (k === 'v' || k === 'V') R.setTool('select');
  });
  $('#viewer').addEventListener('wheel', (e) => { if (e.ctrlKey && R.mode === 'scroll') { e.preventDefault(); R.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); } }, { passive: false });
  addEventListener('resize', debounce(() => { if (R.book && R.mode === 'scroll') R.setZoom(R.zoom); }, 250));
  // drag & drop
  let dd = 0;
  addEventListener('dragenter', (e) => { e.preventDefault(); dd++; $('#dropOverlay').classList.remove('hidden'); });
  addEventListener('dragleave', () => { if (--dd <= 0) { dd = 0; $('#dropOverlay').classList.add('hidden'); } });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', async (e) => { e.preventDefault(); dd = 0; $('#dropOverlay').classList.add('hidden'); const paths = [...e.dataTransfer.files].map((f) => api.pathFor(f)).filter(Boolean); if (!paths.length) return; const added = await Lib.add(paths); if (added.length === 1) R.open(added[0].id); });
  // reading timer: counts half-minutes while the window is focused, a book is open and you were active in the last 2 minutes
  setInterval(async () => { if (R.book && document.hasFocus() && Date.now() - R.lastAct < 120000) { Lib.stats = await api.addMinutes(R.book.id, 0.5); Lib.renderStats(); } }, 30000);
  addEventListener('beforeunload', () => R.flushSave());
  api.onOpenExternal(async (x) => {
    if (x.mode === 'edit' && window.Editor) { if (document.body.classList.contains('editing') && !(await Editor.close())) return; const r = await Editor.open(x.file, { source: x.source }); if (r) toast(t('edTitle') + ': ' + x.file.split(/[\\/]/).pop()); return; }
    const added = await Lib.add([x.file]); if (!added.length) return; const r = await R.open(added[0].id, x.page != null ? x.page - 1 : undefined);
    if (r) { toast(t('opened', { t: r.book.title })); api.handoffOpened({ file: x.file, source: x.source, bookId: r.book.id, pageCount: r.info.pageCount }); }
  });
}

(async () => {
  S = await api.settings(); setTheme(S.theme || 'light'); wire(); await Lib.load(); applyI18n(); api.ready();
  window.__reader = { R, Lib, t };
})();
