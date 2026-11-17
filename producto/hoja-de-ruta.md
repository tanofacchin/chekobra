# Hoja de ruta

## Hecho

- Base de datos multiempresa con reglas de seguridad y pruebas automáticas (Supabase, São Paulo).
- 13 plantillas base: excavadora, retroexcavadora, cargadora, motoniveladora, topadora, rodillo, minicargadora,
  manipulador telescópico, camioneta, camión volcador, tractor, cosechadora y pulverizadora.
- App instalable en el celular:
  - Operario: equipo, GPS, selfie con marca de agua, checklist, fotos de fallas, firma, cierre de jornada, sin señal.
  - Panel: resumen y alertas, jornadas con filtros y exportación a Excel, fallas, equipos (alta, liberar, fuera de servicio), personal y obras.
- Ingreso de operarios con código de empresa + legajo + PIN.
- Integración John Deere JDLink (ISO 15143-3) con alertas cruzadas. Falta la aprobación de John Deere.

- Listo para publicar (falta prueba completa en el proyecto de pruebas): consentimiento y política de privacidad,
  bloqueo por 5 intentos de PIN, etiquetas QR por equipo y escáner en la app, editor de plantillas, avisos por correo
  de equipos bloqueados.

- Gestión de flota: mantenimiento preventivo por horas/km, historial de trabajos, vencimientos de documentación de
  equipos y personas (con bloqueo opcional al vencer), ficha de equipo e informe de cumplimiento imprimibles,
  indicadores por equipo, operario y obra.

- Combustible: cargas desde el celular (con foto y sin señal), consumo real tanque lleno a tanque lleno, alertas de
  consumo alto y de carga sin uso, referencia por equipo, hoja de combustible en el Excel.
- Excel con hojas, formato y gráficos; escáner de QR en iPhone.

- Checklist v2 (revisión en obra del 12/11): sin seguro, matafuego no crítico, pérdidas de fluidos como advertencia
  roja, fotos obligatorias (horómetro, 4 lados, balde/dientes, tablero, caja de herramientas), controles semanales
  con día configurable (zapatas y bulones los viernes), ayuda en el enganche rápido, orden exterior → cabina →
  equipo encendido. Todo configurable en el editor de plantillas.

- Taller y costos (13/11): rol mecánico con legajo y PIN; órdenes de trabajo desde las fallas (prioridad, asignación,
  estados, repuestos con costo, horas, foto del trabajo); al terminar repara las fallas, deja el trabajo en el historial
  y libera el equipo si no le quedan fallas críticas. Tarifa por hora o por día de cada equipo y costo por obra
  (equipo + combustible + reparaciones) en el panel y en el Excel.
- Corrección: un segundo checklist del mismo día ya no vuelve a pedir el control semanal.

- Mejoras de uso (14/11): buscador de equipos (operario y panel) para flotas grandes, equipos disponibles primero,
  pantalla clara cuando el servidor rechaza un checklist, pestañas del panel a la vista en computadora, orden de
  trabajo directa desde un equipo bloqueado.

- Supervisión (15/11): mapa de la flota (último checklist con GPS o JDLink), resumen del día en el panel y por correo
  a las 19 h, historial del equipo en línea de tiempo, alerta de fallas repetidas o que vuelven tras repararse, y
  asignación de equipos y obras por operario (la valida el servidor).

- Seguridad y pruebas (17/11): verificación en dos pasos (app autenticadora) obligatoria para dueño y administración y
  exigida por el servidor, con restablecimiento por otro administrador; registro de auditoría inalterable (altas,
  cambios, borrados, liberaciones, asignaciones, PIN) con Excel; dictado por voz de las notas; prueba completa en el
  navegador guardada en el repositorio y GitHub corre las pruebas antes de cada publicación.

## Próximo (piloto Concivi)

1. Prueba en celulares reales en obra (GPS, cámara, firma, sin señal, QR).
2. Revisión legal de la política de privacidad y definición de plazos de conservación.
3. Borrado automático de fotos y ubicaciones vencidas.

## Después

- Avisos por WhatsApp (por correo ya está).
- Avisos por correo de services y vencimientos próximos.
- Otras marcas por ISO 15143-3 (Caterpillar, Komatsu, Volvo) y APIs de agro (CNH, AGCO).
- Dominio propio, correo propio y hosting definitivo.
- Planes y cobro de suscripciones.
