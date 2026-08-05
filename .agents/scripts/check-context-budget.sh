#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo 'usage: check-context-budget.sh [--root <repository-root>]' >&2
}

repo_root=''
while (($# > 0)); do
  case "$1" in
    --root)
      (($# >= 2)) || { usage; exit 2; }
      repo_root=$2
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$repo_root" ]]; then
  repo_root=$(git rev-parse --show-toplevel)
fi

root_instructions="$repo_root/AGENTS.md"
router="$repo_root/.agents/README.md"
skills_dir="$repo_root/.agents/skills"
failures=0
entrypoint_total=0
skill_count=0
description_total=0
root_bytes=0
max_scoped_bytes=0

fail() {
  echo "ERROR: $*" >&2
  failures=$((failures + 1))
}

file_bytes() {
  wc -c < "$1" | tr -d '[:space:]'
}

check_file_budget() {
  local candidate_file=$1
  local limit=$2
  local label=$3
  local measured

  if [[ ! -f "$candidate_file" ]]; then
    fail "$label is missing"
    return
  fi

  measured=$(file_bytes "$candidate_file")
  entrypoint_total=$((entrypoint_total + measured))
  if ((measured > limit)); then
    fail "$label exceeds $limit bytes ($measured)"
  fi
}

check_file_budget "$root_instructions" 7000 'AGENTS.md'
check_file_budget "$router" 7000 '.agents/README.md'

if [[ -f "$root_instructions" ]]; then
  root_bytes=$(file_bytes "$root_instructions")
  max_scoped_bytes=$root_bytes
fi

for scoped_area in backend frontend; do
  scoped_instructions="$repo_root/$scoped_area/AGENTS.md"
  [[ -f "$scoped_instructions" ]] || continue
  scoped_bytes=$(file_bytes "$scoped_instructions")
  if ((scoped_bytes > 8000)); then
    fail "$scoped_area/AGENTS.md exceeds 8000 bytes ($scoped_bytes)"
  fi
  scoped_bundle=$((root_bytes + scoped_bytes))
  if ((scoped_bundle > 15000)); then
    fail "root plus $scoped_area instructions exceed 15000 bytes ($scoped_bundle)"
  fi
  if ((scoped_bundle > max_scoped_bytes)); then
    max_scoped_bytes=$scoped_bundle
  fi
done

if [[ ! -d "$skills_dir" ]]; then
  fail '.agents/skills is missing'
else
  while IFS= read -r skill_file; do
    [[ -n "$skill_file" ]] || continue
    skill_count=$((skill_count + 1))
    check_file_budget "$skill_file" 12000 "$skill_file"

    description=$(sed -n '/^---$/,/^---$/s/^description:[[:space:]]*//p' "$skill_file" | head -n 1)
    if [[ -z "$description" ]]; then
      fail "$skill_file has no frontmatter description"
    elif ((${#description} > 360)); then
      fail "$skill_file description exceeds 360 characters (${#description})"
    fi
    description_total=$((description_total + ${#description}))

    while IFS=: read -r line_number key; do
      [[ -n "$key" ]] || continue
      fail "$skill_file:$line_number has unsupported frontmatter key '$key'"
    done < <(awk '
      NR == 1 && $0 == "---" { in_frontmatter = 1; next }
      in_frontmatter && $0 == "---" { exit }
      in_frontmatter && /^[A-Za-z0-9_-]+:/ {
        key = $0
        sub(/:.*/, "", key)
        if (key != "name" && key != "description") print NR ":" key
      }
    ' "$skill_file")
  done < <(rg --files "$skills_dir" -g 'SKILL.md' | sort)
fi

if ((entrypoint_total > 100000)); then
  fail "root, router, and skill entrypoints exceed 100000 bytes ($entrypoint_total)"
fi

if ((description_total > 5000)); then
  fail "skill catalog descriptions exceed 5000 characters ($description_total)"
fi

if [[ -d "$skills_dir" ]]; then
  while IFS= read -r reference_file; do
    [[ -n "$reference_file" ]] || continue
    measured=$(file_bytes "$reference_file")
    if ((measured > 18000)); then
      fail "$reference_file exceeds the 18000-byte selective-reference budget ($measured)"
    fi
  done < <(rg --files "$skills_dir" -g '**/references/*.md' | sort)

  if reread_matches=$(rg -n '(^|[[:space:]])[Rr]ead (the root )?`(AGENTS|backend/AGENTS|frontend/AGENTS)\.md`' "$skills_dir" "$router" 2>/dev/null); then
    fail 'agent routing rereads injected AGENTS instructions'
    echo "$reread_matches" >&2
  fi

  if removed_map_matches=$(rg -n -g '*.md' '\.agents/context/(code-map|app-areas)\.md' "$repo_root/.agents" "$root_instructions" 2>/dev/null); then
    fail 'agent guidance references removed context maps'
    echo "$removed_map_matches" >&2
  fi

  final_gate_mentions=$(
    (rg -o 'mage qc:prerelease' "$repo_root/.agents" -g '*.md' 2>/dev/null || true) |
      wc -l |
      tr -d '[:space:]'
  )
  if ((final_gate_mentions > 12)); then
    fail "workflow guidance repeats the root final gate more than 12 times ($final_gate_mentions)"
  fi
fi

if ((failures > 0)); then
  exit 1
fi

printf 'agent_context_budget_ok skills=%d root_bytes=%d max_scoped_bytes=%d catalog_description_chars=%d entrypoint_bytes=%d\n' \
  "$skill_count" "$root_bytes" "$max_scoped_bytes" "$description_total" "$entrypoint_total"
