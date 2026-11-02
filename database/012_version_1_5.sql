-- Versión 1.5: MPO, observaciones, agendas manuales desde imagen. Ejecutar una sola vez después de 011.
begin;

-- 1. Bloqueos: pertenencia a MPO
alter table public.bloqueos add column if not exists "Es_MPO" boolean not null default false;
alter table public.bloqueos add column if not exists "MPO_Nombre" text not null default '' check (length("MPO_Nombre") <= 250);

create or replace function public.create_bloqueo_v11(payload jsonb, documents jsonb default '[]'::jsonb) returns uuid
language plpgsql security definer set search_path to '' as $function$
declare b public.bloqueos;new_id uuid;d jsonb;path text;
begin
 if private.app_role() not in ('administrativo','avanzado') or private.app_role() is null then raise exception 'No autorizado';end if;
 if jsonb_typeof(documents)<>'array' or jsonb_array_length(documents)>10 then raise exception 'Máximo 10 documentos';end if;
 b:=jsonb_populate_record(null::public.bloqueos,payload-array['id','Dias_Bloqueo','version','created_by','actor_id','created_at','updated_at','archived']);
 if coalesce(b."Pacientes_Citados",false)<>(jsonb_array_length(documents)>0) then raise exception 'Adjunta PDF si hay pacientes citados';end if;
 insert into public.bloqueos("Codigo_Bloqueo","Establecimiento","Sector","Profesional","Profesion","Agenda","Agendas","Tipo_Bloqueo","Observacion","Fecha_Inicio","Fecha_Termino","Hora_Inicio","Hora_Termino","Tipo_Horario","Media_Jornada","Pacientes_Citados","Cupos_Bloqueados","Es_MPO","MPO_Nombre")
 values(b."Codigo_Bloqueo",b."Establecimiento",coalesce(b."Sector",''),b."Profesional",b."Profesion",'',b."Agendas",b."Tipo_Bloqueo",coalesce(b."Observacion",''),b."Fecha_Inicio",b."Fecha_Termino",coalesce(b."Hora_Inicio",''),coalesce(b."Hora_Termino",''),b."Tipo_Horario",coalesce(b."Media_Jornada",''),coalesce(b."Pacientes_Citados",false),b."Cupos_Bloqueados",coalesce(b."Es_MPO",false),case when coalesce(b."Es_MPO",false) then coalesce(b."MPO_Nombre",'') else '' end)
 returning id into new_id;
 for d in select value from jsonb_array_elements(documents) loop path:=d->>'object_path';
  if path<>auth.uid()::text||'/'||(d->>'id')||'.'||(d->>'file_type') or not exists(select 1 from storage.objects where bucket_id='pacientes-citados' and name=path) then raise exception 'Documento no encontrado';end if;
  if (d->>'appointment_day')::date<b."Fecha_Inicio" or (d->>'appointment_day')::date>b."Fecha_Termino" then raise exception 'Fecha de nómina fuera del bloqueo';end if;
  insert into public.patient_documents(id,bloqueo_id,object_path,original_name,file_type,byte_size,sha256,appointment_day,extraction_status,headers,patients) values((d->>'id')::uuid,new_id,path,d->>'original_name',d->>'file_type',(d->>'byte_size')::int,d->>'sha256',(d->>'appointment_day')::date,d->>'extraction_status',d->'headers',d->'patients');
 end loop;
 return new_id;
end;$function$;

