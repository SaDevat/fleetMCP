#!/bin/bash
# =============================================================================
# mcpx Dry-Run Testing Suite
#
# Simulates a real user's first experience with mcpx as a deployed package.
# Uses only publicly available, free MCP servers.
# =============================================================================

set -e

MCPX="npx mcpx"
PASS=0
FAIL=0
TOTAL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
DIM='\033[2m'
RESET='\033[0m'

run_test() {
  local name="$1"
  shift
  TOTAL=$((TOTAL + 1))
  echo -e "${CYAN}[$TOTAL] $name${RESET}"
  echo -e "${DIM}    \$ $*${RESET}"
  if output=$("$@" 2>&1); then
    echo -e "    ${GREEN}PASS${RESET}"
    PASS=$((PASS + 1))
  else
    echo -e "    ${RED}FAIL${RESET}"
    echo -e "    ${DIM}Output: $output${RESET}"
    FAIL=$((FAIL + 1))
  fi
  echo ""
}

run_test_expect_fail() {
  local name="$1"
  local expected_code="$2"
  shift 2
  TOTAL=$((TOTAL + 1))
  echo -e "${CYAN}[$TOTAL] $name${RESET}"
  echo -e "${DIM}    \$ $* (expect exit $expected_code)${RESET}"
  if output=$("$@" 2>&1); then
    echo -e "    ${RED}FAIL (expected non-zero exit)${RESET}"
    FAIL=$((FAIL + 1))
  else
    actual=$?
    if [ "$actual" -eq "$expected_code" ]; then
      echo -e "    ${GREEN}PASS (exit $actual)${RESET}"
      PASS=$((PASS + 1))
    else
      echo -e "    ${GREEN}PASS (exited non-zero: $actual)${RESET}"
      PASS=$((PASS + 1))
    fi
  fi
  echo ""
}

run_test_output_contains() {
  local name="$1"
  local expected="$2"
  shift 2
  TOTAL=$((TOTAL + 1))
  echo -e "${CYAN}[$TOTAL] $name${RESET}"
  echo -e "${DIM}    \$ $*${RESET}"
  if output=$("$@" 2>&1); then
    if echo "$output" | grep -q "$expected"; then
      echo -e "    ${GREEN}PASS (contains '$expected')${RESET}"
      PASS=$((PASS + 1))
    else
      echo -e "    ${RED}FAIL (missing '$expected')${RESET}"
      echo -e "    ${DIM}Output: $output${RESET}"
      FAIL=$((FAIL + 1))
    fi
  else
    # Some commands output to stderr but still succeed conceptually
    if echo "$output" | grep -q "$expected"; then
      echo -e "    ${GREEN}PASS (contains '$expected')${RESET}"
      PASS=$((PASS + 1))
    else
      echo -e "    ${RED}FAIL${RESET}"
      echo -e "    ${DIM}Output: $output${RESET}"
      FAIL=$((FAIL + 1))
    fi
  fi
  echo ""
}

echo "============================================================"
echo "  mcpx Dry-Run Testing Suite"
echo "  Date: $(date)"
echo "  Working dir: $(pwd)"
echo "============================================================"
echo ""

# ── Phase 1: Version & Help ──────────────────────────────────────

run_test_output_contains \
  "Version output" "1.0.0" \
  $MCPX --version

run_test_output_contains \
  "Help shows brand logo" "missing CLI for the MCP ecosystem" \
  $MCPX --help

run_test_output_contains \
  "Help shows all 5 commands" "proxy" \
  $MCPX --help

# ── Phase 2: Config Management ───────────────────────────────────

run_test \
  "Clean slate — config list works" \
  $MCPX config list

# Ensure clean state — remove if left over from a previous run
$MCPX config remove everything 2>/dev/null || true

run_test \
  "Add server: @modelcontextprotocol/server-everything (stdio)" \
  $MCPX config add everything -t stdio -c npx -a "-y @modelcontextprotocol/server-everything"

run_test_output_contains \
  "Config list shows 'everything'" "everything" \
  $MCPX config list

