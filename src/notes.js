'use strict';
// Export annotations/bookmarks/vocabulary as Markdown, plain text or an HTML (-> PDF) summary.
const TYPE = { highlight: 'Highlight', underline: 'Underline', strike: 'Strikethrough', note: 'Note', text: 'Text box', ink: 'Pen', marker: 'Marker', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow' };
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function sorted(data) { return [...(data.annotations || [])].sort((a, b) => a.page - b.page || ((a.rects && a.rects[0] && a.rects[0][1]) || (a.rect && a.rect[1]) || 0) - ((b.rects && b.rects[0] && b.rects[0][1]) || (b.rect && b.rect[1]) || 0)); }
function toMarkdown(book, data, vocab = []) {
  const L = [`# ${book.title}`, '', `*${book.path}* · exported ${new Date().toISOString().slice(0, 10)} from Mamba Reader`, ''];
  if ((data.bookmarks || []).length) { L.push('## Bookmarks', ''); data.bookmarks.sort((a, b) => a.page - b.page).forEach((b) => L.push(`- p. ${b.page + 1}${b.title ? ' — ' + b.title : ''}`)); L.push(''); }
  L.push('## Annotations', '');
  let last = -1;
  for (const a of sorted(data)) {
    if (a.page !== last) { L.push(`### Page ${a.page + 1}`, ''); last = a.page; }
    const head = `**${TYPE[a.type] || a.type}**${a.color ? ` (${a.color})` : ''}`;
    if (a.text) L.push(`> ${a.text.replace(/\n/g, ' ')}`, '', `${head}${a.comment ? ': ' + a.comment : ''}`, '');
    else L.push(`- ${head}${a.content ? ': ' + a.content : ''}${a.comment ? ' — ' + a.comment : ''}`, '');
  }
  const v = vocab.filter((x) => x.bookId === book.id);
  if (v.length) { L.push('## Vocabulary', '', '| Word | Translation | Note | Page |', '|---|---|---|---|'); v.forEach((x) => L.push(`| ${x.word} | ${x.translation || ''} | ${(x.note || '').replace(/\|/g, '/')} | ${x.page + 1} |`)); L.push(''); }
  return L.join('\n');
}
function toText(book, data, vocab) { return toMarkdown(book, data, vocab).replace(/^#+ /gm, '').replace(/\*\*/g, '').replace(/^> /gm, '  "').replace(/^\| ?|\|$/gm, '').replace(/\*/g, ''); }
function toHtml(book, data, vocab = []) {
  const rows = sorted(data).map((a) => `<div class="a"><div class="m">p. ${a.page + 1} · ${esc(TYPE[a.type] || a.type)}<span class="c" style="background:${esc(a.color || '#ccc')}"></span></div>${a.text ? `<blockquote style="border-color:${esc(a.color || '#ccc')}">${esc(a.text)}</blockquote>` : ''}${a.content ? `<p>${esc(a.content)}</p>` : ''}${a.comment ? `<p class="cm">💬 ${esc(a.comment)}</p>` : ''}</div>`).join('');
  const bms = (data.bookmarks || []).sort((a, b) => a.page - b.page).map((b) => `<li>p. ${b.page + 1} ${esc(b.title || '')}</li>`).join('');
  const v = vocab.filter((x) => x.bookId === book.id).map((x) => `<tr><td>${esc(x.word)}</td><td>${esc(x.translation)}</td><td>${esc(x.note)}</td><td>${x.page + 1}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(book.title)} — notes</title><style>body{font-family:"Segoe UI",Arial,"Noto Naskh Arabic",sans-serif;margin:36px;color:#222}h1{margin:0 0 4px}.sub{color:#777;font-size:12px;margin-bottom:20px}.a{border-bottom:1px solid #eee;padding:8px 0;break-inside:avoid}.m{font-size:11px;color:#888}.c{display:inline-block;width:10px;height:10px;border-radius:50%;margin-inline-start:6px;vertical-align:middle}blockquote{margin:6px 0;padding:2px 10px;border-inline-start:4px solid;font-style:italic}.cm{color:#444}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:4px 8px;font-size:13px}</style></head><body dir="auto"><h1>${esc(book.title)}</h1><div class="sub">${esc(book.path)} · ${(data.annotations || []).length} annotations · ${new Date().toISOString().slice(0, 10)}</div>${bms ? `<h2>Bookmarks</h2><ul>${bms}</ul>` : ''}<h2>Annotations</h2>${rows || '<p>—</p>'}${v ? `<h2>Vocabulary</h2><table><tr><th>Word</th><th>Translation</th><th>Note</th><th>Page</th></tr>${v}</table>` : ''}</body></html>`;
}
function vocabCsv(list) { const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; return '\ufeff' + ['word,translation,note,book,page,context,created', ...(list || []).map((v) => [v.word, v.translation, v.note, v.bookTitle, (v.page || 0) + 1, v.context, v.created].map(q).join(','))].join('\r\n') + '\r\n'; }
module.exports = { toMarkdown, toText, toHtml, vocabCsv };
