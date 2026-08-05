#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
checker="$script_dir/check-context-budget.sh"
fixture_root=$(mktemp -d)
trap 'rm -rf "$fixture_root"' EXIT

mkdir -p "$fixture_root/.agents/skills/example"
printf '# Root\n' > "$fixture_root/AGENTS.md"
printf '# Router\n' > "$fixture_root/.agents/README.md"
printf '%s\n' \
  '---' \
  'name: example' \
  'description: Example skill used by the context-budget fixture' \
  '---' \
  '' \
  '# Example' > "$fixture_root/.agents/skills/example/SKILL.md"

bash "$checker" --root "$fixture_root" >/dev/null

awk 'BEGIN { for (i = 0; i < 7101; i++) printf "x" }' > "$fixture_root/AGENTS.md"
if bash "$checker" --root "$fixture_root" >"$fixture_root/output" 2>&1; then
  echo 'expected oversized AGENTS.md to fail' >&2
  exit 1
fi
rg -q 'AGENTS.md exceeds 7000 bytes' "$fixture_root/output"

printf '# Root\n' > "$fixture_root/AGENTS.md"
printf '\nRead `AGENTS.md` before starting.\n' >> "$fixture_root/.agents/skills/example/SKILL.md"
if bash "$checker" --root "$fixture_root" >"$fixture_root/output" 2>&1; then
  echo 'expected injected-instruction reread to fail' >&2
  exit 1
fi
rg -q 'rereads injected AGENTS instructions' "$fixture_root/output"

sed -i.bak '/Read `AGENTS.md`/d' "$fixture_root/.agents/skills/example/SKILL.md"
printf '\nUse `.agents/context/code-map.md`.\n' >> "$fixture_root/.agents/skills/example/SKILL.md"
if bash "$checker" --root "$fixture_root" >"$fixture_root/output" 2>&1; then
  echo 'expected removed context-map reference to fail' >&2
  exit 1
fi
rg -q 'references removed context maps' "$fixture_root/output"

sed -i.bak '/code-map.md/d' "$fixture_root/.agents/skills/example/SKILL.md"
mkdir -p "$fixture_root/.agents/skills/example/references"
awk 'BEGIN { for (i = 0; i < 18001; i++) printf "x" }' > \
  "$fixture_root/.agents/skills/example/references/oversized.md"
if bash "$checker" --root "$fixture_root" >"$fixture_root/output" 2>&1; then
  echo 'expected oversized selective reference to fail' >&2
  exit 1
fi
rg -q 'selective-reference budget' "$fixture_root/output"

printf '# Reference\n' > "$fixture_root/.agents/skills/example/references/oversized.md"
mkdir -p "$fixture_root/backend"
awk 'BEGIN { for (i = 0; i < 8001; i++) printf "x" }' > \
  "$fixture_root/backend/AGENTS.md"
if bash "$checker" --root "$fixture_root" >"$fixture_root/output" 2>&1; then
  echo 'expected oversized scoped AGENTS.md to fail' >&2
  exit 1
fi
rg -q 'backend/AGENTS.md exceeds 8000 bytes' "$fixture_root/output"

echo 'check-context-budget tests passed'
