#!/usr/bin/env node
// setup.mjs — install the Claude Code trigger (Layers 1 + 2) into ~/.claude.
//
// Idempotent, non-destructive to your settings.json (backup written), and self-testing.
// Cross-platform (Windows/macOS/Linux). Designed so an agent can run it unattended:
//
//   node setup.mjs              install / update
//   node setup.mjs --uninstall  remove our hooks from settings.json (keeps files)
//
// Requires: Node 18+. For the Claude Code Stop-time review you also need the `claude`
// CLI on PATH (it spawns a Sonnet subagent inside your session — uses your normal auth).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = path.dirname(fileURLToPath(import.meta.url));
const home = os.homedir();
const claudeDir = path.join(home, '.claude');
const installRoot = path.join(claudeDir, 'agent-markdown-review');
const settingsPath = path.join(claudeDir, 'settings.json');
const uninstall = process.argv.includes('--uninstall');

const POST_CMD = 'bash -c "$HOME/.claude/agent-markdown-review/triggers/claude-code/validate-md.sh"';
const STOP_CMD = 'bash -c "$HOME/.claude/agent-markdown-review/triggers/claude-code/review-on-stop.sh"';

const log = (s) => process.stdout.write(s + '\n');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(claudeDir)) {
  log('✗ ~/.claude not found — is Claude Code installed for this user?');
  process.exit(1);
}

// 1) Copy the runtime files (skip on uninstall)
if (!uninstall) {
  for (const sub of ['validator', 'prompts', 'triggers/claude-code']) {
    copyDir(path.join(repo, sub), path.join(installRoot, sub));
  }
  log(`✓ files copied → ${installRoot}`);
}

// 2) Merge settings.json (non-destructive, with backup)
let settings = {};
if (fs.existsSync(settingsPath)) {
  fs.copyFileSync(settingsPath, settingsPath + '.bak');
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
  catch { log('✗ settings.json is not valid JSON — aborting, nothing changed.'); process.exit(1); }
}
settings.hooks ||= {};

function ensure(event, matcher, cmd, timeout) {
  settings.hooks[event] ||= [];
  // Remove our command from every group first → idempotent, and handles --uninstall.
  for (const grp of settings.hooks[event]) if (grp.hooks) grp.hooks = grp.hooks.filter((h) => h.command !== cmd);
  if (uninstall) return;
  let grp = settings.hooks[event].find((g) => (g.matcher || '') === (matcher || ''));
  if (!grp) { grp = matcher ? { matcher, hooks: [] } : { hooks: [] }; settings.hooks[event].push(grp); }
  (grp.hooks ||= []).push({ type: 'command', command: cmd, ...(timeout ? { timeout } : {}) });
}

ensure('PostToolUse', 'Write|Edit|MultiEdit', POST_CMD, 10);
ensure('Stop', '', STOP_CMD, 15);

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
log(uninstall
  ? '✓ hooks removed from settings.json'
  : '✓ hooks registered in settings.json (backup: settings.json.bak)');

if (uninstall) { log(`Done. (files left in ${installRoot})`); process.exit(0); }

// 3) Self-test — the validator must flag a bad file (exit 2)
const tmp = path.join(os.tmpdir(), `amr-selftest-${Date.now()}.md`);
let ok = true;
try {
  fs.writeFileSync(tmp, '# T\n\nSee [missing](./does-not-exist-xyz.md)\n\n```js\nlet a = 1;\n');
  try {
    execFileSync(process.execPath, [path.join(installRoot, 'validator', 'index.mjs'), tmp], { stdio: 'pipe' });
    ok = false; // expected a non-zero exit
  } catch (e) {
    if (e.status !== 2) ok = false;
  }
} finally {
  try { fs.unlinkSync(tmp); } catch {}
}
log(ok ? '✓ self-test passed (validator flags issues as expected)'
       : '✗ self-test FAILED — check Node and the installed paths');

log('\nDone. Restart your Claude Code session if the hooks do not fire immediately.');
log('Tune the number of review passes per file: export AMR_REVIEW_MAX=2');
process.exit(ok ? 0 : 1);
