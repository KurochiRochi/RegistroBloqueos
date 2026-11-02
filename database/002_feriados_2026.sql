-- Calendario nacional de referencia: https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/
-- Consultado 26-10-2026. Confirmar posibles feriados locales o sobrevinientes.
-- El año queda SIN REVISAR hasta que un perfil avanzado lo confirme en la app.
begin;
insert into public.calendar_years(year,reviewed,source) values(2026,false,'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/');
insert into public.holidays(day,name,source) select day::date,name,'Gobierno de Chile · calendario 2026' from (values
('2026-01-01','Año Nuevo'),('2026-04-03','Viernes Santo'),('2026-04-04','Sábado Santo'),
('2026-05-01','Día del Trabajo'),('2026-05-21','Glorias Navales'),('2026-06-21','Pueblos Indígenas'),
('2026-06-29','San Pedro y San Pablo'),('2026-07-16','Virgen del Carmen'),('2026-08-15','Asunción'),
('2026-09-18','Independencia Nacional'),('2026-09-19','Glorias del Ejército'),('2026-10-12','Encuentro de Dos Mundos'),
('2026-10-31','Iglesias Evangélicas'),('2026-11-01','Todos los Santos'),('2026-12-08','Inmaculada Concepción'),('2026-12-25','Navidad')
) v(day,name);
commit;
