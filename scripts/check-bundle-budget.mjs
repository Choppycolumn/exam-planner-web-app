import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'dist/index.html'), 'utf8');
const references = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((match) => match[1]);
const uniqueReferences = [...new Set(references)];
const initialBytes = uniqueReferences.reduce((total, asset) => total + statSync(resolve(root, `dist${asset}`)).size, 0);
const forbiddenInitialChunks = uniqueReferences.filter((asset) => /\/(?:charts|local-db)-/.test(asset));
const budgetBytes = Number(process.env.INITIAL_JS_BUDGET_BYTES || 900_000);

if (forbiddenInitialChunks.length) {
  throw new Error(`Heavy deferred chunks were preloaded: ${forbiddenInitialChunks.join(', ')}`);
}
if (initialBytes > budgetBytes) {
  throw new Error(`Initial JavaScript ${initialBytes} bytes exceeds budget ${budgetBytes} bytes`);
}

console.log(JSON.stringify({ ok: true, initialBytes, budgetBytes, assets: uniqueReferences }, null, 2));
