// Genera la migración con las plantillas base: node plantillas/generar-sql.mjs
import { writeFileSync } from 'node:fs';
import { PLANTILLAS, normalizar } from './base.mjs';

const lit = s => "'" + String(s).replace(/'/g, "''") + "'";
const filas = PLANTILLAS.map(normalizar).map(t => {
  const ids = t.secciones.flatMap(s => s.items.map(i => i.id));
  if (new Set(ids).size !== ids.length) throw new Error(`IDs repetidos en ${t.clave}`);
  return `  (null, ${lit(t.clave)}, ${lit(t.nombre)}, ${lit(t.rubro)}, ${lit(t.medidor)}, 1, ${lit(JSON.stringify(t.secciones))}::jsonb)`;
});

const sql = `-- Generado por plantillas/generar-sql.mjs: no editar a mano.
insert into public.plantillas (empresa_id, clave, nombre, rubro, medidor, version, secciones) values
${filas.join(',\n')}
on conflict (empresa_id, clave, version) do nothing;
`;
const out = new URL('../supabase/migrations/20261110000003_plantillas_base.sql', import.meta.url);
writeFileSync(out, sql);
console.log(`${filas.length} plantillas → ${out.pathname}`);
