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

## Próximo (piloto Concivi)

1. Prueba en celulares reales en obra (GPS, cámara, firma, sin señal).
2. Consentimiento del operario y política de privacidad (ver `legal/`).
3. Límite de intentos de PIN (ver `seguridad/`).
4. Código QR por equipo: el operario escanea y entra directo al checklist de ese equipo.
5. Editor de plantillas para que cada empresa ajuste sus checklists.

## Después

- Avisos por WhatsApp / correo al supervisor ante un bloqueo o una falla.
- Mantenimiento: service por horas de motor, vencimientos de documentación (seguro, VTV, habilitaciones).
- Otras marcas por ISO 15143-3 (Caterpillar, Komatsu, Volvo) y APIs de agro (CNH, AGCO).
- Reportes PDF para auditorías de minería.
- Dominio propio, correo propio y hosting definitivo.
- Planes y cobro de suscripciones.
