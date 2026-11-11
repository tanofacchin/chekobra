# CheckObra · Desarrollo — registro de la conversación

Período: 9 al 11 de noviembre de 2026.

---

## 1. Investigación y primer prototipo (9/11)

**Pedido:** una app de checklist para operarios de máquinas, camionetas y vehículos de construcción y minería, primero
para Concivi y después para ofrecer a otras empresas. Investigar checklists protocolares, comparar apps competidoras y
hacer un prototipo con interfaz para operarios y administradores.

**Se hizo:**
- Normativa: OSHA 1926.602 (EE.UU.), Decreto 911/96 y SRT (Argentina). Estructura estándar del checklist:
  documentación, inspección visual, niveles, cabina, prueba de funcionamiento y revisión del lugar.
- 10 plantillas de equipo (excavadora, retroexcavadora, cargadora, motoniveladora, topadora, rodillo, minicargadora,
  manipulador telescópico, camioneta, camión volcador), con unos 40 a 50 puntos cada una.
- Comparación con HCSS, Tenna, Fleetio, SafetyCulture y Whip Around.
- Prototipo en HTML: operario (equipo y obra, GPS, selfie, checklist, firma, cierre) y administrador (panel, filtros,
  exportación, detalle). Bloqueo automático por falla crítica y aviso si el checklist se completa en menos de 2 minutos.

## 2. Paso a la nube y prototipo rehecho (10/11)

**Pedido:** mover el trabajo a la nube para seguir desde el celular. Los archivos originales no se habían copiado, y
el usuario pidió **rehacerlos**.

**Se hizo:** el prototipo se rehízo como página de claude.ai con base de datos compartida (lo que carga el operario
lo ve el administrador en otro dispositivo) y guardado sin señal. PINs de prueba: operario 1234, administración 0000.

## 3. John Deere JDLink — consulta inicial

**Pregunta:** ¿JDLink tiene API? **Respuesta:** sí. Hay dos opciones: la API ISO 15143-3 (AEMP 2.0), que es un estándar que
también publican Caterpillar, Komatsu y Volvo, y las APIs propias de John Deere. Se accede con cuenta de desarrollador,
registro de aplicación y autorización OAuth del dueño de la flota. Concivi tiene máquinas John Deere con JDLink.

## 4. Producto para vender, no solo para Concivi

**Definición del usuario:** la idea es venderlo a otras constructoras, mineras y empresas de agro.

**Decisiones:** CheckObra es un producto independiente desde el principio, con Concivi como primer cliente. Es multiempresa
desde el inicio. La cuenta de John Deere va a nombre del producto y cada cliente conecta la suya. Se suman plantillas de
agro y un editor de plantillas. Base técnica: **Supabase**.

## 5. Base de datos multiempresa (10/11)

**Repositorio:** `tanofacchin/chekobra`.

**Se hizo:**
- Esquema: empresas, miembros con roles (dueño, administrador, supervisor, operario), obras, plantillas versionadas,
  equipos, jornadas, fallas, auditoría de bloqueos y telemetría.
- Reglas de seguridad por empresa (Row Level Security). El operario no escribe tablas directamente: usa funciones del
  servidor que **calculan el resultado del checklist en el servidor**.
- Almacenamiento privado de fotos y firmas por empresa y por usuario.
- 13 plantillas base (se suman tractor, cosechadora y pulverizadora).
- Pruebas automáticas. Encontraron un **error de seguridad real**: una empresa podía sacar de servicio un equipo de otra.
  Se corrigió.

**Decisión del usuario:** operarios entran con **código de empresa + legajo + PIN de 6 dígitos**.

## 6. Supabase en São Paulo y app instalable (10/11)

**Pedido:** pasar el proyecto a São Paulo y seguir con la app.

**Se hizo:**
- Proyecto `checkobra` en São Paulo (sa-east-1), creado por el usuario. Se aplicaron todas las migraciones.
- Función del servidor `operarios` (alta y cambio de PIN).
- App instalable (PWA) en `desarrollo/app/`: flujo completo del operario y panel (resumen, jornadas, fallas, equipos,
  personal y obras, exportación CSV). Bandeja de salida en el teléfono: lo cargado sin señal se envía solo y no se duplica.
- Prueba completa contra el proyecto real, incluido el envío sin señal. Después se borraron los datos de prueba.
- Publicación en **https://tanofacchin.github.io/chekobra/** (GitHub Pages, activado por el usuario).
- Entorno de Claude Code "chekobra" con acceso solo a ese proyecto de Supabase.

## 7. Integración con John Deere (10/11)

