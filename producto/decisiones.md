# Decisiones técnicas

| Fecha | Decisión | Por qué |
|---|---|---|
| 2026-11-10 | Supabase (Postgres) como base | Base, usuarios, fotos y funciones en un solo servicio; reglas de seguridad por empresa en la propia base |
| 2026-11-10 | Servidores en São Paulo (sa-east-1) | Menor demora para usuarios en Argentina, importante con señal débil |
| 2026-11-10 | Producto multiempresa desde el inicio | Se vende a varias empresas; agregarlo después obliga a rehacer la base |
| 2026-11-10 | El resultado del checklist se calcula en el servidor | Que no se pueda falsear un "apto" desde el teléfono |
| 2026-11-10 | Operarios entran con empresa + legajo + PIN | Muchos operarios no tienen correo |
| 2026-11-10 | App web instalable (PWA), sin tiendas | Se actualiza sola, funciona en Android y iPhone, sin aprobación de tiendas |
| 2026-11-10 | Bandeja de salida en el teléfono | Las obras y campos tienen poca señal; nada se pierde ni se duplica |
| 2026-11-10 | Telemetría por el estándar ISO 15143-3 | Una integración sirve para varias marcas |
| 2026-11-10 | Plantillas versionadas con ids de ítem fijos | Las jornadas viejas siguen mostrándose bien aunque cambie la plantilla |
| 2026-11-12 | Tres niveles por punto: crítico (bloquea), advertencia roja (no bloquea), normal | Las pérdidas de fluidos tienen que verse pero no siempre justifican parar la máquina (revisión en obra) |
| 2026-11-12 | Controles semanales: obligatorios el día que tocan, se piden atrasados al siguiente uso | Ahorrar tiempo diario sin perder el control; el servidor no rechaza un atrasado si el teléfono estaba sin señal |
| 2026-11-12 | Orden del checklist según la recorrida: exterior → cabina apagada → equipo encendido | Optimizar el tiempo del operario |
| 2026-11-13 | Las órdenes de trabajo liberan el equipo al terminarse si no quedan fallas críticas | El mecánico cierra el circuito sin esperar al supervisor; queda registrado quién y con qué orden |
| 2026-11-13 | Costo por obra: tarifa por hora (o por día) + combustible + reparaciones; lo que no tiene obra se reparte por horas | Las reparaciones y cargas sin obra son costos reales del equipo; repartirlas por uso es lo más justo y simple |
| 2026-11-15 | Mapa con Leaflet y OpenStreetMap, sin clave ni costo | Alcanza para ver la última posición; si crece el uso hay que pasar a un proveedor de mapas pago (OSM no permite uso intensivo) |
| 2026-11-15 | Sin asignaciones, el operario puede usar todo; con asignaciones, solo eso | No obliga a configurar nada a las empresas chicas |
| 2026-11-17 | Segundo factor por app autenticadora (TOTP), exigido en la base (mi_rol) y no solo en la pantalla | Una contraseña robada de un administrador no alcanza para ver ni cambiar datos; los operarios siguen con legajo y PIN |
| 2026-11-17 | Auditoría por disparadores en la base, sin acceso de escritura para nadie | Registra también lo que se cambie por fuera de la app; nadie puede borrar sus rastros |
| 2026-11-17 | Las pruebas corren en GitHub antes de publicar; el recorrido en navegador usa un proyecto de pruebas aparte | Que un error no llegue a los operarios y que las pruebas nunca toquen datos de clientes |
| 2026-11-18 | El producto se llama **Operapto** ("operar" + "apto") | Existe otro "CheckObra" en Brasil. Quedan con el nombre viejo, por ahora, el repositorio y la dirección de GitHub Pages (se mudan con el dominio propio) y los nombres internos que no se ven (proyecto de Supabase, base local del celular, clave de sesión) |
