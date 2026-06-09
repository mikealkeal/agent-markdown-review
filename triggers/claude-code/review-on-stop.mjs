#!/usr/bin/env node
// review-on-stop.mjs — Claude Code Stop adapter (Layer 2, semantic review).
//
// The hook does NOT call an LLM itself (no global context reload, no API key needed).
// If a Markdown file changed this turn, it emits decision:block with a directive that
// tells the agent to spawn a FRESH-CONTEXT reviewer subagent (Agent tool, model sonnet)
// on those files, using the shared reviewer brief.
//
// Loop guard: a file is (re)reviewed only if its content changed since the last review
// (sha256), and at most AMR_REVIEW_MAX times per session.
//
// Output: JSON {decision:"block", reason} on stdout when a review is due, else nothing.
// Always exit 0 (the JSON drives the Stop hook, not the exit code).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MAX = Math.max(1, parseInt(process.env.AMR_REVIEW_MAX || '2', 10) || 2);
const MAX_FILES = 5;
const here = path.dirname(fileURLToPath(import.meta.url));
const briefPath = path.resolve(here, '../../prompts/reviewer-brief.md');

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

const todo = [];
for (const p of list) {
  let c; try { c = fs.readFileSync(p, 'utf8'); } catch { continue; } // gone
  const h = crypto.createHash('sha256').update(c).digest('hex');
  const st = state[p] || { hash: '', count: 0 };
  if (st.count >= MAX) continue;   // runaway cap reached
  if (st.hash === h) continue;     // unchanged since last review
  todo.push(p);
  state[p] = { hash: h, count: st.count + 1 };
  if (todo.length >= MAX_FILES) break;
}
if (!todo.length) process.exit(0);
try { fs.writeFileSync(stateF, JSON.stringify(state)); } catch { /* best-effort */ }

let brief = 'Read the file as EXTERNAL input and challenge it. List ONLY real substance '
  + 'problems: gaps (promised/expected info missing, empty section, open question), internal '
  + 'contradictions, dubious/unsupported/false claims, blocking ambiguities. Ignore style. '
  + 'Format each point as "- [where] problem -> fix". If the document is solid, reply exactly "RAS".';
try { const b = fs.readFileSync(briefPath, 'utf8').trim(); if (b) brief = b; } catch { /* fallback above */ }

const fileList = todo.map((p) => `\`${p}\``).join(', ');
const reason =
  `🔍 Fresh-context review — Markdown file(s) written/changed this turn: ${fileList}.\n` +
  `BEFORE stopping, for EACH file above: spawn a FRESH-CONTEXT reviewer subagent via the Agent ` +
  `tool (model: "sonnet", subagent_type: "general-purpose") with this exact mandate:\n` +
  `« ${brief} »\n` +
  `The subagent reads the file(s) itself (no other context). Then apply the fixes it reports — ` +
  `or, if you judge a point intentional, say so explicitly. Then stop.`;

process.stdout.write(JSON.stringify({ decision: 'block', reason }));
process.exit(0);
