#!/usr/bin/env bash
# Apply (or reset) all SQL migrations against the project database.
#
# Wraps backend/cmd/migrate, which tracks applied migrations in the
# schema_migrations table — running this repeatedly is safe; only pending
# migrations get applied.
#
# Usage:
#   scripts/migrate.sh                 # apply pending migrations against local
#   scripts/migrate.sh up              # same
#   scripts/migrate.sh up dev          # apply against the 'dev' env
#   scripts/migrate.sh reset           # DROP public schema + re-apply (DESTRUCTIVE)
#   scripts/migrate.sh down            # DROP public schema only (DESTRUCTIVE)
#   scripts/migrate.sh status          # print which migrations are applied
#
# Env is resolved by backend/internal/config (reads .env / DATABASE_URL).

set -euo pipefail

ACTION="${1:-up}"
ENV_NAME="${2:-local}"

# Resolve repo root from the script's own location so the script works from
# any cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"

if [[ ! -d "$BACKEND_DIR/cmd/migrate" ]]; then
  echo "error: $BACKEND_DIR/cmd/migrate not found — is the script in the right repo?" >&2
  exit 1
fi

cd "$BACKEND_DIR"

color_red()   { printf '\033[31m%s\033[0m\n' "$*"; }
color_green() { printf '\033[32m%s\033[0m\n' "$*"; }
color_blue()  { printf '\033[34m%s\033[0m\n' "$*"; }

confirm_destructive() {
  color_red "About to run a DESTRUCTIVE operation: $1"
  color_red "Environment: $ENV_NAME"
  echo
  read -r -p "Type the env name ('$ENV_NAME') to confirm: " typed
  if [[ "$typed" != "$ENV_NAME" ]]; then
    color_red "Confirmation failed — aborting."
    exit 1
  fi
}

case "$ACTION" in
  up)
    color_blue "Applying pending migrations against env=$ENV_NAME"
    go run ./cmd/migrate --env="$ENV_NAME" --up
    color_green "✓ Migrations applied"
    ;;

  reset)
    confirm_destructive "DROP public schema + re-apply ALL migrations"
    color_blue "Resetting env=$ENV_NAME"
    go run ./cmd/migrate --env="$ENV_NAME" --reset
    color_green "✓ Schema reset and re-applied"
    ;;

  down)
    confirm_destructive "DROP public schema (no re-apply)"
    color_blue "Dropping schema for env=$ENV_NAME"
    go run ./cmd/migrate --env="$ENV_NAME" --down
    color_green "✓ Schema dropped (database is now empty)"
    ;;

  status)
    # No flag for this in cmd/migrate yet, so query directly.
    if [[ -z "${DATABASE_URL:-}" ]] && [[ -f "$REPO_ROOT/.env" ]]; then
      # shellcheck disable=SC1091
      set -a; . "$REPO_ROOT/.env"; set +a
    fi
    if [[ -z "${DATABASE_URL:-}" ]]; then
      color_red "DATABASE_URL not set; cannot check status"
      exit 1
    fi
    color_blue "Applied migrations on env=$ENV_NAME:"
    psql "$DATABASE_URL" -c "SELECT version FROM schema_migrations ORDER BY version" \
      || color_red "Could not query schema_migrations — has the database been initialised?"
    ;;

  -h|--help|help)
    sed -n '2,18p' "$0"
    ;;

  *)
    color_red "Unknown action: $ACTION"
    echo "Run '$0 help' for usage."
    exit 2
    ;;
esac
