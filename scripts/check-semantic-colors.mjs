import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = join(root, 'src');
const directPalette = /(?:text|bg|border|ring|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|rose|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink)-\d+(?:\/\d+)?|(?:bg|border|ring)-white(?:\/\d+)?/g;
const failures = [];

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
      const matches = [...readFileSync(file, 'utf8').matchAll(directPalette)].map((match) => match[0]);
      if (matches.length) failures.push(`${relative(root, file)}: ${[...new Set(matches)].join(', ')}`);
    }
  }
}

visit(sourceRoot);
if (failures.length) {
  console.error('Use semantic color utilities backed by apple-tokens.css:\n' + failures.join('\n'));
  process.exitCode = 1;
}
