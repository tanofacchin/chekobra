# Cuentas y accesos

Inventario de todo lo que, si se pierde o se filtra, compromete el producto. **Acá no se anotan claves**: solo dónde están.

## Cuentas

| Servicio | Para qué | Titular | 2FA | Quién más accede |
|---|---|---|---|---|
| GitHub `tanofacchin` | Código, publicación de la app | Titular | ☐ | Claude Code (app de GitHub, solo `chekobra`) |
| Supabase (organización con proyecto `checkobra`, São Paulo) | Base de datos, usuarios, fotos, funciones | Titular | ☐ | — |
| Correo principal | Recuperación de todas las cuentas | Titular | ☐ | — |
| John Deere developer (pendiente) | API JDLink | A nombre del producto | ☐ | — |
| Dominio (pendiente) | Dirección propia de la app | A nombre del producto | ☐ | — |

El **correo principal** es la llave de todo: si alguien lo controla, recupera las demás cuentas. Es el primero en tener 2FA.

## Claves y dónde están guardadas

| Clave | Dónde está | Riesgo si se filtra | Cómo rotarla |
|---|---|---|---|
| Supabase `service_role` | Solo en Supabase (la usan las funciones automáticamente) | **Total**: lectura y escritura de todo | Supabase → Project Settings → API → regenerar JWT secret |
| Supabase `anon` | En el código de la app (es pública por diseño) | Ninguno: las reglas RLS limitan qué puede hacer | — |
| Token personal de Supabase (`sbp_…`) | Entorno de Claude Code "chekobra" | Alto: administra el proyecto | supabase.com/dashboard/account/tokens → borrar y crear otro |
| `CRON_SECRET` | Secrets de la función `johndeere` + Vault (`cron_secret`) | Bajo: permite forzar una sincronización | Cambiar en ambos lugares a la vez |
| `JD_CLIENT_ID` / `JD_CLIENT_SECRET` (pendiente) | Secrets de la función `johndeere` | Alto: suplantar la app ante John Deere | Portal de John Deere |
| Contraseña de la base de datos | Gestor de contraseñas | Alto | Supabase → Database → Reset password |

## Configuración recomendada de GitHub

- Settings → General → **Change visibility → Private**.
- Settings → Code security → activar **Secret scanning**, **Push protection** y **Dependabot alerts**.
- Settings → Branches → regla para `main`: exigir que los cambios pasen las pruebas antes de publicarse (cuando haya más de una persona).
- Settings → Collaborators: revisar cada tanto que no haya nadie de más.
- Cuenta → Settings → Password and authentication → **2FA** con app de autenticación (no SMS).

## Altas y bajas de personas

Al sumar a alguien: NDA y cesión de derechos firmados → acceso solo a lo que necesita → anotarlo en la tabla de arriba.
Al irse alguien: quitar accesos el mismo día → rotar las claves que pudo haber visto → anotarlo.
