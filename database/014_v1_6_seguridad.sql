-- Versión 1.6 · Seguridad. YA APLICADA en Supabase (proyecto App bloqueos) el 04-11-2026
-- con el nombre 014_v1_6_seguridad_revocar_permisos_sobrantes. NO volver a ejecutar sin necesidad
-- (es idempotente, pero no hace falta).
-- Defensa en profundidad: ningún permiso innecesario sobre las tablas de la app.
revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;
alter default privileges in schema public revoke all on tables from anon;
