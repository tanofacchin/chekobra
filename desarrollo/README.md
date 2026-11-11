# CheckObra — desarrollo

Todos los comandos de esta guía se corren desde la carpeta `desarrollo/`.

Checklist pre-operacional de maquinaria y vehículos para constructoras, mineras y empresas agropecuarias.
El operario inicia la jornada con ubicación, foto con el equipo, checklist y firma. Si falla un punto crítico,
el equipo queda bloqueado hasta que un supervisor lo libera. La empresa ve todo en un panel y exporta a Excel.

Producto multiempresa: cada cliente (empresa) tiene sus equipos, personal, obras y plantillas, y no ve los datos de los demás.

## Estado

| Parte | Estado |
|---|---|
| Prototipo funcional (operario + administración) | `prototipo/index.html` — también publicado en claude.ai |
| Base de datos multiempresa (Supabase / Postgres) | `supabase/migrations` — aplicada en el proyecto `checkobra` de Supabase |
| Plantillas base (13: construcción, vial, transporte y agro) | `plantillas/base.mjs` |
| App instalable (PWA) conectada a Supabase | `app/` — publicada en GitHub Pages; ingreso de operarios con empresa + legajo + PIN |
| Integración JDLink / ISO 15143-3 | `supabase/functions/johndeere` — lista; falta habilitar las credenciales de John Deere |
| Editor de plantillas, avisos por WhatsApp/mail, QR por equipo | pendiente |

## Cómo está armada la base de datos

- **empresas / miembros**: cada usuario pertenece a una o más empresas con un rol: `dueno`, `admin`, `supervisor` u `operario`.
- **equipos, obras, plantillas**: por empresa. Las plantillas sin empresa son las base del producto; una empresa puede
  tener su propia versión con la misma clave y se usa esa.
- **jornadas, fallas, eventos_equipo**: el registro de cada checklist, cada falla y cada bloqueo/liberación (auditoría).
- **telemetria_***: conexiones con John Deere (y otros), lecturas de horas/ubicación/combustible. Los tokens OAuth
  están en una tabla que la app no puede leer.
- **Almacenamiento**: bucket privado `evidencias`, rutas `<empresa_id>/<usuario>/<archivo>`.

Reglas de seguridad (Row Level Security):

- Nadie ve datos de otra empresa.
- El operario ve solo sus propias jornadas; supervisores y administradores ven todas las de su empresa.
- El operario no escribe tablas: usa funciones del servidor (`enviar_checklist`, `cerrar_jornada`) que validan todo
  y **calculan el resultado del checklist en el servidor** (no se confía en lo que manda el teléfono).
- El estado de un equipo (bloqueado / operativo / fuera de servicio) solo cambia por `liberar_equipo` y
  `cambiar_servicio`, que dejan registro de quién y por qué.
- Un reenvío del mismo checklist (sin señal) no se duplica: cada envío lleva un `client_id` generado en el teléfono.

## Pruebas

Necesita PostgreSQL 15 o superior instalado:

```bash
supabase/tests/correr.sh
```

Levanta un Postgres temporal, aplica las migraciones y verifica permisos entre empresas y roles, bloqueo y liberación
de equipos, validaciones del checklist, cierre de jornada, fotos y tokens.

## Plantillas

Se editan en `plantillas/base.mjs`. Después:

```bash
node plantillas/generar-sql.mjs
```

Los ids de ítems (`doc.1`, `cabina.3`…) no se reusan con otro significado: las jornadas guardan respuestas por id.
Para cambiar una plantilla ya usada, se crea una versión nueva.

## Puesta en marcha en Supabase

1. Crear el proyecto en supabase.com (a nombre del producto, no de un cliente).
2. `supabase link --project-ref <ref>` y `supabase db push` para aplicar las migraciones
   (no aplicar `supabase/tests/stub_supabase.sql`: es solo para pruebas locales).

## App (`app/`)

Archivos estáticos, sin paso de compilación: se publican tal cual (GitHub Pages, Cloudflare Pages, etc.).

- `js/config.js`: dirección y clave pública (anon) del proyecto Supabase.
- `js/cola.js`: bandeja de salida en el teléfono (IndexedDB). Lo que carga el operario sin señal se envía solo después.
- `sw.js`: guarda la app en el teléfono para que abra sin conexión. Al cambiar archivos, subir `VERSION`.
- Operarios: el administrador los da de alta con legajo y PIN de 6 dígitos (función `supabase/functions/operarios`);
  entran con código de empresa + legajo + PIN.
- Dueños y supervisores: correo y contraseña.

Para probar en local: `cd app && python3 -m http.server 8080` y abrir http://localhost:8080.

## Decisiones pendientes
- **Telemetría**: registrar la app en developer.deere.com a nombre del producto y pedir acceso a la API ISO 15143-3.
  Cada cliente autoriza su cuenta JDLink con OAuth.

## John Deere (JDLink)

Función `johndeere` (API ISO 15143-3). Cada empresa conecta su cuenta desde **Equipos → Conectar John Deere**;
las máquinas se vinculan por N.º de serie / PIN. Se actualiza sola cada hora (pg_cron) y con **Actualizar ahora**.

Con los datos de la máquina, el panel avisa:
- **Horómetro distinto**: el operario cargó un valor que difiere en más de 2 h del que informó la máquina.
- **Checklist lejos de la máquina**: a más de 500 m de donde estaba el equipo.
- **Máquina usada sin checklist**: sumó horas de motor en un día sin ningún checklist.

Para habilitarla (una sola vez, a nombre del producto):
1. Registrar la aplicación en developer.deere.com y pedir acceso a la API ISO 15143-3.
2. Redirect URI: `https://xcnbmxppqbuglwcmiyuo.supabase.co/functions/v1/johndeere/callback`
3. Cargar en Supabase (Edge Functions → Secrets): `JD_CLIENT_ID`, `JD_CLIENT_SECRET`.
   Con acceso de producción, además `JD_API_BASE` con la URL que indique John Deere (por defecto se usa el sandbox).

Pruebas: `npm install && npm test` (lector ISO 15143-3 + base de datos).
