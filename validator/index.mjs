#!/usr/bin/env node
// index.mjs — CLI entry for the deterministic validator (Layer 1).
// Dispatches by file extension. Markdown today; drop in validator/<format>.mjs to add more.
//
//   node index.mjs <file...>
//
// Prints issues to stderr. Exit 2 if any issue is found (so a hook can surface it to the
// agent), 0 otherwise. Non-markdown files are skipped.

import fs from 'node:fs';
import path from 'node:path';
import { checkMarkdown } from './markdown.mjs';

const VALIDATORS = { md: checkMarkdown, markdown: checkMarkdown, mdx: checkMarkdown };

const files = process.argv.slice(2);
if (files.length === 0) process.exit(0);

let total = 0;
for (const f of files) {
  const ext = (f.split('.').pop() || '').toLowerCase();
  const fn = VALIDATORS[ext];
  if (!fn) continue;
  let content;
  try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const issues = fn(content, path.dirname(path.resolve(f)));
  if (issues.length) {
    total += issues.length;
    process.stderr.write(`\n⚠️  ${path.basename(f)} — ${issues.length} issue(s):\n`);
    issues.sort((a, b) => a.line - b.line)
          .forEach(({ line, msg }) => process.stderr.write(`  • L${line} — ${msg}\n`));
  }
}

if (total > 0) {
  process.stderr.write('\nRe-read and fix these (or confirm they are intentional).\n');
  process.exit(2);
}
process.exit(0);
