# Registro de bloqueos 1.5

Aplicación independiente: https://registro-de-bloqueos.pages.dev/
React + TypeScript + Vite. Datos y autenticación en Supabase; archivos en un bucket privado. Alojamiento Cloudflare Pages. No requiere ChatGPT ni un computador encendido como servidor.

## Cambios de 1.2
- Interfaz institucional azul inspirada en las referencias: Inicio, Bloqueos, Agendas por establecimiento, Profesionales y Reportes. Configuración y accesos siguen en el menú superior del perfil.
- Registro nuevo en tres pasos: información, adjuntos y confirmación. Se mantienen validaciones, permisos y datos de pacientes.
- Directorio importado: 249 nombres; 46 con asignación regular y 203 de apoyo sin agenda regular. Ambos = Los Olivos y Viña del Mar, confirmado por la usuaria. Los nombres y asignaciones originales se conservan; profesión no informada.
- Período de referencia 01-10-2026 a 31-12-2026, con vistas día/semana/mes y filtros por establecimiento, profesión, profesional, agenda, fecha y estado.
- Cruce exacto normalizado de profesional, establecimiento, agenda y fecha. Horarios completos, rangos y AM/PM. Unión de intervalos evita duplicar minutos; no descuenta cupos por estimación. Horario no informado se marca por verificar.
- La planilla entregada solo contiene Nombre del profesional y Establecimiento. No se crearon sesiones, horarios, profesiones o cupos. La pantalla avisa Programación pendiente hasta recibir el archivo de agendas reales.
- Los bloqueos sin agenda de referencia aparecen diferenciados: no se presentan como atenciones programadas.
- Las tablas de referencia son de solo lectura con RLS. Los períodos están separados para admitir 2027 más adelante. No hay edición manual ni importador de programación abierto en esta versión.
- La nueva página Reportes agrupa datos reales y permite exportar XLSX/PDF por fechas y establecimiento.

## Funciones conservadas de 1.1
- Un código SISMAULE único por bloqueo, con hasta 30 agendas.
- Profesión y cinco establecimientos: Buenos Aires, Arrau Méndez, Los Olivos, Viña del Mar y Rural. Sector permite identificar centros rurales.
- Horario no informado, jornada completa, rango de horas o media jornada AM/PM.
- Nóminas PDF/HTML múltiples (hasta 10 archivos de 20 MB), en espacio separado de solo lectura. El HTML se interpreta con parse5, sin ejecutar scripts ni cargar sus recursos. PDF con PDF.js local; si no se reconoce con fiabilidad, se conserva el original y se informa del límite. PDF escaneado sin OCR.
- Resúmenes por profesional y establecimiento. Sin cupos en pantalla ni exportación.
- Exportación XLSX (16 columnas) e informe PDF con rango de fechas obligatorio. Incluyen bloqueos que intersectan el rango, con períodos originales completos. Los informes generales no contienen identificadores de pacientes.
- Menú de perfil en el círculo superior derecho: nombre, contacto telefónico, correo y clave; configuración de idioma ES/EN, tamaño, contraste y movimiento; cerrar sesión.
- Guía de uso dentro de la aplicación.

## Permisos
| Acción | Solo vista (normal) | Administrativo | Administradora avanzada |
|---|---|---|---|
| Consultar bloqueos y descargar informes | Sí | Sí | Sí |
| Editar su nombre/contacto/correo/clave | Sí | Sí | Sí |
| Crear bloqueos | No | Sí | Sí |
| Editar bloqueos | No | Solo propios | Todos |
| Mantener y confirmar feriados | No | Sí | Sí |
| Leer nóminas de pacientes | No | Sí | Sí |
| Administrar perfiles | No | No | Sí |

La cuenta avanzada es única, reservada inicialmente a jcontreras@saludparral.cl. Un índice y triggers impiden otorgar ese rol a otro perfil. El acceso sigue ligado al UUID de Supabase Auth al confirmar un cambio de correo. No se confía en roles enviados por el navegador.

El teléfono se guarda como contacto. Recuperación por correo; SMS pendiente por decisión de la usuaria. La entrega de correos a colegas depende del SMTP configurado en Supabase.

## Instalación y actualización
Node.js 24 o superior y pnpm. Abrir esta carpeta en Visual Studio Code.

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

