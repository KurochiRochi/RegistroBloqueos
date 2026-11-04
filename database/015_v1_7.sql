-- Versión 1.7 · Eliminar bloqueos (archivado con historial) y reutilizar códigos.
-- Ejecutar una sola vez después de 014.
begin;
-- El código SISMAULE sigue siendo único entre los bloqueos ACTIVOS; uno eliminado
-- (archivado) conserva su historial y libera el código para volver a registrarlo.
alter table public.bloqueos drop constraint if exists "bloqueos_Codigo_Bloqueo_key";
create unique index if not exists bloqueos_codigo_activo
  on public.bloqueos (lower(trim("Codigo_Bloqueo"))) where archived = 0;
commit;
