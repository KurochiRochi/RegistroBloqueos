# Validación de 1.1

26 de octubre de 2026.

- TypeScript sin errores y compilación Vite correctos.
- Pruebas de modelo: 7 correctas (incluye días lunes-sábado, feriados, duplicación por profesional, fechas y XLSX).
- Base inicial: 21 verificaciones correctas.
- V1.1: verificaciones de Solo vista, Administrativo, única avanzada, calendario, RPC atómica, lectura de Storage por roles, inmutabilidad y cambio de email con conservación del rol correctas.
- HTML: parse5 sin ejecutar scripts ni recursos. PDF: reconstrucción espacial sin inferencias; falla cerrada hacia original si la tabla es ambigua.
- El ejemplo HTML del usuario se reconoció localmente con 15 filas y 13 campos. No se subió ni se incluyó en paquetes.
- Informe PDF sintético de 3 páginas: renderizado con Poppler y revisión visual de las tres páginas; encabezados, tabla, acentos y paginación legibles.
- Navegador local: varias agendas; horario Media jornada / PM; adjuntos HTML y PDF; lectura del HTML sintético; conservación de PDF de formato distinto como original; menú superior; idioma inglés/español.
- Supabase SQL Editor: migración aplicada, 1 perfil avanzado, bucket público=false y 0 documentos.
- Cloudflare Pages: Success, publicado en https://registro-de-bloqueos.pages.dev/ .
- Límite: Chrome rechazó el permiso para abrir el sitio publicado en la comprobación final. No se verificaron en producción el inicio de sesión, la subida con dos cuentas reales ni la sincronización entre equipos. No se crearon cuentas o datos ficticios en producción.
- SMS no implementado por decisión de la usuaria: el número queda de contacto y se usa recuperación por correo.

## Versión 1.2 — 28 de octubre de 2026

- TypeScript, compilación y pruebas anteriores correctos; 22 verificaciones nuevas del calendario: cruce exacto de profesional/establecimiento/agenda/fecha, intervalos superpuestos sin duplicación, jornadas completas y medias jornadas, horario no informado y límites del período.
- Migraciones 004 y 005 aplicadas en Supabase: 249 profesionales, 46 regulares, 203 de apoyo, 57 vínculos regulares a establecimientos. Ambos corresponde a Los Olivos y Viña del Mar, según confirmación de la usuaria.
- La nómina no contiene horarios, cupos ni agendas. El período 01-10-2026 a 31-12-2026 existe con programación pendiente; no se inventaron sesiones ni profesiones.
- Revisión visual local: inicio institucional azul, calendario con selección y detalle, profesionales de apoyo y formulario en tres pasos. Datos sintéticos exclusivamente en desarrollo, excluidos del paquete publicado.
- Referencias de solo lectura protegidas con RLS; los bloqueos existentes conservan su información e historial. Los cambios de referencia se reciben mediante Realtime.
- Lectura autenticada de la app publicada 1.1 confirmada durante esta actualización. La comprobación simultánea con dos personas reales sigue pendiente.

## Actualización 1.3 — 29 de octubre de 2026

- Publicada en https://registro-de-bloqueos.pages.dev/ mediante Wrangler: despliegue a91f51f4.
- Migraciones 006, 007 y 008 aplicadas; no volver a ejecutar 006 sobre este proyecto. 007 serializa importaciones y comprueba conflictos internos. 008 coteja las fichas con una extracción independiente y conserva correcciones manuales.
- Se cargaron por la propia interfaz los cuatro Excel y el PDF: 5 cargas confirmadas, 12796 filas de programación originales, 12786 reglas únicas (10 duplicadas exactas omitidas), 1066 fichas por establecimiento y código. Las 249 fichas anteriores permanecen conservadas, sin fusionar identidades dudosas.
- Período automático: 01-10-2026 a 28-02-2027, incluidas las agendas de Los Olivos que extienden su vigencia hasta febrero.
- 329 reglas no tienen un día semanal coincidente dentro de su rango. Se conservan y se identifican para revisión; no generan atenciones en fechas inventadas.
- Se conservan 4961 filas originales con nombre BLOQUEADA y 97 filas Generada=NO, con etiquetas de origen separadas de los bloqueos ingresados en la app. Esos conteos son filas de origen, no personas, días ni sesiones únicas.
- Cupos múltiples: hora, intervalo y cupos conservados; término pendiente hasta que la usuaria confirme su interpretación. No se multiplicó intervalo por cupos ni se asignó una duración total sin confirmación.
- Profesiones: 21 etiquetas, incluidas categorías no específicas de la fuente. No se fusionan enfermería, TENS, asistencia dental e higiene dental. Las discrepancias entre códigos/establecimientos quedan en fichas separadas. Las correcciones manuales tienen control de versión e historial, y la recarga de la nómina no sobrescribe su profesión.
- Verificado en producción: acceso avanzado, cinco cargas completas, rango ampliado, profesiones estandarizadas, calendario con agendas programadas y bloqueadas de distinto color y navegación hasta febrero de 2027. No se crearon bloqueos ni pacientes ficticios en producción.
- Pruebas: TypeScript y build, suite anterior, nuevas pruebas PostgreSQL/RLS, atomicidad, idempotencia, conflictos internos y previos, edición concurrente, mantenimiento de correcciones y regresión de profesiones PDF con dos líneas. Comparación independiente de los cuatro Excel: 12796 filas × 14 campos, sin diferencias normalizadas. PDF: 1066 nombres y profesiones comparados fila por fila, sin diferencias. Los datos fuente no se incluyen en el JavaScript público.
- Se mantiene pendiente una prueba con dos colegas reales en computadores distintos. Los avisos Realtime y la recarga de referencias se comprobaron al cargar y corregir esta información.

- Migración 009 aplicada: Los Carros también admitido al registrar bloqueos. Validado en PostgreSQL local sin introducir registros de prueba en producción.

- Migración 010 aplicada: catálogo en una respuesta consistente mediante RPC SECURITY INVOKER con RLS, evitando decenas de consultas al abrir la app. Solo perfiles activos; acceso anónimo rechazado en pruebas.