`.env.local` solo contiene URL y clave PUBLICABLE. Nunca usar service_role ni claves secretas en VITE_. El proyecto actual ya estaba configurado; la base 001 y la carga 002 NO deben ejecutarse de nuevo.

Para una instalación nueva: ejecutar, en orden, database/001_schema.sql, 002_feriados_2026.sql y 003_version_1_1.sql. Para actualizar 0.1: solo 003. La migración es transaccional y de una sola ejecución. No contiene datos del archivo de pacientes de ejemplo.

```powershell
pnpm test
pnpm build
```

Subir los archivos de dist (o un ZIP con ellos en su raíz) a una implementación de PRODUCCIÓN del proyecto Cloudflare Pages registro-de-bloqueos. El ZIP no incluye .env.local ni archivos de pacientes. No cambiar la Site URL de Supabase: ya apunta al dominio actual y permite raíz y /recuperar.

## Integridad y archivos
- RLS en tablas y Storage; bucket pacientes-citados PRIVADO, sin URLs públicas.
- Insertar bloqueo y metadatos de nóminas se realiza en una única RPC transaccional después de subir los originales. Un fallo no deja un bloqueo incompleto; la app intenta limpiar archivos sin vínculo.
- Los originales y los metadatos de nómina no tienen permisos de edición ni eliminación desde la app. Cada original conserva hash SHA-256 y fecha asignada. No son una copia de seguridad.
- Consulta de archivos con sesión autenticada y RLS. No se crean enlaces públicos ni permanentes para pacientes.
- La extracción tabular conserva valores literales; el original es la fuente. No interpreta diagnósticos ni corrige identificadores. Un PDF ambiguo queda para descarga, sin tabla inventada.
- Conteo de lunes a sábado, sin domingos ni feriados. Una fecha por profesional, aunque haya varias agendas. Calendarios deben revisarse y confirmarse.
- Control de versiones evita sobrescribir cambios simultáneos; historial anterior permanece en la base.
- Realtime avisa cambios y cada cliente consulta nuevamente con RLS. Hay actualización de respaldo cada 30 segundos con pestaña visible.

## Validación
Pruebas de modelo y XLSX, 21 pruebas de la base inicial, 29 verificaciones adicionales de permisos/atomicidad/cambio de correo y pruebas de lectura HTML/PDF espacial. Reporte PDF de datos sintéticos renderizado para revisión visual. QA del formulario y menú en navegador local. Ver docs/ESTADO_INSTALACION.md para el estado de publicación y límites de la comprobación real.

El ejemplo local se leyó solo para verificar estructura (15 filas, 13 columnas). No está incluido en este código ni en los ZIP. outputs contiene únicamente material sintético de QA y se excluye del paquete fuente.

## Respaldo
Respaldar PostgreSQL y el contenido de Storage por separado. Una exportación Excel no conserva usuarios, roles, historial ni documentos. Ver docs/OPERACION_Y_RESPALDOS.md. Definir y comprobar una restauración antes de depender de este sistema como registro único.

Referencias técnicas: https://supabase.com/docs/guides/storage/security/access-control y https://supabase.com/docs/reference/javascript/auth-updateuser

## Migración de 1.1 a 1.2
Ejecutar una sola vez `database/004_agendas_reference.sql` y `database/005_professionals_seed.sql`. Ya aplicadas en el proyecto actual. El directorio queda protegido por sesión y no se incluye en el JavaScript público. `src/demo-agendas.ts` solo se carga cuando DEV es verdadero; datos sintéticos de QA no se compilan en producción.

Para poblar sesiones reales se requiere establecimiento, profesional, profesión si está disponible, nombre/código de agenda, fecha de atención, hora de inicio/término y cupos originales cuando se informen. La programación real no se deriva del simple vínculo con un establecimiento. Los cambios manuales y cargas 2027 están reservados a versiones posteriores.

## Versión 1.3: cargas y fichas
En Agendas por establecimiento, los perfiles Administrativo y Avanzado pueden seleccionar hasta seis archivos (20 MB por archivo), revisar la vista previa y confirmar. Se admiten Excel .xlsx con los 14 encabezados SISMAULE, PDF de texto con encabezados reconocibles y tablas HTML guardadas como .php/.html. PHP nunca se ejecuta. Los formatos PDF ambiguos o escaneados se rechazan con una indicación para exportar a Excel; no se inventa OCR.

