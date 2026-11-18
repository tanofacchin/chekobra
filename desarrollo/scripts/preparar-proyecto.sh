#!/usr/bin/env bash
# Deja un proyecto de Supabase igual al de producción: migraciones, funciones y secretos.
# Pensado para el proyecto de pruebas ("operapto-pruebas"); sirve también para uno nuevo de producción.
#
#   SUPABASE_ACCESS_TOKEN=sbp_... scripts/preparar-proyecto.sh <ref-del-proyecto>
#
# - Aplica solo las migraciones que faltan (las anota en supabase_migrations.schema_migrations).
# - Las migraciones con tareas programadas (pg_cron) se saltean salvo que se pase CON_CRON=1:
#   en el proyecto de pruebas no hace falta que corran solas.
# - Despliega las funciones y crea PIN_PEPPER si no existe (el valor nunca se muestra).
set -euo pipefail
REF="${1:?Uso: scripts/preparar-proyecto.sh <ref-del-proyecto>}"
cd "$(dirname "$0")/.."
API="https://api.supabase.com/v1/projects/$REF"
AUTH=(); [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN")
sql() { jq -n --arg q "$1" '{query:$q}' | curl -fsS -X POST "$API/database/query" "${AUTH[@]}" -H 'Content-Type: application/json' -d @-; }

sql "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);" >/dev/null
hechas=$(sql "select coalesce(string_agg(version, ' '), '') v from supabase_migrations.schema_migrations" | jq -r '.[0].v')
for f in supabase/migrations/*.sql; do
  b=$(basename "$f" .sql); v=${b%%_*}; n=${b#*_}
  if [[ " $hechas " == *" $v "* ]]; then continue; fi
  if grep -q "cron.schedule" "$f" && [ "${CON_CRON:-0}" != 1 ]; then echo "salteada (pg_cron): $b"; continue; fi
  sql "begin;
$(cat "$f")
;
insert into supabase_migrations.schema_migrations (version, name) values ('$v', '$n');
commit;" >/dev/null
  echo "aplicada: $b"
done

for fn in ingresar operarios avisos johndeere; do
  [ -d "supabase/functions/$fn" ] || continue
  jwt=false; [ "$fn" = operarios ] && jwt=true   # el resto valida por su cuenta (cron, OAuth, PIN)
  args=(-F "metadata={\"entrypoint_path\":\"$fn/index.ts\",\"name\":\"$fn\",\"verify_jwt\":$jwt};type=application/json")
  args+=(-F "file=@supabase/functions/$fn/index.ts;filename=$fn/index.ts;type=application/typescript")
  for s in supabase/functions/_shared/*.js; do case "$s" in *.test.*) ;; *) args+=(-F "file=@$s;filename=_shared/$(basename "$s");type=application/javascript");; esac; done
  curl -fsS -X POST "$API/functions/deploy?slug=$fn" "${AUTH[@]}" "${args[@]}" >/dev/null && echo "función: $fn"
done

if ! curl -fsS "$API/secrets" "${AUTH[@]}" | jq -e '.[] | select(.name == "PIN_PEPPER")' >/dev/null; then
  jq -n --arg p "$(openssl rand -hex 32)" '[{name:"PIN_PEPPER",value:$p}]' | curl -fsS -X POST "$API/secrets" "${AUTH[@]}" -H 'Content-Type: application/json' -d @- >/dev/null
  echo "secreto PIN_PEPPER creado"
fi
echo "Proyecto $REF listo."
