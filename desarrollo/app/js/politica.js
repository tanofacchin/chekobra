// Política de privacidad y texto del consentimiento.
// BORRADOR: revisarlo con un abogado antes del piloto. Lo marcado entre [corchetes] hay que completarlo.
// Al cambiar el texto, subir la versión acá y en public.version_privacidad() (migración nueva): todos vuelven a aceptar.
export const VERSION_PRIVACIDAD = 'v1-2026-11';
export const TITULAR = '[NOMBRE O RAZÓN SOCIAL DEL TITULAR DE CHECKOBRA]';
export const CONTACTO = '[CORREO DE CONTACTO PARA PRIVACIDAD]';

// Lo que ve el operario antes de aceptar: corto y claro.
export const RESUMEN = [
  ['Qué se guarda', 'Tu nombre y legajo, una foto tuya con el equipo al iniciar la jornada, la ubicación GPS de ese momento, tu firma, las respuestas del checklist, el horómetro u odómetro y las novedades que cargues.'],
  ['Para qué', 'Para registrar que el equipo se revisó antes de usarlo, cuidar tu seguridad y la de tus compañeros, y cumplir las normas de higiene y seguridad. No se usa para otra cosa.'],
  ['Cuándo', 'La ubicación y la foto se toman solo cuando hacés el checklist. La app no te sigue durante la jornada.'],
  ['Quién lo ve', 'Los supervisores y administradores de tu empresa. Nadie de otra empresa.'],
  ['Cuánto tiempo', 'Mientras lo exijan las normas de seguridad laboral y como máximo [PLAZO A DEFINIR]. Después se borra.'],
  ['Tus derechos', 'Podés pedir ver, corregir o borrar tus datos a tu empresa o escribiendo a ' + CONTACTO + '.'],
];

export function politicaHtml() {
  return `
<h1>Política de privacidad de CheckObra</h1>
<p class="muted">Versión ${VERSION_PRIVACIDAD}. Borrador sujeto a revisión legal.</p>

<h2>1. Quiénes somos</h2>
<p>CheckObra es un servicio de ${TITULAR} ("CheckObra") que permite a empresas de construcción, minería y agro registrar
el control pre-operacional de sus máquinas y vehículos.</p>
<p>La <b>empresa empleadora o contratante</b> del operario es la <b>responsable</b> de los datos que se cargan en su cuenta.
CheckObra actúa como <b>encargado del tratamiento</b>: guarda y procesa los datos por cuenta de esa empresa y según sus
instrucciones, en los términos de la Ley 25.326 de Protección de los Datos Personales.</p>

<h2>2. Qué datos se tratan</h2>
<ul>
  <li><b>Identificación:</b> nombre, apellido y legajo del operario; nombre y correo de supervisores y administradores.</li>
  <li><b>Fotografía:</b> una foto del operario con el equipo al iniciar la jornada, y fotos de las fallas encontradas.</li>
  <li><b>Ubicación:</b> coordenadas GPS y su precisión, tomadas solo en el momento de hacer el checklist.</li>
  <li><b>Firma:</b> la firma dibujada en la pantalla al confirmar el checklist.</li>
  <li><b>Datos del trabajo:</b> equipo, obra, respuestas del checklist, horómetro u odómetro, horarios de inicio y cierre,
      novedades y combustible cargado.</li>
  <li><b>Datos técnicos:</b> fecha y hora, tipo de navegador o dispositivo, y registros de acceso.</li>
  <li><b>Datos de las máquinas</b> (si la empresa conecta telemetría, por ejemplo John Deere JDLink): horas de motor,
      ubicación y combustible de los equipos. No son datos del operario, pero se cruzan con los checklists.</li>
</ul>
<p>No se recolectan datos sensibles en los términos del artículo 2 de la Ley 25.326.</p>

<h2>3. Para qué se usan</h2>
<ul>
  <li>Registrar que cada equipo se inspeccionó antes de operar, por quién, cuándo y dónde.</li>
  <li>Bloquear equipos con fallas críticas y avisar a los supervisores.</li>
  <li>Cumplir las obligaciones de higiene y seguridad en el trabajo (Ley 19.587, Decreto 351/79, Decreto 911/96 y,
      en minería, Decreto 249/07).</li>
  <li>Detectar inconsistencias entre los checklists y los datos de las máquinas.</li>
  <li>Dar soporte técnico y mantener la seguridad del servicio.</li>
</ul>
<p>Los datos <b>no se venden</b>, no se usan con fines publicitarios y no se comparten con terceros ajenos a la
prestación del servicio.</p>

<h2>4. Base legal y consentimiento</h2>
<p>El tratamiento se basa en el consentimiento libre, expreso e informado del titular (art. 5, Ley 25.326), que se pide
la primera vez que ingresa y cada vez que esta política cambia, y en las obligaciones de seguridad laboral de la empresa.
Queda registro de la fecha, la hora y la versión aceptada.</p>

<h2>5. Quién accede</h2>
<ul>
  <li>Los supervisores y administradores de la empresa del operario. Cada empresa ve solo sus propios datos.</li>
  <li>El operario ve sus propias jornadas.</li>
  <li>Personal técnico de CheckObra, solo cuando sea necesario para dar soporte o mantener el servicio, bajo
      confidencialidad.</li>
</ul>

<h2>6. Dónde se guardan</h2>
<p>Los datos se alojan en servidores de Supabase Inc. ubicados en São Paulo, Brasil, con cifrado en tránsito y en reposo.
Esto implica una transferencia internacional de datos. [CONFIRMAR CON ASESOR LEGAL el encuadre de la transferencia y,
si corresponde, las cláusulas contractuales previstas por la Agencia de Acceso a la Información Pública.]</p>

<h2>7. Cuánto tiempo se guardan</h2>
<p>Los registros de checklist se conservan mientras la empresa mantenga su cuenta y lo exija la normativa de seguridad
laboral. Las fotografías y ubicaciones se conservan como máximo [PLAZO A DEFINIR] y luego se eliminan. Si la empresa da
de baja su cuenta, sus datos se eliminan dentro de los [PLAZO] días siguientes, salvo obligación legal de conservarlos.</p>

<h2>8. Seguridad</h2>
<p>Se aplican medidas técnicas y organizativas para proteger los datos: separación de datos por empresa, acceso solo con
usuario y clave, bloqueo por intentos fallidos, almacenamiento privado de fotos y firmas con enlaces temporales,
registro de quién bloquea o libera cada equipo, y acceso restringido del personal técnico.</p>

<h2>9. Tus derechos</h2>
<p>Como titular de los datos podés solicitar el <b>acceso</b>, la <b>rectificación</b>, la <b>actualización</b> y la
<b>supresión</b> de tus datos (arts. 14, 15 y 16 de la Ley 25.326). El derecho de acceso puede ejercerse en forma
gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo. Podés hacerlo a través de
tu empresa o escribiendo a ${CONTACTO}. La supresión puede no proceder cuando la empresa deba conservar los registros
por obligación legal.</p>
<p>LA AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la
atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por
incumplimiento de las normas vigentes en materia de protección de datos personales.</p>

<h2>10. Cambios</h2>
<p>Si esta política cambia, la app te va a mostrar la nueva versión y te va a pedir que la aceptes antes de seguir.</p>

<h2>11. Contacto</h2>
<p>${TITULAR} · ${CONTACTO}</p>`;
}
