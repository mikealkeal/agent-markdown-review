#!/usr/bin/env bash
# Claude Code Stop hook (Layer 2) — thin wrapper around review-on-stop.mjs.
# Registered by setup.mjs. The .mjs emits JSON {decision:block, reason} on stdout
# when a review is due; the hook itself never calls an LLM.
set +e
node "$HOME/.claude/agent-markdown-review/triggers/claude-code/review-on-stop.mjs"
exit 0
