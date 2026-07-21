#!/usr/bin/env bash
# BeepBite project status dashboard
# Usage: ./scripts/status.sh [--build]
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_BUILD=false
for arg in "$@"; do [[ "$arg" == "--build" ]] && RUN_BUILD=true; done

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'
BLUE='\033[0;34m'; MAGENTA='\033[0;35m'; WHITE='\033[1;37m'

pass() { printf "${GREEN}✅ PASS${RESET}"; }
fail() { printf "${RED}❌ FAIL${RESET}"; }
warn() { printf "${YELLOW}⚠  %s${RESET}" "$1"; }

sep() {
  printf "\n${CYAN}${BOLD}══════════════════════════════════════════════════════${RESET}\n"
  printf "${CYAN}${BOLD}  %s${RESET}\n" "$1"
  printf "${CYAN}══════════════════════════════════════════════════════${RESET}\n"
}

# ── load .env ─────────────────────────────────────────────────────────────────
if [[ -f "$REPO_ROOT/.env" ]]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' "$REPO_ROOT/.env" | grep -v '^$' | xargs) 2>/dev/null || true
fi
DATABASE_URL="${DATABASE_URL:-}"

# ════════════════════════════════════════════════════════════════════════
# 1. SCHEMA
# ════════════════════════════════════════════════════════════════════════
sep "1. Schema"

