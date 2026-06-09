# agent-markdown-review

**The ecosystem lints your *code* as the agent writes it. This validates what the agent *wrote* — your Markdown — structurally *and* semantically.**

When an AI agent writes a `.md` (README, spec, ADR, notes, docs), it does it in one forward pass and does not re-read itself. You end up asking "re-read and check" every time — and every time it finds something. This wires that review into the right trigger — structural checks **enforced** on write, a fresh-context semantic pass on the yield/commit boundary — so you stop asking.

## Two layers

| Layer | Catches | How | Cost |
|-------|---------|-----|------|
| **1 — Deterministic** | unclosed frontmatter/fences, unresolved placeholders, **broken local links** | a validator run on write → fed back to the agent | none, instant, guaranteed |
| **2 — Semantic** | gaps, internal contradictions, dubious claims, blocking ambiguities | a **fresh-context** reviewer (errors decorrelated from the author's) | one model call (scales with file size), only when a `.md` changed |

Why two layers and not just "re-read it"? Because same-context self-review is the *weakest* lever — see [METHODOLOGY.md](METHODOLOGY.md) (research-backed).

## Quickstart (Claude Code)

```bash
node setup.mjs
```

Copies the runtime into `~/.claude/agent-markdown-review/`, registers a `PostToolUse` hook (Layer 1) and a `Stop` hook (Layer 2) **non-destructively** in your `settings.json`, and self-tests. Full playbook + gotchas: [INSTALL.md](INSTALL.md).

## Not tied to Claude Code

The core is harness-agnostic. The Markdown validator is **pure Node, zero AI** — it runs anywhere. Layer 2 is just "call a fresh LLM with [the brief](prompts/reviewer-brief.md)". Each environment plugs in via a trigger:

- [triggers/claude-code/](triggers/claude-code/README.md) — real-time, in the agent loop (the reference adapter).
- [triggers/git-pre-commit/](triggers/git-pre-commit/README.md) — commit-time, any editor, **any LLM CLI** (`claude -p`, `llm`, `ollama`, …).

## Structure

```text
agent-markdown-review/
├── METHODOLOGY.md          # why it works (research + 2-layer design)
├── INSTALL.md              # agent-first install playbook
├── prompts/
│   └── reviewer-brief.md   # the reviewer prompt — model/harness-agnostic
├── validator/
│   ├── index.mjs           # Layer 1 CLI (dispatch by extension)
│   └── markdown.mjs        # Markdown checks — pure, no AI
├── triggers/
│   ├── claude-code/        # real-time agent-loop adapter (hooks)
│   └── git-pre-commit/     # commit-time, any LLM CLI
└── setup.mjs               # idempotent installer + self-test
```

## Scope

- **Semantic review (Layer 2):** any text document — the brief is format-agnostic.
- **Structural validation (Layer 1):** Markdown today. The `validator/` dispatches by extension; add `validator/<format>.mjs` for more (PRs welcome).

## Honest limitations

- **Layer 2 is a deterministic *trigger*, not a forced execution.** The hook reliably fires and injects the review directive; the review runs because the agent follows it. Layer 1 (`exit 2`) is the hard-deterministic half.
- No built-in token/cost accounting (the trigger does not run the model itself). Counts and a size-based estimate are possible; exact cost would require running the reviewer as a CLI with JSON output.

## Contributing

Wanted adapters: **Cursor, Aider, Windsurf, GitHub Actions/CI.** The contract is small — run [the validator](validator/index.mjs) on changed `.md`, and (optionally) pipe [the brief](prompts/reviewer-brief.md) + the file to a fresh LLM. Open a PR under `triggers/`.

## License

[MIT](LICENSE)
