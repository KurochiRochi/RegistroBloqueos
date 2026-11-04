# Seguridad — versión 1.6 — 4 de noviembre de 2026

## Base de datos (Supabase)
- RLS activo en las 18 tablas; lectura solo para perfiles activos; escritura solo vía funciones o políticas por rol.
- El trigger `protect_profile` impide cambiarse el rol, desactivar a la administradora principal o crear otro perfil avanzado.
- Funciones `SECURITY DEFINER`: todas con `search_path` fijo, sin acceso de `anon` y con validación de rol interna. Las alertas del linter sobre ellas son esperadas.
- Buckets `pacientes-citados` y `agenda-imagenes`: privados, con tope de tamaño y tipos permitidos.
- 1.6: se quitaron `TRUNCATE`, `REFERENCES` y `TRIGGER` a `authenticated` y todos los permisos a `anon` (migración 014).

## Sitio (Cloudflare Pages, `public/_headers`)
- CSP estricta (`script-src 'self'`, sin `eval`, sin scripts externos), `frame-ancestors 'none'`, HSTS, COOP/CORP, `nosniff`, Permissions-Policy restrictiva.
- 1.6: `img-src` y `worker-src` admiten `blob:` (vistas previas de imágenes y PDF) y se agregó `upgrade-insecure-requests`.
- Pendiente conocido: `style-src` conserva `'unsafe-inline'` por los estilos en línea de React.

## Código
- Sin `innerHTML`, `eval` ni claves secretas en el repositorio. Solo la clave publicable de Supabase (pública por diseño; la protege RLS).
- 1.6: `fflate` 0.8.3 (corrige bucle infinito con ZIP dañado) y `vite` 8.1.6 (avisos del servidor de desarrollo).
- Función `enviar-observacion`: CORS limitado al sitio, valida el id, exige sesión y limpia saltos de línea del asunto.

## Acciones manuales (no se pueden hacer desde el código)
1. Supabase → Authentication → Providers → Email: activar **Leaked password protection**.
2. Activar **2FA** en Supabase, Cloudflare, GitHub y el correo.
3. Revisar de vez en cuando los avisos: Supabase → Advisors (Security).
4. Respaldos: exportar la base periódicamente (ver OPERACION_Y_RESPALDOS.md).
