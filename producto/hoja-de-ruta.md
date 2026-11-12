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
