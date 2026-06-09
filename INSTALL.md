# Install — agent-first playbook

This file is written so an **agent** can install the system unattended. If you are pointing your agent at this repo, tell it: *"read INSTALL.md and set it up."* The fragile parts are handled by [setup.mjs](setup.mjs) so nothing depends on the agent improvising.

## Claude Code (recommended path)

```bash
node setup.mjs
```

`setup.mjs` is idempotent and:

1. copies `validator/`, `prompts/`, `triggers/claude-code/` into `~/.claude/agent-markdown-review/`;
2. merges the two hooks into `~/.claude/settings.json` **non-destructively** (writes `settings.json.bak` first, preserves all your other hooks, refuses to run if the file is invalid JSON);
3. self-tests the validator (expects it to flag a deliberately bad file).

Then **restart your Claude Code session** if the hooks do not fire immediately (hooks are read at session start).

Uninstall (removes our hooks, keeps files):

```bash
node setup.mjs --uninstall
```

## Generic git pre-commit (any editor / agent / LLM)

See [triggers/git-pre-commit/README.md](triggers/git-pre-commit/README.md). Summary: vendor `validator/` + `prompts/` into your repo (or set `AMR_HOME`), copy `pre-commit` into `.git/hooks/`, and optionally `export LLM_CMD="claude -p"` for Layer 2.

## Requirements

- **Node 18+** on `PATH` (the validator and the Claude Code logic are Node, dependency-free).
- For Layer 2 under Claude Code: the `claude` CLI on `PATH` (it spawns a Sonnet subagent inside your session, using your normal auth — no API key needed).

## Gotchas (learned the hard way)

- **`jq` is not required.** The Claude Code adapter parses the hook payload in Node, not `jq` — because `jq` is frequently absent from the hook shell.
- **Never hand-merge `settings.json`.** Use `setup.mjs`; a careless manual edit can clobber existing hooks or break the JSON. The installer backs up and merges only its own entries.
- **A `gitleaks` (or other) pre-commit in your *own* dotfiles repo** may block commits if the tool is not on the hook shell's `PATH`. That is unrelated to this project, but if you hit it: install the tool or ensure its directory is on `PATH` (do not blindly `--no-verify` a secret scanner).
- **Windows / Git Bash:** hooks run under Git Bash; paths use `$HOME` so the same `settings.json` works across machines. Node receives Windows paths and handles them; the adapter also normalizes MSYS `/c/...` paths defensively.
- **Layer 2 is a deterministic *trigger*, not a forced execution.** The Stop hook reliably fires and injects the review directive, but the review itself runs because the agent follows that directive. Layer 1 (`exit 2`) is the hard-deterministic half.

## Verify it works

After install, write a small `.md` with a broken local link and an open "section to complete" line, then let the agent finish a turn:

- Layer 1 should surface the broken link immediately;
- Layer 2 should ask for a fresh-context review at the end of the turn.
