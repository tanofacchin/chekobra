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
