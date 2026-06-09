# Trigger — Claude Code (real-time, in the agent loop)

Fires **inside the agent's working loop**, so the agent self-corrects while it works — no commit or human prompt needed.

- **Layer 1** — `PostToolUse` hook on `Write|Edit|MultiEdit` runs [the validator](../../validator/index.mjs) on any `.md` the agent writes and feeds issues back via `exit 2`.
- **Layer 2** — `Stop` hook checks whether a `.md` changed this turn and, if so, blocks the stop with a directive telling the agent to spawn a **fresh-context reviewer subagent** (Agent tool, model `sonnet`) using [the shared brief](../../prompts/reviewer-brief.md).

## Install (recommended)

From the repo root:

```bash
node setup.mjs
```

It copies the runtime files to `~/.claude/agent-markdown-review/`, registers both hooks in `~/.claude/settings.json` **non-destructively** (a `.bak` is written), and self-tests. See [INSTALL.md](../../INSTALL.md) for the full playbook and gotchas.

## Manual install

Copy the runtime files under `~/.claude/agent-markdown-review/` (preserving `validator/`, `prompts/`, `triggers/claude-code/`), then merge the two entries from [settings.snippet.json](settings.snippet.json) into the `hooks` block of your `~/.claude/settings.json`.

## Files

| File | Role |
|------|------|
| [validate-md.sh](validate-md.sh) | Layer 1 wrapper (PostToolUse) |
| [hook-validate.mjs](hook-validate.mjs) | Layer 1 logic — reads payload, validates, logs touched files |
| [review-on-stop.sh](review-on-stop.sh) | Layer 2 wrapper (Stop) |
| [review-on-stop.mjs](review-on-stop.mjs) | Layer 2 logic — change detection, cap, review directive |
| [settings.snippet.json](settings.snippet.json) | Hooks to merge (for manual install) |

## Tuning

| Env var | Default | Effect |
|---------|---------|--------|
| `AMR_REVIEW_MAX` | `2` | Max Layer-2 review passes per file per session |

Remove the `Stop` entry from `settings.json` to disable Layer 2 (Layer 1 stays). Or run `node setup.mjs --uninstall`.

## Note on Layer 2 reliability

The Stop hook is a **deterministic trigger**, but Layer 2 executes via a directive injected into the agent — reliable at stop time, yet still an instruction, not a hard-forced call. Layer 1 (`exit 2`) is the deterministic half. See [METHODOLOGY.md](../../METHODOLOGY.md).
