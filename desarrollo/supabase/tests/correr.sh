#!/usr/bin/env bash
# Levanta un Postgres temporal, aplica las migraciones y corre las pruebas.
# Uso: supabase/tests/correr.sh   (requiere PostgreSQL 15+ instalado)
set -euo pipefail
cd "$(dirname "$0")/../.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DIR="$(mktemp -d)"
PORT="${PORT:-54399}"
USER_PG="$(id -un)"
RUN=()
if [ "$USER_PG" = "root" ]; then
  id postgres >/dev/null 2>&1 || useradd -r postgres
  chown postgres "$DIR"
  RUN=(su postgres -c)
  USER_PG=postgres
fi
run() { if [ ${#RUN[@]} -gt 0 ]; then "${RUN[@]}" "$*"; else bash -c "$*"; fi; }
run "$PGBIN/initdb -D $DIR/data -U $USER_PG -A trust >/dev/null"
run "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log start >/dev/null"
trap 'run "$PGBIN/pg_ctl -D $DIR/data stop -m fast >/dev/null"; rm -rf "$DIR"' EXIT
PSQL=(psql -h "$DIR" -p "$PORT" -U "$USER_PG" -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f supabase/tests/stub_supabase.sql
for f in supabase/migrations/*.sql; do
  if grep -q "pg_cron" "$f"; then echo "migración: $f (se saltea: requiere pg_cron de Supabase)"; continue; fi
  echo "migración: $f"; "${PSQL[@]}" -f "$f"
done
"${PSQL[@]}" -f supabase/tests/pruebas.sql
