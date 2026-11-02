-- Versión 1.3. Una vez, después de 005. No altera bloqueos ni pacientes.
begin;
alter table public.catalog_professionals add column resource_establishment text not null default '',add column resource_code text not null default '',add column aliases text[] not null default '{}',add column source_profession text not null default '',add column source_origin text not null default '',add column version integer not null default 1,add column manual_override boolean not null default false;
create unique index catalog_resource_unique on public.catalog_professionals(resource_establishment,resource_code) where resource_code<>'';
alter table public.agenda_sessions drop constraint agenda_sessions_establishment_check;
alter table public.agenda_sessions add constraint agenda_sessions_establishment_check check(establishment in ('Buenos Aires','Arrau Méndez','Los Olivos','Viña del Mar','Los Carros','Rural'));
create table public.agenda_imports(
 id uuid primary key default gen_random_uuid(),sha256 text not null unique check(sha256~'^[0-9a-f]{64}$'),name text not null check(length(name) between 1 and 250),kind text not null check(kind in ('agendas','professionals')),row_count integer not null,inserted_count integer not null default 0,created_at timestamptz not null default now(),created_by uuid default auth.uid()
);
create table public.agenda_rules(
 id uuid primary key default gen_random_uuid(),rule_key text not null unique,import_id uuid not null references public.agenda_imports(id),professional_id uuid not null references public.catalog_professionals(id),
 establishment text not null check(establishment in ('Buenos Aires','Arrau Méndez','Los Olivos','Viña del Mar','Los Carros','Rural')),resource_code text not null,resource_name text not null check(length(resource_name) between 1 and 250),
 agenda_code text not null check(length(agenda_code) between 1 and 100),agenda_name text not null check(length(agenda_name) between 1 and 250),starts_on date not null,ends_on date not null,weekday integer not null check(weekday between 0 and 6),starts_at time not null,interval_minutes integer not null check(interval_minutes between 1 and 1440),capacity integer not null check(capacity between 0 and 10000),generated boolean not null,staggered boolean not null,source_blocked boolean not null,attention text not null,source_row text not null,source_name text not null,
 check(ends_on>=starts_on and ends_on-starts_on<=367),check(extract(epoch from starts_at)+interval_minutes*60<=86400)
);
create index agenda_rules_lookup on public.agenda_rules(establishment,professional_id,starts_on,ends_on);
create table public.reference_history(id bigint generated always as identity primary key,table_name text not null,record_id uuid not null,action text not null,before_data jsonb,after_data jsonb,created_at timestamptz not null default now(),created_by uuid default auth.uid());
create function private.audit_reference() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into public.reference_history(table_name,record_id,action,before_data,after_data) values(tg_table_name,new.id,tg_op,case when tg_op='UPDATE' then to_jsonb(old) end,to_jsonb(new));return new;end;$$;
create trigger audit_catalog after insert or update on public.catalog_professionals for each row execute function private.audit_reference();
create trigger audit_import after insert or update on public.agenda_imports for each row execute function private.audit_reference();

