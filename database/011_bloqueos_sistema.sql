-- 1.4: bloqueos importados desde archivos del sistema (PDF/HTML/PHP guardado).
-- Ejecutar una sola vez después de 010. No modifica public.bloqueos ni sus reglas.
begin;
create table public.bloqueos_sistema_cargas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check(length(nombre) between 1 and 250),
  sha256 text not null unique check(sha256 ~ '^[0-9a-f]{64}$'),
  filas integer not null,
  nuevos integer not null,
  completados integer not null,
  repetidos integer not null,
  actor_id uuid not null default auth.uid(),
  actor_name text not null default '',
  fecha timestamptz not null default now()
);
create table public.bloqueos_sistema (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique check(length(clave) between 1 and 300),
  codigo text not null default '' check(length(codigo)<=250),
  establecimiento text not null default '' check(length(establecimiento)<=250),
  profesional text not null default '' check(length(profesional)<=250),
  profesion text not null default '' check(length(profesion)<=150),
  agenda text not null default '' check(length(agenda)<=500),
  tipo text not null default '' check(length(tipo)<=250),
  observacion text not null default '' check(length(observacion)<=3000),
  fecha_inicio date,
  fecha_termino date,
  hora_inicio text not null default '' check(hora_inicio ~ '^([0-2][0-9]:[0-5][0-9])?$'),
  hora_termino text not null default '' check(hora_termino ~ '^([0-2][0-9]:[0-5][0-9])?$'),
  carga_id uuid not null references public.bloqueos_sistema_cargas(id),
  fila integer not null default 0,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index bloqueos_sistema_codigo on public.bloqueos_sistema(lower(codigo)) where codigo<>'';
alter table public.bloqueos_sistema enable row level security;
alter table public.bloqueos_sistema_cargas enable row level security;
create policy bloqueos_sistema_read on public.bloqueos_sistema for select to authenticated using(private.app_role() is not null);
create policy bloqueos_sistema_cargas_read on public.bloqueos_sistema_cargas for select to authenticated using(private.app_role() is not null);

-- Una sola RPC transaccional. Nunca sobrescribe un dato ya guardado: solo completa campos vacíos.
-- Clave = código del bloqueo; sin código, huella de profesional+establecimiento+fecha de inicio
-- (datos que no cambian al completar faltantes en cargas posteriores).
create function public.import_bloqueos_sistema(meta jsonb, entries jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  role text := private.app_role();
  carga uuid; e jsonb; k text; existing public.bloqueos_sistema;
  n_new int := 0; n_fill int := 0; n_rep int := 0; n_manual int := 0; seen text[] := '{}';
  fi date; ft date;
begin
  if role is null or role not in ('administrativo','avanzado') then
    raise exception 'Tu perfil no permite cargar bloqueos.' using errcode='42501';
  end if;
  if jsonb_typeof(entries)<>'array' or jsonb_array_length(entries) between 1 and 20000 is not true then
    raise exception 'El archivo debe contener entre 1 y 20000 filas.';
  end if;
  perform pg_advisory_xact_lock(137814);
  if exists(select 1 from public.bloqueos_sistema_cargas where sha256=meta->>'sha256') then
    raise exception 'Este archivo ya fue cargado anteriormente.' using errcode='23505';
  end if;
  insert into public.bloqueos_sistema_cargas(nombre,sha256,filas,nuevos,completados,repetidos,actor_name)
    values(left(meta->>'name',250),meta->>'sha256',jsonb_array_length(entries),0,0,0,
      coalesce((select display_name from public.profiles where auth_user_id=auth.uid()),''))
    returning id into carga;
  for e in select * from jsonb_array_elements(entries) loop
    fi := nullif(e->>'fecha_inicio','')::date;
    ft := nullif(e->>'fecha_termino','')::date;
    k := case when trim(coalesce(e->>'codigo',''))<>'' then 'c:'||lower(trim(e->>'codigo'))
      else 'h:'||md5(lower(concat_ws('|',trim(e->>'profesional'),trim(e->>'establecimiento'),fi))) end;
    if k = any(seen) then n_rep := n_rep+1; continue; end if;
    seen := seen || k;
    -- Ya ingresado manualmente en la app con el mismo código: no se duplica.
    if trim(coalesce(e->>'codigo',''))<>'' and exists(select 1 from public.bloqueos b
        where lower(trim(b."Codigo_Bloqueo"))=lower(trim(e->>'codigo'))) then
      n_manual := n_manual+1; continue;
    end if;
    select * into existing from public.bloqueos_sistema where clave=k;
    if not found then
      insert into public.bloqueos_sistema(clave,codigo,establecimiento,profesional,profesion,agenda,tipo,observacion,
        fecha_inicio,fecha_termino,hora_inicio,hora_termino,carga_id,fila)
      values(k,left(trim(coalesce(e->>'codigo','')),250),left(coalesce(e->>'establecimiento',''),250),
        left(coalesce(e->>'profesional',''),250),left(coalesce(e->>'profesion',''),150),left(coalesce(e->>'agenda',''),500),
        left(coalesce(e->>'tipo',''),250),left(coalesce(e->>'observacion',''),3000),fi,ft,
        coalesce(e->>'hora_inicio',''),coalesce(e->>'hora_termino',''),carga,coalesce((e->>'fila')::int,0));
      n_new := n_new+1;
    else
      update public.bloqueos_sistema s set
        establecimiento=case when s.establecimiento='' then left(coalesce(e->>'establecimiento',''),250) else s.establecimiento end,
        profesional=case when s.profesional='' then left(coalesce(e->>'profesional',''),250) else s.profesional end,
        profesion=case when s.profesion='' then left(coalesce(e->>'profesion',''),150) else s.profesion end,
        agenda=case when s.agenda='' then left(coalesce(e->>'agenda',''),500) else s.agenda end,
        tipo=case when s.tipo='' then left(coalesce(e->>'tipo',''),250) else s.tipo end,
        observacion=case when s.observacion='' then left(coalesce(e->>'observacion',''),3000) else s.observacion end,
        fecha_inicio=coalesce(s.fecha_inicio,fi), fecha_termino=coalesce(s.fecha_termino,ft),
        hora_inicio=case when s.hora_inicio='' then coalesce(e->>'hora_inicio','') else s.hora_inicio end,
        hora_termino=case when s.hora_termino='' then coalesce(e->>'hora_termino','') else s.hora_termino end,
        actualizado=now()
      where s.id=existing.id
        and ((s.establecimiento='' and coalesce(e->>'establecimiento','')<>'') or (s.profesional='' and coalesce(e->>'profesional','')<>'')
          or (s.profesion='' and coalesce(e->>'profesion','')<>'') or (s.agenda='' and coalesce(e->>'agenda','')<>'')
          or (s.tipo='' and coalesce(e->>'tipo','')<>'') or (s.observacion='' and coalesce(e->>'observacion','')<>'')
          or (s.fecha_inicio is null and fi is not null) or (s.fecha_termino is null and ft is not null)
          or (s.hora_inicio='' and coalesce(e->>'hora_inicio','')<>'') or (s.hora_termino='' and coalesce(e->>'hora_termino','')<>''));
      if found then n_fill := n_fill+1; else n_rep := n_rep+1; end if;
    end if;
  end loop;
  update public.bloqueos_sistema_cargas set nuevos=n_new,completados=n_fill,repetidos=n_rep+n_manual where id=carga;
  return jsonb_build_object('nuevos',n_new,'completados',n_fill,'repetidos',n_rep,'ya_en_app',n_manual);
end $$;
revoke all on public.bloqueos_sistema,public.bloqueos_sistema_cargas from public,anon,authenticated;
grant select on public.bloqueos_sistema,public.bloqueos_sistema_cargas to authenticated;
revoke all on function public.import_bloqueos_sistema(jsonb,jsonb) from public,anon;
grant execute on function public.import_bloqueos_sistema(jsonb,jsonb) to authenticated;
alter publication supabase_realtime add table public.bloqueos_sistema;
commit;
