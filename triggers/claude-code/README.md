# Trigger — Claude Code (real-time, in the agent loop)

Fires **inside the agent's working loop**, so the agent self-corrects while it works — no commit or human prompt needed.

- **Layer 1** — `PostToolUse` hook on `Write|Edit|MultiEdit` runs [the validator](../../validator/index.mjs) on any `.md` the agent writes and feeds issues back via `exit 2`.
- **Layer 2** — `Stop` hook checks whether a `.md` changed this turn and, if so, blocks the stop with a directive telling the agent to spawn **one fresh-context reviewer subagent** (Agent tool, model `sonnet`) using [the shared brief](../../prompts/reviewer-brief.md). It is **diff-aware** (forwards the `git diff` of the change, not the whole file), **scoped** (skips infra paths — `.claude/`, `docs/`, `CLAUDE.md`), **thresholded** (skips changes under `AMR_REVIEW_MIN_LINES`), and **batched** (one subagent for all files in the turn).

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
| [review-on-stop.mjs](review-on-stop.mjs) | Layer 2 logic — change detection, scope filter, git-diff extraction, threshold, cap, batched review directive |
| [settings.snippet.json](settings.snippet.json) | Hooks to merge (for manual install) |

## Tuning

| Env var | Default | Effect |
|---------|---------|--------|
| `AMR_REVIEW_MAX` | `2` | Max Layer-2 review passes per file per session |
| `AMR_REVIEW_MODEL` | `sonnet` | Model for the Layer-2 reviewer subagent — a cheap/fast model is enough (decorrelation matters more than power). The hook itself runs no model and costs $0. Set `haiku` to cut cost further. |
| `AMR_REVIEW_MIN_LINES` | `6` | Skip review when the change is smaller than this many diff lines (added + removed). Trivial edits never trigger a review. |
| `AMR_REVIEW_EXCLUDE` | infra paths | Comma-separated path fragments to skip (replaces the defaults: `.claude/skills/`, `.claude/rules/`, `.claude/docs/`, `.claude/agents/`, `.claude/commands/`, `.claude/templates/`, `.claude/hooks/`, `/docs/`, plus any file named `CLAUDE.md`). |

Remove the `Stop` entry from `settings.json` to disable Layer 2 (Layer 1 stays). Or run `node setup.mjs --uninstall`.

## Note on Layer 2 reliability

The Stop hook is a **deterministic trigger**, but Layer 2 executes via a directive injected into the agent — reliable at stop time, yet still an instruction, not a hard-forced call. Layer 1 (`exit 2`) is the deterministic half. See [METHODOLOGY.md](../../METHODOLOGY.md).
