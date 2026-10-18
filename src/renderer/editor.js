'use strict';
/* global api, t, toast, $, $$, el, uid, showView, S, R, Lib */
// Visual PDF editor. Everything is kept as a list of edit operations per page (in page/display points) and is only
// written to a new PDF on Save (src/pdfedit.js). Undo/redo snapshot the operations; images live in a side store.
const CSSFONT = { Helvetica: 'Arial, Helvetica, sans-serif', Times: '"Times New Roman", Times, serif', Courier: '"Courier New", Courier, monospace' };
const WINANSI = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);
const winAnsiOk = (s) => [...s].every((c) => c === '\n' || (c >= ' ' && c <= '~') || (c >= '\u00a0' && c <= '\u00ff') || WINANSI.has(c));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const E = {
  file: null, src: null, docs: {}, pages: [], items: {}, forms: {}, imgs: {}, info: {}, zoom: 1.2, tool: 'select', sel: null, hist: [], fut: [], dirty: false, out: null,
  style: { font: 'Helvetica', size: 14, color: '#111111', bold: false, italic: false, align: 'left' }, pending: null, blankSeq: 1, mergeSeq: 1,
  key(p) { return p.blank ? 'b:' + p.id : `${p.src}:${p.index}`; },
  size(p) { return p.blank ? p.size : this.docs[p.src].pages[p.index]; },
  ops(p) { const k = this.key(p); return (this.items[k] = this.items[k] || []); },

  // ---------- open / close ----------
  async open(file, opts = {}) {
    let r; try { r = await api.editOpen(file); } catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 5000); return null; }
    if (!r.isPDF) { toast(t('edNoPdf')); api.editClose(r.docId); return null; }
    if (R.book) await R.close(true);
    Object.assign(this, { file, docs: { o: { file, docId: r.docId, pages: r.pages, title: r.title } }, pages: r.pages.map((_, i) => ({ src: 'o', index: i, rot: 0 })), items: {}, forms: {}, imgs: {}, info: {}, sel: null, hist: [], fut: [], dirty: false, out: null, tool: 'select', pending: null });
    document.body.classList.add('editing'); showView('editor');
    $('#edFile').textContent = file.split(/[\\/]/).pop(); this.wire(); this.setTool('select'); this.renderAll(); this.commit(true);
    if (opts.source) api.handoffOpened({ file, source: opts.source, mode: 'edit', pageCount: r.pageCount });
    return r;
  },
  async close(force) {
    if (!force && this.dirty && !confirm(t('edUnsaved'))) return false;
    for (const d of Object.values(this.docs)) api.editClose(d.docId);
    this.docs = {}; this.pages = []; document.body.classList.remove('editing'); $('#edMain').replaceChildren(); $('#edPages').replaceChildren(); showView('library'); Lib.load(); return true;
  },

  // ---------- history ----------
  snap() { return JSON.stringify({ pages: this.pages, items: this.items, forms: this.forms }); },
  commit(initial) { const s = this.snap(); if (this.hist[this.hist.length - 1] === s) return; this.hist.push(s); if (this.hist.length > 200) this.hist.shift(); this.fut = []; if (!initial) this.dirty = true; this.updateBar(); },
  restore(s) { const o = JSON.parse(s); this.pages = o.pages; this.items = o.items; this.forms = o.forms; this.sel = null; this.dirty = true; this.renderAll(); },
  undo() { if (this.hist.length < 2) return; this.fut.push(this.hist.pop()); this.restore(this.hist[this.hist.length - 1]); },
  redo() { if (!this.fut.length) return; const s = this.fut.pop(); this.hist.push(s); this.restore(s); },
  updateBar() { $('#edUndo').disabled = this.hist.length < 2; $('#edRedo').disabled = !this.fut.length; $('#edSave').classList.toggle('dirty', this.dirty); },

  // ---------- tools ----------
  setTool(tool, pending) {
    this.tool = tool; this.pending = pending || null; if (tool !== 'select') this.select(null);
    $$('#edTools [data-et]').forEach((b) => b.classList.toggle('on', b.dataset.et === tool || (tool === 'place' && b.dataset.et === (pending && pending.from))));
    $('#edMain').dataset.tool = tool;
    const hint = { select: 'edHintSelect', text: 'edHintText', addtext: 'edHintAdd', image: 'edHintImage', whiteout: 'edHintDrag', redact: 'edHintDrag', place: 'edHintPlace' }[tool];
    $('#edHint').textContent = hint ? t(hint) : ''; this.renderProps();
  },
  // ---------- rendering ----------
  renderAll() { this.renderThumbs(); this.renderPages(); this.renderProps(); this.updateBar(); },
  renderThumbs() {
    const host = $('#edPages'); host.replaceChildren();
    this.pages.forEach((p, i) => {
      const [w, h] = this.size(p); const s = 110 / Math.max(w, h);
      const img = p.blank ? el('div', { class: 'blank', style: { width: w * s + 'px', height: h * s + 'px' } }) : el('img', { src: `mrpage://render/${this.docs[p.src].docId}/${p.index}?s=${(s * 2).toFixed(3)}`, style: { width: w * s + 'px', height: h * s + 'px' } });
      const box = el('div', { class: 'thw', style: { transform: `rotate(${p.rot || 0}deg)` } }, img);
      const th = el('div', { class: 'edth', draggable: 'true', 'data-i': i, title: t('edPageN', { n: i + 1 }) }, box,
        el('div', { class: 'thn' }, String(i + 1) + (p.src && p.src !== 'o' ? ' · ' + t('edMerged') : '')),
        el('div', { class: 'tha' },
          el('button', { title: t('edRotate'), onclick: (e) => { e.stopPropagation(); p.rot = ((p.rot || 0) + 90) % 360; this.commit(); this.renderAll(); } }, '⟳'),
          el('button', { title: t('edInsertAfter'), onclick: (e) => { e.stopPropagation(); this.insertBlank(i + 1); } }, '＋'),
          el('button', { title: t('edDelPage'), onclick: (e) => { e.stopPropagation(); if (this.pages.length > 1) { this.pages.splice(i, 1); this.commit(); this.renderAll(); } } }, '🗑')));
      th.onclick = () => { const pg = $(`#edMain .edpage[data-i="${i}"]`); if (pg) pg.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
      th.ondragstart = (e) => { e.dataTransfer.setData('text/x-page', String(i)); th.classList.add('drag'); };
      th.ondragend = () => th.classList.remove('drag');
      th.ondragover = (e) => { if ([...e.dataTransfer.types].includes('text/x-page')) { e.preventDefault(); th.classList.add('over'); } };
      th.ondragleave = () => th.classList.remove('over');
      th.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); th.classList.remove('over'); const from = +e.dataTransfer.getData('text/x-page'); if (Number.isNaN(from) || from === i) return; this.movePage(from, i); };
      host.appendChild(th);
    });
    host.appendChild(el('div', { class: 'edpbtns' }, el('button', { class: 'ghost', onclick: () => this.insertBlank(this.pages.length) }, t('edBlank')), el('button', { class: 'ghost', onclick: () => this.merge() }, t('edMerge'))));
  },
  movePage(from, to) { const [p] = this.pages.splice(from, 1); this.pages.splice(to, 0, p); this.commit(); this.renderAll(); },
  insertBlank(at) { const ref = this.pages[Math.min(at, this.pages.length - 1)] || this.pages[0]; const sz = ref ? this.size(ref).slice() : [595.28, 841.89]; this.pages.splice(at, 0, { blank: true, id: this.blankSeq++, size: sz, rot: 0 }); this.commit(); this.renderAll(); },
  async merge() {
    const f = await api.editPickPdf(); if (!f) return; let r; try { r = await api.editOpen(f); } catch (e) { toast(String(e.message || e), 5000); return; }
    const id = 'm' + this.mergeSeq++; this.docs[id] = { file: f, docId: r.docId, pages: r.pages, title: r.title };
    r.pages.forEach((_, i) => this.pages.push({ src: id, index: i, rot: 0 })); this.commit(); this.renderAll(); toast(f.split(/[\\/]/).pop() + ' +' + r.pages.length);
  },
  renderPages() {
    const main = $('#edMain'); const top = main.scrollTop; main.replaceChildren(); const z = this.zoom; const dpr = window.devicePixelRatio || 1;
    this.pages.forEach((p, i) => {
      const [w, h] = this.size(p); const rot = p.rot || 0; const sw = rot % 180 ? h : w, sh = rot % 180 ? w : h;
      const page = el('div', { class: 'edpage', 'data-i': i, 'data-key': this.key(p), style: { width: w * z + 'px', height: h * z + 'px', transform: rot ? `translate(${(sw - w) * z / 2}px, ${(sh - h) * z / 2}px) rotate(${rot}deg)` : '' } });
      if (!p.blank) page.appendChild(el('img', { class: 'edimg', draggable: 'false', src: `mrpage://render/${this.docs[p.src].docId}/${p.index}?s=${(z * dpr).toFixed(3)}` }));
      const ov = el('div', { class: 'edov' }); page.appendChild(ov);
      const wrap = el('div', { class: 'edwrap', style: { width: sw * z + 'px', height: sh * z + 'px' } }, page, el('div', { class: 'edpn' }, String(i + 1)));
      main.appendChild(wrap); this.fillOverlay(p, ov); this.wirePage(p, page, ov);
    });
    main.scrollTop = top;
  },
  async pageInfo(p) {
    if (p.blank) return { lines: [], images: [], widgets: [] }; const k = this.key(p);
    if (!this.info[k]) this.info[k] = await api.editInfo(this.docs[p.src].docId, p.index); return this.info[k];
  },
  async fillOverlay(p, ov) {
    const z = this.zoom; const info = await this.pageInfo(p); const ops = this.ops(p); const k = this.key(p);
    if (!ov.isConnected) return; ov.replaceChildren();
    const box = (r, cls, extra = {}) => el('div', { class: cls, style: { left: r[0] * z + 'px', top: r[1] * z + 'px', width: r[2] * z + 'px', height: r[3] * z + 'px' }, ...extra });
    // removal previews (erase = white, redact = black)
    for (const op of ops) if (op.t === 'erase') ov.appendChild(box(op.rect, 'ederase')); else if (op.t === 'redact') ov.appendChild(box(op.rect, 'edredact', { 'data-id': op.id }));
    // original text lines (Edit text tool)
    info.lines.forEach((l, li) => {
      if (ops.some((o) => o.line === li)) return;
      const b = box(l.bbox, 'edline' + (l.editable ? '' : ' noedit'), { 'data-li': li, title: l.text });
      if (this.sel && this.sel.kind === 'line' && this.sel.k === k && this.sel.li === li) b.classList.add('sel');
      ov.appendChild(b);
    });
    // original images
    info.images.forEach((im, ii) => {
      if (ops.some((o) => o.img === ii)) return; const b = box(im.bbox, 'edoimg', { 'data-ii': ii });
      if (this.sel && this.sel.kind === 'oimg' && this.sel.k === k && this.sel.ii === ii) b.classList.add('sel'); ov.appendChild(b);
    });
    // form fields
    if (p.src === 'o') for (const w of info.widgets) ov.appendChild(this.fieldInput(w, box));
    // own items
    for (const op of ops) if (['text', 'image', 'whiteout'].includes(op.t)) ov.appendChild(this.itemEl(p, op));
    if (info.scanned && !ops.length && this.tool === 'text') toast(t('edScanned'), 4000);
  },
  fieldInput(w, box) {
    const z = this.zoom; const v = this.forms[w.name] !== undefined ? this.forms[w.name] : w.type === 'checkbox' || w.type === 'radiobutton' ? w.checked : w.value;
    let inp;
    if (w.type === 'checkbox') { inp = el('input', { type: 'checkbox' }); inp.checked = !!v; inp.onchange = () => { this.forms[w.name] = inp.checked; this.commit(); }; }
    else if (w.type === 'radiobutton') { inp = el('input', { type: 'radio', name: 'f_' + w.name }); inp.checked = v === true || v === w.onValue; inp.onchange = () => { this.forms[w.name] = w.onValue; this.commit(); }; }
    else if (w.type === 'combobox' || w.type === 'listbox') { inp = el('select', {}, ...(w.options || []).map((o) => el('option', { value: o }, o))); inp.value = v || ''; inp.onchange = () => { this.forms[w.name] = inp.value; this.commit(); }; }
    else if (w.type === 'text') { inp = w.multiline ? el('textarea') : el('input', { type: 'text' }); inp.value = v || ''; if (w.maxLen > 0) inp.maxLength = w.maxLen; inp.onchange = () => { this.forms[w.name] = inp.value; this.commit(); }; inp.style.fontSize = Math.max(9, Math.min(w.rect[3] * 0.62, 14)) * z + 'px'; }
    else return el('span');
    if (w.readOnly) inp.disabled = true;
    const b = box(w.rect, 'edfield'); b.title = w.label || w.name; b.appendChild(inp); b.addEventListener('pointerdown', (e) => e.stopPropagation()); return b;
  },
  itemEl(p, op) {
    const z = this.zoom; const [x, y, w, h] = op.rect; const k = this.key(p);
    const d = el('div', { class: 'editem it-' + op.t, 'data-id': op.id, style: { left: x * z + 'px', top: y * z + 'px', width: w * z + 'px', height: h * z + 'px' } });
    if (op.t === 'whiteout') d.style.background = op.color || '#fff';
    if (op.t === 'image') d.appendChild(el('img', { src: this.imgs[op.data] || '', draggable: 'false' }));
    if (op.t === 'text') {
      const base0 = op.baseline != null ? op.baseline : op.size * 0.8;
      const tx = el('div', { class: 'edtext', style: { fontFamily: CSSFONT[op.font] || CSSFONT.Helvetica, fontSize: op.size * z + 'px', lineHeight: 1.2, color: op.color, fontWeight: op.bold ? 700 : 400, fontStyle: op.italic ? 'italic' : 'normal', textAlign: op.align || 'left', top: (base0 - 0.95 * op.size) * z + 'px' } });
      tx.textContent = op.text; d.appendChild(tx); if (op.cover) d.classList.add('cover');
      d.ondblclick = (e) => { e.stopPropagation(); this.editText(p, op, d); };
    }
    if (this.sel && this.sel.kind === 'item' && this.sel.id === op.id) { d.classList.add('sel'); d.appendChild(el('div', { class: 'hdl', 'data-h': 'se' })); }
    d.dataset.k = k; return d;
  },
  rerenderPage(p) { const i = this.pages.indexOf(p); const ov = $(`#edMain .edpage[data-i="${i}"] .edov`); if (ov) this.fillOverlay(p, ov); },
  findOp(id) { for (const p of this.pages) { const o = (this.items[this.key(p)] || []).find((x) => x.id === id); if (o) return { p, op: o }; } return null; },

  // ---------- page interaction ----------
  wirePage(p, page, ov) {
    const z = () => this.zoom; const pt = (e) => { const r = ov.getBoundingClientRect(); const rot = p.rot || 0; let x = (e.clientX - r.left), y = (e.clientY - r.top); const W = r.width, H = r.height;
      if (rot === 90) [x, y] = [y, W - x]; else if (rot === 180) [x, y] = [W - x, H - y]; else if (rot === 270) [x, y] = [H - y, x];
      return [x / z(), y / z()]; };
    ov.addEventListener('pointerdown', async (e) => {
      if (e.button !== 0) return; const [x, y] = pt(e); const target = e.target.closest('.editem, .edline, .edoimg, .edredact');
      if (this.tool === 'place' && this.pending) { e.preventDefault(); this.placePending(p, x, y); return; }
      if (this.tool === 'addtext') { e.preventDefault(); const op = this.addTextOp(p, x, y - this.style.size * 0.8, ''); this.setTool('select'); this.select({ kind: 'item', id: op.id }); this.rerenderPage(p); setTimeout(() => { const d = $(`.editem[data-id="${op.id}"]`); if (d) this.editText(p, op, d); }, 30); return; }
      if (this.tool === 'image') { e.preventDefault(); const im = await this.pickImage(); if (im) { const w = Math.min(220, im.w), h = w * im.h / im.w; this.addOp(p, { t: 'image', rect: [x, y, w, h], data: im.id }); this.setTool('select'); } return; }
      if (this.tool === 'whiteout' || this.tool === 'redact') { e.preventDefault(); this.dragRect(e, p, ov, pt); return; }
      if (target && target.classList.contains('edline')) {
        const li = +target.dataset.li; e.preventDefault();
        if (this.tool === 'text') { this.select({ kind: 'line', k: this.key(p), li }); this.editLine(p, li); }
        return;
      }
      if (target && target.classList.contains('edoimg')) { e.preventDefault(); const ii = +target.dataset.ii; this.select({ kind: 'oimg', k: this.key(p), ii }); this.startDrag(e, p, { oimg: ii }, pt); return; }
      if (target && (target.classList.contains('editem') || target.classList.contains('edredact'))) {
        if (e.target.closest('.edtext[contenteditable="true"]')) return;
        e.preventDefault(); const id = target.dataset.id; this.select({ kind: 'item', id }); this.startDrag(e, p, { id, resize: e.target.classList.contains('hdl') }, pt); return;
      }
      this.select(null);
    });
  },
  dragRect(e, p, ov, pt) {
    const [x0, y0] = pt(e); const z = this.zoom; const ghost = el('div', { class: this.tool === 'redact' ? 'edredact ghost' : 'ederase ghost wo' }); ov.appendChild(ghost);
    const move = (ev) => { const [x, y] = pt(ev); Object.assign(ghost.style, { left: Math.min(x, x0) * z + 'px', top: Math.min(y, y0) * z + 'px', width: Math.abs(x - x0) * z + 'px', height: Math.abs(y - y0) * z + 'px' }); };
    const up = (ev) => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); ghost.remove(); const [x, y] = pt(ev); const r = [Math.min(x, x0), Math.min(y, y0), Math.abs(x - x0), Math.abs(y - y0)]; if (r[2] < 3 || r[3] < 3) return;
      this.addOp(p, this.tool === 'redact' ? { t: 'redact', rect: r } : { t: 'whiteout', rect: r, color: '#ffffff' }); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  },
  async startDrag(e, p, what, pt) {
    const [sx, sy] = pt(e); let op, conv = false, info = await this.pageInfo(p);
    if (what.oimg != null) { op = null; } else { const f = this.findOp(what.id); if (!f) return; op = f.op; }
    const orig = op ? op.rect.slice() : info.images[what.oimg].bbox.slice(); let moved = false;
    const move = async (ev) => {
      const [x, y] = pt(ev); const dx = x - sx, dy = y - sy; if (!moved && Math.hypot(dx, dy) < 2) return;
      if (!op && !conv) { conv = true; op = await this.convertImage(p, what.oimg); if (!op) return; this.select({ kind: 'item', id: op.id }); }
      if (!op) return; moved = true;
      if (what.resize) { const keep = op.t === 'image' && !ev.shiftKey; let w = Math.max(8, orig[2] + dx), h = Math.max(6, orig[3] + dy); if (keep) h = w * orig[3] / orig[2]; op.rect = [orig[0], orig[1], w, h]; }
      else op.rect = [orig[0] + dx, orig[1] + dy, orig[2], orig[3]];
      const d = $(`.editem[data-id="${op.id}"], .edredact[data-id="${op.id}"]`); if (d) { const z = this.zoom; Object.assign(d.style, { left: op.rect[0] * z + 'px', top: op.rect[1] * z + 'px', width: op.rect[2] * z + 'px', height: op.rect[3] * z + 'px' }); }
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (moved) { this.commit(); this.rerenderPage(p); } };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  },
  /** Turn an original image into an editable item: remove it from the page content and re-add it as an image op. */
  async convertImage(p, ii) {
    const info = await this.pageInfo(p); const im = info.images[ii]; if (!im) return null;
    const data = await api.editImagePng(this.docs[p.src].docId, p.index, ii); const id = uid(); this.imgs[id] = data;
    const overl = info.images.some((o, j) => j !== ii && !(o.bbox[0] + o.bbox[2] <= im.bbox[0] || im.bbox[0] + im.bbox[2] <= o.bbox[0] || o.bbox[1] + o.bbox[3] <= im.bbox[1] || im.bbox[1] + im.bbox[3] <= o.bbox[1]));
    const ops = this.ops(p); ops.push({ id: uid(), t: 'erase', what: 'image', rect: im.bbox.slice(), pixels: overl, img: ii });
    const op = { id: uid(), t: 'image', rect: im.bbox.slice(), data: id, img: ii }; ops.push(op); this.commit(); this.rerenderPage(p); return op;
  },
  addOp(p, op) { op.id = op.id || uid(); this.ops(p).push(op); this.commit(); this.rerenderPage(p); if (['text', 'image', 'whiteout', 'redact'].includes(op.t)) this.select({ kind: 'item', id: op.id }); return op; },
  addTextOp(p, x, y, text, extra = {}) { const s = this.style; return this.addOp(p, { t: 'text', rect: [x, y, 200, s.size * 1.3], text, font: s.font, size: s.size, color: s.color, bold: s.bold, italic: s.italic, align: s.align, ...extra }); },
  /** Edit an existing line: remove the original glyphs and retype it in the closest standard font, on the same baseline. */
  async editLine(p, li) {
    const info = await this.pageInfo(p); const l = info.lines[li]; if (!l) return; const ops = this.ops(p);
    const [bx, by, bw, bh] = l.bbox; const er = [bx - 0.5, by + bh * 0.12, bw + 1, bh * 0.76];
    ops.push({ id: uid(), t: 'erase', what: 'text', rect: er, line: li });
    const op = { id: uid(), t: 'text', rect: [bx, by, Math.max(bw + 4, 40), bh], text: l.text.replace(/\s+$/, ''), font: l.font, bold: l.bold, italic: l.italic, size: l.size, color: l.color, align: 'left', baseline: l.baseline - by, line: li };
    ops.push(op); this.commit(); this.select({ kind: 'item', id: op.id }); this.rerenderPage(p);
    if (l.mixed) toast(t('edMixed'), 3500);
    setTimeout(() => { const d = $(`.editem[data-id="${op.id}"]`); if (d) this.editText(p, op, d, true); }, 40);
  },
  deleteLine(p, li) { const info = this.info[this.key(p)]; const l = info && info.lines[li]; if (!l) return; const [bx, by, bw, bh] = l.bbox; this.addOp(p, { t: 'erase', what: 'text', rect: [bx - 0.5, by + bh * 0.12, bw + 1, bh * 0.76], line: li }); this.select(null); },
  editText(p, op, d, selectAll) {
    const tx = d.querySelector('.edtext'); if (!tx) return; tx.contentEditable = 'true'; tx.spellcheck = false; tx.focus(); d.classList.add('editing');
    const r = document.createRange(); r.selectNodeContents(tx); if (!selectAll) r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    const done = () => {
      tx.removeEventListener('blur', done); tx.contentEditable = 'false'; d.classList.remove('editing');
      const txt = tx.innerText.replace(/\r/g, '').replace(/\n$/, '');
      if (txt === op.text && op.text) return;
      if (!txt.trim()) { const ops = this.ops(p); ops.splice(ops.indexOf(op), 1); }
      else { op.text = txt; const c = document.createElement('canvas').getContext('2d'); c.font = `${op.italic ? 'italic ' : ''}${op.bold ? 700 : 400} ${op.size}px ${CSSFONT[op.font]}`; const lines = txt.split('\n'); const w = Math.max(...lines.map((x) => c.measureText(x).width)); op.rect[2] = Math.max(op.rect[2], w + 4); op.rect[3] = Math.max(op.rect[3], lines.length * op.size * 1.2); }
      this.commit(); this.rerenderPage(p);
    };
    tx.addEventListener('blur', done);
    tx.onkeydown = (e) => { if (e.key === 'Escape') { tx.blur(); } e.stopPropagation(); };
  },
  select(s) { this.sel = s; $$('#edMain .sel').forEach((x) => x.classList.remove('sel')); $$('#edMain .hdl').forEach((x) => x.remove());
    if (s && s.kind === 'item') { const d = $(`#edMain [data-id="${s.id}"]`); if (d) { d.classList.add('sel'); if (d.classList.contains('editem')) d.appendChild(el('div', { class: 'hdl', 'data-h': 'se' })); } }
    if (s && s.kind === 'line') { const d = $(`#edMain .edpage[data-key="${s.k}"] .edline[data-li="${s.li}"]`); if (d) d.classList.add('sel'); }
    if (s && s.kind === 'oimg') { const d = $(`#edMain .edpage[data-key="${s.k}"] .edoimg[data-ii="${s.ii}"]`); if (d) d.classList.add('sel'); }
    this.renderProps(); },
  deleteSel() {
    const s = this.sel; if (!s) return;
    if (s.kind === 'item') { const f = this.findOp(s.id); if (!f) return; const ops = this.ops(f.p); ops.splice(ops.indexOf(f.op), 1); this.commit(); this.select(null); this.rerenderPage(f.p); }
    else if (s.kind === 'line') { const p = this.pages.find((x) => this.key(x) === s.k); if (p) this.deleteLine(p, s.li); }
    else if (s.kind === 'oimg') { const p = this.pages.find((x) => this.key(x) === s.k); if (!p) return; this.convertImage(p, s.ii).then((op) => { if (!op) return; const ops = this.ops(p); ops.splice(ops.indexOf(op), 1); this.commit(); this.select(null); this.rerenderPage(p); }); }
  },
  async replaceSel() {
    const s = this.sel; if (!s) return; const im = await this.pickImage(); if (!im) return;
    if (s.kind === 'oimg') { const p = this.pages.find((x) => this.key(x) === s.k); const op = await this.convertImage(p, s.ii); if (op) { op.data = im.id; this.commit(); this.rerenderPage(p); this.select({ kind: 'item', id: op.id }); } }
    else if (s.kind === 'item') { const f = this.findOp(s.id); if (f && f.op.t === 'image') { f.op.data = im.id; const [x, y, w] = f.op.rect; f.op.rect = [x, y, w, w * im.h / im.w]; this.commit(); this.rerenderPage(f.p); } }
  },
  async pickImage(dataUrl) {
    const d = dataUrl || await api.editPickImage(); if (!d) return null;
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = d; }).catch(() => null); if (!img) { toast('Image could not be read'); return null; }
    let data = d; if (!/^data:image\/(png|jpe?g);/.test(d)) { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); data = c.toDataURL('image/png'); }
    const id = uid(); this.imgs[id] = data; return { id, w: img.naturalWidth, h: img.naturalHeight };
  },
  placePending(p, x, y) {
    const pd = this.pending; const w = pd.w, h = pd.h;
    if (pd.text != null) this.addTextOp(p, x, y - pd.size * 0.8, pd.text, { size: pd.size, font: 'Helvetica', color: '#111111', bold: false, italic: false });
    else this.addOp(p, { t: 'image', rect: [x - w / 2, y - h / 2, w, h], data: pd.id });
    this.setTool('select');
  },

  // ---------- properties panel ----------
  renderProps() {
    const host = $('#edProps'); if (!host) return; host.replaceChildren(); const s = this.sel; const f = s && s.kind === 'item' ? this.findOp(s.id) : null; const op = f && f.op;
    const textMode = (op && op.t === 'text') || this.tool === 'addtext';
    host.appendChild(el('div', { class: 'muted small' }, s ? t('edSel') : t('edNothing')));
    if (textMode) {
      const st = op || this.style; const set = (k, v) => { st[k] = v; if (op) { this.commit(); this.rerenderPage(f.p); } else this.style[k] = v; this.renderProps(); };
      const fam = el('select', { class: 'sel', onchange: (e) => set('font', e.target.value) }, ...['Helvetica', 'Times', 'Courier'].map((x) => el('option', { value: x }, x))); fam.value = st.font;
      const size = el('input', { type: 'number', min: 4, max: 200, step: 0.5, value: st.size, class: 'num', onchange: (e) => set('size', clamp(+e.target.value || 12, 4, 200)) });
      const color = el('input', { type: 'color', value: st.color, onchange: (e) => set('color', e.target.value) });
      host.append(el('label', {}, t('edFont')), fam, el('label', {}, t('edSize')), size, el('label', {}, t('edColor')), color,
        el('div', { class: 'row' }, el('button', { class: 'ib' + (st.bold ? ' on' : ''), title: t('edBold'), onclick: () => set('bold', !st.bold) }, el('b', {}, 'B')), el('button', { class: 'ib' + (st.italic ? ' on' : ''), title: t('edItalic'), onclick: () => set('italic', !st.italic) }, el('i', {}, 'I'))),
        el('label', {}, t('edAlign')), el('div', { class: 'row' }, ...[['left', '⯇'], ['center', '≡'], ['right', '⯈']].map(([a, g]) => el('button', { class: 'ib' + ((st.align || 'left') === a ? ' on' : ''), onclick: () => set('align', a) }, g))));
    }
    if (s && s.kind === 'line') host.append(el('button', { class: 'ghost', onclick: () => { const p = this.pages.find((x) => this.key(x) === s.k); this.editLine(p, s.li); } }, t('edEditThis')), el('button', { class: 'ghost danger', onclick: () => this.deleteSel() }, t('edDeleteText')));
    if ((s && s.kind === 'oimg') || (op && op.t === 'image')) host.append(el('button', { class: 'ghost', title: t('edReplaceHint'), onclick: () => this.replaceSel() }, t('edReplace')));
    if (s) host.append(el('button', { class: 'ghost danger', onclick: () => this.deleteSel() }, t('edDelete')));
    host.append(el('p', { class: 'note' }, t('edFieldHint')));
  },

  // ---------- signatures & stamps ----------
  async signDialog(kind = 'signature') {
    const list = await api.sigList(); const mine = list.filter((x) => (x.kind || 'signature') === kind);
    const body = el('div', { class: 'sigdlg' }); const tabs = el('div', { class: 'seg' }); const pane = el('div', { class: 'sigpane' });
    const saved = el('div', { class: 'sigsaved' }, el('div', { class: 'muted small' }, t('edSigSaved')), ...(mine.length ? mine.map((sg) => el('div', { class: 'sigitem' },
      el('img', { src: sg.data, onclick: () => { closeModal(); this.armImage(sg.data, kind); } }), el('button', { class: 'ib', title: t('edDelete'), onclick: async (e) => { e.stopPropagation(); await api.sigSave(list.filter((x) => x.id !== sg.id)); closeModal(); this.signDialog(kind); } }, '✕'))) : [el('div', { class: 'muted small' }, t('edSigNone'))]));
    let mode = 'draw'; let getData = () => null;
    const show = () => {
      $$('button', tabs).forEach((b) => b.classList.toggle('on', b.dataset.m === mode)); pane.replaceChildren();
      if (mode === 'draw') {
        const cv = el('canvas', { width: 900, height: 300, class: 'sigcv' }); const ctx = cv.getContext('2d'); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = colorIn.value; let last = null, any = false;
        cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); const r = cv.getBoundingClientRect(); last = [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
        cv.onpointermove = (e) => { if (!last) return; const r = cv.getBoundingClientRect(); const pt = [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; ctx.strokeStyle = colorIn.value; ctx.lineWidth = 2.5 + 5 * (e.pressure && e.pointerType === 'pen' ? e.pressure : 0.5); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...pt); ctx.stroke(); last = pt; any = true; };
        cv.onpointerup = () => { last = null; };
        pane.append(cv, el('button', { class: 'ghost', onclick: () => { ctx.clearRect(0, 0, cv.width, cv.height); any = false; } }, t('edSigClear')));
        getData = () => (any ? trim(cv) : null);
      } else if (mode === 'type') {
        const inp = el('input', { class: 'search', placeholder: kind === 'initials' ? t('edInitialsAsk') : t('edSigTypeHint'), value: kind === 'initials' ? (S.initials || '') : (S.sigName || '') });
        const prev = el('div', { class: 'sigtype' }); const upd = () => { prev.textContent = inp.value || ' '; prev.style.color = colorIn.value; }; inp.oninput = upd; upd();
        pane.append(inp, prev); setTimeout(() => inp.focus(), 50);
        getData = () => { if (!inp.value.trim()) return null; if (kind === 'initials') api.setSettings({ initials: inp.value }); else api.setSettings({ sigName: inp.value }); return typed(inp.value, colorIn.value); };
      } else {
        let data = null; const img = el('img', { class: 'sigimp' }); const white = el('input', { type: 'checkbox', checked: true });
        pane.append(el('button', { class: 'ghost', onclick: async () => { const d = await api.editPickImage(); if (d) { data = d; img.src = d; } } }, t('edSigPick')), img, el('label', { class: 'row' }, white, t('edSigWhite')));
        getData = async () => (data ? (white.checked ? await knockOutWhite(data) : data) : null);
      }
    };
    const colorIn = el('input', { type: 'color', value: '#1a2a6c' });
    for (const [m, k] of [['draw', 'edSigDraw'], ['type', 'edSigType'], ['import', 'edSigImport']]) tabs.appendChild(el('button', { 'data-m': m, onclick: () => { mode = m; show(); } }, t(k)));
    body.append(saved, el('div', { class: 'row' }, tabs, colorIn), pane, el('div', { class: 'row end' }, el('button', { class: 'primary', id: 'sigUse', onclick: async () => {
      const d = await getData(); if (!d) return; const all = await api.sigList(); all.unshift({ id: uid(), kind, data: d, created: new Date().toISOString() }); await api.sigSave(all.slice(0, 24)); closeModal(); this.armImage(d, kind);
    } }, t('edSigUse'))));
    show(); openModal(kind === 'initials' ? t('edInitials') : t('edSigTitle'), body);
  },
  async armImage(data, from) { const im = await this.pickImage(data); if (!im) return; const w = from === 'initials' ? 60 : 160; this.setTool('place', { id: im.id, w, h: w * im.h / im.w, from: from === 'initials' ? 'initials' : 'sign' }); },
  dateStamp() { const d = new Date(); const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; this.setTool('place', { text: s, size: 12, from: 'date' }); },

  // ---------- save ----------
  async save(saveAs) {
    const btn = $('#edSave'); btn.disabled = true; $('#edHint').textContent = t('edWorking');
    try {
      const items = {};
      for (const p of this.pages) {
        const k = this.key(p); const ops = this.items[k] || []; if (!ops.length) continue;
        items[k] = ops.map((op) => {
          const o = { ...op }; if (op.t === 'image') o.data = this.imgs[op.data];
          if (op.t === 'text' && !winAnsiOk(op.text)) o.png = renderTextPng(op);
          return o;
        });
      }
      const sources = Object.entries(this.docs).map(([id, d]) => ({ id, file: d.file }));
      const pages = this.pages.map((p) => (p.blank ? { blank: true, id: p.id, size: p.size, rot: p.rot || 0 } : { src: p.src, index: p.index, rot: p.rot || 0 }));
      const forms = Object.entries(this.forms).map(([name, value]) => ({ name, value }));
      const r = await api.editSave({ file: this.file, sources, pages, items, forms, out: saveAs ? null : this.out }, !!saveAs);
      if (!r) return null; this.out = r.out; this.dirty = false; this.updateBar();
      showSaved(r.out); return r;
    } catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 6000); return null; }
    finally { btn.disabled = false; this.setTool(this.tool, this.pending); }
  },

  // ---------- wiring ----------
  wire() {
    if (this._wired) return; this._wired = true;
    $$('#edTools [data-et]').forEach((b) => (b.onclick = () => { const k = b.dataset.et; if (k === 'sign') this.signDialog('signature'); else if (k === 'initials') this.signDialog('initials'); else if (k === 'date') this.dateStamp(); else this.setTool(k); }));
    $('#edUndo').onclick = () => this.undo(); $('#edRedo').onclick = () => this.redo();
    $('#edSave').onclick = () => this.save(false); $('#edSaveAs').onclick = () => this.save(true); $('#edCloseBtn').onclick = () => this.close();
    $('#edZoomIn').onclick = () => { this.zoom = clamp(this.zoom * 1.2, 0.4, 4); this.renderPages(); }; $('#edZoomOut').onclick = () => { this.zoom = clamp(this.zoom / 1.2, 0.4, 4); this.renderPages(); };
    $('#edMain').addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); this.zoom = clamp(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.4, 4); this.renderPages(); }, { passive: false });
    addEventListener('keydown', (e) => {
      if (!document.body.classList.contains('editing')) return; const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]'); if (typing) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
      else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); }
      else if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); this.save(e.shiftKey); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (this.sel) { e.preventDefault(); this.deleteSel(); } }
      else if (e.key === 'Escape') { if (this.tool !== 'select') this.setTool('select'); else this.select(null); }
      else if (!e.ctrlKey && !e.altKey && !e.metaKey) { const m = { v: 'select', t: 'text', a: 'addtext', i: 'image', w: 'whiteout', r: 'redact' }[k]; if (m) this.setTool(m); else if (k === 's') this.signDialog('signature'); else if (k === 'd') this.dateStamp(); else if (k === 'n') this.signDialog('initials'); }
    });
  },
};
// ---- helpers (canvas) ----
function trim(cv) { const ctx = cv.getContext('2d'); const { width: w, height: h } = cv; const d = ctx.getImageData(0, 0, w, h).data; let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 <= x0) return null; const pad = 8; const o = document.createElement('canvas'); o.width = x1 - x0 + pad * 2; o.height = y1 - y0 + pad * 2; o.getContext('2d').drawImage(cv, x0 - pad, y0 - pad, o.width, o.height, 0, 0, o.width, o.height); return o.toDataURL('image/png'); }
function typed(text, color) { const c = document.createElement('canvas'); c.width = 1400; c.height = 320; const x = c.getContext('2d'); x.font = '170px Caveat, cursive'; x.fillStyle = color; x.textBaseline = 'middle'; x.fillText(text, 30, 165); return trim(c); }
async function knockOutWhite(data) { const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = data; }); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const id = x.getImageData(0, 0, c.width, c.height); const d = id.data; for (let i = 0; i < d.length; i += 4) { const m = Math.min(d[i], d[i + 1], d[i + 2]); if (m > 225) d[i + 3] = 0; else if (m > 180) d[i + 3] = Math.round(d[i + 3] * (225 - m) / 45); } x.putImageData(id, 0, 0); return c.toDataURL('image/png'); }
/** Text that the standard PDF fonts cannot encode (Arabic, Greek, emoji …) is rendered by Chromium (with proper shaping) into a PNG. */
function renderTextPng(op) { const k = 4; const [, , w, h] = op.rect; const c = document.createElement('canvas'); c.width = Math.ceil(w * k); c.height = Math.ceil(h * k); const x = c.getContext('2d'); x.scale(k, k);
  x.font = `${op.italic ? 'italic ' : ''}${op.bold ? 700 : 400} ${op.size}px ${CSSFONT[op.font] || CSSFONT.Helvetica}`; x.fillStyle = op.color || '#000'; const rtl = /[\u0590-\u08ff]/.test(op.text); x.direction = rtl ? 'rtl' : 'ltr';
  const base0 = op.baseline != null ? op.baseline : op.size * 0.8; op.text.split('\n').forEach((ln, i) => { const al = op.align || (rtl ? 'right' : 'left'); x.textAlign = al; x.fillText(ln, al === 'center' ? w / 2 : al === 'right' ? w : 0, base0 + i * op.size * 1.2); });
  return c.toDataURL('image/png'); }
function openModal(title, body) { $('#mTitle').textContent = title; $('#mBody').replaceChildren(body); $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
function showSaved(file) {
  const e = $('#toast'); e.replaceChildren(el('div', {}, t('edSaved', { f: file.split(/[\\/]/).pop() })), el('div', { class: 'row' }, el('button', { class: 'ghost', onclick: () => api.show(file) }, t('edShow')), el('button', { class: 'ghost', onclick: async () => { if (await E.close()) { const a = await Lib.add([file]); if (a.length) R.open(a[0].id); } } }, t('edOpenReader'))));
  e.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.add('hidden'), 9000);
}
window.Editor = E;