**Se hizo:**
- Función `johndeere`: conexión por empresa, descarga de la flota en formato ISO 15143-3, vinculación por número de serie / PIN.
- Alertas: **horómetro distinto** (más de 2 h), **checklist lejos de la máquina** (más de 500 m) y **máquina usada sin
  checklist**.
- Actualización automática cada hora. Tarjeta "John Deere JDLink" en el panel.
- Probado con datos simulados. **Falta:** registrar la app en developer.deere.com, pedir acceso a la API ISO 15143-3 y
  cargar `JD_CLIENT_ID` y `JD_CLIENT_SECRET` en Supabase.

Se encontró en la base una empresa "prueba 1" (código `prueba`) creada por el usuario. No se tocó.

## 8. Seguridad y organización del trabajo (10/11)

**Pedido:** máxima seguridad para que no roben la idea ni el código; carpeta de trabajo por áreas.

**Se hizo:** estructura `desarrollo/`, `producto/`, `estrategia/`, `comercial/`, `legal/`, `seguridad/`, `operaciones/`,
licencia propietaria, Dependabot y lista de archivos prohibidos. **No se subió** porque el repositorio sigue público.

**Puntos clave dados:** una idea no se registra. Se protegen el código (registro en la DNDA), la marca (INPI) y la
información confidencial (NDA y cesión de derechos). Selfie, GPS y firma son datos personales (Ley 25.326):
hace falta consentimiento y política de privacidad antes del piloto.

## 9. ¿Sirve para gran escala? (10/11)

**Respuesta:** la base sirve (Postgres, multiempresa, almacenamiento, estándar ISO, región São Paulo). Antes del primer
cliente pago hay que sumar: un proyecto de pruebas separado (lo más urgente), Supabase Pro con respaldos, dominio propio
con hosting adecuado, correo propio, monitoreo de errores, código compilado y minificado, y pruebas automáticas.
Para clientes grandes: apps en las tiendas, ingreso con cuenta corporativa, certificaciones (SOC 2) y otro desarrollador.
Costos orientativos: piloto ~0; primeros clientes US$ 50–100/mes; gran escala, cientos a pocos miles por mes.

## 10. Separación de conversaciones (10/11)

Se separó el trabajo en **CheckObra · Desarrollo** y **CheckObra · Estrategia y negocio**, con la etiqueta `checkobra`.

## 11. Hosting (10/11)

- **¿Hostinger?** Viable para la app, el dominio y el correo propio, y permite configurar encabezados de seguridad. La base
  de datos sigue en Supabase.
- **¿KVM 1 o KVM 2?** Para la app no hace falta un VPS: alcanza el hosting web común. Si se quiere un VPS, KVM 1 alcanza
  para empezar. KVM 2 tiene sentido cuando haya servicios propios que correr (avisos por WhatsApp, receptor de telemetría,
  copia de prueba de la base). Un VPS implica administrar su seguridad.

## 12. Telemetría para cualquier máquina (10/11)

**Pregunta:** ¿hay dispositivos para cualquier vehículo, como JDLink? **Respuesta:** sí, telemetría de reposición.
- Máquinas modernas: conexión al **CAN bus (J1939)**, con horómetro real, combustible, códigos de falla y ubicación.
- Máquinas viejas: GPS conectado al contacto. Equipos sin motor: rastreador a batería. Agro: además ISOBUS.
- Equipos: **Teltonika FMC650** (J1939 + ISOBUS, instaladores en Argentina), Trackunit Raw, Geotab GO / GO IRON, Samsara.
- **Oportunidad:** Teltonika puede mandar los datos a un servidor propio, así que CheckObra podría ofrecer su **propio kit
  de telemetría** para flotas mixtas. El receptor iría en un VPS (KVM 1 para empezar).

## Pendientes al 11/11

**Del usuario:**
- [ ] Pasar el repositorio a **privado** y elegir hosting (Hostinger, GitHub Pro o Cloudflare Pages).
- [ ] 2FA en GitHub, Supabase y correo; secret scanning y push protection; gestor de contraseñas.
- [ ] Nombre o razón social del titular para la licencia.
- [ ] Registrar la app en developer.deere.com.
- [ ] Probar la app en celulares reales.
- [ ] Decidir qué hacer con la empresa de prueba "prueba 1".

**De desarrollo:**
- [ ] Subir la estructura de carpetas (cuando el repositorio sea privado).
- [ ] Consentimiento del operario y política de privacidad.
- [ ] Límite de intentos de PIN.
- [ ] Proyecto de Supabase separado para pruebas.
- [ ] QR por equipo y editor de plantillas.
- [ ] Receptor de datos para Teltonika (cuando haya un dispositivo).
