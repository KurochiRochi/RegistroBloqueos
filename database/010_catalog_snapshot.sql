-- Una respuesta consistente: evita decenas de viajes REST para catálogos grandes.
begin;
create function public.agenda_catalog_v13() returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if private.app_role() is null then raise exception 'No autorizado';end if;
 return jsonb_build_object(
 'periods',coalesce((select jsonb_agg(to_jsonb(p) order by p.starts_on,p.id) from public.agenda_periods p),'[]'::jsonb),
 'professionals',coalesce((select jsonb_agg(to_jsonb(p) order by p.name,p.id) from public.catalog_professionals p),'[]'::jsonb),
 'sessions',coalesce((select jsonb_agg(to_jsonb(p) order by p.service_day,p.id) from public.agenda_sessions p),'[]'::jsonb),
 'rules',coalesce((select jsonb_agg(to_jsonb(p) order by p.starts_on,p.id) from public.agenda_rules p),'[]'::jsonb),
 'imports',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at,p.id) from public.agenda_imports p),'[]'::jsonb));
end;$$;
revoke all on function public.agenda_catalog_v13() from public,anon;
grant execute on function public.agenda_catalog_v13() to authenticated;
notify pgrst,'reload schema';
commit;
