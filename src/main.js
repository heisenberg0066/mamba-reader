'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, session, Menu, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SUPPORTED = ['.pdf', '.epub', '.xps', '.oxps', '.cbz', '.fb2', '.mobi', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.html', '.htm'];
const PROTO = 'mamba-reader';

if (process.env.MAMBA_READER_DATA) app.setPath('userData', process.env.MAMBA_READER_DATA);
const SELFTEST = process.argv.includes('--self-test');
if (!SELFTEST && !process.env.MAMBA_READER_NO_LOCK && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
protocol.registerSchemesAsPrivileged([{ scheme: 'mrpage', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
// Register mamba-reader:// for this user (installer also writes it; this keeps the portable build working).
// mamba-reader:// registration (the NSIS installer also writes it; portable builds register their real exe, not the temp-extracted one)
try {
  if (process.env.MAMBA_READER_UITEST || process.argv.includes('--self-test')) { /* tests: leave the system alone */ }
  else if (process.defaultApp) app.setAsDefaultProtocolClient(PROTO, process.execPath, [path.resolve(process.argv[1] || '.')]);
  else if (process.env.PORTABLE_EXECUTABLE_FILE) app.setAsDefaultProtocolClient(PROTO, process.env.PORTABLE_EXECUTABLE_FILE, []);
  else app.setAsDefaultProtocolClient(PROTO);
} catch (_) {}

let store, docs, win;
const logHandoff = (entry) => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'handoff.log'), JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n'); } catch (_) {} };

/** Extract files from argv / mamba-reader:// URLs. */
function filesFromArgs(argv) {
  const out = [];
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith('--')) continue;
    if (a.toLowerCase().startsWith(PROTO + ':')) {
      try { const u = new URL(a); const p = u.searchParams.get('path') || u.searchParams.get('file') || decodeURIComponent(u.pathname.replace(/^\/+/, '')); if (p) out.push({ file: path.resolve(p), source: 'protocol', page: parseInt(u.searchParams.get('page') || '', 10) || null }); } catch (_) {}
      continue;
    }
    const f = path.resolve(a);
    if (SUPPORTED.includes(path.extname(f).toLowerCase()) && fs.existsSync(f)) out.push({ file: f, source: 'argv' });
  }
  return out;
}
let pendingOpen = [];
function deliver(list) {
  list.forEach((x) => logHandoff({ event: 'received', ...x }));
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isLoading() && win.__ready) { list.forEach((x) => win.webContents.send('open-external', x)); if (win.isMinimized()) win.restore(); win.focus(); }
  else pendingOpen.push(...list);
}
app.on('second-instance', (_e, argv) => { deliver(filesFromArgs(argv)); if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.on('open-url', (e, url) => { e.preventDefault(); deliver(filesFromArgs(['', url])); });

// ---------- library ----------
async function addBook(file) {
  file = path.resolve(file); const id = store.idFor(file); const lib = store.lib(); const st = fs.statSync(file);
  const existing = lib.books[id];
  if (existing && fs.existsSync(store.coverPath(id))) { if (existing.path !== file) { existing.path = file; store.saveLib(lib); } return existing; }
  const info = await docs.call('open', { file, cachePdf: store.cachePdf(id) });
  try { fs.writeFileSync(store.coverPath(id), await docs.call('cover', { docId: info.docId, width: 320 })); } catch (_) {}
  await docs.call('close', { docId: info.docId });
  const b = { id, path: file, title: (info.title && info.title.trim()) || path.basename(file, path.extname(file)), author: info.author || '', kind: info.kind, size: st.size, pageCount: info.pageCount, added: new Date().toISOString(), lastOpened: null, lastPage: 0, progress: 0, tags: [], rtl: info.rtl, ...(existing || {}) };
  b.path = file; lib.books[id] = b; store.saveLib(lib); return b;
}
const withCover = (b) => ({ ...b, missing: !fs.existsSync(b.path), cover: fs.existsSync(store.coverPath(b.id)) ? require('url').pathToFileURL(store.coverPath(b.id)).href : null });
const openDocs = new Map(); // bookId -> docId

function htmlToPdf(html, dest) {
  return new Promise(async (resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `mr-${Date.now()}.html`); fs.writeFileSync(tmp, html);
    const w = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
    try { await w.loadFile(tmp); fs.writeFileSync(dest, await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, generateDocumentOutline: true, generateTaggedPDF: true })); resolve(dest); } catch (e) { reject(e); } finally { w.destroy(); fs.rm(tmp, { force: true }, () => {}); }
  });
}

