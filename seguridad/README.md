# Seguridad

Objetivo: que nadie pueda copiar el producto, acceder a datos de los clientes ni tomar control de las cuentas.

- [cuentas-y-accesos.md](cuentas-y-accesos.md) — inventario de cuentas, quién accede, segundo factor, claves.
- [seguridad-de-la-app.md](seguridad-de-la-app.md) — cómo está protegida la app y qué falta.
- [respuesta-a-incidentes.md](respuesta-a-incidentes.md) — qué hacer si algo se filtra o te hackean una cuenta.

## Niveles de información

| Nivel | Ejemplos | Dónde vive | Regla |
|---|---|---|---|
| **Secreto** | Claves de Supabase (service_role), Client Secret de John Deere, contraseñas, tokens | Solo en el gestor de contraseñas y en los "Secrets" de cada servicio | Nunca en el repositorio, chat, mail ni capturas |
| **Confidencial** | Código, estrategia, precios, contratos, datos de clientes | Repositorio privado, Supabase | Solo personas con NDA firmado |
| **Interno** | Hoja de ruta, documentación técnica | Repositorio privado | Equipo |
| **Público** | La app publicada, sitio web, folletos | Internet | — |

Nota: el código de la app que corre en el celular (`desarrollo/app/`) siempre lo puede descargar quien abra la app; así
funcionan todas las apps web. Lo valioso y lo que hay que proteger está en el servidor (reglas de la base, funciones,
integraciones), en los datos y en la marca. Más adelante conviene minificar el código de la app para dificultar su lectura.

## Lo mínimo, hoy

- [ ] Repositorio de GitHub en **privado**.
- [ ] **Segundo factor (2FA)** en GitHub, Supabase, Google/correo, John Deere y el dominio.
- [ ] Gestor de contraseñas (Bitwarden, 1Password) con todas las claves; nada anotado en papel o chats.
- [ ] Borrar los tokens de acceso de Supabase que ya no se usan.
- [ ] Activar en GitHub: Secret scanning, Push protection y Dependabot (ver cuentas-y-accesos.md).
