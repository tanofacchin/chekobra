# Decisiones técnicas

| Fecha | Decisión | Por qué |
|---|---|---|
| 2026-11-10 | Supabase (Postgres) como base | Base, usuarios, fotos y funciones en un solo servicio; reglas de seguridad por empresa en la propia base |
| 2026-11-10 | Servidores en São Paulo (sa-east-1) | Menor demora para usuarios en Argentina, importante con señal débil |
| 2026-11-10 | Producto multiempresa desde el inicio | Se vende a varias empresas; agregarlo después obliga a rehacer la base |
| 2026-11-10 | El resultado del checklist se calcula en el servidor | Que no se pueda falsear un "apto" desde el teléfono |
| 2026-11-10 | Operarios entran con empresa + legajo + PIN | Muchos operarios no tienen correo |
| 2026-11-10 | App web instalable (PWA), sin tiendas | Se actualiza sola, funciona en Android y iPhone, sin aprobación de tiendas |
| 2026-11-10 | Bandeja de salida en el teléfono | Las obras y campos tienen poca señal; nada se pierde ni se duplica |
| 2026-11-10 | Telemetría por el estándar ISO 15143-3 | Una integración sirve para varias marcas |
| 2026-11-10 | Plantillas versionadas con ids de ítem fijos | Las jornadas viejas siguen mostrándose bien aunque cambie la plantilla |
