# Operaciones

## Infraestructura

| Pieza | Dónde | Notas |
|---|---|---|
| Base de datos, usuarios, fotos | Supabase, proyecto `checkobra`, São Paulo | Migraciones en `desarrollo/supabase/migrations` |
| Funciones del servidor | Supabase Edge Functions: `operarios`, `johndeere` | Código en `desarrollo/supabase/functions` |
| Actualización de telemetría | pg_cron, cada hora (minuto 17) | Clave en Vault (`cron_secret`) |
| App | GitHub Pages: https://tanofacchin.github.io/chekobra/ | Se publica sola al subir cambios a `desarrollo/app/` |

## Publicar cambios

- **App**: subir a `main` → GitHub Actions la publica. Al cambiar archivos de la app, subir `VERSION` en `desarrollo/app/sw.js` para que los celulares la actualicen.
- **Base de datos**: nueva migración en `desarrollo/supabase/migrations/`, probar con `npm test` en `desarrollo/`, aplicar en Supabase.
- **Funciones**: desplegar con la CLI de Supabase o la API de administración.

## Publicar la versión del piloto (consentimiento, PIN, QR, plantillas, avisos)

El orden importa: la app nueva entra por la función `ingresar` y exige el consentimiento.
1. Probar todo en el proyecto `checkobra-pruebas`.
2. En producción, cargar el secreto `PIN_PEPPER` (64 caracteres al azar, guardarlo también en el gestor de contraseñas:
   si se pierde, todos los operarios tienen que recibir un PIN nuevo).
3. Aplicar las migraciones 8 y 9.
4. Desplegar las funciones `ingresar`, `operarios` y `avisos`.
5. Subir la app (sube `VERSION` del service worker a `checkobra-v3`).
6. Los operarios creados antes de este cambio necesitan un PIN nuevo (Personal → Cambiar PIN).

Avisos por correo: crear cuenta en Resend, verificar el dominio propio y cargar `RESEND_API_KEY` y
`AVISOS_REMITENTE` (ej.: `CheckObra <avisos@dominio>`) en los secretos de funciones. Sin eso, los avisos quedan
pendientes y se ven en el panel.

## Respaldos

- Plan gratuito de Supabase: **sin respaldos automáticos descargables**. Antes de tener clientes pagos: pasar a plan Pro
  (respaldos diarios) o programar una copia propia periódica.
- El código y la estructura de la base están en este repositorio.

## Costos (a completar)

| Servicio | Plan | Costo mensual |
|---|---|---|
| Supabase | Gratuito (luego Pro) | US$ 0 (Pro: ~US$ 25) |
| GitHub | Gratuito (Pro si se usa Pages con repositorio privado) | US$ 0 (Pro: ~US$ 4) |
| Dominio | — | — |

## Límites del plan gratuito a vigilar

- Supabase pausa los proyectos gratuitos sin actividad durante una semana.
- Correos de cuenta: pocos por hora con el servidor de Supabase; configurar SMTP propio.
