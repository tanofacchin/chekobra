// Genera la migración con la versión 2 de las plantillas base: node plantillas/generar-v2.mjs
import { writeFileSync } from 'node:fs';
import { PLANTILLAS_V2 } from './v2.mjs';

const lit = s => "'" + String(s).replace(/'/g, "''") + "'";
const filas = PLANTILLAS_V2.map(t => {
  const ids = t.secciones.flatMap(s => s.items.map(i => i.id));
  if (new Set(ids).size !== ids.length) throw new Error(`IDs repetidos en ${t.clave}`);
  return `  (null, ${lit(t.clave)}, ${lit(t.nombre)}, ${lit(t.rubro)}, ${lit(t.medidor)}, 2, ${lit(JSON.stringify(t.secciones))}::jsonb)`;
});
const sql = `-- Generado por plantillas/generar-v2.mjs: no editar a mano.
insert into public.plantillas (empresa_id, clave, nombre, rubro, medidor, version, secciones) values
${filas.join(',\n')}
on conflict (empresa_id, clave, version) do nothing;
`;
const out = new URL('../supabase/migrations/20261113000013_plantillas_v2.sql', import.meta.url);
writeFileSync(out, sql);
for (const t of PLANTILLAS_V2) {
  const it = t.secciones.flatMap(s => s.items);
  console.log(`${t.clave.padEnd(16)} ${it.length} puntos · ${it.filter(i => i.critico).length} críticos · ${it.filter(i => i.alerta).length} advertencias · ${it.filter(i => i.foto).length} fotos · ${it.filter(i => i.frecuencia).length} semanales · ${t.secciones.map(s => s.clave).join(' > ')}`);
}
