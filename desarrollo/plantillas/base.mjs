// Plantillas base de CheckObra (visibles para todas las empresas).
// Fuente única: este archivo. `node plantillas/generar-sql.mjs` genera la migración.
// Cada sección tiene una clave; el id de cada ítem es "<clave>.<n>" y no se debe reusar
// con otro significado (las jornadas guardan respuestas por id).

export const C = true; // ítem crítico: si falla, el equipo queda bloqueado

const MANG = ['Mangueras y acoples hidráulicos sin fisuras, roces ni pérdidas', C];

const B = {
  doc: ['doc', 'Documentación', [
    ['Operador habilitado y capacitado para este equipo', C],
    ['Seguro del equipo vigente'],
    ['Manual del operador y tabla de cargas en cabina'],
    ['Service / mantenimiento al día según registro'],
    ['Matafuego cargado, precintado y con tarjeta vigente', C],
    ['Botiquín de primeros auxilios completo']]],
  fluidos: ['fluidos', 'Motor y fluidos (con motor frío)', [
    ['Aceite de motor en nivel'],
    ['Refrigerante en nivel'],
    ['Aceite hidráulico en nivel'],
    ['Combustible suficiente para la jornada'],
    ['Sin pérdidas de aceite, combustible o refrigerante', C],
    ['Filtro de aire / indicador de restricción en verde'],
    ['Correas sin fisuras y con tensión correcta'],
    ['Batería con bornes ajustados y sin sulfato']]],
  cabina: ['cabina', 'Cabina y elementos de seguridad', [
    ['Cinturón de seguridad en buen estado y abrocha', C],
    ['Estructura ROPS/FOPS sin daños ni modificaciones', C],
    ['Asiento firme y regulado'],
    ['Vidrios sin roturas que impidan la visión'],
    ['Espejos limpios y bien orientados'],
    ['Escalones y pasamanos firmes y limpios de barro o aceite'],
    ['Tablero sin testigos de falla al arrancar', C],
    ['Bocina funciona', C],
    ['Alarma de retroceso funciona', C],
    ['Luces de trabajo y baliza funcionan'],
    ['Limpiaparabrisas funciona'],
    ['Cabina ordenada, sin objetos sueltos bajo los pedales']]],
  prueba: ['prueba', 'Prueba de funcionamiento', [
    ['Frenos de servicio responden', C],
    ['Freno de estacionamiento retiene el equipo', C],
    ['Dirección / mandos de traslación responden', C],
    ['Comandos hidráulicos responden sin tirones'],
    ['Palanca de bloqueo de mandos funciona', C],
    ['Sin ruidos, vibraciones ni humo anormales']]],
  entorno: ['entorno', 'Revisión del lugar de trabajo', [
    ['Área de trabajo libre de personal no autorizado'],
    ['Líneas eléctricas aéreas identificadas y a distancia segura', C],
    ['Servicios enterrados marcados (gas, agua, fibra)'],
    ['Terreno firme y lejos de bordes de zanja o talud'],
    ['Señalización y vallado colocados'],
    ['Comunicación con señalero / radio acordada']]],
  // Agro
  docAgro: ['doc', 'Documentación', [
    ['Operador capacitado para este equipo', C],
    ['Seguro del equipo vigente'],
    ['Manual del operador en cabina'],
    ['Service / mantenimiento al día según registro'],
    ['Matafuego cargado, precintado y con tarjeta vigente', C],
    ['Botiquín de primeros auxilios completo']]],
  cabinaAgro: ['cabina', 'Cabina y elementos de seguridad', [
    ['Cinturón de seguridad en buen estado y abrocha', C],
    ['Arco o cabina antivuelco (ROPS) sin daños', C],
    ['Asiento firme y regulado'],
    ['Vidrios y espejos sanos y limpios'],
    ['Escalones y pasamanos firmes y limpios'],
    ['Tablero sin testigos de falla al arrancar', C],
    ['Bocina funciona'],
    ['Luces de camino, giros y baliza funcionan', C],
    ['Cartel de vehículo lento colocado'],
    ['Arranque solo en neutro (seguridad de arranque) funciona', C]]],
  pruebaAgro: ['prueba', 'Prueba de funcionamiento', [
    ['Frenos responden y están acoplados para circular', C],
    ['Freno de estacionamiento retiene', C],
    ['Dirección responde sin juego', C],
    ['Comandos hidráulicos responden sin tirones'],
    ['Sin ruidos, vibraciones ni humo anormales']]],
  entornoAgro: ['entorno', 'Revisión del lugar de trabajo', [
    ['Personas y animales fuera del área de trabajo'],
    ['Líneas eléctricas aéreas identificadas y a distancia segura', C],
    ['Pendientes, zanjas, alambrados y bajos anegados identificados'],
    ['Traslado por ruta: señalización y escolta si corresponde']]],
};

