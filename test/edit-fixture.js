'use strict';
// Builds the PDF-editor test fixtures with pdf-lib: text in several fonts, an image, form fields, a rotated page.
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const zlib = require('zlib');
function png(w, h, rgbFn) { // tiny PNG encoder (RGB)
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b] = rgbFn(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; ih[10] = 0; ih[11] = 0; ih[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
async function makeFixture() {
  const doc = await PDFDocument.create(); doc.setTitle('Editor fixture');
  const helv = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), times = await doc.embedFont(StandardFonts.TimesRoman);
  const p1 = doc.addPage([595, 842]);
  p1.drawText('Invoice for Ammar Andersson', { x: 60, y: 770, size: 22, font: bold, color: rgb(0.1, 0.2, 0.6) });
  p1.drawText('Total amount: 1250 SEK', { x: 60, y: 730, size: 14, font: helv });
  p1.drawText('This line will be deleted.', { x: 60, y: 705, size: 14, font: helv });
  p1.drawText('Keep this line exactly as it is.', { x: 60, y: 680, size: 14, font: helv });
  const img = await doc.embedPng(png(120, 80, (x, y) => [230, 120 + (x % 40), 20 + y]));
  p1.drawImage(img, { x: 60, y: 520, width: 120, height: 80 });
  p1.drawText('Secret: 4711-0815', { x: 60, y: 470, size: 14, font: helv });
  const form = doc.getForm();
  const tf = form.createTextField('name'); tf.addToPage(p1, { x: 60, y: 400, width: 220, height: 24 });
  const cb = form.createCheckBox('agree'); cb.addToPage(p1, { x: 60, y: 360, width: 18, height: 18 });
  const dd = form.createDropdown('city'); dd.addOptions(['Stockholm', 'Göteborg', 'Malmö']); dd.addToPage(p1, { x: 60, y: 320, width: 160, height: 22 });
  const p2 = doc.addPage([595, 842]); p2.drawText('Second page in Times Roman', { x: 60, y: 770, size: 18, font: times });
  const p3 = doc.addPage([595, 842]); p3.drawText('Rotated page text', { x: 60, y: 770, size: 18, font: helv }); p3.setRotation(degrees(90));
  const other = await PDFDocument.create(); const o1 = other.addPage([400, 300]); o1.drawText('Merged appendix', { x: 40, y: 240, size: 20, font: await other.embedFont(StandardFonts.Helvetica) });
  return { main: Buffer.from(await doc.save()), merge: Buffer.from(await other.save()), png: png(60, 60, (x, y) => [20, 160, 60 + x]) };
}
module.exports = { makeFixture, png };

if (require.main === module) {
  const dir = process.argv[2]; const fs = require('fs'); const path = require('path'); fs.mkdirSync(dir, { recursive: true });
  makeFixture().then((f) => { fs.writeFileSync(path.join(dir, 'invoice.pdf'), f.main); fs.writeFileSync(path.join(dir, 'appendix.pdf'), f.merge); fs.writeFileSync(path.join(dir, 'photo.png'), module.exports.png(160, 120, (x, y) => [40 + x, 90 + (y % 60), 200])); console.log('fixtures in ' + dir); });
}