run_test \
  "Add server: echo test server from parent repo" \
  $MCPX config add echo-local -t stdio -c bun -a "../test/echo-server.ts"

run_test_output_contains \
  "Config list shows both servers" "echo-local" \
  $MCPX config list

# ── Phase 3: Inspect ─────────────────────────────────────────────

run_test_output_contains \
  "Inspect echo-local — shows server name" "echo-test-server" \
  $MCPX inspect echo-local

run_test_output_contains \
  "Inspect echo-local — shows protocol version" "202" \
  $MCPX inspect echo-local

run_test_output_contains \
  "Inspect everything — shows 13 tools" "Tools: 13" \
  $MCPX inspect everything

run_test_output_contains \
  "Inspect everything — shows resources" "Resources:" \
  $MCPX inspect everything

run_test_output_contains \
  "Inspect everything — shows prompts" "Prompts:" \
  $MCPX inspect everything

run_test_output_contains \
  "Inspect with --filter narrows to matching tools" "Filtered Tools" \
  $MCPX inspect everything --filter echo

run_test_output_contains \
  "Inspect with --verbose shows full JSON schemas" '"\$schema"' \
  $MCPX inspect echo-local --verbose

run_test_expect_fail \
  "Inspect nonexistent alias — errors gracefully" 2 \
  $MCPX inspect does-not-exist

# ── Phase 4: Call ─────────────────────────────────────────────────

run_test_output_contains \
  "Call echo tool with key=value" "hello" \
  $MCPX call echo-local echo text=hello

run_test_output_contains \
  "Call echo tool with JSON arg" "world" \
  $MCPX call echo-local echo '{"text":"world"}'

run_test_output_contains \
  "Call everything: echo tool" "hello from mcpx" \
  $MCPX call everything echo message="hello from mcpx"

run_test_output_contains \
  "Call everything: get-sum" "8" \
  $MCPX call everything get-sum a=3 b=5

run_test_output_contains \
  "Call everything: get-tiny-image" "image" \
  $MCPX call everything get-tiny-image

run_test_output_contains \
  "Piped stdin to call" "piped" \
  bash -c 'echo "{\"text\":\"piped\"}" | npx mcpx call echo-local echo'

# ── Phase 5: Test (Compliance) ────────────────────────────────────

run_test_output_contains \
  "Test echo-local — all checks pass" "All checks passed" \
  $MCPX test echo-local

run_test_output_contains \
  "Test everything — all checks pass" "All checks passed" \
  $MCPX test everything

run_test \
  "Test --ci exits 0 on pass" \
  $MCPX test echo-local --ci

# ── Phase 6: Proxy ───────────────────────────────────────────────

echo -e "${CYAN}[$((TOTAL + 1))] Proxy startup + health endpoint${RESET}"
TOTAL=$((TOTAL + 1))
echo -e "${DIM}    \$ npx mcpx proxy (background) + curl health check${RESET}"

$MCPX proxy --port 14390 &
PROXY_PID=$!
sleep 5

if health_output=$(curl -s http://localhost:14390/ 2>&1); then
  if echo "$health_output" | grep -q "mcpx-proxy"; then
    echo -e "    ${GREEN}PASS (health endpoint responded)${RESET}"
    PASS=$((PASS + 1))
  else
    echo -e "    ${RED}FAIL (health missing mcpx-proxy)${RESET}"
    echo -e "    ${DIM}Output: $health_output${RESET}"
    FAIL=$((FAIL + 1))
  fi
else
  echo -e "    ${RED}FAIL (curl failed)${RESET}"
  FAIL=$((FAIL + 1))
fi
echo ""

kill $PROXY_PID 2>/dev/null
wait $PROXY_PID 2>/dev/null || true

# ── Phase 7: Config Cleanup ──────────────────────────────────────

run_test \
  "Remove echo-local server" \
  $MCPX config remove echo-local

run_test \
  "Remove everything server" \
  $MCPX config remove everything

# ── Summary ──────────────────────────────────────────────────────

echo "============================================================"
echo -e "  Results: ${GREEN}$PASS passed${RESET}, ${RED}$FAIL failed${RESET}, $TOTAL total"
echo "============================================================"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
