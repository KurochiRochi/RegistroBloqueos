-- Versión 1.6: agenda por recurso (PDF SISMAULE), listas de referencia (Excel
-- "BD Profesionales y Agenda") e ingreso manual de agendas con la estructura de SISMAULE.
-- Ejecutar una sola vez después de 012.
begin;

-- 1. Tipos de carga admitidos.
alter table public.agenda_imports drop constraint if exists agenda_imports_kind_check;
alter table public.agenda_imports add constraint agenda_imports_kind_check
  check (kind in ('agendas','professionals','manual','recurso','listas'));

-- 2. Sesiones con detalle de la "Gestión Agendas por Recurso".
alter table public.agenda_sessions
  add column if not exists source_blocked boolean not null default false,
  add column if not exists attention text not null default '' check (length(attention) <= 250),
  add column if not exists booked integer check (booked is null or booked >= 0),
  add column if not exists interval_minutes integer check (interval_minutes is null or interval_minutes between 1 and 1440),
  add column if not exists source_row text not null default '' check (length(source_row) <= 2000),
  add column if not exists import_id uuid references public.agenda_imports(id) on delete set null;

-- 3. Lista de nombres de agenda (autocompletado).
create table if not exists public.catalog_agendas (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 250),
  source_name text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists catalog_agendas_name_key on public.catalog_agendas (upper(trim(name)));
alter table public.catalog_agendas enable row level security;
drop policy if exists catalog_agendas_read on public.catalog_agendas;
create policy catalog_agendas_read on public.catalog_agendas for select to authenticated using (private.app_role() is not null);
grant select on public.catalog_agendas to authenticated;

