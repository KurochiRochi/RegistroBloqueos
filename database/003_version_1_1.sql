-- Migración de 0.1 a 1.1. Aplicar una vez después de 001 y 002.
begin;
alter table public.profiles add column if not exists auth_user_id uuid unique;
alter table public.profiles add column if not exists phone text not null default '' check(length(phone)<=30);
update public.profiles p set auth_user_id=u.id from auth.users u where lower(u.email)=p.email and p.auth_user_id is null;
-- normal conserva su nombre interno por compatibilidad y pasa a ser Solo vista.
update public.profiles set role='normal' where role='avanzado' and email<>'jcontreras@saludparral.cl';
create unique index if not exists one_advanced_profile on public.profiles(role) where role='avanzado';
create or replace function private.app_role() returns text language sql stable security definer set search_path='' as $$
 select role from public.profiles where active and auth.uid() is not null and
 (auth_user_id=auth.uid() or (auth_user_id is null and email=lower(auth.jwt()->>'email')));
$$;
create or replace function private.protect_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' and new.role='avanzado' then raise exception 'Solo existe una administradora avanzada'; end if;
 if tg_op='UPDATE' then
   if old.role='avanzado' and (new.role<>'avanzado' or not new.active) then raise exception 'No puedes quitar el acceso de la administradora principal'; end if;
   if new.role='avanzado' and old.role<>'avanzado' then raise exception 'No se permite crear otro perfil avanzado'; end if;
   if pg_trigger_depth()=1 and private.app_role() is distinct from 'avanzado' and auth.uid() is not null and
    (new.role<>old.role or new.active<>old.active or new.email<>old.email or
     (new.auth_user_id is distinct from old.auth_user_id and not(old.auth_user_id is null and new.auth_user_id=auth.uid() and old.email=lower(auth.jwt()->>'email')))) then
     raise exception 'Solo puedes modificar tu nombre y teléfono';
   end if;
 end if;
 new.updated_at:=now();return new;
end;$$;
drop policy profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using(private.app_role()='avanzado' or auth_user_id=auth.uid()) with check(private.app_role()='avanzado' or auth_user_id=auth.uid());
-- El correo cambia únicamente cuando Auth confirma el cambio; el rol sigue ligado al UUID.
create function private.sync_auth_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
   update public.profiles set auth_user_id=new.id where email=lower(new.email) and auth_user_id is null;
 else
   if new.email is distinct from old.email and new.email_confirmed_at is not null then
     update public.profiles set email=lower(new.email) where auth_user_id=new.id;
   end if;
 end if;
 return new;
end;$$;
-- El trigger se ejecuta como propietario de Auth, no permite cambios directos de rol.
create trigger sync_registro_profile after insert or update of email on auth.users for each row execute function private.sync_auth_profile();
create function public.my_profile() returns setof public.profiles language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return; end if;
 update public.profiles p set auth_user_id=auth.uid() where p.auth_user_id is null and p.email=lower(auth.jwt()->>'email') and p.active;
 return query select * from public.profiles p where p.auth_user_id=auth.uid() and p.active;
end;$$;
revoke all on function public.my_profile() from public,anon;grant execute on function public.my_profile() to authenticated;

