# Estado de instalación — versión 1.1 — 26 de octubre de 2026

- Proyecto Supabase: App bloqueos, ixjrfkjdlnzzbstvuocx.
- Página: https://registro-de-bloqueos.pages.dev/
- Cloudflare Pages: registro-de-bloqueos.
- Migración 003 aplicada mediante SQL Editor y confirmada: 1 perfil avanzado, bucket privado (public=false), 0 documentos de pacientes.
- Se conservan registros anteriores. La migración inicializó Agendas con la agenda previa sin cambiar sus versiones ni historial. Las profesiones antiguas permanecen sin informar hasta completarlas al editar.
- Año 2026: revisar su estado en Feriados y confirmar con la fuente aplicable. No se confirmó automáticamente durante esta actualización.
- Teléfono: contacto solamente; recuperación por correo. SMTP y disponibilidad de envío a colegas dependen de la configuración de Supabase.
- Los originales se almacenan de forma privada, con metadatos de solo lectura en patient_documents. No hay nóminas de ejemplo cargadas.
- Pruebas locales: TypeScript, compilación, pruebas de permisos y atomicidad, parser HTML inerte y PDF espacial, revisión visual de un PDF de informe sintético; formulario de varias agendas, AM/PM, adjuntos HTML/PDF y cambio de idioma verificados en navegador.
- La comprobación de uso simultáneo con dos cuentas reales requiere que ambas personas accedan. No se crearon usuarios ni bloqueos ficticios en producción para probar.
- Código y ZIP de publicación no contienen contraseñas, claves privadas ni archivos reales de pacientes.

Cloudflare confirmó Success: sitio construido y publicado en el dominio definitivo. El navegador rechazó el permiso para acceder directamente al sitio publicado durante la verificación final; no se intentó eludir ese bloqueo. La comprobación autenticada de producción y el uso de dos cuentas reales quedan pendientes. No volver a ejecutar las migraciones aplicadas sobre este proyecto.


## Actualización 1.2 — 28 de octubre de 2026

- 004 y 005 aplicadas y verificadas en Supabase: regular=46, support=203, total=249.
- 11 asignaciones Ambos expandidas a Los Olivos y Viña del Mar por confirmación expresa de la usuaria; total 57 vínculos regulares.
- Período Q4 2026 creado. agenda_sessions vacío y programming_loaded=false: falta la fuente real de programación.
- Nombres con Ninguno se conservan como apoyo sin agenda regular, no como empleados inactivos ni con horarios inventados.
- Nuevas referencias de solo lectura para perfiles activos. Ningún paciente real se ha importado con esta actualización.
- TypeScript y compilación correctos; pruebas anteriores y 22 verificaciones de cruce temporal correctas. Directorio completo y permisos de lectura probados en PGlite.
- QA local: diseño azul, filtro de calendario, tarjeta de bloqueo parcial y vínculo al bloqueo, formulario de información/adjuntos/confirmación.
- Publicación web confirmada por Wrangler y navegador en https://registro-de-bloqueos.pages.dev/; despliegue 7e2abc51. Se autorizó expresamente Wrangler con lectura de cuenta/usuario y escritura Pages.
- Verificación autenticada en producción: versión 1.2, Conectado, catálogo regular disponible, período correcto y programación pendiente; el bloqueo anterior sigue visible sin alteraciones.

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

## Actualización 1.6 — 4 de noviembre de 2026 (Seguridad)

- Migración 014 aplicada en Supabase: se quitaron permisos sobrantes (TRUNCATE, REFERENCES, TRIGGER; todo a anon). Verificado: 0 permisos sobrantes.
- Auditoría de RLS, funciones y buckets sin hallazgos críticos; detalle en docs/SEGURIDAD.md.
- Cabeceras de seguridad reforzadas (HSTS, COOP/CORP, blob: para vistas previas, upgrade-insecure-requests). Requiere publicar el nuevo ZIP para aplicarse.
- fflate 0.8.3 y vite 8.1.6: pnpm audit sin vulnerabilidades. Función enviar-observacion endurecida (aún sin desplegar: depende de Resend).
- Pendiente manual: activar Leaked password protection en Supabase y 2FA en todas las cuentas.
