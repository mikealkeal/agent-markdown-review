# Methodology

Why this exists, why it has two layers, and why "just re-read it" is the weakest possible fix.

## The problem

An LLM generates in a single forward pass, with no native feedback loop. Worse: **the context that produced an error is blind to that error**. That is why asking an agent to "re-read and check" in the same conversation barely helps — what helps is re-introducing the content as **external input**, seen by a **deterministic** checker or a **fresh-context** reviewer.

## Two complementary layers

| Layer | Catches | Mechanism | Cost |
|-------|---------|-----------|------|
| **1 — Deterministic** | objective structural errors | a validator run on write | none, instant, guaranteed |
| **2 — Semantic** | gaps, contradictions, dubious claims | a fresh-context reviewer | one cheap model call on the **diff**, only when a non-trivial change lands in a non-infra `.md` |

Layer 1 catches what is *factually wrong* (syntax, structure, links). Layer 2 catches what only judgment sees (substance). Both are needed: a linter does not understand meaning; a fresh reviewer should not waste effort on unbalanced code fences.

## Architecture

```text
Write / edit a .md   (any session, any topic)
        │
        ▼
[Layer 1]  trigger → validator/index.mjs
   • validates structure; issues → fed back to the agent → it fixes inline
   • logs the touched file for Layer 2
        │
        ▼  (when the agent yields)
[Layer 2]  trigger → fresh-context reviewer (prompts/reviewer-brief.md)
   • only if a .md changed; guarded by content hash + a per-file cap
   • lists gaps/contradictions → the agent applies the fixes
```

## Layer 1 — deterministic validator

Pure and dependency-free ([validator/markdown.mjs](validator/markdown.mjs)). *Deterministic* here means: no LLM, fixed rules — same input, same output (not a formal program property). It flags only the objectively-wrong or clearly-incomplete:

- unclosed YAML frontmatter;
- unbalanced code fences;
- unresolved placeholders and incompleteness markers;
- broken local links (relative target missing on disk).

Conservative on purpose — it must not nudge the agent into "fixing" correct content. It runs on every write, costs nothing, and is guaranteed by the trigger.

## Layer 2 — fresh-context semantic review

The trigger fires on the yield/commit boundary — a `Stop` hook in the Claude Code adapter, a `pre-commit` in the git adapter. When a `.md` changed, the reviewer reads the document as **external input** (see [the brief](prompts/reviewer-brief.md)), so its errors are decorrelated from the author's. It is gated so cost stays marginal:

1. nothing changed → no review;
2. **infra files are skipped** — `.claude/` config, `docs/`, and `CLAUDE.md` are tooling, not deliverables (override with `AMR_REVIEW_EXCLUDE`);
3. only the **diff** is reviewed, not the whole file — the change is extracted via `git diff HEAD` (a new or untracked file falls back to a full read);
4. a change under `AMR_REVIEW_MIN_LINES` (default 6) is treated as trivial and skipped;
5. a file is re-reviewed only if its **content changed** since the last review (sha256);
6. at most `AMR_REVIEW_MAX` (default 2) passes per file per session — a *session* is one Claude Code session, tracked in a temp file keyed by its id (a new session resets the cap);
7. all changed files of a turn are reviewed by **one** batched subagent, not one per file.

The crucial property is the **fresh context** — a separate reviewer (subagent or separate session) sees what the generating context cannot. Its value is in **detection**: the agent then applies the fix *with that external signal in hand*, which is a different thing from unprompted same-context self-review.

**Cost.** The trigger itself runs **no model** — Layer 1 validation and Layer 2's change-detection + directive are pure logic, so the hook is free. The only spend is the reviewer, which is a near-mechanical task (read + apply a fixed rubric): a cheap, fast model (Sonnet by default, `AMR_REVIEW_MODEL`) is the right fit — the decorrelated fresh context matters more than model power. Keep your strong model for the work; delegate the review to an inexpensive one. The reviewer reads only the **diff** (via `git diff`), not the whole file, so a one-line edit no longer pays for a full-document read.

## Lifecycle (example)

1. The agent writes `guide.md` with a broken link and a substance gap.
2. **Layer 1** flags the broken link → the agent fixes it in the turn.
3. The agent yields.
4. **Layer 2** sees `guide.md` changed → asks for a fresh-context review.
5. The reviewer finds the substance gap → the agent fixes it, or **declares it intentional and leaves the file unchanged** — an unchanged file (same hash) is skipped next time, so a false positive never loops.
6. Next yield: `guide.md` is unchanged → Layer 2 skips it. No loop.

## Foundations

- [LLMs Cannot Self-Correct Reasoning Yet — Huang et al., ICLR 2024](https://arxiv.org/abs/2310.01798) — without an external signal, self-correction degrades more than it fixes.
- [CRITIC — Gou et al., 2024](https://arxiv.org/abs/2305.11738) — the gains come from external tool feedback; remove the tool and they collapse.
- [Reflexion — Shinn et al., 2023](https://arxiv.org/abs/2303.11366) — improvement is driven by execution/environment feedback, not "reflection" alone.
- [Self-Refine — Madaan et al., 2023](https://arxiv.org/abs/2303.17651) — iterative refinement works mostly with a signal, and one pass usually suffices.

**Application to this design:** since an LLM does not reliably self-correct without an **external signal**, we derive two levers — a **deterministic validator** (Layer 1) and a **separate-context evaluator** (Layer 2), whose errors are decorrelated from the generator's. This is a reasoned design choice from the results above, not a theorem: the cited work concerns reasoning and tool feedback, not document review specifically.

## Anti-patterns

- Relying on same-context "re-read" as a quality gate — the weakest lever.
- Re-reviewing **unchanged** content repeatedly — noise, no gain (hence the hash guard).
- Making Layer 1 chatty about style — keep it on the objectively wrong.
- Running a fresh-context review on every micro-edit — costly; that is why Layer 2 is on the yield/commit boundary, gated by content change, a diff-line threshold, and a scope filter, and reviews only the diff.
