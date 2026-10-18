'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('api', {
  pathFor: (f) => webUtils.getPathForFile(f),
  ready: () => ipcRenderer.send('renderer-ready'),
  onOpenExternal: (cb) => ipcRenderer.on('open-external', (_e, x) => cb(x)),
  settings: inv('settings:get'), setSettings: inv('settings:set'),
  libList: inv('lib:list'), libAdd: inv('lib:add'), libRemove: inv('lib:remove'), libUpdate: inv('lib:update'), libRelink: inv('lib:relink'),
  openBook: inv('book:open'), closeBook: inv('book:close'), saveBook: inv('book:save'),
  text: inv('doc:text'), search: inv('doc:search'),
  vocab: inv('vocab:list'), saveVocab: inv('vocab:save'), vocabCsv: inv('vocab:csv'), stats: inv('stats:get'), addMinutes: inv('stats:add'),
  pickFiles: inv('dialog:open'), exportNotes: inv('export:notes'), exportAnnotated: inv('export:annotated'),
  backupExport: inv('backup:export'), backupImport: inv('backup:import'), show: inv('shell:show'), openPath: inv('shell:open'),
  handoffOpened: inv('handoff:opened'),
  editOpen: inv('edit:open'), editClose: inv('edit:close'), editInfo: inv('edit:info'), editImagePng: inv('edit:imagePng'), editPickImage: inv('edit:pickImage'), editPickPdf: inv('edit:pickPdf'), editSave: inv('edit:save'), sigList: inv('sig:list'), sigSave: inv('sig:save'), info: inv('app:info'),
  ...(process.env.MAMBA_READER_UITEST ? { test: { shot: inv('test:shot'), deliver: inv('test:deliver'), bookData: inv('test:bookData'), handoffLog: inv('test:handoffLog'), size: inv('test:size'), input: inv('test:input'), fixtures: inv('test:fixtures'), nextPick: inv('test:nextPick'), inspect: inv('test:inspect'), hash: inv('test:hash') } } : {}),
});
