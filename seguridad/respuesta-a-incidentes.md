# Respuesta a incidentes

## Si se filtró una clave (la viste en un chat, mail, captura o en el repositorio)

1. **Rotala ya** (ver cómo en `cuentas-y-accesos.md`). Borrarla del lugar donde apareció no alcanza.
2. Si estuvo en el repositorio: rotarla igual; queda en el historial.
3. Revisar en Supabase (Logs) si hubo accesos raros desde que se filtró.
4. Anotar abajo qué pasó.

## Si te hackearon una cuenta

1. Recuperarla desde el correo principal y cambiar la contraseña.
2. Cerrar todas las sesiones abiertas y revisar el 2FA.
3. Revisar qué se cambió: colaboradores de GitHub, tokens, claves de Supabase, reglas de la base.
4. Rotar todas las claves a las que esa cuenta tenía acceso.

## Si se expusieron datos de clientes

1. Cortar el acceso (rotar claves, desactivar usuarios).
2. Medir el alcance: qué empresas, qué datos, desde cuándo.
3. Avisar a las empresas afectadas y, si corresponde, a la Agencia de Acceso a la Información Pública (ver `legal/`).
4. Consultar al asesor legal antes de comunicar públicamente.

## Si alguien copia el producto

1. Juntar pruebas (capturas con fecha, enlaces, archivos).
2. Comparar con el registro de software en la DNDA y la marca en el INPI (ver `legal/`).
3. Consultar al asesor legal: intimación, denuncia o acción judicial.

## Registro

| Fecha | Qué pasó | Qué se hizo |
|---|---|---|
| 2026-11-10 | El repositorio estuvo público desde su creación (unas horas). Sin forks ni estrellas; sin claves en el historial. | Pasado a privado. |
