# Seguridad de la app

## Lo que ya está implementado

- **Aislamiento entre empresas** con Row Level Security en todas las tablas: una empresa nunca ve datos de otra. Probado automáticamente (`desarrollo/supabase/tests/`).
- **Roles**: dueño, administrador, supervisor y operario. El operario solo ve sus propias jornadas.
- **El operario no escribe tablas directamente**: todo pasa por funciones del servidor que validan los datos y **calculan el resultado del checklist en el servidor**. No se puede falsear un "apto" desde el teléfono.
- **El estado de un equipo** (bloqueado, liberado) solo cambia por funciones que dejan registro de quién y por qué (`eventos_equipo`).
- **Fotos y firmas** en almacenamiento privado; cada usuario sube solo a su carpeta; se ven con enlaces temporales de 1 hora.
- **Tokens de John Deere** en una tabla que la app no puede leer; solo el servidor.
- **Sin sesión no se accede a nada** (permisos de `anon` revocados).
- **Envíos sin señal** no se duplican (cada envío lleva un identificador único).
- Las pruebas encontraron y se corrigió un error que permitía a una empresa actuar sobre equipos de otra.

## Pendientes (por prioridad)

1. ~~Límite de intentos de PIN~~ **Hecho:** bloqueo al 5.º intento; la contraseña real se deriva del PIN con un secreto del servidor, así que no se pueden probar PINs por fuera de la función `ingresar`.
2. **Correo propio (SMTP)** para los mails de la cuenta, con dominio propio (evita suplantación y el límite de envíos).
3. **Dominio propio con HTTPS** en lugar de github.io.
4. **Encabezados de seguridad** (Content-Security-Policy) en el hosting definitivo.
5. **Minificar el código de la app** al publicar.
6. **Respaldos**: plan pago de Supabase con respaldos diarios o copia propia programada (ver `operaciones/`).
7. **Revisión de seguridad externa** antes de vender a mineras grandes (lo suelen exigir).
8. **Registro de accesos del panel** (quién vio o exportó qué).
