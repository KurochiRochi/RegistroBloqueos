-- Referencias de profesionales y programación. Una vez, después de 003.
begin;
create table public.agenda_periods (
 id uuid primary key default gen_random_uuid(),label text not null,
 starts_on date not null,ends_on date not null,source_name text not null,
 programming_loaded boolean not null default false,
 check(ends_on>=starts_on),unique(starts_on,ends_on)
);
create table public.catalog_professionals (
 id uuid primary key default gen_random_uuid(), source_key text not null unique,
 name text not null check(length(trim(name)) between 1 and 250),
 profession text not null default '',source_assignment text not null,
 classification text not null check(classification in ('regular','support','pending')),
 establishments text[] not null default '{}',source_name text not null,
 check((classification='support' and cardinality(establishments)=0) or classification<>'support')
);
create table public.agenda_sessions (
 id uuid primary key default gen_random_uuid(),period_id uuid not null references public.agenda_periods(id),
 professional_id uuid not null references public.catalog_professionals(id),
 establishment text not null check(establishment in ('Buenos Aires','Arrau Méndez','Los Olivos','Viña del Mar','Rural')),
 agenda_name text not null check(length(trim(agenda_name)) between 1 and 250),agenda_code text not null default '',
 service_day date not null,starts_at time,ends_at time,capacity integer check(capacity>=0),source_name text not null,
 check((starts_at is null and ends_at is null) or (starts_at is not null and ends_at is not null and ends_at>starts_at))
);
create index agenda_sessions_lookup on public.agenda_sessions(period_id,service_day,professional_id,establishment);
create function private.validate_agenda_session() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.agenda_periods p where p.id=new.period_id and new.service_day between p.starts_on and p.ends_on) then raise exception 'La fecha no pertenece al período de la programación';end if;
 if not exists(select 1 from public.catalog_professionals p where p.id=new.professional_id and p.classification='regular' and new.establishment=any(p.establishments)) then raise exception 'El profesional no tiene asignación regular a ese establecimiento';end if;
 return new;
end;$$;
create trigger validate_agenda_session before insert or update on public.agenda_sessions for each row execute function private.validate_agenda_session();
alter table public.agenda_periods enable row level security;
alter table public.catalog_professionals enable row level security;
alter table public.agenda_sessions enable row level security;
create policy agenda_periods_read on public.agenda_periods for select to authenticated using(private.app_role() is not null);
create policy catalog_professionals_read on public.catalog_professionals for select to authenticated using(private.app_role() is not null);
create policy agenda_sessions_read on public.agenda_sessions for select to authenticated using(private.app_role() is not null);
revoke all on public.agenda_periods,public.catalog_professionals,public.agenda_sessions from anon,authenticated;
grant select on public.agenda_periods,public.catalog_professionals,public.agenda_sessions to authenticated;
revoke all on function private.validate_agenda_session() from public;
-- Programación y edición manual se incorporan en versiones posteriores. Solo lectura en esta versión.
insert into public.agenda_periods(label,starts_on,ends_on,source_name) values('Octubre–diciembre 2026','2026-10-01','2026-12-31','profesionales_por_establecimiento.xlsx');
do $$declare t text;begin foreach t in array array['agenda_periods','catalog_professionals','agenda_sessions'] loop
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t);end if;
end loop;end;$$;
notify pgrst,'reload schema';
commit;
