-- Admite Los Carros en los bloqueos; conserva las demás validaciones.
begin;
create or replace function private.validate_v11() returns trigger language plpgsql security definer set search_path='' as $$
declare a text;
begin
 if private.app_role() not in ('administrativo','avanzado') or private.app_role() is null then raise exception 'Solo vista no puede modificar bloqueos'; end if;
 if tg_op='UPDATE' and (to_jsonb(new)-array['version','Dias_Bloqueo','updated_at','actor_id','actor_name'])=(to_jsonb(old)-array['version','Dias_Bloqueo','updated_at','actor_id','actor_name']) then return new;end if;
 if cardinality(new."Agendas") not between 1 and 30 then raise exception 'Agrega entre 1 y 30 agendas'; end if;
 foreach a in array new."Agendas" loop if a is null or length(trim(a)) not between 1 and 250 then raise exception 'Agenda inválida'; end if; end loop;
 if (select count(distinct lower(trim(x))) from unnest(new."Agendas") x)<>cardinality(new."Agendas") then raise exception 'No repitas agendas'; end if;
 if length(trim(new."Profesion"))=0 then raise exception 'Indica la profesión'; end if;
 if new."Establecimiento" not in ('Buenos Aires','Arrau Méndez','Los Olivos','Viña del Mar','Los Carros','Rural') then raise exception 'Selecciona un establecimiento del listado'; end if;
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
revoke all on function private.validate_v11() from public;
notify pgrst,'reload schema';
commit;