-- 2. Fechas MPO (reservadas; no se descuentan como feriados)
create table if not exists public.mpo_dates(
 id uuid primary key default gen_random_uuid(),
 day date not null check (day between '2000-01-01' and '2100-12-31'),
 name text not null check (length(trim(name)) between 1 and 200),
 audience text not null default '' check (length(audience) <= 200),
 establishment text not null default '' check (establishment in ('','Buenos Aires','Arrau Méndez','Los Olivos','Viña del Mar','Los Carros','Rural')),
 source text not null default '' check (length(source) <= 300),
 created_by uuid default auth.uid(),
 created_at timestamptz not null default now(),
 unique(day,name,establishment)
);
alter table public.mpo_dates enable row level security;
drop policy if exists mpo_read on public.mpo_dates;
create policy mpo_read on public.mpo_dates for select to authenticated using (private.app_role() is not null);
drop policy if exists mpo_write on public.mpo_dates;
create policy mpo_write on public.mpo_dates for all to authenticated using (private.app_role() in ('administrativo','avanzado')) with check (private.app_role() in ('administrativo','avanzado'));
grant select, insert, update, delete on public.mpo_dates to authenticated;

-- 3. Observaciones de usuarios hacia la administradora
create table if not exists public.observaciones(
 id uuid primary key default gen_random_uuid(),
 created_at timestamptz not null default now(),
 user_id uuid not null default auth.uid(),
 email text not null default '',
 display_name text not null default '',
 role text not null default '',
 page text not null default '' check (length(page) <= 120),
 message text not null check (length(trim(message)) between 1 and 3000),
 status text not null default 'nueva' check (status in ('nueva','leida','respondida')),
 notified boolean not null default false
);
create or replace function private.fill_observacion() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.profiles;
begin
 select * into p from public.profiles where active and (auth_user_id=auth.uid() or (auth_user_id is null and email=lower(auth.jwt()->>'email'))) limit 1;
 if p.email is null then raise exception 'Perfil no activo';end if;
 new.user_id:=auth.uid();new.email:=p.email;new.display_name:=p.display_name;new.role:=p.role;new.status:='nueva';new.notified:=false;new.created_at:=now();
 return new;
end;$$;
drop trigger if exists fill_observacion on public.observaciones;
create trigger fill_observacion before insert on public.observaciones for each row execute function private.fill_observacion();
alter table public.observaciones enable row level security;
drop policy if exists obs_insert on public.observaciones;
create policy obs_insert on public.observaciones for insert to authenticated with check (private.app_role() is not null);
drop policy if exists obs_read on public.observaciones;
create policy obs_read on public.observaciones for select to authenticated using (user_id=auth.uid() or private.app_role()='avanzado');
drop policy if exists obs_update on public.observaciones;
create policy obs_update on public.observaciones for update to authenticated using (private.app_role()='avanzado') with check (private.app_role()='avanzado');
grant select, insert, update on public.observaciones to authenticated;