alter table public.bloqueos add column "Profesion" text not null default '' check(length("Profesion")<=150);
alter table public.bloqueos add column "Agendas" text[] not null default '{}';
alter table public.bloqueos add column "Media_Jornada" text not null default '' check("Media_Jornada" in ('','AM','PM'));
alter table public.bloqueos add column "Pacientes_Citados" boolean not null default false;
update public.bloqueos set "Agendas"=array["Agenda"],version=version+1 where false; -- no altera registros históricos
-- Migración de filas existentes sin invocar cálculo/calendario ni cambiar su historial.
alter table public.bloqueos disable trigger validate_bloqueo;
alter table public.bloqueos disable trigger audit_bloqueo;
update public.bloqueos set "Agendas"=case when trim("Agenda")='' then '{}'::text[] else array["Agenda"] end;
alter table public.bloqueos enable trigger validate_bloqueo;
alter table public.bloqueos enable trigger audit_bloqueo;
create function private.validate_v11() returns trigger language plpgsql security definer set search_path='' as $$
declare a text;
begin
 if private.app_role() not in ('administrativo','avanzado') or private.app_role() is null then raise exception 'Solo vista no puede modificar bloqueos'; end if;
 if tg_op='UPDATE' and (to_jsonb(new)-array['version','Dias_Bloqueo','updated_at','actor_id','actor_name'])=(to_jsonb(old)-array['version','Dias_Bloqueo','updated_at','actor_id','actor_name']) then return new;end if;
 if cardinality(new."Agendas") not between 1 and 30 then raise exception 'Agrega entre 1 y 30 agendas'; end if;
 foreach a in array new."Agendas" loop if a is null or length(trim(a)) not between 1 and 250 then raise exception 'Agenda inválida'; end if; end loop;
 if (select count(distinct lower(trim(x))) from unnest(new."Agendas") x)<>cardinality(new."Agendas") then raise exception 'No repitas agendas'; end if;
 if length(trim(new."Profesion"))=0 then raise exception 'Indica la profesión'; end if;
 if new."Establecimiento" not in ('Buenos Aires','Arrau Méndez','Los Olivos','Viña del Mar','Rural') then raise exception 'Selecciona un establecimiento del listado'; end if;
 if new."Tipo_Horario" not in ('NO INFORMADO','JORNADA COMPLETA','RANGO HORARIO','MEDIA JORNADA') then raise exception 'Tipo de horario inválido'; end if;
 if new."Tipo_Horario"='MEDIA JORNADA' and new."Media_Jornada" not in ('AM','PM') then raise exception 'Selecciona AM o PM'; end if;
 if new."Tipo_Horario"<>'MEDIA JORNADA' then new."Media_Jornada":=''; end if;
 if new."Tipo_Horario"<>'RANGO HORARIO' then new."Hora_Inicio":='';new."Hora_Termino":=''; end if;
 -- Agenda es la primera para compatibilidad; Agendas conserva todas sin truncarlas.
 new."Agenda":=new."Agendas"[1];
 if tg_op='UPDATE' and new."Pacientes_Citados" is distinct from old."Pacientes_Citados" then raise exception 'La nómina adjunta es inmutable'; end if;
 if tg_op='UPDATE' and exists(select 1 from public.patient_documents d where d.bloqueo_id=new.id and (d.appointment_day<new."Fecha_Inicio" or d.appointment_day>new."Fecha_Termino")) then raise exception 'El período debe conservar las fechas de las nóminas adjuntas';end if;
 return new;
end;$$;
create trigger a_validate_v11 before insert or update on public.bloqueos for each row execute function private.validate_v11();
drop policy bloqueos_insert on public.bloqueos;
drop policy bloqueos_update on public.bloqueos;
create policy bloqueos_insert on public.bloqueos for insert to authenticated with check(private.app_role() in ('administrativo','avanzado') and created_by=auth.uid());
create policy bloqueos_update on public.bloqueos for update to authenticated using(private.app_role()='avanzado' or (private.app_role()='administrativo' and created_by=auth.uid())) with check(private.app_role()='avanzado' or (private.app_role()='administrativo' and created_by=auth.uid()));
drop policy calendar_write on public.calendar_years;drop policy holidays_write on public.holidays;
create policy calendar_write on public.calendar_years for all to authenticated using(private.app_role() in ('administrativo','avanzado')) with check(private.app_role() in ('administrativo','avanzado'));
create policy holidays_write on public.holidays for all to authenticated using(private.app_role() in ('administrativo','avanzado')) with check(private.app_role() in ('administrativo','avanzado'));

