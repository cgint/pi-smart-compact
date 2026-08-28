#!/usr/bin/env bash
# parcour.sh — run one fixture under both turn-reduce arms and collect everything
# needed to inspect what the reduction actually did.
#
# Historical P01 harness from EVALUATION.md §3a. It produced inspection artifacts, not
# benefit evidence (there is no verifier/outcome check). The current unwired prototype means
# this script cannot reproduce an ON run unless a future implementation restores the hook.
#
# Usage:
#   eval/parcour.sh <campaign-id> [fixture] [repetition]
#
# Artifacts land in /tmp/parcour-<run_id>/ and are never deleted by this script.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CAMPAIGN="${1:?usage: eval/parcour.sh <campaign-id> [fixture] [repetition]}"
FIXTURE="${2:-codebase-inventory}"
REP="${3:-1}"

FIXTURE_DIR="$REPO_ROOT/eval/fixtures/$FIXTURE"
[ -f "$FIXTURE_DIR/prompt.md" ] || { echo "no prompt.md in $FIXTURE_DIR" >&2; exit 1; }

# Pinned for both arms. Changing any of these invalidates comparison across runs,
# which is why they are recorded into every manifest.
PROVIDER="google"
MODEL="gemini-3.6-flash"
THINKING="off"
TOOLS="read,bash,grep,find,ls"
EXTENSION="$REPO_ROOT/index.ts"

run_arm() {
  local arm="$1"
  local run_id="${CAMPAIGN}-${arm}-r${REP}-${FIXTURE}"
  local root="/tmp/parcour-${run_id}"
  local ws="$root/workspace"

  if [ -e "$root" ]; then
    echo "run root already exists, refusing to overwrite: $root" >&2
    exit 1
  fi

  mkdir -p "$ws" "$root/sessions"

  # Fixture material: the repo's own readable content, without build output or VCS.
  for d in src test docs findings concepts prompts openspec; do
    [ -d "$REPO_ROOT/$d" ] && cp -R "$REPO_ROOT/$d" "$ws/"
  done
  cp "$REPO_ROOT"/*.md "$ws/" 2>/dev/null || true

  local argv=(
    pi -p
    -ne -e "$EXTENSION"
    -nc -ns -np
    --tools "$TOOLS"
    --provider "$PROVIDER"
    --model "$MODEL"
    --thinking "$THINKING"
    --session-dir "$root/sessions"
    --name "$run_id"
    --approve
  )

  # The only difference between arms.
  local -a arm_env=()
  if [ "$arm" = "on" ]; then
    arm_env=(PI_TURN_REDUCE_ENABLED=true PI_TURN_REDUCE_AFTER_N=1)
  fi
  # Compaction is held OFF in both arms so turn-reduce is the only variable.

  python3 - "$root/manifest.json" "$run_id" "$arm" "$REP" "$FIXTURE" "$ws" \
    "${arm_env[*]:-}" "${argv[@]}" <<'PY'
import json, sys
out, run_id, arm, rep, fixture, ws, arm_env, *argv = sys.argv[1:]
json.dump({
    "schema_version": "turn-reduce-parcour-v1",
    "run_id": run_id, "arm": arm, "repetition": int(rep),
    "fixture_id": fixture, "workspace": ws,
    "arm_env": arm_env.split() if arm_env else [],
    "held_off": ["PI_SMART_COMPACT_ENABLED"],
    "argv": argv,
}, open(out, "w"), indent=2)
PY

  echo "→ $run_id"
  local started
  started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  (
    cd "$ws"
    if [ "${#arm_env[@]}" -gt 0 ]; then export "${arm_env[@]}"; fi
    "${argv[@]}" "$(cat "$FIXTURE_DIR/prompt.md")"
  ) >"$root/final-answer.txt" 2>"$root/stderr.log" || echo "  (non-zero exit — see stderr.log)"

  # The audit dir is written relative to pi's cwd, i.e. into the workspace.
  [ -d "$ws/.pi/turn-reduce" ] && cp -R "$ws/.pi/turn-reduce" "$root/turn-reduce-audit"

  python3 - "$root/manifest.json" "$started" <<'PY'
import json, sys, datetime
p, started = sys.argv[1], sys.argv[2]
m = json.load(open(p)); m["started_at"] = started
m["finished_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
json.dump(m, open(p, "w"), indent=2)
PY

  echo "  artifacts: $root"
}

run_arm off
run_arm on

echo
echo "Inspect with: eval/inspect.py $CAMPAIGN"