-- 4. Agendas ingresadas manualmente a partir de imágenes
alter table public.agenda_imports drop constraint if exists agenda_imports_kind_check;
alter table public.agenda_imports add constraint agenda_imports_kind_check check (kind in ('agendas','professionals','manual'));
alter table public.agenda_imports add column if not exists attachments text[] not null default '{}';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('agenda-imagenes','agenda-imagenes',false,10485760,array['image/png','image/jpeg','image/webp','image/gif','application/pdf'])
on conflict(id) do nothing;
drop policy if exists agenda_img_insert on storage.objects;
create policy agenda_img_insert on storage.objects for insert to authenticated with check (bucket_id='agenda-imagenes' and private.app_role() in ('administrativo','avanzado') and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists agenda_img_read on storage.objects;
create policy agenda_img_read on storage.objects for select to authenticated using (bucket_id='agenda-imagenes' and private.app_role() is not null);

create or replace function public.save_manual_agenda(meta jsonb, entries jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare imp uuid; n integer; lo date; hi date; period uuid; x record; p public.catalog_professionals; code text;
begin
 if coalesce(private.app_role(),'') not in ('administrativo','avanzado') then raise exception 'No autorizado';end if;
 if jsonb_typeof(entries)<>'array' or jsonb_array_length(entries) not between 1 and 500 then raise exception 'Ingresa entre 1 y 500 franjas';end if;
 perform pg_advisory_xact_lock(137813);
 if exists(select 1 from public.agenda_imports where sha256=meta->>'sha256') then raise exception 'Esta agenda manual ya fue guardada';end if;
 insert into public.agenda_imports(sha256,name,kind,row_count,attachments)
 values(meta->>'sha256',left(coalesce(nullif(meta->>'name',''),'Ingreso manual'),250),'manual',jsonb_array_length(entries),coalesce(array(select jsonb_array_elements_text(meta->'attachments')),'{}'))
 returning id into imp;
 for x in select * from jsonb_to_recordset(entries) as r(professional_id uuid,establishment text,agenda_code text,agenda_name text,starts_on date,ends_on date,weekday int,starts_at time,interval_minutes int,capacity int,attention text) loop
  select * into p from public.catalog_professionals where id=x.professional_id for update;
  if not found then raise exception 'Profesional no encontrado';end if;
  if x.establishment not in ('Buenos Aires','Arrau Méndez','Los Olivos','Viña del Mar','Los Carros','Rural') then raise exception 'Establecimiento inválido';end if;
  if coalesce(length(trim(x.agenda_name)),0) not between 1 and 250 then raise exception 'Indica el nombre de la agenda';end if;
  if x.starts_on is null or x.ends_on is null or x.ends_on<x.starts_on then raise exception 'Revisa las fechas de vigencia';end if;
  if x.weekday not between 0 and 6 or x.starts_at is null then raise exception 'Indica día y hora de inicio';end if;
  code:=coalesce(nullif(trim(x.agenda_code),''),'MANUAL-'||upper(left(md5(trim(x.agenda_name)),6)));
  insert into public.agenda_rules(rule_key,import_id,professional_id,establishment,resource_code,resource_name,agenda_code,agenda_name,starts_on,ends_on,weekday,starts_at,interval_minutes,capacity,generated,staggered,source_blocked,attention,source_row,source_name)
  values(md5(jsonb_build_array('manual',p.id,x.establishment,code,trim(x.agenda_name),x.starts_on,x.ends_on,x.weekday,x.starts_at,x.interval_minutes,x.capacity,coalesce(x.attention,''))::text),
   imp,p.id,x.establishment,coalesce(nullif(p.resource_code,''),'MANUAL'),left(p.name,250),left(code,100),trim(x.agenda_name),x.starts_on,x.ends_on,x.weekday,x.starts_at,greatest(1,least(1440,coalesce(x.interval_minutes,20))),greatest(0,least(10000,coalesce(x.capacity,1))),true,false,false,left(coalesce(x.attention,''),250),'manual',left(coalesce(nullif(meta->>'name',''),'Ingreso manual'),250))
  on conflict(rule_key) do nothing;
  update public.catalog_professionals set classification='regular',establishments=(select array_agg(distinct e) from unnest(establishments||array[x.establishment]) e),version=version+1 where id=p.id and (classification<>'regular' or not (x.establishment=any(establishments)));
 end loop;
 select count(*) into n from public.agenda_rules where import_id=imp;
 update public.agenda_imports set inserted_count=n where id=imp;
 select date_trunc('month',min(starts_on))::date,(date_trunc('month',max(ends_on))+interval '1 month -1 day')::date into lo,hi from public.agenda_rules;
 select id into period from public.agenda_periods order by starts_on,id limit 1;
 if period is null then insert into public.agenda_periods(label,starts_on,ends_on,source_name,programming_loaded) values('Programación cargada',lo,hi,'Archivos importados',true);
 else update public.agenda_periods set starts_on=least(starts_on,lo),ends_on=greatest(ends_on,hi),programming_loaded=true where id=period;end if;
 return jsonb_build_object('inserted',n,'import_id',imp);
end;$$;
revoke all on function public.save_manual_agenda(jsonb,jsonb) from public,anon;
grant execute on function public.save_manual_agenda(jsonb,jsonb) to authenticated;

do $$ begin
 begin alter publication supabase_realtime add table public.mpo_dates; exception when others then null; end;
 begin alter publication supabase_realtime add table public.observaciones; exception when others then null; end;
end $$;
notify pgrst,'reload schema';
commit;
