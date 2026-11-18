# Estrategia

**Solo titular.** Si se suman colaboradores al repositorio, mover esta carpeta a un repositorio privado aparte.

## Visión

Que ninguna máquina arranque en una obra, mina o campo sin un control real, verificable y con evidencia,
y que el dueño de la flota lo vea en el momento.

## Mercados

| Segmento | Dolor principal | Por dónde entrar |
|---|---|---|
| **Constructoras** (vial, obra civil) | Accidentes y multas; checklists en papel que nadie controla | Concivi como caso piloto y referencia |
| **Mineras** | Exigencias de seguridad muy altas (Decreto 249/07), auditorías, contratistas | Contratistas de mineras primero; la minera exige el estándar a sus proveedores |
| **Agro** | Maquinaria cara, operarios rotativos, campañas cortas | Contratistas rurales y concesionarios John Deere |

## Diferenciales (lo que hay que cuidar y comunicar)

1. **Evidencia que no se puede falsear**: selfie con el equipo, GPS, firma, tiempo del checklist y resultado calculado en el servidor.
2. **Bloqueo automático** del equipo ante una falla crítica, con registro de quién lo liberó.
3. **Cruce con la telemetría de la máquina** (JDLink y luego otras marcas por ISO 15143-3): detecta horómetros falsos, checklists hechos lejos de la máquina y uso sin checklist. Pocos competidores lo hacen.
4. **Funciona sin señal**, pensado para obra y campo.
5. **En español y con normativa argentina**, plantillas por tipo de equipo listas para usar.

## Competencia (investigación inicial)

| Producto | Fortaleza | Debilidad frente a Operapto |
|---|---|---|
| HCSS (Equipment360 / Safety) | Muy completo en construcción pesada, EE.UU. | Caro, en inglés, pensado para empresas grandes |
| Tenna | Telemetría + inspecciones | Mercado de EE.UU. |
| Fleetio | Gestión de flota y mantenimiento | Orientado a vehículos, no a maquinaria de obra |
| SafetyCulture (iAuditor) | Formularios genéricos muy flexibles | Genérico: no bloquea equipos ni cruza telemetría |
| Whip Around | Inspecciones de vehículos simples | Vehículos de ruta, no maquinaria pesada |

Pendiente: relevar competidores locales (Argentina, Chile, Perú) y precios reales.

## Modelo de negocio (a definir)

- Suscripción mensual por **equipo activo** (lo más alineado al valor) con mínimo por empresa.
- Plan con telemetría (JDLink / ISO) más caro.
- Implementación inicial paga para empresas grandes (carga de flota, plantillas a medida, capacitación).

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Que copien la idea | Velocidad, marca registrada, clientes de referencia, datos acumulados, integraciones |
| Dependencia de John Deere para la telemetría | Usar el estándar ISO 15143-3 para sumar otras marcas |
| Rechazo de los operarios (control, selfie) | Explicar el beneficio (seguridad propia), consentimiento, uso rápido |
| Un solo desarrollador | Documentar todo en este repositorio; pruebas automáticas |
