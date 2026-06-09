#!/usr/bin/env node
// hook-validate.mjs — Claude Code PostToolUse adapter (Layer 1).
//
// Reads the hook payload on stdin, extracts the written file path, and if it is a
// Markdown file: runs the deterministic validator and logs the path for Layer 2.
// On issues: writes the checklist to stderr and exits 2 ("show stderr to Claude")
// so the agent re-reads and fixes immediately. Non-blocking (no loop).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkMarkdown } from '../../validator/markdown.mjs';

// MSYS/Git Bash may hand /c/Users/... — node.exe wants C:\Users\...
function toWin(p) {
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(p);
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}` : p;
}

let payload = '';
try { payload = fs.readFileSync(0, 'utf8'); } catch { process.exit(0); }
let file = '', session = '';
try {
  const j = JSON.parse(payload);
  file = j?.tool_input?.file_path || j?.tool_response?.filePath || '';
  session = j?.session_id || '';
} catch { process.exit(0); }
if (!file || !/\.(md|markdown|mdx)$/i.test(file)) process.exit(0);

let content;
try { content = fs.readFileSync(file, 'utf8'); }
catch { file = toWin(file); try { content = fs.readFileSync(file, 'utf8'); } catch { process.exit(0); } }

// Log the touched file for Layer 2 (the Stop-time semantic review).
if (session) {
  try {
    const tf = path.join(os.tmpdir(), `amr-touched-${session}.txt`);
    const abs = path.resolve(file);
    let cur = ''; try { cur = fs.readFileSync(tf, 'utf8'); } catch { /* first md of the session */ }
    if (!new Set(cur.split('\n').filter(Boolean)).has(abs)) fs.appendFileSync(tf, abs + '\n');
  } catch { /* best-effort, never block the validator on this */ }
}

const issues = checkMarkdown(content, path.dirname(path.resolve(file)));
if (!issues.length) process.exit(0);

const out = [`⚠️  Markdown self-check ${path.basename(file)} — ${issues.length} issue(s):`];
issues.sort((a, b) => a.line - b.line).forEach(({ line, msg }) => out.push(`  • L${line} — ${msg}`));
out.push("Re-read the file you just wrote and fix these (or confirm they are intentional).");
process.stderr.write(out.join('\n') + '\n');
process.exit(2);
