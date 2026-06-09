#!/usr/bin/env bash
# Claude Code PostToolUse hook (Layer 1) — thin wrapper around hook-validate.mjs.
# Registered by setup.mjs. Reads the payload on stdin (passed through to node).
set +e
node "$HOME/.claude/agent-markdown-review/triggers/claude-code/hook-validate.mjs"
exit $?
