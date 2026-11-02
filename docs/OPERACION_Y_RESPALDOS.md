# Operación y respaldo — propuesta para acordar con la unidad

## Qué significa elegir una base definitiva

Es decidir dónde vivirán los registros oficiales, quién controla la cuenta, qué disponibilidad necesitan, cómo se respalda y cómo se recupera. No es comprar un Excel más grande ni instalar una copia de base en cada computador. Una base central permite a todos trabajar sobre el mismo registro.

La propuesta preparada es PostgreSQL administrado en Supabase con autenticación propia. La página puede alojarse aparte, en una cuenta propia de la unidad. Las dos cuentas y el dominio deben quedar bajo control institucional, con recuperación de acceso documentada. No se han creado ni contratado estos servicios.

## Antes de comenzar el uso operativo

- Definir responsables de administración de aplicación, infraestructura y respaldos. Son responsabilidades distintas; ser avanzado dentro de Bloquea no concede acceso al panel del proveedor.
- Configurar los correos individuales y decidir el rol de cada uno. La cuenta común atribuye los cambios a la unidad y no permite identificar a la persona.
- Verificar el calendario de feriados aplicable. La carga nacional inicial de 2026 proviene del [Gobierno de Chile](https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/); no presume feriados locales ni futuros.
- Registrar ubicación de código y de las variables públicas; las contraseñas y claves privadas permanecen en los gestores del proveedor.
- Si se ingresaron datos al sitio anterior, acordar la exportación y migración antes del cambio. Este paquete no mueve ni elimina datos del sitio anterior.

## Política inicial sugerida

| Elemento                 | Propuesta                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Frecuencia               | Una copia diaria fuera de la jornada de trabajo                                                                                      |
| Retención                | 30 copias diarias y 12 copias mensuales, sujetas a la política de conservación institucional                                         |
| Copia adicional          | Una copia cifrada en un destino distinto del proveedor principal, con acceso restringido                                             |
| Alcance                  | Esquema, registros, historial, perfiles, feriados y configuración recuperable; documentar por separado recuperación de Auth y correo |
| Antes de cambios         | Copia adicional antes de cada migración o carga masiva                                                                               |
| Prueba de recuperación   | Mensual en un entorno de prueba, con registro de fecha, responsable y resultado                                                      |
| Avisos                   | Notificar al responsable cuando falle la copia o no pueda verificarse                                                                |
| Objetivo de pérdida      | Como propuesta, no perder más de 24 horas de cambios; requiere copias exitosas y seguimiento                                         |
| Objetivo de recuperación | Acordar un plazo según el soporte real disponible y medirlo en las pruebas; no hay garantía de recuperación todavía                  |

Supabase documenta respaldo diario para proyectos Pro/Team/Enterprise y recomienda copias externas regulares para el plan gratuito. La retención y recuperación puntual dependen del plan. No asumir que una cuenta gratuita incluye la política anterior: debe verificarse y configurarse. [Documentación oficial](https://supabase.com/docs/guides/platform/backups).

Una exportación Excel contiene solo los campos del registro y el rango elegido. No incluye usuarios, permisos, historial completo, configuración ni recuperación de sesiones, por lo que no es un respaldo completo.

No guardar copias sin cifrar en cuentas personales ni distribuir contraseñas en el chat. Para recuperar, restaurar primero en un proyecto separado, verificar registros y permisos, y recién después planificar el cambio del servicio activo.

## Cómo se trabaja sin el asistente

1. Cada colega abre el enlace HTTPS externo y entra con su correo y contraseña.
2. Un avanzado habilita o modifica perfiles en Perfil y ajustes.
3. La base central recibe los ingresos y las demás pantallas se actualizan automáticamente.
4. Cualquier perfil autorizado descarga Excel tras seleccionar las dos fechas.
5. Los responsables de infraestructura revisan la salud del servicio, renovación de dominio y respaldos; el asistente no participa del flujo diario.

## Alcance pendiente

Las reglas de cupos (pregunta 3) y la definición de informes se mantienen en pausa. No se han programado reportes ni respaldos. La publicación externa y las pruebas de correo/sesión entre cuentas distintas requieren el proveedor elegido y su configuración real.

## Adjuntos desde 1.1
Respaldar también los objetos del bucket privado pacientes-citados. PostgreSQL conserva los metadatos y las filas extraídas; no incluye automáticamente el contenido binario de Storage. Mantener una copia cifrada separada, acceso restringido y probar que el hash de un original restaurado coincide con sha256. La periodicidad y retención deben acordarse con la unidad. No guardar archivos de pacientes en el repositorio de código ni en ZIP públicos.
