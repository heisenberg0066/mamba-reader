'use strict';
// Promise wrapper around the MuPDF worker thread.
const { Worker } = require('worker_threads');
const path = require('path');
module.exports = function createClient() {
  const file = path.join(__dirname, 'worker', 'docworker.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  let w = null; const pending = new Map(); let seq = 1;
  const start = () => {
    w = new Worker(file);
    w.on('message', ({ id, result, error }) => { const p = pending.get(id); if (!p) return; pending.delete(id); error ? p.reject(new Error(error)) : p.resolve(result && result.buffer && result instanceof Uint8Array ? Buffer.from(result.buffer, result.byteOffset, result.byteLength) : result); });
    w.on('error', (e) => { for (const p of pending.values()) p.reject(e); pending.clear(); w = null; });
    w.on('exit', () => { w = null; });
  };
  const call = (cmd, args) => new Promise((resolve, reject) => { if (!w) start(); const id = seq++; pending.set(id, { resolve, reject }); w.postMessage({ id, cmd, args }); });
  return { call, terminate: () => w && w.terminate() };
};
