#!/usr/bin/env bash
# Start all five agents in the background. Each agent:
#   - Runs under its own ``uv run``, inheriting examples/.env
#   - Binds to the port baked into its Python file
#   - Logs to logs/<agent>.log
#   - Writes its pid to pids/<agent>.pid
#
# On first boot with AUTH__ENABLED=true, bindufy auto-registers each
# agent's DID with Hydra and caches creds under the agent's working
# directory (~/.bindu by default).
#
# Safe to re-run: if an agent's pid file points at a live process,
# we skip it.

set -euo pipefail

FLEET_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${FLEET_DIR}/../.." && pwd)"
LOG_DIR="${FLEET_DIR}/logs"
PID_DIR="${FLEET_DIR}/pids"

mkdir -p "${LOG_DIR}" "${PID_DIR}"

AGENTS=(
  "joke_agent:3773"
  "math_agent:3775"
  "poet_agent:3776"
  "research_agent:3777"
  "faq_agent:3778"
)

start_one() {
  local name="$1" port="$2"
  local pidfile="${PID_DIR}/${name}.pid"
  local logfile="${LOG_DIR}/${name}.log"

  if [[ -f "${pidfile}" ]]; then
    local old_pid
    old_pid="$(cat "${pidfile}")"
    if ps -p "${old_pid}" >/dev/null 2>&1; then
      echo "  [${name}] already running (pid=${old_pid}) — skip"
      return
    fi
    rm -f "${pidfile}"
  fi

  # Quick port check
  if lsof -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  [${name}] port ${port} already bound — refusing to start"
    echo "           (lsof -iTCP:${port} to see what's there)"
    return 1
  fi

  # BINDU_PORT overrides the port baked into the config. Gives the
  # operator an escape hatch if the defaults collide with something
  # else on their box.
  echo "  [${name}] starting on port ${port}..."
  (
    cd "${ROOT_DIR}"
    BINDU_PORT="${port}" nohup uv run python \
      "examples/gateway_test_fleet/${name}.py" \
      > "${logfile}" 2>&1 &
    echo $! > "${pidfile}"
  )
  sleep 1
  if ! ps -p "$(cat "${pidfile}")" >/dev/null 2>&1; then
    echo "  [${name}] FAILED to start — last lines of log:"
    tail -n 20 "${logfile}" | sed 's/^/    /'
    return 1
  fi
  echo "  [${name}] started, pid=$(cat "${pidfile}"), log=${logfile}"
}

echo "Starting gateway_test_fleet (5 agents)..."
for entry in "${AGENTS[@]}"; do
  name="${entry%:*}"
  port="${entry#*:}"
  start_one "${name}" "${port}" || true
done

# Poll each agent's /health for up to ~5s and read its DID. We do this
# in the script (rather than forcing the operator to run a second
# command) because pinning peer DIDs in /plan requests is the #1 way
# to get `agent_did` populated in the gateway's SSE stream. Printing
# ready-to-paste shell exports keeps the common workflow one-step.
print_dids() {
  local timeout_ms=5000
  local label
  declare -a rows=()

  for entry in "${AGENTS[@]}"; do
    local name="${entry%:*}"
    local port="${entry#*:}"
    local did=""
    local waited=0
    while (( waited < timeout_ms )); do
      did="$(curl -sS --max-time 1 "http://localhost:${port}/health" 2>/dev/null \
        | python3 -c 'import sys,json
try:
    print(json.load(sys.stdin)["application"]["agent_did"])
except Exception:
    pass' 2>/dev/null)"
      if [[ -n "${did}" ]]; then break; fi
      sleep 0.25
      waited=$(( waited + 250 ))
    done
    if [[ -z "${did}" ]]; then did="(not ready — re-run or check logs/${name}.log)"; fi
    rows+=("${name}|${port}|${did}")
  done

  echo
  echo "Agent DIDs:"
  for row in "${rows[@]}"; do
    local n p d
    IFS='|' read -r n p d <<< "${row}"
    printf "  %-16s :%s  %s\n" "${n}" "${p}" "${d}"
  done

  echo
  echo "Shell exports (paste to pin peer DIDs in /plan requests):"
  for row in "${rows[@]}"; do
    local n p d
    IFS='|' read -r n p d <<< "${row}"
    if [[ "${d}" == did:* ]]; then
      # Strip "_agent" suffix so variable names match the conventional
      # /plan catalog name (e.g. JOKE_DID, not JOKE_AGENT_DID).
      local var
      var="$(echo "${n%_agent}" | tr '[:lower:]' '[:upper:]')_DID"
      printf '  export %s="%s"\n' "${var}" "${d}"
    fi
  done
}

print_dids

echo
echo "Fleet started. Tail logs with:"
echo "  tail -f ${LOG_DIR}/*.log"
echo "Stop with:"
echo "  ${FLEET_DIR}/stop_fleet.sh"