create table public.patient_documents (
 id uuid primary key, bloqueo_id uuid not null references public.bloqueos(id),
 object_path text not null unique, original_name text not null check(length(original_name)<=250),
 file_type text not null check(file_type in ('pdf','html')), byte_size integer not null check(byte_size between 1 and 20971520), sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 appointment_day date not null, extraction_status text not null check(extraction_status in ('table','original')),
 headers jsonb not null, patients jsonb not null check(jsonb_typeof(patients)='array' and jsonb_array_length(patients)<=5000),
 created_by uuid not null default auth.uid(),created_at timestamptz not null default now()
);
alter table public.patient_documents enable row level security;
create policy documents_read on public.patient_documents for select to authenticated using(private.app_role() in ('administrativo','avanzado'));
grant select on public.patient_documents to authenticated;
revoke all on public.patient_documents from anon;
create index documents_block on public.patient_documents(bloqueo_id,appointment_day);
-- Solo lectura desde la app y escrituras iniciales atómicas con RPC. No hay UPDATE/DELETE.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('pacientes-citados','pacientes-citados',false,20971520,array['application/pdf','text/html']) on conflict(id) do update set public=false,file_size_limit=20971520,allowed_mime_types=array['application/pdf','text/html'];
create policy patient_upload on storage.objects for insert to authenticated with check(bucket_id='pacientes-citados' and private.app_role() in ('administrativo','avanzado') and split_part(name,'/',1)=auth.uid()::text and name ~ '^[0-9a-f-]+/[0-9a-f-]+\.(pdf|html)$');
create policy patient_download on storage.objects for select to authenticated using(bucket_id='pacientes-citados' and private.app_role() in ('administrativo','avanzado') and (exists(select 1 from public.patient_documents d where d.object_path=name) or split_part(name,'/',1)=auth.uid()::text));
create policy patient_cleanup on storage.objects for delete to authenticated using(bucket_id='pacientes-citados' and private.app_role() in ('administrativo','avanzado') and split_part(name,'/',1)=auth.uid()::text and not exists(select 1 from public.patient_documents d where d.object_path=name));
create function public.create_bloqueo_v11(payload jsonb, documents jsonb default '[]') returns uuid language plpgsql security definer set search_path='' as $$
declare b public.bloqueos; new_id uuid; d jsonb; path text;
begin
 if private.app_role() not in ('administrativo','avanzado') or private.app_role() is null then raise exception 'No autorizado'; end if;
 if jsonb_typeof(documents)<>'array' or jsonb_array_length(documents)>10 then raise exception 'Máximo 10 documentos'; end if;
 b:=jsonb_populate_record(null::public.bloqueos,payload-array['id','Dias_Bloqueo','version','created_by','actor_id','created_at','updated_at','archived']);
 if coalesce(b."Pacientes_Citados",false)<>(jsonb_array_length(documents)>0) then raise exception 'Adjunta PDF si hay pacientes citados'; end if;
 insert into public.bloqueos("Codigo_Bloqueo","Establecimiento","Sector","Profesional","Profesion","Agenda","Agendas","Tipo_Bloqueo","Observacion","Fecha_Inicio","Fecha_Termino","Hora_Inicio","Hora_Termino","Tipo_Horario","Media_Jornada","Pacientes_Citados","Cupos_Bloqueados") values(b."Codigo_Bloqueo",b."Establecimiento",coalesce(b."Sector",''),b."Profesional",b."Profesion",'',b."Agendas",b."Tipo_Bloqueo",coalesce(b."Observacion",''),b."Fecha_Inicio",b."Fecha_Termino",coalesce(b."Hora_Inicio",''),coalesce(b."Hora_Termino",''),b."Tipo_Horario",coalesce(b."Media_Jornada",''),coalesce(b."Pacientes_Citados",false),b."Cupos_Bloqueados") returning id into new_id;
 for d in select value from jsonb_array_elements(documents) loop
  path:=d->>'object_path';
  if path<>auth.uid()::text||'/'||(d->>'id')||'.'||(d->>'file_type') or not exists(select 1 from storage.objects where bucket_id='pacientes-citados' and name=path) then raise exception 'Documento no encontrado'; end if;
  if (d->>'appointment_day')::date<b."Fecha_Inicio" or (d->>'appointment_day')::date>b."Fecha_Termino" then raise exception 'Fecha de nómina fuera del bloqueo'; end if;
  insert into public.patient_documents(id,bloqueo_id,object_path,original_name,file_type,byte_size,sha256,appointment_day,extraction_status,headers,patients) values((d->>'id')::uuid,new_id,path,d->>'original_name',d->>'file_type',(d->>'byte_size')::int,d->>'sha256',(d->>'appointment_day')::date,d->>'extraction_status',d->'headers',d->'patients');
 end loop;
 return new_id;
end;$$;
revoke all on function public.create_bloqueo_v11(jsonb,jsonb) from public,anon;grant execute on function public.create_bloqueo_v11(jsonb,jsonb) to authenticated;
-- Evita saltarse la atomicidad y crear 'Sí' sin adjuntos mediante REST.
revoke insert on public.bloqueos from authenticated;
revoke all on all functions in schema private from public;
grant execute on function private.app_role() to authenticated;
-- La publicación entrega avisos; los clientes vuelven a consultar con RLS vigente.
do $$declare t text;begin foreach t in array array['bloqueos','profiles','calendar_years','holidays'] loop
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t);end if;
end loop;end;$$;
notify pgrst,'reload schema';
commit;