La nómina PDF consolidada se reconoce por sus columnas; se excluyen sus anexos. Se mantiene una ficha por establecimiento y código, con profesión estandarizada y nombre literal. No se fusionan nombres parecidos ni profesiones contradictorias. La nómina anterior permanece conservada como fuente anterior; las fichas no son un conteo certificado de personas únicas. Profesionales permite ingreso y edición manual, con control de versión, alias del nombre anterior y auditoría. Los códigos de una ficha importada son inmutables. Una recarga del PDF conserva las correcciones manuales de profesión.

Las reglas conservan fecha inicial/final, día semanal, hora, intervalo, cupos, Escalonada, Generada, Atención y fila de origen. El calendario solo crea ocurrencias en fechas compatibles con el día de semana; los rangos sin ese día se mantienen para revisión. No omite automáticamente feriados si la fuente programa atención. Esto no cambia el cálculo de días hábiles de inasistencia.

El período abarca los meses de todas las agendas, incluso 2027. Las franjas consecutivas de la misma agenda y tipo de atención se reúnen visualmente; se conservan huecos y cupos originales. Las marcas BLOQUEADA y Generada=NO proceden de SISMAULE y se muestran diferenciadas. Los bloqueos de la app se cruzan con establecimiento, ficha/nombres conservados, código o nombre de agenda, fecha y horario. Los cupos múltiples conservan hora e intervalo sin inferir el término hasta confirmar su interpretación.

Cada archivo se confirma en una transacción. Su SHA-256 evita repetir la misma carga, una clave de contenido evita reglas idénticas y los cambios incompatibles con una regla anterior requieren revisión. No hay sustitución destructiva automática. Las tablas tienen RLS: Solo vista consulta; Administrativo/Avanzado importan y editan referencias mediante RPC; el historial de referencias solo lo lee Avanzado. No se modifica el acceso a pacientes.

Instalación: aplicar una sola vez database/006_agenda_import.sql y database/007_import_serialization.sql después de 005 y publicar dist. No incluir outputs, archivos de pacientes, .env.local ni node_modules al distribuir código. Las fuentes proporcionadas se cargan desde la interfaz; no se incluyen en el JavaScript público.

La migración 008 coteja las 1066 fichas iniciales con una extracción independiente del PDF, conservando correcciones manuales. El parser se verificó fila por fila: 1066 nombres y profesiones idénticos; tiene una regresión específica para profesiones que ocupan dos líneas.

La migración 009 incorpora Los Carros en la validación de bloqueos. En el proyecto actual ya están aplicadas 006–009; no repetir 006.

La migración 010 permite consultar el catálogo completo en una única respuesta, respetando RLS. Ya aplicada junto con 006–009 en el proyecto actual.

## Versión 1.4: bloqueos desde archivo del sistema y menú de perfil
- Menú del círculo superior derecho con nombres por tarea: Mi perfil y contraseña, Preferencias de pantalla, Guía de uso, Administrar accesos de usuarios (solo avanzada) y Cerrar sesión. Los textos de ayuda 8 y 9 pasaron a Modo de uso.
- En Bloqueos, Administrativo y Avanzado tienen **Agregar archivo** (hasta 6 PDF de texto, HTML o páginas guardadas .php; 20 MB c/u). Vista previa antes de confirmar. PHP nunca se ejecuta.
- Sin duplicados: el mismo archivo (SHA-256) no se acepta dos veces; un código ya importado o ya ingresado en la app no se repite. Sin código, se identifica por profesional + establecimiento + fecha de inicio. Las recargas solo completan campos vacíos; nunca sobrescriben datos ya guardados.
- Los bloqueos importados aparecen en la misma lista con la etiqueta Archivo del sistema. Si falta código, establecimiento válido, profesional, fechas o tipo, la fila se marca en rojo con ⚠ Información incompleta. No se cuentan en Días ni en informes hasta que se registren en la app.
- Instalación: ejecutar una sola vez `database/011_bloqueos_sistema.sql` (después de 010) en el SQL Editor de Supabase y publicar dist. Sin la migración, la app sigue funcionando y la lista simplemente no muestra bloqueos importados.
