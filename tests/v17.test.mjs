// Versión 1.7: eliminar bloqueos, bloqueos de agenda sin registrar y horario del ingreso manual.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { missingBlocks, manualRules } from "../src/agenda-model.ts";
import { expandRules } from "../src/agenda-import.ts";
import { matchesAll } from "../src/search.ts";

const db = new PGlite();
await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create schema storage;grant usage on schema storage to authenticated;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;
create publication supabase_realtime;`);
const load = (n) => readFileSync(new URL("../database/" + n, import.meta.url), "utf8");
await db.exec(load("001_schema.sql"));
await db.exec(load("002_feriados_2026.sql"));
const ids = {
  root: "00000000-0000-4000-8000-000000000001",
  admin: "00000000-0000-4000-8000-000000000003",
  other: "00000000-0000-4000-8000-000000000004",
};
await db.exec(
  `insert into auth.users values('${ids.root}','jcontreras@saludparral.cl',now()),('${ids.admin}','admin@example.invalid',now()),('${ids.other}','otro@example.invalid',now());`,
);
for (const f of ["003_version_1_1.sql", "004_agendas_reference.sql", "005_professionals_seed.sql", "006_agenda_import.sql", "007_import_serialization.sql", "009_los_carros_blocks.sql", "010_catalog_snapshot.sql", "011_bloqueos_sistema.sql", "012_version_1_5.sql", "013_agenda_recurso_y_manual.sql", "015_v1_7.sql"])
  await db.exec(load(f));
async function login(id, email) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: ids[id], email })]);
  await db.exec("set role authenticated");
}
let checks = 0;
const ok = () => checks++;
await db.exec("reset role");
await db.exec(`insert into public.profiles(email,display_name,role,active,auth_user_id) values('admin@example.invalid','Admin','administrativo',true,'${ids.admin}'),('otro@example.invalid','Otro','administrativo',true,'${ids.other}') on conflict (email) do update set role=excluded.role,active=true,auth_user_id=excluded.auth_user_id`);
await db.exec(`update public.calendar_years set reviewed=true`);

const payload = (code) => ({ Codigo_Bloqueo: code, Establecimiento: "Los Olivos", Sector: "", Profesional: "ANA PEREZ", Profesion: "Psicólogo/a", Agendas: ["CONTROL"], Tipo_Bloqueo: "REUNION", Observacion: "", Fecha_Inicio: "2026-11-09", Fecha_Termino: "2026-11-10", Hora_Inicio: "", Hora_Termino: "", Tipo_Horario: "JORNADA COMPLETA", Media_Jornada: "", Pacientes_Citados: false, Cupos_Bloqueados: null });
await login("admin", "admin@example.invalid");
const created = (await db.query("select public.create_bloqueo_v11($1::jsonb,'[]'::jsonb) id", [JSON.stringify(payload("A-1"))])).rows[0].id;
ok();
// Un código activo no se repite.
await assert.rejects(db.query("select public.create_bloqueo_v11($1::jsonb,'[]'::jsonb)", [JSON.stringify(payload("a-1 "))]), /duplicate|unique|bloqueos_codigo_activo/i);
ok();
// Otro administrativo no puede eliminar un bloqueo ajeno.
await login("other", "otro@example.invalid");
const denied = await db.query(`update public.bloqueos set archived=1,version=version+1 where id=$1 and version=1 returning id`, [created]);
assert.equal(denied.rows.length, 0);
ok();
// El autor lo elimina (archiva): queda historial y el código se libera.
await login("admin", "admin@example.invalid");
const del = await db.query(`update public.bloqueos set archived=1,version=version+1 where id=$1 and version=1 returning id`, [created]);
assert.equal(del.rows.length, 1);
ok();
const hist = await db.query(`select accion from public.historial where bloqueo_id=$1 order by id`, [created]);
assert.deepEqual(hist.rows.map((r) => r.accion), ["Creado", "Archivado"]);
ok();
await db.query("select public.create_bloqueo_v11($1::jsonb,'[]'::jsonb)", [JSON.stringify(payload("A-1"))]);
ok();

// --- Bloqueos hechos en la agenda (rojo) sin registrar.
const prof = { id: "p1", name: "RODRIGO NUÑEZ", profession: "Médico", source_assignment: "", classification: "regular", establishments: ["Arrau Méndez"], aliases: [] };
const s = (day, blocked = true, agenda = "CONTROL") => ({ id: "s" + day + agenda, period_id: "x", professional_id: "p1", establishment: "Arrau Méndez", agenda_name: agenda, agenda_code: "", service_day: day, starts_at: "08:00", ends_at: "12:00", capacity: 5, source_name: "pdf", source_blocked: blocked });
const sessions = [s("2026-11-12"), s("2026-11-13"), s("2026-11-14"), s("2026-11-16"), s("2026-11-18"), s("2026-11-17", false)];
let miss = missingBlocks(sessions, [prof], []);
assert.equal(miss.length, 2, "viernes-sábado-lunes (domingo no corta) y un día aparte");
assert.equal(miss[0].from, "2026-11-12");
assert.equal(miss[0].until, "2026-11-16");
assert.equal(miss[0].starts_at, "08:00");
assert.equal(miss[1].from, "2026-11-18");
ok();
const reg = { id: "b1", archived: 0, Establecimiento: "Arrau Méndez", Profesional: "Rodrigo Nuñez", Fecha_Inicio: "2026-11-12", Fecha_Termino: "2026-11-16", Agendas: ["control"], Agenda: "control" };
miss = missingBlocks(sessions, [prof], [reg]);
assert.equal(miss.length, 1);
assert.equal(miss[0].from, "2026-11-18");
ok();
miss = missingBlocks(sessions, [prof], [{ ...reg, archived: 1 }], [{ profesional: "RODRIGO NUNEZ", establecimiento: "Arrau Méndez", fecha_inicio: "2026-11-12", fecha_termino: "2026-11-18" }]);
assert.equal(miss.length, 0, "un bloqueo eliminado no cuenta, uno de archivo del sistema sí");
ok();

// --- Ingreso manual: hora de término = inicio + intervalo × cupos.
const rules = manualRules(
  [{ id: "m", corr: 7, professional_id: "p1", establishment: "Arrau Méndez", agenda_code: "", agenda_name: "CONTROL", starts_on: "2026-11-02", ends_on: "2026-11-30", closed_on: null, generated: true, staggered: false, requires_record: true, funding: "", agenda_type: "Consulta", multi_hour: false, details: [{ id: "d", manual_agenda_id: "m", weekday: 1, starts_at: "08:00:00", interval_minutes: 20, capacity: 6, box: "", quotas: [] }] }],
  [prof],
);
const day = expandRules(rules, "x", "2026-11-02", "2026-11-02");
assert.equal(day.length, 1);
assert.equal(day[0].ends_at, "10:00");
ok();

// --- Autocompletado: sin tildes, mayúsculas ni orden.
assert.ok(matchesAll("RODRIGO NUÑEZ", "nunez rod"));
assert.ok(!matchesAll("RODRIGO NUÑEZ", "perez"));
ok();
console.log(`v1.7: ${checks} grupos de verificaciones correctos (eliminar bloqueo, bloqueos sin registrar, horario manual, autocompletado).`);
