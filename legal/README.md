# Legal

> Esto es una guía para ordenar los temas, no asesoramiento legal. Antes de firmar o registrar, consultarlo con un abogado
> de propiedad intelectual / tecnología.

## 1. Propiedad intelectual — qué se puede proteger y cómo

Una **idea** no se puede registrar. Lo que sí se protege es el **código**, la **marca** y la **información confidencial**.
La mejor protección práctica es combinar las tres con velocidad: clientes reales, datos acumulados y marca conocida.

| Qué | Cómo se protege | Dónde | Estado |
|---|---|---|---|
| Código fuente, plantillas, base de datos | Derecho de autor (Ley 11.723). **Registro de software** como obra inédita | DNDA (Dirección Nacional del Derecho de Autor), trámite en línea | ☐ |
| Nombre "CheckObra" y logo | **Registro de marca** en las clases 9 (software) y 42 (servicios de software) | INPI. Antes, buscar si ya existe una marca igual o parecida | ☐ |
| Dominio (`checkobra.com.ar`, `.com`, `.app`) | Registro a nombre del titular | NIC Argentina y registradores internacionales | ☐ |
| Estrategia, precios, código | Secreto comercial (Ley 24.766) + acuerdos de confidencialidad | Contratos | ☐ |

El registro en la DNDA conviene repetirlo con cada versión importante: deja una fecha cierta de autoría.

## 2. Contratos necesarios

- **Acuerdo de confidencialidad (NDA)** con cualquiera que vea el código, la estrategia o los datos: desarrolladores, socios, inversores.
- **Cesión de derechos** con todo el que programe o diseñe: lo que hacen pasa a ser del titular (sin esto, el autor es quien lo escribió).
- **Términos y condiciones del servicio** para los clientes (SaaS): uso permitido, prohibición de copiar o revender, responsabilidad, pagos, baja.
- **Acuerdo de tratamiento de datos** con cada empresa cliente: la empresa es responsable de los datos de sus operarios; CheckObra los procesa por cuenta de ella.
- **Acuerdo piloto con Concivi**: alcance, plazo, precio o gratuidad, confidencialidad y permiso para usarlos como referencia.

## 3. Datos personales (Ley 25.326)

La app guarda datos personales de los operarios: **nombre, legajo, foto (selfie), ubicación GPS y firma**.

- [ ] **Política de privacidad** visible en la app.
- [ ] **Consentimiento informado** del operario la primera vez que entra (qué se guarda, para qué, por cuánto tiempo).
- [ ] **Inscripción de la base de datos** en el Registro Nacional de Bases de Datos (Agencia de Acceso a la Información Pública).
- [ ] **Plazo de conservación** de fotos y ubicaciones (por ejemplo, el que exija la normativa de higiene y seguridad) y borrado automático después.
- [ ] Los datos se alojan en Brasil (Supabase, São Paulo): mencionarlo en la política de privacidad.
- [ ] Procedimiento para que un operario pida ver o borrar sus datos.

## 4. Sociedad

Antes de vender a terceros conviene facturar desde una figura propia (monotributo al inicio, luego SAS/SRL) y que
cuentas, dominio, marca y registros queden a su nombre.
