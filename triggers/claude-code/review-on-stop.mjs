#!/usr/bin/env node
// review-on-stop.mjs — Claude Code Stop adapter (Layer 2, semantic review).
//
// The hook does NOT call an LLM itself (no global context reload, no API key needed).
// If a Markdown file changed this turn, it emits decision:block with a directive that tells
// the agent to spawn ONE FRESH-CONTEXT reviewer subagent (Agent tool) on the changes,
// using the shared reviewer brief.
//
// Cost controls (v2):
//  - Scope     : skips infra (.claude/skills, rules, docs, agents… + CLAUDE.md + docs/) — not deliverables.
//  - Diff-aware: passes `git diff HEAD` to the reviewer instead of the whole file (full-file read = the cost).
//  - Threshold : skips when the diff is < AMR_REVIEW_MIN_LINES lines (default 6).
//  - Batched   : ONE subagent for all files in the turn (not N).
//  - Loop guard (kept): a file is (re)reviewed only if its content changed (sha256), capped at MAX/session.
//
// Diff fallback: if `git diff` returns nothing (new/untracked file, or not in a git repo), the file
// gets a "full review" — the intended behavior for freshly generated content.
//
// Output: JSON {decision:"block", reason} on stdout when a review is due, else nothing. Always exit 0.
//
// Env vars:
//  AMR_REVIEW_MAX        max reviews per file per session (default 2)
//  AMR_REVIEW_MIN_LINES  diff-line threshold below which a change is skipped (default 6)
//  AMR_REVIEW_MODEL      reviewer subagent model (default "sonnet"; use "haiku" to cut cost)
//  AMR_REVIEW_EXCLUDE    comma-separated path fragments to exclude (replaces the defaults)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX = Math.max(1, parseInt(process.env.AMR_REVIEW_MAX || '2', 10) || 2);
const MAX_FILES = 5;
const MIN_LINES = Math.max(1, parseInt(process.env.AMR_REVIEW_MIN_LINES || '6', 10) || 6);
// The reviewer is a near-mechanical task (read + apply a rubric) — a cheap/fast model is the right
// fit; what matters is the decorrelated fresh context, not raw model power.
const MODEL = (process.env.AMR_REVIEW_MODEL || 'sonnet').replace(/["\\\n]/g, '');
const MAX_HUNK = 200; // max diff lines forwarded to the reviewer before truncation
const here = path.dirname(fileURLToPath(import.meta.url));
const briefPath = path.resolve(here, '../../prompts/reviewer-brief.md');

// Infra paths excluded by default (substring match on '/'-normalized path). Override via AMR_REVIEW_EXCLUDE.
const DEFAULT_EXCLUDE = [
  '/.claude/skills/', '/.claude/rules/', '/.claude/docs/', '/.claude/agents/',
  '/.claude/commands/', '/.claude/templates/', '/.claude/hooks/', '/docs/',
];
const EXCLUDE = process.env.AMR_REVIEW_EXCLUDE
  ? process.env.AMR_REVIEW_EXCLUDE.split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_EXCLUDE;

const norm = (p) => p.replace(/\\/g, '/');
const isExcluded = (p) => {
  const n = norm(p);
  if (n.split('/').pop() === 'CLAUDE.md') return true;
  return EXCLUDE.some((frag) => n.includes(frag));
};

function gitDiff(p) {
  try {
    return execFileSync('git', ['-C', path.dirname(p), 'diff', '--no-color', 'HEAD', '--', p],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }) || '';
  } catch { return ''; }
}
function countDiffLines(diff) {
  let n = 0;
  for (const ln of diff.split('\n')) {
    if ((ln[0] === '+' || ln[0] === '-') && !ln.startsWith('+++') && !ln.startsWith('---')) n++;
  }
  return n;
}

let payload = '';
try { payload = fs.readFileSync(0, 'utf8'); } catch { process.exit(0); }
let session = '';
try { session = JSON.parse(payload)?.session_id || ''; } catch { process.exit(0); }
if (!session) process.exit(0);

const touchedF = path.join(os.tmpdir(), `amr-touched-${session}.txt`);
let list = [];
try { list = [...new Set(fs.readFileSync(touchedF, 'utf8').split('\n').filter(Boolean))]; }
catch { process.exit(0); } // no .md touched → nothing to do, zero cost
if (!list.length) process.exit(0);

const stateF = path.join(os.tmpdir(), `amr-reviewed-${session}.json`);
let state = {};
try { state = JSON.parse(fs.readFileSync(stateF, 'utf8')); } catch { /* first review */ }

const todo = []; // { p, mode: 'diff'|'full', hunk }
for (const p of list) {
  if (isExcluded(p)) continue;                                 // infra, not a deliverable
  let c; try { c = fs.readFileSync(p, 'utf8'); } catch { continue; } // gone
  const h = crypto.createHash('sha256').update(c).digest('hex');
  const st = state[p] || { hash: '', count: 0 };
  if (st.count >= MAX) continue;                                // runaway cap reached
  if (st.hash === h) continue;                                  // unchanged since last review

  const diff = gitDiff(p);
  let mode = 'full';
  let hunk = '';
  if (diff) {
    if (countDiffLines(diff) < MIN_LINES) {                     // trivial change → skip
      state[p] = { hash: h, count: st.count };                 // mark seen without spending budget
      continue;
    }
    mode = 'diff';
    const lines = diff.split('\n');
    hunk = lines.length > MAX_HUNK
      ? lines.slice(0, MAX_HUNK).join('\n')
        + `\n… (diff truncated, ${lines.length - MAX_HUNK} more lines — read the file if needed)`
      : diff;
  }
  todo.push({ p, mode, hunk });
  state[p] = { hash: h, count: st.count + 1 };
  if (todo.length >= MAX_FILES) break;
}

try { fs.writeFileSync(stateF, JSON.stringify(state)); } catch { /* best-effort */ }
if (!todo.length) process.exit(0);

let brief = 'Read the file as EXTERNAL input and challenge it. List ONLY real substance '
  + 'problems: gaps (promised/expected info missing, empty section, open question), internal '
  + 'contradictions, dubious/unsupported/false claims, blocking ambiguities. Ignore style. '
  + 'Format each point as "- [where] problem -> fix". If the document is solid, reply exactly "RAS".';
try { const b = fs.readFileSync(briefPath, 'utf8').trim(); if (b) brief = b; } catch { /* fallback above */ }

const diffNote =
  'You receive Markdown files changed this turn. Each comes with either its DIFF (challenge ONLY the '
  + 'change; read the full file only if the diff lacks context) or a "full review" marker (new/untracked '
  + 'file: read it whole). Apply the rubric below to each.\n\n';

const blocks = todo.map(({ p, mode, hunk }) =>
  mode === 'diff'
    ? `--- ${p} (diff) ---\n${hunk}`
    : `--- ${p} (full review: new or untracked file) ---`,
).join('\n\n');

const reason =
  `🔍 Fresh-context review — ${todo.length} Markdown file(s) changed this turn.\n`
  + `BEFORE stopping: spawn ONE FRESH-CONTEXT reviewer subagent via the Agent tool `
  + `(model: "${MODEL}", subagent_type: "general-purpose") with this exact mandate:\n`
  + `« ${diffNote}${brief} »\n\n`
  + `Files and diffs to review:\n${blocks}\n\n`
  + `Then apply the fixes it reports — or, if you judge a point intentional, say so explicitly. Then stop.`;

process.stdout.write(JSON.stringify({ decision: 'block', reason }));
process.exit(0);
