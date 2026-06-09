// markdown.mjs — Layer 1 deterministic checks for Markdown. Pure, dependency-free.
//
// Exports checkMarkdown(content, baseDir) -> [{ line, msg }].
// No stdin, no process control, no logging — just deterministic structural checks,
// so it can be reused by any trigger (Claude Code hook, git pre-commit, CI, standalone).
//
// Deliberately conservative: only flags the objectively-wrong or clearly-incomplete,
// to avoid nudging an agent into "fixing" correct content.

import fs from 'node:fs';
import path from 'node:path';

export function checkMarkdown(content, baseDir) {
  const lines = content.split(/\r?\n/);
  const issues = [];
  const add = (line, msg) => issues.push({ line, msg });

  // 1) Unclosed YAML frontmatter
  if (/^---\s*$/.test(lines[0] ?? '')) {
    let closed = false;
    for (let i = 1; i < lines.length; i++) {
      if (/^---\s*$/.test(lines[i])) { closed = true; break; }
    }
    if (!closed) add(1, 'Unclosed YAML frontmatter (no closing `---`).');
  }

  // 2) Unbalanced code fences (odd number of ``` markers)
  let fences = 0, first = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { fences++; if (fences === 1) first = i + 1; }
  }
  if (fences % 2 !== 0) add(first, 'Unclosed code fence (odd number of ``` markers).');

  // 3) Unresolved placeholders / incompleteness markers
  const markers = [
    { re: /<[A-Z][A-Z0-9_]{1,}>/, label: 'unresolved `<PLACEHOLDER>`' },
    { re: /\bTBD\b/, label: 'incompleteness marker (TBD)' },
    { re: /\bFIXME\b/, label: 'incompleteness marker (FIXME)' },
    { re: /\bTODO\b/, label: 'incompleteness marker (TODO)' },
    { re: /lorem ipsum/i, label: 'filler text (lorem ipsum)' },
    { re: /\]\(\s*\)/, label: 'empty markdown link `]()`' },
    { re: /\]\(\s*#\s*\)/, label: 'empty anchor link `](#)`' },
  ];
  for (let i = 0; i < lines.length; i++) {
    for (const { re, label } of markers) {
      if (re.test(lines[i])) { add(i + 1, `Check: ${label}.`); break; }
    }
  }

  // 4) Broken local links (relative target that does not exist on disk)
  if (baseDir) {
    const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
    const fileExt = /\.(md|markdown|mdx|txt|png|jpe?g|gif|svg|webp|pdf|json|ya?ml|sh|mjs|cjs|js|ts|tsx|jsx|csv|html?)$/i;
    for (let i = 0; i < lines.length; i++) {
      let m; linkRe.lastIndex = 0;
      while ((m = linkRe.exec(lines[i])) !== null) {
        let target = m[1].trim().replace(/\s+["'].*$/, '').trim();
        if (!target || /^(https?:|mailto:|tel:|data:|ftp:|#|<)/i.test(target)) continue;
        const clean = target.split('#')[0];
        if (!clean || (!clean.includes('/') && !fileExt.test(clean))) continue;
        let resolved;
        try { resolved = path.resolve(baseDir, decodeURIComponent(clean)); } catch { continue; }
        if (!fs.existsSync(resolved)) add(i + 1, `Broken local link: \`${clean}\` (target not found).`);
      }
    }
  }

  return issues;
}
