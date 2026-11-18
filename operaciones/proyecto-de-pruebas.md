# Proyecto de pruebas (operapto-pruebas)

Para que las pruebas del navegador no toquen datos de clientes y corran solas antes de cada publicación.

## Una sola vez

1. En supabase.com: **New project** → nombre `operapto-pruebas`, región **South America (São Paulo)**, plan gratuito.
   Anotá el **Project ref** (está en la URL: supabase.com/dashboard/project/<ref>).
2. Decile a Claude el ref: corre `desarrollo/scripts/preparar-proyecto.sh <ref>`, que aplica las migraciones,
   despliega las funciones y crea el secreto PIN_PEPPER.
3. En GitHub → el repositorio → **Settings → Secrets and variables → Actions → New repository secret**, cargá:
   - `PRUEBAS_SUPABASE_URL`: `https://<ref>.supabase.co`
   - `PRUEBAS_SUPABASE_PUBLICA`: la clave publicable (Settings → API Keys → Publishable key)
   - `PRUEBAS_SUPABASE_SERVICIO`: la clave secreta (Secret key). Solo va en GitHub, nunca en el código.

Desde ahí, cada publicación corre: pruebas de la base → recorrido completo en el navegador contra el proyecto de pruebas → publica.
Si algo falla, no se publica y las capturas quedan como adjunto de la ejecución en GitHub (Actions).

## Cada cambio de base de datos

Primero `scripts/preparar-proyecto.sh <ref-de-pruebas>` (aplica solo lo que falta), pruebas, y recién después producción.

## Recuperar el acceso de un administrador que perdió el celular

- Otro dueño o administrador de la empresa: Personal y obras → la persona → **Restablecer verificación**.
- Si es el único dueño: desde la base (soporte de Operapto), borrar sus factores en `auth.mfa_factors`
  después de confirmar la identidad por otro medio. Queda registrado en la auditoría de Supabase.
