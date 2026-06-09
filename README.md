# agent-markdown-review

**The ecosystem lints your *code* as the agent writes it. This validates what the agent *wrote* — your Markdown — structurally *and* semantically.**

When an AI agent writes a `.md` (README, spec, ADR, notes, docs), it does it in one forward pass and does not re-read itself. You end up asking "re-read and check" every time — and every time it finds something. This wires that review into the right trigger — structural checks **enforced** on write, a fresh-context semantic pass on the yield/commit boundary — so you stop asking.

```text
   write / edit a .md
        |
        v
   +----------------------------------------------------+
   |  LAYER 1  -  on write  -  $0  -  deterministic      |
   |  frontmatter . fences . placeholders . local links |
   +----------------------------------------------------+
        |
        |-- issues --> agent fixes (= a write) --> back to LAYER 1 (top)
        |
        '-- clean  -->  agent yields / commits
                            |
                            v
   +----------------------------------------------------+
   |  changed since last review                         |
   |   AND  under MAX passes?      (MAX = 2 by default)  |
   +----------------------------------------------------+
        |
        |-- no / capped -->  done  -  added cost: $0
        |
        '-- yes
            |
            v
   +----------------------------------------------------+
   |  LAYER 2  -  on yield  -  fresh context  -  cheap   |
   |  reads the doc as EXTERNAL input ->                 |
   |  gaps . contradictions . dubious claims            |
   +----------------------------------------------------+
        |
        |-- RAS -->  done
        |
        '-- findings --> agent applies fix (= a write)
                             '--> back to LAYER 1 (top), bounded by MAX = 2
```

## Two layers

| Layer | Catches | How | Cost |
|-------|---------|-----|------|
| **1 — Deterministic** | unclosed frontmatter/fences, unresolved placeholders, **broken local links** | a validator run on write → fed back to the agent | none, instant, guaranteed |
| **2 — Semantic** | gaps, internal contradictions, dubious claims, blocking ambiguities | a **fresh-context** reviewer (errors decorrelated from the author's) | one model call (scales with file size), only when a `.md` changed |

## The core idea — review as *external* input

An LLM can't reliably proofread its own output **from inside the context that produced it**. The mistake lives in the model's own reasoning, where it's a blind spot. The fix isn't a smarter prompt — it's changing the content's *position*: from *"mine"* to **external input seen by a fresh reader**.

| | "Included" context — *self-review* | **External** context — *this approach* |
|---|---|---|
| Where the content sits | in the model's own context (it wrote it) | handed to a **fresh reader** as external input |
| Sees its own mistakes? | poorly — blind to what it just generated | yes — errors decorrelated from the author |
| What the research shows | self-correction degrades without an external signal | the same error, seen as external, is caught far more often |
| Typical move | "re-read and check" in the same chat | a separate reviewer (subagent / fresh session) |
| Outcome | finds little; can turn right into wrong | finds the real gaps |

That's the whole bet: both layers exist to get the document **out** of the generating context — a deterministic checker (no model at all) and a fresh-context reviewer. The fancy prompt is secondary; the *position* of the content is what matters. Sources and detail: [METHODOLOGY.md](METHODOLOGY.md).

## Cost

The **hooks themselves cost $0** — they run no model. Layer 1 (validation) and Layer 2's change-detection + review directive are pure logic. The *only* spend is the Layer 2 reviewer, and:

- it runs on a **cheap, fast model** (Sonnet by default; set `AMR_REVIEW_MODEL`) — the review is near-mechanical, so the **decorrelated fresh context matters more than raw model power**;
- it fires **only when a `.md` actually changed**, capped at `AMR_REVIEW_MAX` (default 2) passes per file per session.

In practice: **free on every write**, plus one cheap call only when there is something new to review.

## Quickstart (Claude Code)

```bash
node setup.mjs
```

Copies the runtime into `~/.claude/agent-markdown-review/`, registers a `PostToolUse` hook (Layer 1) and a `Stop` hook (Layer 2) **non-destructively** in your `settings.json`, and self-tests. Full playbook + gotchas: [INSTALL.md](INSTALL.md).

## How to use

Once installed, **there is nothing to run.** You write Markdown as usual and the review happens on its own:

1. **You (or your agent) write or edit a `.md`** → Layer 1 validates it on the spot; any structural issue (broken link, unclosed fence, leftover placeholder) is fed straight back and fixed before moving on.
2. **The agent finishes its turn** → if a `.md` changed, Layer 2 fires: the agent spawns a fresh-context reviewer that reads the doc as external input and reports gaps / contradictions / dubious claims; the agent applies the fixes (or flags a point as intentional), then stops.
3. **Nothing changed?** → both layers stay silent and cost nothing.

No slash command, no manual step. Pause it with `node setup.mjs --uninstall` (or remove just the `Stop` entry to keep Layer 1 only). Tune with `AMR_REVIEW_MAX` and `AMR_REVIEW_MODEL`.

With the **git pre-commit** flavor, "using it" is simply `git commit`: staged `.md` is validated, and reviewed too if you set `LLM_CMD`. See [triggers/git-pre-commit/](triggers/git-pre-commit/README.md).

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
