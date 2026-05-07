import type { ConfusingWordGroup, PrintMode } from './types';

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function renderGroup(group: ConfusingWordGroup, mode: PrintMode) {
  const title = escapeHtml(group.title);
  if (mode === 'meaning-to-word') {
    return `<section><h2>${title}</h2><ol>${group.words
      .map((word) => `<li><span class="blank"></span> ${escapeHtml(word.partOfSpeech)} ${escapeHtml(word.chineseDefinition || word.englishDefinition || '释义待补充')}</li>`)
      .join('')}</ol></section>`;
  }
  if (mode === 'word-to-meaning') {
    return `<section><h2>${title}</h2><ol>${group.words.map((word) => `<li><strong>${escapeHtml(word.word)}</strong>: <span class="line"></span></li>`).join('')}</ol></section>`;
  }
  if (mode === 'comparison-table') {
    return `<section><h2>${title}</h2><table><thead><tr><th>Word</th><th>Part of Speech</th><th>Meaning</th><th>Example</th></tr></thead><tbody>${group.words
      .map((word) => `<tr><td>${escapeHtml(word.word)}</td><td>______</td><td>______</td><td>______</td></tr>`)
      .join('')}</tbody></table></section>`;
  }
  return `<section><h2>${title}</h2><table><thead><tr><th>Word</th><th>Part of Speech</th><th>Meaning</th><th>Example</th></tr></thead><tbody>${group.words
    .map(() => '<tr><td>______</td><td>______</td><td>______</td><td>______</td></tr>')
    .join('')}</tbody></table></section>`;
}

export function openPrintWindow(groups: ConfusingWordGroup[], mode: PrintMode) {
  const win = window.open('', '_blank');
  if (!win) return;
  const html = `<!doctype html><html><head><meta charset="utf-8" /><title>易混单词默写版</title><style>
    body{font-family:Arial,"Microsoft YaHei",sans-serif;color:#111827;margin:32px}
    h1{font-size:24px;margin:0 0 4px} .date{color:#64748b;margin-bottom:24px}
    section{break-inside:avoid;margin-bottom:28px} h2{font-size:18px;border-bottom:1px solid #d1d5db;padding-bottom:8px}
    li{margin:12px 0;font-size:15px}.blank{display:inline-block;width:180px;border-bottom:1px solid #111827;margin-right:12px}.line{display:inline-block;width:360px;border-bottom:1px solid #111827}
    table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #cbd5e1;padding:10px;text-align:left;height:34px}th{background:#f8fafc}
    @media print{button{display:none}body{margin:18mm}}
  </style></head><body><button onclick="window.print()">打印</button><h1>易混单词默写版</h1><div class="date">${new Date().toLocaleDateString()}</div>${groups
    .map((group) => renderGroup(group, mode))
    .join('')}</body></html>`;
  win.document.write(html);
  win.document.close();
}