-- 4. Agenda manual con la estructura de SISMAULE: cabecera, detalle semanal y distribución de cupos.
create table if not exists public.manual_agendas (
  id uuid primary key default gen_random_uuid(),
  corr bigint generated always as identity,
  professional_id uuid not null references public.catalog_professionals(id),
  establishment text not null check (establishment in ('Buenos Aires','Arrau Méndez','Los Olivos','Viña del Mar','Los Carros','Rural')),
  agenda_code text not null default '' check (length(agenda_code) <= 100),
  agenda_name text not null check (length(trim(agenda_name)) between 1 and 250),
  starts_on date not null check (starts_on >= '2000-01-01'),
  ends_on date not null check (ends_on <= '2100-12-31'),
  closed_on date,
  generated boolean not null default false,
  staggered boolean not null default false,
  requires_record boolean not null default true,
  funding text not null default 'PRODUCCIÓN - PRESTACIÓN INSTITUCIONAL' check (length(funding) <= 150),
  agenda_type text not null default 'Consulta' check (agenda_type in ('Consulta','Procedimiento')),
  multi_hour boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (closed_on is null or closed_on >= starts_on)
);
create table if not exists public.manual_agenda_details (
  id uuid primary key default gen_random_uuid(),
  manual_agenda_id uuid not null references public.manual_agendas(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  starts_at time not null,
  interval_minutes integer not null check (interval_minutes between 1 and 1440),
  capacity integer not null check (capacity between 1 and 1000),
  box text not null default '' check (length(box) <= 50),
  created_at timestamptz not null default now()
);
create table if not exists public.manual_agenda_quotas (
  id uuid primary key default gen_random_uuid(),
  detail_id uuid not null references public.manual_agenda_details(id) on delete cascade,
  establishment text not null check (establishment in ('Buenos Aires','Arrau Méndez','Los Olivos','Viña del Mar','Los Carros','Rural')),
  attention text not null check (attention in ('CONTROL','NUEVO')),
  capacity integer not null check (capacity between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists manual_agenda_details_agenda on public.manual_agenda_details (manual_agenda_id);
create index if not exists manual_agenda_quotas_detail on public.manual_agenda_quotas (detail_id);

alter table public.manual_agendas enable row level security;
alter table public.manual_agenda_details enable row level security;
alter table public.manual_agenda_quotas enable row level security;
do $$ declare t text; begin
  foreach t in array array['manual_agendas','manual_agenda_details','manual_agenda_quotas'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (private.app_role() is not null)', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (private.app_role() in (''administrativo'',''avanzado'')) with check (private.app_role() in (''administrativo'',''avanzado''))', t);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated', t);
  end loop;
end $$;

-- Período: abarca los meses de cualquier programación cargada.
create or replace function private.extend_period(lo date, hi date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare period uuid; a date := date_trunc('month', lo)::date; z date := (date_trunc('month', hi) + interval '1 month -1 day')::date;
begin
  select id into period from public.agenda_periods order by starts_on, id limit 1;
  if period is null then
    insert into public.agenda_periods(label, starts_on, ends_on, source_name, programming_loaded)
    values ('Programación cargada', a, z, 'Archivos importados', true) returning id into period;
  else
    update public.agenda_periods set starts_on = least(starts_on, a), ends_on = greatest(ends_on, z), programming_loaded = true where id = period;
  end if;
  return period;
end $$;

-- Vincula el profesional con el establecimiento cuando tiene agenda.
create or replace function private.link_professional(pid uuid, est text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.catalog_professionals
     set classification = 'regular',
         establishments = (select array_agg(distinct e) from unnest(establishments || array[est]) e),
         version = version + 1
   where id = pid and (classification <> 'regular' or not (est = any(establishments)));
end $$;

create or replace function private.manual_agenda_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(private.app_role(), '') not in ('administrativo','avanzado') then raise exception 'No autorizado'; end if;
  if not exists (select 1 from public.catalog_professionals where id = new.professional_id) then
    raise exception 'Recurso no encontrado';
  end if;
  new.updated_at := now();
  perform private.link_professional(new.professional_id, new.establishment);
  perform private.extend_period(new.starts_on, coalesce(least(new.closed_on, new.ends_on), new.ends_on));
  return new;
end $$;
drop trigger if exists manual_agenda_guard on public.manual_agendas;
create trigger manual_agenda_guard before insert or update on public.manual_agendas
  for each row execute function private.manual_agenda_guard();

-- Los cupos distribuidos no pueden superar los cupos del detalle.
create or replace function private.manual_quota_guard()
returns trigger language plpgsql set search_path = '' as $$
declare total integer; cap integer;
begin
  select capacity into cap from public.manual_agenda_details where id = new.detail_id;
  select coalesce(sum(capacity), 0) into total from public.manual_agenda_quotas where detail_id = new.detail_id and id <> new.id;
  if total + new.capacity > cap then
    raise exception 'La distribución supera los % cupos del detalle', cap;
  end if;
  return new;
end $$;
drop trigger if exists manual_quota_guard on public.manual_agenda_quotas;
create trigger manual_quota_guard before insert or update on public.manual_agenda_quotas
  for each row execute function private.manual_quota_guard();

create or replace function private.manual_detail_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.capacity < (select coalesce(sum(capacity), 0) from public.manual_agenda_quotas where detail_id = new.id) then
    raise exception 'Los cupos del detalle no pueden ser menores que los ya distribuidos';
  end if;
  return new;
end $$;
drop trigger if exists manual_detail_guard on public.manual_agenda_details;
create trigger manual_detail_guard before update on public.manual_agenda_details
  for each row execute function private.manual_detail_guard();

-- Copiar agenda con su detalle y distribución en nuevas fechas.
create or replace function public.copy_manual_agenda(source uuid, new_start date, new_end date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.manual_agendas; nid uuid; d record; did uuid;
begin
  if coalesce(private.app_role(), '') not in ('administrativo','avanzado') then raise exception 'No autorizado'; end if;
  if new_start is null or new_end is null or new_end < new_start then raise exception 'Revisa las fechas'; end if;
  select * into a from public.manual_agendas where id = source;
  if not found then raise exception 'Agenda no encontrada'; end if;
  insert into public.manual_agendas(professional_id, establishment, agenda_code, agenda_name, starts_on, ends_on, staggered, requires_record, funding, agenda_type, multi_hour)
  values (a.professional_id, a.establishment, a.agenda_code, a.agenda_name, new_start, new_end, a.staggered, a.requires_record, a.funding, a.agenda_type, a.multi_hour)
  returning id into nid;
  for d in select * from public.manual_agenda_details where manual_agenda_id = source loop
    insert into public.manual_agenda_details(manual_agenda_id, weekday, starts_at, interval_minutes, capacity, box)
    values (nid, d.weekday, d.starts_at, d.interval_minutes, d.capacity, d.box) returning id into did;
    insert into public.manual_agenda_quotas(detail_id, establishment, attention, capacity)
    select did, establishment, attention, capacity from public.manual_agenda_quotas where detail_id = d.id;
  end loop;
  return nid;
end $$;
revoke all on function public.copy_manual_agenda(uuid, date, date) from public, anon;
grant execute on function public.copy_manual_agenda(uuid, date, date) to authenticated;

-- 5. Listas del Excel "BD Profesionales y Agenda": profesionales y nombres de agenda.
create or replace function public.import_reference_lists(meta jsonb, professionals jsonb, agendas jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare imp uuid; np integer := 0; na integer := 0; n integer; nm text;
begin
  if coalesce(private.app_role(), '') not in ('administrativo','avanzado') then raise exception 'No autorizado'; end if;
  if jsonb_typeof(professionals) <> 'array' or jsonb_typeof(agendas) <> 'array'
     or jsonb_array_length(professionals) + jsonb_array_length(agendas) not between 1 and 10000 then
    raise exception 'Listas inválidas';
  end if;
  perform pg_advisory_xact_lock(137813);
  if exists (select 1 from public.agenda_imports where sha256 = meta->>'sha256') then
    return jsonb_build_object('already_loaded', true);
  end if;
  insert into public.agenda_imports(sha256, name, kind, row_count)
  values (meta->>'sha256', left(meta->>'name', 250), 'listas', jsonb_array_length(professionals) + jsonb_array_length(agendas))
  returning id into imp;
  for nm in select distinct regexp_replace(trim(v), '\s+', ' ', 'g') from jsonb_array_elements_text(professionals) v where length(trim(v)) between 1 and 250 loop
    if not exists (
      select 1 from public.catalog_professionals p
       where upper(p.name) = upper(nm) or exists (select 1 from unnest(p.aliases) a where upper(a) = upper(nm))
    ) then
      insert into public.catalog_professionals(source_key, name, profession, source_assignment, classification, establishments, source_name, source_origin)
      values ('lista:' || md5(upper(nm)), nm, '', 'Lista BD Profesionales', 'pending', '{}', left(meta->>'name', 250), 'Excel BD Profesionales y Agenda')
      on conflict (source_key) do nothing;
      get diagnostics n = row_count; np := np + n;
    end if;
  end loop;
  for nm in select distinct regexp_replace(trim(v), '\s+', ' ', 'g') from jsonb_array_elements_text(agendas) v where length(trim(v)) between 1 and 250 loop
    insert into public.catalog_agendas(name, source_name) values (nm, left(meta->>'name', 250))
    on conflict ((upper(trim(name)))) do nothing;
    get diagnostics n = row_count; na := na + n;
  end loop;
  update public.agenda_imports set inserted_count = np + na where id = imp;
  return jsonb_build_object('professionals', np, 'agendas', na, 'import_id', imp);
end $$;
revoke all on function public.import_reference_lists(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.import_reference_lists(jsonb, jsonb, jsonb) to authenticated;

-- 6. PDF "Gestión Agendas por Recurso": agenda activa (negro) y bloqueada (rojo) por día.
-- Reemplaza la programación anterior del mismo profesional y establecimiento solo en los días que cubre el archivo.
create or replace function public.import_resource_agenda(meta jsonb, entries jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare imp uuid; pid uuid; pname text; est text := meta->>'establishment'; lo date; hi date; period uuid; n integer; removed integer; created boolean := false;
begin
  if coalesce(private.app_role(), '') not in ('administrativo','avanzado') then raise exception 'No autorizado'; end if;
  if est is null or est not in ('Buenos Aires','Arrau Méndez','Los Olivos','Viña del Mar','Los Carros','Rural') then raise exception 'Selecciona el establecimiento'; end if;
  if jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) not between 1 and 20000 then raise exception 'El archivo no tiene filas de agenda'; end if;
  perform pg_advisory_xact_lock(137813);
  if exists (select 1 from public.agenda_imports where sha256 = meta->>'sha256') then raise exception 'Este archivo ya fue cargado'; end if;
  pid := nullif(meta->>'professional_id', '')::uuid;
  pname := regexp_replace(trim(coalesce(meta->>'professional_name', '')), '\s+', ' ', 'g');
  if pid is not null then
    select name into pname from public.catalog_professionals where id = pid;
    if not found then raise exception 'Profesional no encontrado'; end if;
  else
    if length(pname) not between 3 and 250 then raise exception 'Indica el profesional del archivo'; end if;
    select id into pid from public.catalog_professionals p
     where upper(p.name) = upper(pname) or exists (select 1 from unnest(p.aliases) a where upper(a) = upper(pname))
     order by (est = any(p.establishments)) desc, p.name limit 1;
    if pid is null then
      insert into public.catalog_professionals(source_key, name, profession, source_assignment, classification, establishments, source_name, source_origin)
      values ('recurso:' || md5(upper(pname)), upper(pname), '', est, 'regular', array[est], left(meta->>'name', 250), 'PDF Gestión Agendas por Recurso')
      on conflict (source_key) do update set name = excluded.name
      returning id into pid;
      created := true;
    end if;
  end if;
  perform private.link_professional(pid, est);
  select min(x.service_day), max(x.service_day) into lo, hi from jsonb_to_recordset(entries) x(service_day date);
  if lo is null then raise exception 'Fechas no reconocidas'; end if;
  period := private.extend_period(lo, hi);
  insert into public.agenda_imports(sha256, name, kind, row_count)
  values (meta->>'sha256', left(meta->>'name', 250), 'recurso', jsonb_array_length(entries)) returning id into imp;
  delete from public.agenda_sessions where professional_id = pid and establishment = est and service_day between lo and hi;
  get diagnostics removed = row_count;
  insert into public.agenda_sessions(period_id, professional_id, establishment, agenda_name, agenda_code, service_day, starts_at, ends_at, capacity, booked, interval_minutes, attention, source_blocked, source_row, source_name, import_id)
  select period, pid, est, left(trim(x.agenda_name), 250), left(coalesce(x.agenda_code, ''), 100), x.service_day, x.starts_at, x.ends_at,
         greatest(0, x.capacity), greatest(0, x.booked), x.interval_minutes, left(coalesce(x.attention, ''), 250), coalesce(x.source_blocked, false),
         left(coalesce(x.source_row, ''), 2000), left(meta->>'name', 250), imp
    from jsonb_to_recordset(entries) x(service_day date, starts_at time, ends_at time, capacity integer, booked integer, interval_minutes integer,
                                       agenda_code text, agenda_name text, attention text, source_blocked boolean, source_row text)
   where length(trim(coalesce(x.agenda_name, ''))) > 0;
  get diagnostics n = row_count;
  update public.agenda_imports set inserted_count = n where id = imp;
  return jsonb_build_object('inserted', n, 'replaced', removed, 'professional_id', pid, 'professional_name', pname, 'created_professional', created, 'from', lo, 'until', hi);
end $$;
revoke all on function public.import_resource_agenda(jsonb, jsonb) from public, anon;
grant execute on function public.import_resource_agenda(jsonb, jsonb) to authenticated;

-- 7. Catálogo: incluye nombres de agenda y agendas manuales.
create or replace function public.agenda_catalog_v13()
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if private.app_role() is null then raise exception 'No autorizado'; end if;
  return jsonb_build_object(
    'periods', coalesce((select jsonb_agg(to_jsonb(p) order by p.starts_on, p.id) from public.agenda_periods p), '[]'::jsonb),
    'professionals', coalesce((select jsonb_agg(to_jsonb(p) order by p.name, p.id) from public.catalog_professionals p), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(to_jsonb(p) order by p.service_day, p.starts_at, p.id) from public.agenda_sessions p), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(to_jsonb(p) order by p.starts_on, p.id) from public.agenda_rules p), '[]'::jsonb),
    'imports', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at, p.id) from public.agenda_imports p), '[]'::jsonb),
    'agenda_names', coalesce((select jsonb_agg(p.name order by p.name) from public.catalog_agendas p), '[]'::jsonb),
    'manual', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('details', coalesce((
        select jsonb_agg(to_jsonb(d) || jsonb_build_object('quotas', coalesce((
            select jsonb_agg(to_jsonb(q) order by q.created_at, q.id) from public.manual_agenda_quotas q where q.detail_id = d.id), '[]'::jsonb))
          order by d.weekday = 0, d.weekday, d.starts_at, d.id)
        from public.manual_agenda_details d where d.manual_agenda_id = m.id), '[]'::jsonb))
      order by m.corr desc) from public.manual_agendas m), '[]'::jsonb)
  );
end $$;

do $$ declare t text; begin
  foreach t in array array['catalog_agendas','manual_agendas','manual_agenda_details','manual_agenda_quotas'] loop
    begin execute format('alter publication supabase_realtime add table public.%s', t); exception when others then null; end;
  end loop;
end $$;

commit;