const maq = (clave, nombre, ...esp) => ({ clave, nombre, rubro: 'construccion', medidor: 'horas', secciones: [B.doc, B.fluidos, ...esp, B.cabina, B.prueba, B.entorno] });
const agro = (clave, nombre, ...esp) => ({ clave, nombre, rubro: 'agro', medidor: 'horas', secciones: [B.docAgro, B.fluidos, ...esp, B.cabinaAgro, B.pruebaAgro, B.entornoAgro] });

export const PLANTILLAS = [
  maq('excavadora', 'Excavadora',
    ['rodaje', 'Tren de rodaje y estructura', [['Tensión de orugas correcta'], ['Zapatas y bulones completos'], ['Rodillos, rueda guía y cadena sin daños'], ['Mandos finales sin pérdidas'], ['Giro de tornamesa sin juego anormal'], ['Contrapeso firme']]],
    ['trabajo', 'Equipo de trabajo', [['Balde, dientes y cuchillas en buen estado'], ['Pasadores y bujes trabados y engrasados'], ['Enganche rápido trabado con su seguro', C], ['Cilindros sin pérdidas ni rayas en el vástago'], MANG, ['Pluma y brazo sin fisuras visibles']]]),
  maq('retroexcavadora', 'Retroexcavadora',
    ['chasis', 'Ruedas y chasis', [['Neumáticos con presión correcta y sin cortes'], ['Tuercas de rueda completas y ajustadas'], ['Estabilizadores bajan y retienen', C], ['Traba de giro del brazo colocada para traslado', C]]],
    ['trabajo', 'Equipo de trabajo', [['Pala frontal y cuchilla en buen estado'], ['Balde retro y dientes en buen estado'], ['Pasadores y bujes trabados y engrasados'], ['Cilindros sin pérdidas'], MANG]]),
  maq('cargadora', 'Cargadora frontal',
    ['chasis', 'Ruedas y chasis', [['Neumáticos con presión correcta y sin cortes'], ['Tuercas de rueda completas y ajustadas'], ['Articulación central sin juego y traba de transporte presente', C], ['Ejes y diferenciales sin pérdidas']]],
    ['trabajo', 'Equipo de trabajo', [['Balde y cuchilla en buen estado'], ['Brazos de levante sin fisuras'], ['Pasadores trabados y engrasados'], ['Enganche rápido trabado', C], MANG]]),
  maq('motoniveladora', 'Motoniveladora',
    ['chasis', 'Ruedas y tándem', [['Neumáticos con presión correcta y sin cortes'], ['Tuercas de rueda completas y ajustadas'], ['Tándem sin pérdidas'], ['Articulación sin juego']]],
    ['trabajo', 'Equipo de trabajo', [['Cuchilla y cantoneras en buen estado'], ['Círculo y cremallera sin daños'], ['Escarificador / ripper con dientes completos'], ['Cilindros sin pérdidas'], MANG]]),
  maq('topadora', 'Topadora',
    ['rodaje', 'Tren de rodaje', [['Tensión de orugas correcta'], ['Zapatas y bulones completos'], ['Rodillos y rueda guía sin daños'], ['Rueda motriz y segmentos sin desgaste excesivo']]],
    ['trabajo', 'Equipo de trabajo', [['Hoja y cantoneras en buen estado'], ['Brazos de empuje y muñones sin fisuras'], ['Ripper y dientes en buen estado'], ['Cilindros sin pérdidas'], MANG]]),
  maq('rodillo', 'Rodillo compactador',
    ['chasis', 'Tambor y ruedas', [['Tambor sin daños'], ['Raspadores ajustados'], ['Neumáticos con presión correcta (si tiene)'], ['Articulación central sin juego y traba presente', C]]],
    ['sistemas', 'Sistemas', [['Vibración enciende y corta'], ['Rociadores de agua y tanque cargado'], ['Parada de emergencia / hombre muerto funciona', C], MANG]]),
  maq('minicargadora', 'Minicargadora',
    ['chasis', 'Ruedas u orugas', [['Neumáticos u orugas en buen estado'], ['Tuercas de rueda completas y ajustadas']]],
    ['trabajo', 'Equipo y seguridad', [['Barra de seguridad y sensor de asiento bloquean los mandos', C], ['Puerta o rejilla delantera en su lugar'], ['Implemento enganchado con las trabas cerradas', C], ['Traba de brazos para servicio presente'], ['Cilindros sin pérdidas'], MANG]]),
  maq('telescopico', 'Manipulador telescópico',
    ['chasis', 'Ruedas y chasis', [['Neumáticos con presión correcta y sin cortes'], ['Tuercas de rueda completas y ajustadas'], ['Estabilizadores bajan y retienen', C], ['Nivelación de chasis funciona']]],
    ['trabajo', 'Pluma y carga', [['Pluma sin fisuras; las secciones deslizan sin ruido'], ['Horquillas sin fisuras y trabadas', C], ['Implemento correcto y trabado', C], ['Indicador de momento de carga funciona', C], ['Tabla de cargas legible en cabina'], ['Cadenas o cables de extensión en buen estado'], MANG]]),
  { clave: 'camioneta', nombre: 'Camioneta', rubro: 'construccion', medidor: 'km', secciones: [
    ['doc', 'Documentación', [['Licencia de conducir vigente y categoría correcta', C], ['Cédula del vehículo'], ['Seguro y comprobante de pago vigentes', C], ['VTV / RTO vigente'], ['Matafuego cargado y vigente', C], ['Botiquín completo']]],
    ['exterior', 'Exterior', [['Neumáticos con presión y dibujo correctos', C], ['Rueda de auxilio, gato y llave de rueda'], ['Luces altas, bajas, giros, freno y retroceso', C], ['Espejos sanos y regulados'], ['Parabrisas sin roturas en el campo visual'], ['Carga en caja asegurada'], ['Balizas triangulares (2)'], ['Pértiga con banderín y luz (en obra minera)']]],
    ['fluidos', 'Motor y fluidos', [['Aceite de motor en nivel'], ['Refrigerante en nivel'], ['Líquido de frenos en nivel'], ['Agua del lavaparabrisas'], ['Combustible suficiente'], ['Sin pérdidas debajo del vehículo', C]]],
    ['cabina', 'Cabina', [['Cinturones de seguridad funcionan', C], ['Bocina funciona', C], ['Tablero sin testigos de falla', C], ['Limpiaparabrisas funciona'], ['Radio o celular cargado para comunicación'], ['Kit antiderrame']]],
    ['prueba', 'Prueba de manejo', [['Frenos responden de forma pareja', C], ['Freno de mano retiene', C], ['Dirección sin juego ni ruidos', C]]],
  ]},
  { clave: 'volcador', nombre: 'Camión volcador', rubro: 'construccion', medidor: 'km', secciones: [
    ['doc', 'Documentación', [['Licencia profesional vigente', C], ['Habilitación de carga (RUTA) vigente'], ['Seguro vigente', C], ['RTO vigente'], ['Matafuego cargado y vigente', C], ['Botiquín completo']]],
    ['chasis', 'Neumáticos y chasis', [['Neumáticos con presión correcta y sin cortes', C], ['Tuercas de rueda completas'], ['Elásticos sin hojas rotas'], ['Guardabarros y paragolpes firmes']]],
    ['fluidos', 'Motor y fluidos', [['Aceite de motor en nivel'], ['Refrigerante en nivel'], ['Combustible y urea (AdBlue) suficientes'], ['Sin pérdidas de fluidos', C], ['Correas en buen estado']]],
    ['frenos', 'Frenos de aire', [['Presión de aire carga en tiempo normal', C], ['Tanques de aire purgados'], ['Frenos de servicio responden', C], ['Freno de estacionamiento retiene', C], ['Freno motor funciona']]],
    ['caja', 'Caja volcadora', [['Caja apoyada y traba de vuelco colocada', C], ['Cilindro de vuelco sin pérdidas'], ['Compuerta trasera y trabas en buen estado'], ['Lona o cobertor de carga'], ['Puntal de seguridad presente para mantenimiento']]],
    ['cabina', 'Cabina', [['Cinturón de seguridad funciona', C], ['Bocina funciona', C], ['Alarma de retroceso funciona', C], ['Luces y baliza funcionan', C], ['Espejos sanos y regulados'], ['Tablero sin testigos de falla', C], ['Tacógrafo funcionando']]],
  ]},
  agro('tractor', 'Tractor',
    ['enganche', 'Rodado y enganche', [['Neumáticos con presión correcta y sin cortes'], ['Tuercas de rueda y lastre ajustados'], ['Enganche de tres puntos con pernos y trabas', C], ['Barra de tiro y perno con seguro colocado', C], ['Protector de toma de fuerza y cardán colocados', C], ['Acoples hidráulicos remotos limpios y sin pérdidas']]]),
  agro('cosechadora', 'Cosechadora',
    ['rodado', 'Rodado', [['Neumáticos u orugas en buen estado'], ['Tuercas de rueda completas y ajustadas']]],
    ['cabezal', 'Cabezal y trilla', [['Cuchillas, puntones y sinfín del cabezal en buen estado'], ['Traba o soporte de seguridad del cabezal para mantenimiento', C], ['Protecciones de correas y cadenas en su lugar', C], ['Sistema de trilla y zarandas sin obstrucciones'], ['Tolva y tubo de descarga sin daños'], ['Motor y compartimento limpios de rastrojo (riesgo de incendio)', C], MANG]]),
  agro('pulverizadora', 'Pulverizadora autopropulsada',
    ['rodado', 'Rodado', [['Neumáticos con presión correcta y sin cortes'], ['Tuercas de rueda completas y ajustadas']]],
    ['aplicacion', 'Equipo de aplicación', [['Botalón plegado y trabado para traslado', C], ['Mangueras y conexiones de producto sin pérdidas', C], ['Picos y filtros limpios y completos'], ['Tanque y tapas cerrados, sin fisuras'], ['Tanque de agua limpia para lavado de manos cargado'], ['Ficha de seguridad del producto en cabina'], ['Equipo de protección para químicos disponible', C], ['Filtro de carbón de la cabina vigente']]]),
];

export function normalizar(t) {
  return {
    clave: t.clave, nombre: t.nombre, rubro: t.rubro, medidor: t.medidor,
    secciones: t.secciones.map(([k, titulo, items]) => ({
      clave: k, titulo,
      items: items.map(([texto, critico], i) => ({ id: `${k}.${i + 1}`, texto, critico: !!critico })),
    })),
  };
}