migration_files=("$REPO_ROOT"/backend/migrations/0*.sql)
migration_count=${#migration_files[@]}
latest_migration=""
if (( migration_count > 0 )); then
  latest_migration=$(basename "${migration_files[-1]}")
fi

printf "  Consolidated migrations : ${WHITE}%d${RESET}\n" "$migration_count"
printf "  Latest file             : ${WHITE}%s${RESET}\n" "$latest_migration"

if [[ -n "$DATABASE_URL" ]]; then
  applied=$(psql "$DATABASE_URL" -tA -c "SELECT COUNT(*) FROM schema_migrations;" 2>/dev/null || echo "unreachable")
  if [[ "$applied" == "unreachable" ]]; then
    printf "  Applied migrations      : $(warn 'DB unreachable')\n"
  else
    printf "  Applied migrations      : ${GREEN}%s rows${RESET}\n" "$applied"
  fi
else
  printf "  Applied migrations      : $(warn 'DATABASE_URL not set')\n"
fi

# ════════════════════════════════════════════════════════════════════════
# 2. BACKEND HEALTH
# ════════════════════════════════════════════════════════════════════════
sep "2. Backend Health"

cd "$REPO_ROOT/backend"

be_ok="✅"
printf "  go build ./...          : "
if go build ./... 2>/dev/null; then pass; else be_ok="❌"; fail; fi
printf "\n"

printf "  go vet ./...            : "
if go vet ./... 2>/dev/null; then pass; else fail; fi
printf "\n"

cd "$REPO_ROOT"
test_files=$(find backend -name '*_test.go' 2>/dev/null | wc -l)
test_funcs=$(grep -r 'func Test' backend --include='*_test.go' 2>/dev/null | wc -l)
printf "  Test files              : ${WHITE}%d${RESET}\n" "$test_files"
printf "  Test functions          : ${WHITE}%d${RESET}\n" "$test_funcs"

# ════════════════════════════════════════════════════════════════════════
# 3. FRONTEND HEALTH
# ════════════════════════════════════════════════════════════════════════
sep "3. Frontend Health"

routes_count=$(grep -c '<Route' "$REPO_ROOT/src/routes.jsx" 2>/dev/null || echo 0)
pages_count=$(find "$REPO_ROOT/src/pages" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l)
nm_exists="$REPO_ROOT/node_modules"

printf "  Routes in routes.jsx    : ${WHITE}%d${RESET}\n" "$routes_count"
printf "  Pages directories       : ${WHITE}%d${RESET}\n" "$pages_count"
if [[ -d "$nm_exists" ]]; then
  printf "  node_modules            : ${GREEN}present${RESET}\n"
else
  printf "  node_modules            : ${RED}missing (run npm install)${RESET}\n"
fi

if $RUN_BUILD; then
  printf "  npm run build           : "
  if (cd "$REPO_ROOT" && npm run build --silent 2>/dev/null); then pass; else fail; fi
  printf "\n"
else
  printf "  npm run build           : ${DIM}skipped (pass --build to run)${RESET}\n"
fi

# ════════════════════════════════════════════════════════════════════════
# 4. CODEBASE METRICS
# ════════════════════════════════════════════════════════════════════════
sep "4. Codebase Metrics"

go_loc=$(find "$REPO_ROOT/backend" -name '*.go' 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
jsx_loc=$(find "$REPO_ROOT/src" \( -name '*.jsx' -o -name '*.js' \) 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
handler_pkgs=$(ls "$REPO_ROOT/backend/internal/handlers/" 2>/dev/null | wc -l)
cmd_count=$(ls "$REPO_ROOT/backend/cmd/" 2>/dev/null | wc -l)

printf "  Go LOC (backend)        : ${WHITE}%s${RESET}\n" "${go_loc:-0}"
printf "  JSX/JS LOC (src)        : ${WHITE}%s${RESET}\n" "${jsx_loc:-0}"
printf "  Handler packages        : ${WHITE}%d${RESET}\n" "$handler_pkgs"
printf "  Migrations              : ${WHITE}%d${RESET}\n" "$migration_count"
printf "  cmd/ entrypoints        : ${WHITE}%d${RESET}\n" "$cmd_count"

# ════════════════════════════════════════════════════════════════════════
# 5. WAVE PROGRESS
# ════════════════════════════════════════════════════════════════════════
sep "5. Wave Progress"

PROGRESS_FILE="$REPO_ROOT/docs/internal/PROGRESS.md"
TASKS_FILE="$REPO_ROOT/docs/internal/tasks.md"

total_waves=0
if [[ -f "$TASKS_FILE" ]]; then
  total_waves=$(grep -c '^# Wave ' "$TASKS_FILE" 2>/dev/null || echo 0)
fi

done_count=0
inprog_count=0
notstarted_count=0

if [[ -f "$PROGRESS_FILE" ]]; then
  printf "  %-6s  %-55s  %s\n" "Wave" "Title" "Status"
  printf "  %s\n" "──────────────────────────────────────────────────────────────────────"

  # Parse all waves in a single pass, preserving order
  while IFS= read -r line; do
    if [[ "$line" =~ ^\-\ \[x\]\ \*\*Wave\ ([0-9]+)\*\*\ —\ (.+)$ ]]; then
      wnum="${BASH_REMATCH[1]}"
      wtitle="${BASH_REMATCH[2]}"
      printf "  ${GREEN}%-6s${RESET}  %-55s  ${GREEN}✅ Done${RESET}\n" "W$wnum" "${wtitle:0:55}"
      done_count=$(( done_count + 1 ))
    elif [[ "$line" =~ ^\-\ \[~\]\ \*\*Wave\ ([0-9]+)\*\*\ —\ (.+)$ ]]; then
      wnum="${BASH_REMATCH[1]}"
      wtitle="${BASH_REMATCH[2]}"
      printf "  ${YELLOW}%-6s${RESET}  %-55s  ${YELLOW}⏳ In Progress${RESET}\n" "W$wnum" "${wtitle:0:55}"
      inprog_count=$(( inprog_count + 1 ))
    elif [[ "$line" =~ ^\-\ \[\ \]\ \*\*Wave\ ([0-9]+)\*\*\ —\ (.+)$ ]]; then
      wnum="${BASH_REMATCH[1]}"
      wtitle="${BASH_REMATCH[2]}"
      printf "  ${DIM}%-6s  %-55s  ⬜ Not started${RESET}\n" "W$wnum" "${wtitle:0:55}"
      notstarted_count=$(( notstarted_count + 1 ))
    fi
  done < "$PROGRESS_FILE"

  printf "\n"
  printf "  ${BOLD}Summary: ${GREEN}%d done${RESET} · ${YELLOW}%d in-progress${RESET} · ${DIM}%d not started${RESET} · ${BOLD}%d total${RESET}\n" \
    "$done_count" "$inprog_count" "$notstarted_count" "$total_waves"
else
  warn "docs/internal/PROGRESS.md not found"
  printf "\n"
fi

# ════════════════════════════════════════════════════════════════════════
# 6. GIT
# ════════════════════════════════════════════════════════════════════════
sep "6. Git"

cd "$REPO_ROOT"
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
last_commit=$(git log -1 --format="%h %s" 2>/dev/null || echo "unknown")
uncommitted=$(git status --porcelain 2>/dev/null | wc -l)
ahead=$(git rev-list "@{u}..HEAD" --count 2>/dev/null || echo "?")

printf "  Branch                  : ${WHITE}%s${RESET}\n" "$branch"
printf "  Commits ahead of remote : ${WHITE}%s${RESET}\n" "$ahead"
printf "  Last commit             : ${WHITE}%s${RESET}\n" "$last_commit"
printf "  Uncommitted files       : "
if [[ "$uncommitted" -eq 0 ]]; then
  printf "${GREEN}%d (clean)${RESET}\n" "$uncommitted"
else
  printf "${YELLOW}%d${RESET}\n" "$uncommitted"
fi

# ════════════════════════════════════════════════════════════════════════
# HEADLINE SUMMARY
# ════════════════════════════════════════════════════════════════════════
printf "\n"
printf "${BOLD}${CYAN}══════════════════════════════════════════════════════${RESET}\n"

# Feature complete % = done / total * 100
pct=0
if [[ "$total_waves" -gt 0 ]]; then
  pct=$(( done_count * 100 / total_waves ))
fi

printf "${BOLD}  BeepBite — Wave %d/%d · backend %s · %d migrations · %d%% feature-complete${RESET}\n" \
  "$done_count" "$total_waves" "$be_ok" "$migration_count" "$pct"
printf "${BOLD}${CYAN}══════════════════════════════════════════════════════${RESET}\n\n"