create function public.import_professionals(meta jsonb, entries jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r record; n integer:=0;imp uuid;
begin
 if coalesce(private.app_role(),'') not in ('administrativo','avanzado') then raise exception 'No autorizado';end if;
 if jsonb_typeof(entries)<>'array' or jsonb_array_length(entries) not between 1 and 5000 then raise exception 'Lista inválida (máximo 5000 fichas)';end if;
 perform pg_advisory_xact_lock(137813);
 if exists(select 1 from public.agenda_imports where sha256=meta->>'sha256') then return jsonb_build_object('already_loaded',true);end if;
 insert into public.agenda_imports(sha256,name,kind,row_count) values(meta->>'sha256',meta->>'name','professionals',jsonb_array_length(entries)) returning id into imp;
 for r in select * from jsonb_to_recordset(entries) as x(establishment text,resource_code text,name text,profession text,source_origin text) loop
  if r.establishment not in ('Buenos Aires','Arrau Méndez','Los Olivos','Viña del Mar','Los Carros','Rural') or coalesce(length(trim(r.resource_code)),0) not between 1 and 100 or coalesce(length(trim(r.profession)),0) not between 1 and 150 then raise exception 'Ficha inválida';end if;
  insert into public.catalog_professionals(source_key,name,profession,source_assignment,classification,establishments,source_name,resource_establishment,resource_code,source_profession,source_origin)
  values('resource:'||r.establishment||':'||r.resource_code,r.name,r.profession,r.establishment,'pending',array[r.establishment],meta->>'name',r.establishment,r.resource_code,r.profession,r.source_origin)
  on conflict(resource_establishment,resource_code) where resource_code<>'' do update set
   profession=case when public.catalog_professionals.manual_override then public.catalog_professionals.profession else excluded.profession end,
   source_profession=excluded.profession,source_origin=excluded.source_origin,version=public.catalog_professionals.version+1;
  n:=n+1;
 end loop;
 update public.agenda_imports set inserted_count=n where id=imp;
 return jsonb_build_object('processed',n,'import_id',imp);
end;$$;

create function public.import_agendas(meta jsonb, entries jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare imp uuid; n integer; lo date; hi date;period uuid;missing text;
begin
 if coalesce(private.app_role(),'') not in ('administrativo','avanzado') then raise exception 'No autorizado';end if;
 if jsonb_typeof(entries)<>'array' or jsonb_array_length(entries) not between 1 and 20000 then raise exception 'Archivo inválido (máximo 20000 filas)';end if;
 perform pg_advisory_xact_lock(137813);
 if exists(select 1 from public.agenda_imports where sha256=meta->>'sha256') then return jsonb_build_object('already_loaded',true);end if;
 select string_agg(x.establishment||' / '||x.resource_code,', ') into missing from (select distinct j->>'establishment' establishment,j->>'resource_code' resource_code from jsonb_array_elements(entries) j) x left join public.catalog_professionals p on p.resource_establishment=x.establishment and p.resource_code=x.resource_code where p.id is null;
 if missing is not null then raise exception 'Faltan fichas con código SISMAULE: %',missing;end if;

 if exists(select 1 from jsonb_to_recordset(entries) x(establishment text,resource_code text,agenda_code text,starts_on date,ends_on date,weekday int,starts_at time,interval_minutes int,capacity int,generated boolean,staggered boolean,source_blocked boolean,agenda_name text,attention text)
 join jsonb_to_recordset(entries) y(establishment text,resource_code text,agenda_code text,starts_on date,ends_on date,weekday int,starts_at time,interval_minutes int,capacity int,generated boolean,staggered boolean,source_blocked boolean,agenda_name text,attention text) using(establishment,resource_code,agenda_code,weekday,starts_at,attention)
 where x.starts_on<=y.ends_on and x.ends_on>=y.starts_on and (x.interval_minutes,x.capacity,x.generated,x.staggered,x.source_blocked,x.agenda_name) is distinct from (y.interval_minutes,y.capacity,y.generated,y.staggered,y.source_blocked,y.agenda_name)) then raise exception 'El archivo contiene programación incompatible en una misma franja';end if;
 -- No permite sustituir silenciosamente una programación con datos incompatibles.
 if exists(select 1 from jsonb_to_recordset(entries) x(establishment text,resource_code text,agenda_code text,starts_on date,ends_on date,weekday int,starts_at time,interval_minutes int,capacity int,generated boolean,staggered boolean,source_blocked boolean,agenda_name text,attention text)
 join public.agenda_rules a on a.establishment=x.establishment and a.resource_code=x.resource_code and a.agenda_code=x.agenda_code and a.weekday=x.weekday and a.starts_at=x.starts_at and a.attention=x.attention and a.starts_on<=x.ends_on and a.ends_on>=x.starts_on
 where (a.interval_minutes,a.capacity,a.generated,a.staggered,a.source_blocked,a.agenda_name) is distinct from (x.interval_minutes,x.capacity,x.generated,x.staggered,x.source_blocked,x.agenda_name)) then raise exception 'Hay programación superpuesta con datos distintos. Revisa el archivo antes de reemplazar agendas.';end if;
 insert into public.agenda_imports(sha256,name,kind,row_count) values(meta->>'sha256',meta->>'name','agendas',jsonb_array_length(entries)) returning id into imp;
 update public.catalog_professionals p set classification='regular',establishments=(select array_agg(distinct e) from unnest(p.establishments||array[p.resource_establishment]) e),aliases=(select array_agg(distinct a) from unnest(p.aliases||array(select distinct j->>'resource_name' from jsonb_array_elements(entries) j where j->>'establishment'=p.resource_establishment and j->>'resource_code'=p.resource_code)) a),version=p.version+1
 where exists(select 1 from jsonb_array_elements(entries) j where j->>'establishment'=p.resource_establishment and j->>'resource_code'=p.resource_code);
 insert into public.agenda_rules(rule_key,import_id,professional_id,establishment,resource_code,resource_name,agenda_code,agenda_name,starts_on,ends_on,weekday,starts_at,interval_minutes,capacity,generated,staggered,source_blocked,attention,source_row,source_name)
 select distinct on (k) k,imp,p.id,x.establishment,x.resource_code,x.resource_name,x.agenda_code,x.agenda_name,x.starts_on,x.ends_on,x.weekday,x.starts_at,x.interval_minutes,x.capacity,x.generated,x.staggered,x.source_blocked,x.attention,x.source_row,meta->>'name'
 from jsonb_to_recordset(entries) x(establishment text,resource_code text,resource_name text,agenda_code text,agenda_name text,starts_on date,ends_on date,weekday integer,starts_at time,interval_minutes integer,capacity integer,generated boolean,staggered boolean,source_blocked boolean,attention text,source_row text)
 join public.catalog_professionals p on p.resource_establishment=x.establishment and p.resource_code=x.resource_code
 cross join lateral (select md5(jsonb_build_array(x.establishment,x.resource_code,x.agenda_code,x.agenda_name,x.starts_on,x.ends_on,x.weekday,x.starts_at,x.interval_minutes,x.capacity,x.generated,x.staggered,x.source_blocked,x.attention)::text) k) h
 on conflict(rule_key) do nothing;
 get diagnostics n=row_count;
 update public.agenda_imports set inserted_count=n where id=imp;
 select date_trunc('month',min(starts_on))::date,(date_trunc('month',max(ends_on))+interval '1 month -1 day')::date into lo,hi from public.agenda_rules;
 select id into period from public.agenda_periods order by starts_on,id limit 1;
 if period is null then insert into public.agenda_periods(label,starts_on,ends_on,source_name,programming_loaded) values('Programación cargada',lo,hi,'Archivos importados',true);
 else update public.agenda_periods set starts_on=least(starts_on,lo),ends_on=greatest(ends_on,hi),label='Programación cargada',source_name='Archivos importados',programming_loaded=true where id=period;end if;
 return jsonb_build_object('processed',jsonb_array_length(entries),'inserted',n,'import_id',imp);
end;$$;

create function public.save_catalog_professional(payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.catalog_professionals;new_id uuid;
begin
 if coalesce(private.app_role(),'') not in ('administrativo','avanzado') then raise exception 'No autorizado';end if;
 if coalesce(length(trim(payload->>'name')),0) not between 1 and 250 or coalesce(length(trim(payload->>'profession')),0) not between 1 and 150 then raise exception 'Completa nombre y profesión';end if;
 if exists(select 1 from jsonb_array_elements_text(payload->'establishments') e where e not in ('Buenos Aires','Arrau Méndez','Los Olivos','Viña del Mar','Los Carros','Rural')) then raise exception 'Establecimiento inválido';end if;
 if payload->>'classification' not in ('regular','support','pending') then raise exception 'Vinculación inválida';end if;
 if payload->>'classification'='regular' and jsonb_array_length(payload->'establishments')=0 then raise exception 'Selecciona establecimiento para la asignación regular';end if;
 if payload->>'classification'='support' and jsonb_array_length(payload->'establishments')>0 then raise exception 'Apoyo sin agenda regular no debe tener asignación regular';end if;
 if coalesce(payload->>'resource_code','')<>'' and coalesce(payload->>'resource_establishment','') not in ('Buenos Aires','Arrau Méndez','Los Olivos','Viña del Mar','Los Carros','Rural') then raise exception 'El código requiere establecimiento SISMAULE';end if;
 if nullif(payload->>'id','') is not null then
  select * into p from public.catalog_professionals where id=(payload->>'id')::uuid for update;
  if not found or p.version<>(payload->>'version')::int then raise exception 'La ficha cambió. Actualiza antes de guardar';end if;
  if p.resource_code<>'' and (p.resource_code,p.resource_establishment) is distinct from (coalesce(payload->>'resource_code',''),coalesce(payload->>'resource_establishment','')) then raise exception 'El código y establecimiento de origen no se cambian en una ficha importada';end if;
  if exists(select 1 from public.agenda_rules a where a.professional_id=p.id and (payload->>'classification'<>'regular' or not (payload->'establishments' ? a.establishment))) then raise exception 'Conserva la asignación de las agendas ya cargadas';end if;
  update public.catalog_professionals set name=trim(payload->>'name'),profession=trim(payload->>'profession'),classification=payload->>'classification',establishments=array(select jsonb_array_elements_text(payload->'establishments')),resource_code=coalesce(payload->>'resource_code',''),resource_establishment=coalesce(payload->>'resource_establishment',''),aliases=(select array_agg(distinct a) from unnest(p.aliases||array[p.name]) a),manual_override=true,version=version+1 where id=p.id returning id into new_id;
 else
  insert into public.catalog_professionals(source_key,name,profession,classification,establishments,source_assignment,source_name,resource_code,resource_establishment,manual_override) values('manual:'||gen_random_uuid(),trim(payload->>'name'),trim(payload->>'profession'),payload->>'classification',array(select jsonb_array_elements_text(payload->'establishments')),'Ingreso manual','Ingreso manual',coalesce(payload->>'resource_code',''),coalesce(payload->>'resource_establishment',''),true) returning id into new_id;
 end if;
 return new_id;
end;$$;
alter table public.agenda_imports enable row level security;
alter table public.agenda_rules enable row level security;
alter table public.reference_history enable row level security;
create policy imports_read on public.agenda_imports for select to authenticated using(private.app_role() is not null);
create policy rules_read on public.agenda_rules for select to authenticated using(private.app_role() is not null);
create policy reference_history_read on public.reference_history for select to authenticated using(private.app_role()='avanzado');
revoke all on public.agenda_imports,public.agenda_rules,public.reference_history from public,anon,authenticated;
grant select on public.agenda_imports,public.agenda_rules,public.reference_history to authenticated;
revoke all on function private.audit_reference() from public;
revoke all on function public.import_agendas(jsonb,jsonb),public.import_professionals(jsonb,jsonb),public.save_catalog_professional(jsonb) from public,anon;
grant execute on function public.import_agendas(jsonb,jsonb),public.import_professionals(jsonb,jsonb),public.save_catalog_professional(jsonb) to authenticated;
alter publication supabase_realtime add table public.agenda_rules;
alter publication supabase_realtime add table public.agenda_imports;
notify pgrst,'reload schema';
commit;
