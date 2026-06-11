#!/usr/bin/env bash
# PreToolUse gate: block edits to production source unless a CURRENT impact
# analysis (naming the target file) exists in .claude/impact-analysis.md.
#
# Purpose: force "map the blast radius before you change code" at the exact
# moment of editing — countering the failure mode of acting on an incomplete
# model and discovering the impact afterward.
#
# Honest scope: this forces the STEP and re-surfaces the checklist at the
# decision point. It does NOT verify the analysis is correct or complete; that
# still depends on the author and on review.
#
# Not gated: test files (red-first TDD must stay free), docs/*.md, and anything
# under .claude/ (including this artifact). Fails OPEN on any error so a hook
# bug can never brick editing.
set -uo pipefail

input="$(cat)"
project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
impact="$project_dir/.claude/impact-analysis.md"
FRESH_SECONDS=$((60 * 60)) # the analysis must be < 60 minutes old

# Robust JSON parse via python3 (always present on macOS). Covers Edit/Write
# (tool_input.file_path) and MultiEdit (tool_input.file_path + edits[].file_path).
paths="$(printf '%s' "$input" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin); ti = d.get("tool_input", {}) or {}
    out = [ti["file_path"]] if ti.get("file_path") else []
    out += [e["file_path"] for e in (ti.get("edits") or []) if isinstance(e, dict) and e.get("file_path")]
    print("\n".join(out))
except Exception:
    pass
' 2>/dev/null)" || exit 0

# Emit a PreToolUse "deny" decision; the reason is surfaced back to the model.
deny() {
  printf '%s' "$1" | python3 -c '
import sys, json
print(json.dumps({"hookSpecificOutput": {
  "hookEventName": "PreToolUse",
  "permissionDecision": "deny",
  "permissionDecisionReason": sys.stdin.read()}}))'
  exit 0
}

# True only for production source we want to gate.
gated() {
  case "$1" in
  *_test.go | *.test.ts | *.test.tsx | *.spec.ts | *.spec.tsx) return 1 ;; # TDD tests
  */.claude/* | */docs/*) return 1 ;;
  *.go | *.ts | *.tsx | *.js | *.jsx) return 0 ;;
  *) return 1 ;;
  esac
}

fresh() {
  [ -f "$impact" ] || return 1
  local mtime
  mtime=$(stat -f %m "$impact" 2>/dev/null || stat -c %Y "$impact" 2>/dev/null) || return 1
  [ $(($(date +%s) - mtime)) -le "$FRESH_SECONDS" ]
}

CHECK="Open .claude/impact-analysis.md and add/refresh an entry for THIS change that names every file you will touch and, for each, lists: (1) every consumer/caller affected, (2) dependencies, (3) states/edge cases, (4) downstream & runtime effects — each marked VERIFIED (you read the producer and consumers, or measured it) or ASSUMED. Resolve every ASSUMED item before editing, then retry."

while IFS= read -r f; do
  [ -n "$f" ] || continue
  gated "$f" || continue
  fresh || deny "Impact gate: no current impact analysis. $CHECK"
  base="$(basename "$f")"
  rel="${f#"$project_dir"/}"
  # A repo-relative path match is always sufficient.
  grep -qF "$rel" "$impact" 2>/dev/null && continue
  if grep -qF "$base" "$impact" 2>/dev/null; then
    # A bare-basename mention is only acceptable when the name is unambiguous —
    # otherwise one analysis would unlock every same-named file repo-wide.
    count="$(git -C "$project_dir" ls-files "*/$base" "$base" 2>/dev/null | wc -l | tr -d ' ')"
    [ "${count:-0}" -le 1 ] && continue
    deny "Impact gate: .claude/impact-analysis.md mentions $base, but multiple files share that name; name the full path ($rel) in the entry. $CHECK"
  fi
  deny "Impact gate: .claude/impact-analysis.md does not mention $base. $CHECK"
done <<<"$paths"

exit 0
