# Trigger — generic git pre-commit (any editor, any agent, any LLM)

Fires **at commit time**, in any repo, with no dependency on a specific agent or vendor. Proves the core is not tied to Claude Code.

- **Layer 1** (always) — validates staged Markdown with [the validator](../../validator/index.mjs). No LLM required. Blocks the commit on structural issues.
- **Layer 2** (opt-in) — fresh-context semantic review of each staged `.md` via **any LLM CLI**, using [the shared brief](../../prompts/reviewer-brief.md). Advisory (does not block).

The hook resolves the validator + brief from **`$AMR_HOME` if set, otherwise `<your-repo>/.agent-markdown-review/`**.

1. Make the validator + brief available, either way:

   ```bash
   # Option A — point at a checkout of this repo
   export AMR_HOME=/path/to/agent-markdown-review

   # Option B — vendor them into the repo you want to guard
   mkdir -p .agent-markdown-review
   cp -r /path/to/agent-markdown-review/validator /path/to/agent-markdown-review/prompts .agent-markdown-review/
   ```

2. Install the hook into the repo you want to guard (run from that repo; source path is your checkout of this project, or `$AMR_HOME`):

   ```bash
   cp "$AMR_HOME/triggers/git-pre-commit/pre-commit" .git/hooks/pre-commit
   chmod +x .git/hooks/pre-commit
   ```

3. (Optional) Enable Layer 2 with any LLM CLI:

   ```bash
   export LLM_CMD="claude -p"      # or: llm, ollama run <model>, a curl wrapper, etc.
   ```

That's it — `git commit` now validates staged `.md`, and (if `LLM_CMD` is set) prints a fresh-context review per file.

## Files

| File | Role |
|------|------|
| [pre-commit](pre-commit) | The hook — Layer 1 always, Layer 2 if `$LLM_CMD` is set |

## Requirements

- Node 18+ (for the validator)
- Optional: any LLM CLI for Layer 2
