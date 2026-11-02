-- Ejecutar una sola vez en un proyecto Supabase propio, desde SQL Editor.
-- No contiene registros del Excel, contraseñas ni claves privadas.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
  email text primary key check(email=lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  display_name text not null check(length(display_name) between 1 and 150),
  role text not null check(role in ('normal','administrativo','avanzado')),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.profiles(email,display_name,role) values('jcontreras@saludparral.cl','Administración de agendas','avanzado');

create function private.app_role() returns text language sql stable security definer set search_path='' as $$
  select role from public.profiles where email=lower(auth.jwt()->>'email') and active and auth.uid() is not null;
$$;
revoke all on function private.app_role() from public;
grant execute on function private.app_role() to authenticated;
alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (private.app_role()='avanzado' or (email=lower(auth.jwt()->>'email') and auth.uid() is not null));
create policy profiles_insert on public.profiles for insert to authenticated with check (private.app_role()='avanzado');
create policy profiles_update on public.profiles for update to authenticated using (private.app_role()='avanzado') with check(private.app_role()='avanzado');
grant select,insert,update on public.profiles to authenticated;

create table public.calendar_years (
  year integer primary key check(year between 2000 and 2100),
  reviewed boolean not null default false,
  source text not null default '',
  updated_at timestamptz not null default now()
);
create table public.holidays (
  day date primary key check(day between '2000-01-01' and '2100-12-31'),
  name text not null check(length(name) between 1 and 200),
  source text not null default ''
);
alter table public.calendar_years enable row level security;
alter table public.holidays enable row level security;
create policy calendar_read on public.calendar_years for select to authenticated using(private.app_role() is not null);
create policy calendar_write on public.calendar_years for all to authenticated using(private.app_role()='avanzado') with check(private.app_role()='avanzado');
create policy holidays_read on public.holidays for select to authenticated using(private.app_role() is not null);
create policy holidays_write on public.holidays for all to authenticated using(private.app_role()='avanzado') with check(private.app_role()='avanzado');
grant select,insert,update on public.calendar_years to authenticated;
grant select,insert,update,delete on public.holidays to authenticated;

create function private.business_days(a date,b date) returns integer language sql stable security definer set search_path='' as $$
  select count(*)::integer from generate_series(0,b-a) n
  where extract(isodow from a+n)<>7 and not exists(select 1 from public.holidays h where h.day=a+n);
$$;
create function private.calendar_ready(a date,b date) returns boolean language sql stable security definer set search_path='' as $$
  select not exists(select 1 from generate_series(extract(year from a)::int,extract(year from b)::int) y
    where not exists(select 1 from public.calendar_years c where c.year=y and c.reviewed));
$$;
revoke all on function private.business_days(date,date), private.calendar_ready(date,date) from public;

create table public.bloqueos (
  id uuid primary key default gen_random_uuid(),
  "Codigo_Bloqueo" text not null unique check(length(trim("Codigo_Bloqueo")) between 1 and 250),
  "Establecimiento" text not null check(length(trim("Establecimiento")) between 1 and 250),
  "Sector" text not null default '' check(length("Sector")<=250),
  "Profesional" text not null check(length(trim("Profesional")) between 1 and 250),
  "Agenda" text not null default '' check(length("Agenda")<=250),
  "Tipo_Bloqueo" text not null check(length(trim("Tipo_Bloqueo")) between 1 and 250),
  "Observacion" text not null default '' check(length("Observacion")<=3000),
  "Fecha_Inicio" date not null check("Fecha_Inicio">='2000-01-01'),
  "Fecha_Termino" date not null check("Fecha_Termino"<='2100-12-31'),
  "Hora_Inicio" text not null default '',
  "Hora_Termino" text not null default '',
  "Tipo_Horario" text not null check(length(trim("Tipo_Horario")) between 1 and 250),
  "Cupos_Bloqueados" integer check("Cupos_Bloqueados" between 0 and 100000),
  "Dias_Bloqueo" integer not null default 0,
  archived integer not null default 0 check(archived in (0,1)),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  actor_id uuid not null default auth.uid(),
  actor_name text not null default '',
  check("Fecha_Termino">="Fecha_Inicio" and "Fecha_Termino"-"Fecha_Inicio"<=1826),
  check(("Hora_Inicio"='' and "Hora_Termino"='' and "Tipo_Horario"<>'RANGO HORARIO') or
    ("Hora_Inicio" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "Hora_Termino" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "Hora_Termino">"Hora_Inicio"))
);
create index bloqueos_fechas on public.bloqueos("Fecha_Inicio","Fecha_Termino");
create index bloqueos_profesional on public.bloqueos("Profesional");
create table public.historial (
  id bigint generated always as identity primary key,
  bloqueo_id uuid not null references public.bloqueos(id),
  codigo text not null,
  accion text not null,
  actor_id uuid not null,
  actor_name text not null,
  fecha timestamptz not null default now(),
  datos jsonb not null
);
create index historial_bloqueo on public.historial(bloqueo_id,id desc);
create table public.config_history (
  id bigint generated always as identity primary key,
  target text not null,
  actor_name text not null,
  fecha timestamptz not null default now(),
  datos jsonb not null
);
alter table public.bloqueos enable row level security;
alter table public.historial enable row level security;
alter table public.config_history enable row level security;
create policy bloqueos_read on public.bloqueos for select to authenticated using(private.app_role() is not null);
create policy bloqueos_insert on public.bloqueos for insert to authenticated with check(private.app_role() is not null and created_by=auth.uid());
create policy bloqueos_update on public.bloqueos for update to authenticated using(private.app_role() in ('administrativo','avanzado') or (private.app_role()='normal' and created_by=auth.uid())) with check(private.app_role() in ('administrativo','avanzado') or (private.app_role()='normal' and created_by=auth.uid()));
create policy historial_read on public.historial for select to authenticated using(private.app_role() in ('administrativo','avanzado') or (private.app_role()='normal' and exists(select 1 from public.bloqueos b where b.id=bloqueo_id and b.created_by=auth.uid())));
create policy config_read on public.config_history for select to authenticated using(private.app_role()='avanzado');
grant select,insert,update on public.bloqueos to authenticated;
grant select on public.historial,public.config_history to authenticated;
-- No se conceden DELETE ni escritura directa al historial.

create function private.validate_bloqueo() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if private.app_role() is null then raise exception 'Acceso no autorizado'; end if;
  new."Codigo_Bloqueo":=trim(new."Codigo_Bloqueo");
  new."Profesional":=trim(new."Profesional");
  if not private.calendar_ready(new."Fecha_Inicio",new."Fecha_Termino") then raise exception 'Revisa y confirma el calendario de feriados de todos los años del período'; end if;
  if tg_op='UPDATE' then
    if new.id<>old.id or new.created_by<>old.created_by or new.created_at<>old.created_at then raise exception 'No se puede cambiar la identidad del registro'; end if;
    if new.version<>old.version+1 then raise exception 'Versión inválida'; end if;
    if new.archived<>old.archived and private.app_role()='normal' then raise exception 'Archivar requiere perfil administrativo o avanzado'; end if;
  else
    if new.archived<>0 then raise exception 'Un bloqueo nuevo debe ingresar activo';end if;
    new.created_by:=auth.uid();new.created_at:=now();new.version:=1;
  end if;
  new."Dias_Bloqueo":=private.business_days(new."Fecha_Inicio",new."Fecha_Termino");
  new.actor_id:=auth.uid();new.actor_name:=lower(auth.jwt()->>'email');new.updated_at:=now();
  return new;
end;
$$;
create trigger validate_bloqueo before insert or update on public.bloqueos for each row execute function private.validate_bloqueo();
create function private.audit_bloqueo() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.historial(bloqueo_id,codigo,accion,actor_id,actor_name,datos) values(new.id,new."Codigo_Bloqueo",case when tg_op='INSERT' then 'Creado' when new.archived<>old.archived then case when new.archived=1 then 'Archivado' else 'Restaurado' end else 'Editado' end,new.actor_id,new.actor_name,to_jsonb(new));
  return new;
end;
$$;
create trigger audit_bloqueo after insert or update on public.bloqueos for each row execute function private.audit_bloqueo();

create function private.protect_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.email<>old.email then raise exception 'Crea otro perfil para cambiar el correo'; end if;
  if new.email='jcontreras@saludparral.cl' and (new.role<>'avanzado' or not new.active) then raise exception 'No puedes quitar el acceso de la cuenta principal'; end if;
  new.updated_at:=now();return new;
end;
$$;
create trigger protect_profile before insert or update on public.profiles for each row execute function private.protect_profile();
create function private.audit_config() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.config_history(target,actor_name,datos) values(tg_table_name,coalesce(lower(auth.jwt()->>'email'),'instalacion'),jsonb_build_object('operation',tg_op,'before',case when tg_op<>'INSERT' then to_jsonb(old) end,'after',case when tg_op<>'DELETE' then to_jsonb(new) end));
  return coalesce(new,old);
end;
$$;
create trigger audit_profiles after insert or update on public.profiles for each row execute function private.audit_config();
create trigger audit_calendar after insert or update on public.calendar_years for each row execute function private.audit_config();
create trigger audit_holidays after insert or update or delete on public.holidays for each row execute function private.audit_config();

create function private.invalidate_calendar() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op<>'INSERT' then update public.calendar_years set reviewed=false,updated_at=now() where year=extract(year from old.day); end if;
  if tg_op<>'DELETE' then insert into public.calendar_years(year,reviewed) values(extract(year from new.day),false) on conflict(year) do update set reviewed=false,updated_at=now();end if;
  return coalesce(new,old);
end;
$$;
create trigger invalidate_calendar after insert or update or delete on public.holidays for each row execute function private.invalidate_calendar();
create function private.recount_calendar() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.reviewed and auth.uid() is not null then
    update public.bloqueos b set version=version+1 where
      extract(year from b."Fecha_Inicio")<=new.year and extract(year from b."Fecha_Termino")>=new.year
      and private.calendar_ready(b."Fecha_Inicio",b."Fecha_Termino")
      and b."Dias_Bloqueo"<>private.business_days(b."Fecha_Inicio",b."Fecha_Termino");
  end if;return new;
end;
$$;
create trigger recount_calendar after insert or update on public.calendar_years for each row execute function private.recount_calendar();
-- Solo son invocables por triggers; no hay RPC privilegiadas públicas.
revoke all on all functions in schema private from public;
grant execute on function private.app_role() to authenticated;
revoke all on public.profiles,public.calendar_years,public.holidays,public.bloqueos,public.historial,public.config_history from anon;
commit;