function registerIpc() {
  const H = (ch, fn) => ipcMain.handle(ch, (_e, ...a) => fn(...a));
  H('settings:get', () => store.settings());
  H('settings:set', (s) => { const v = { ...store.settings(), ...s }; store.saveSettings(v); return v; });
  H('lib:list', () => Object.values(store.lib().books).map(withCover));
  H('lib:add', async (paths) => { const out = []; for (const p of paths) { try { out.push(withCover(await addBook(p))); } catch (e) { out.push({ error: String(e.message || e), path: p }); } } return out; });
  H('lib:remove', (id) => { const l = store.lib(); delete l.books[id]; store.saveLib(l); return true; });
  H('lib:update', (id, patch) => { const l = store.lib(); if (!l.books[id]) return null; l.books[id] = { ...l.books[id], ...patch }; store.saveLib(l); return withCover(l.books[id]); });
  H('lib:relink', async (id) => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'] }); if (r.canceled) return null; const l = store.lib(); l.books[id].path = r.filePaths[0]; store.saveLib(l); return withCover(l.books[id]); });
  H('book:open', async (id) => {
    const l = store.lib(); const b = l.books[id]; if (!b) throw new Error('Unknown book');
    if (!fs.existsSync(b.path)) throw new Error('File not found: ' + b.path);
    if (openDocs.has(id)) { await docs.call('close', { docId: openDocs.get(id) }).catch(() => {}); }
    const info = await docs.call('open', { file: b.path, cachePdf: store.cachePdf(id) }); openDocs.set(id, info.docId);
    b.lastOpened = new Date().toISOString(); b.pageCount = info.pageCount; store.saveLib(l);
    return { book: withCover(b), info, data: store.bookData(id) };
  });
  H('book:close', async (id) => { if (openDocs.has(id)) { await docs.call('close', { docId: openDocs.get(id) }).catch(() => {}); openDocs.delete(id); } });
  H('book:save', (id, data) => { store.saveBookData(id, data); return true; });
  H('doc:text', (docId, page) => docs.call('text', { docId, page }));
  H('doc:search', (docId, query) => docs.call('search', { docId, query }));
  H('vocab:list', () => store.vocab());
  H('vocab:save', (list) => { store.saveVocab(list); return true; });
  H('vocab:csv', async () => { const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), 'Mamba Reader vocabulary.csv'), filters: [{ name: 'CSV', extensions: ['csv'] }] }); if (r.canceled) return null; fs.writeFileSync(r.filePath, require('./notes').vocabCsv(store.vocab())); return r.filePath; });
  H('stats:get', () => store.stats());
  H('stats:add', (bookId, minutes) => store.addMinutes(bookId, minutes));
  H('dialog:open', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Books', extensions: SUPPORTED.map((e) => e.slice(1)) }] }); return r.canceled ? [] : r.filePaths; });
  H('export:notes', async (id, fmt, vocab) => {
    const b = store.lib().books[id]; const data = store.bookData(id); const N = require('./notes');
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `${b.title} - notes.${fmt}`), filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }] });
    if (r.canceled) return null; return exportNotes(b, data, fmt, r.filePath, vocab || store.vocab());
  });
  H('export:annotated', async (id) => {
    const b = store.lib().books[id]; const r = await dialog.showSaveDialog(win, { defaultPath: path.join(path.dirname(b.path), `${b.title} (annotated).pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled) return null; if (path.resolve(r.filePath) === path.resolve(b.path)) throw new Error('Choose a different file name — the original is never overwritten.');
    return exportAnnotated(id, r.filePath);
  });
  H('backup:export', async () => { const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `Mamba Reader backup ${new Date().toISOString().slice(0, 10)}.zip`), filters: [{ name: 'Backup', extensions: ['zip'] }] }); return r.canceled ? null : store.exportBackup(r.filePath); });
  H('backup:import', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Backup', extensions: ['zip'] }] }); return r.canceled ? null : store.importBackup(r.filePaths[0]); });
  H('shell:show', (p) => shell.showItemInFolder(p));
  H('shell:open', (p) => shell.openPath(p));
  H('handoff:opened', (x) => { logHandoff({ event: 'opened', ...x }); return true; });
  H('app:info', () => ({ version: app.getVersion(), userData: app.getPath('userData'), protocol: app.isDefaultProtocolClient(PROTO) }));
}
async function exportNotes(b, data, fmt, dest, vocab) {
  const N = require('./notes');
  if (fmt === 'md') fs.writeFileSync(dest, N.toMarkdown(b, data, vocab)); else if (fmt === 'txt') fs.writeFileSync(dest, N.toText(b, data, vocab)); else await htmlToPdf(N.toHtml(b, data, vocab), dest);
  return dest;
}
async function exportAnnotated(id, dest) {
  const b = store.lib().books[id]; const data = store.bookData(id);
  let docId = openDocs.get(id); let temp = false;
  if (!docId) { docId = (await docs.call('open', { file: b.path, cachePdf: store.cachePdf(id) })).docId; temp = true; }
  try {
    const annots = (data.annotations || []).map((a) => (a.type === 'note' && a.attachedTo ? null : a)).filter(Boolean);
    return await docs.call('exportAnnotated', { docId, annots, out: dest });
  } finally { if (temp) docs.call('close', { docId }); }
}

// ---------- page images via mrpage://render/<docId>/<page>?s=<scale> ----------
function registerPageProtocol() {
  protocol.handle('mrpage', async (req) => {
    const u = new URL(req.url); const [, docId, page] = u.pathname.split('/'); // host = 'render'
    try {
      const buf = await docs.call('render', { docId: +docId, page: +page, scale: Math.min(6, Math.max(0.1, parseFloat(u.searchParams.get('s')) || 1)) });
      return new Response(buf, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=3600' } });
    } catch (e) { return new Response(String(e.message), { status: 500 }); }
  });
}

// ---------- UI test hooks (only when MAMBA_READER_UITEST is set) ----------
function registerTestIpc() {
  if (!process.env.MAMBA_READER_UITEST) return;
  const dir = process.env.MAMBA_READER_SHOTS || path.join(app.getPath('userData'), 'shots'); fs.mkdirSync(dir, { recursive: true });
  ipcMain.handle('test:shot', async (_e, name) => { const img = await win.webContents.capturePage(); const f = path.join(dir, name + '.png'); fs.writeFileSync(f, img.toPNG()); return f; });
  ipcMain.handle('test:deliver', (_e, argv) => { deliver(filesFromArgs(['exe', ...argv])); return true; });
  ipcMain.handle('test:bookData', (_e, id) => store.bookData(id));
  ipcMain.handle('test:handoffLog', () => { try { return fs.readFileSync(path.join(app.getPath('userData'), 'handoff.log'), 'utf8'); } catch (_) { return ''; } });
  ipcMain.handle('test:size', (_e, w, h) => { win.setContentSize(w, h); return true; });
}
function createWindow() {
  win = new BrowserWindow({ width: 1320, height: 880, minWidth: 900, minHeight: 600, backgroundColor: '#f7f5f0', title: 'Mamba Reader', icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false } });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ipcMain.once('renderer-ready', () => { win.__ready = true; const p = pendingOpen; pendingOpen = []; p.forEach((x) => win.webContents.send('open-external', x)); });
  if (process.env.MAMBA_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(async () => {
  store = require('./store')(app.getPath('userData'));
  docs = require('./docclient')();
  // offline guarantee
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|data|blob|mrpage|devtools|chrome-extension):/i.test(d.url) }));
  registerPageProtocol(); registerIpc(); registerTestIpc();
  if (SELFTEST || process.env.MAMBA_READER_SELFTEST) {
    const r = await require('./selftest')({ store, docs, addBook, exportNotes, exportAnnotated, filesFromArgs, htmlToPdf, app });
    console.log(r.lines.join('\n')); console.log('report: ' + r.report);
    if (SELFTEST && !process.env.MAMBA_READER_SELFTEST && !process.env.CI) dialog.showMessageBoxSync({ message: `Self-test: ${r.passed} passed, ${r.failed} failed`, detail: r.lines.join('\n') });
    const code = r.failed ? 1 : 0; setTimeout(() => process.exit(code), 3000).unref && 0; console.log('selftest: exiting'); try { docs.terminate(); } catch (_) {} setImmediate(() => app.exit(code)); return;
  }
  pendingOpen.push(...filesFromArgs(process.argv));
  createWindow();
  if (process.env.MAMBA_READER_UITEST) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      let r; try { r = await win.webContents.executeJavaScript(fs.readFileSync(process.env.MAMBA_READER_UITEST, 'utf8')); } catch (e) { r = { passed: 0, failed: 1, lines: ['FAIL  ui script crashed — ' + e.message] }; }
      console.log(r.lines.join('\n')); console.log(`UI: ${r.passed} passed, ${r.failed} failed`);
      if (process.env.MAMBA_READER_REPORT) fs.writeFileSync(process.env.MAMBA_READER_REPORT, r.lines.join('\n') + `\nUI: ${r.passed} passed, ${r.failed} failed\n`);
      try { docs.terminate(); } catch (_) {} setTimeout(() => process.exit(r.failed ? 1 : 0), 3000); app.exit(r.failed ? 1 : 0);
    }, 1200));
  }
  if (process.env.MAMBA_SCREENSHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.MAMBA_SCREENSHOT_JS) await win.webContents.executeJavaScript(process.env.MAMBA_SCREENSHOT_JS).catch((e) => console.error('SHOTJS', e));
      setTimeout(async () => { const img = await win.webContents.capturePage(); fs.writeFileSync(process.env.MAMBA_SCREENSHOT, img.toPNG()); app.quit(); }, Number(process.env.MAMBA_SCREENSHOT_WAIT || 2000));
    }, 900));
  }
});
app.on('window-all-closed', () => { if (!SELFTEST && !process.env.MAMBA_READER_SELFTEST) app.quit(); });
app.on('will-quit', () => { try { docs && docs.terminate(); } catch (_) {} });
