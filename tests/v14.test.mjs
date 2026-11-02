import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create schema storage;grant usage on schema storage to authenticated;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;
create publication supabase_realtime;`);
const load = (n) =>
  readFileSync(new URL("../database/" + n, import.meta.url), "utf8");
await db.exec(load("001_schema.sql"));
await db.exec(load("002_feriados_2026.sql"));
const ids = {
  root: "00000000-0000-4000-8000-000000000001",
  viewer: "00000000-0000-4000-8000-000000000002",
  admin: "00000000-0000-4000-8000-000000000003",
  other: "00000000-0000-4000-8000-000000000004",
};
await db.exec(
  `insert into auth.users values('${ids.root}','jcontreras@saludparral.cl',now()),('${ids.viewer}','viewer@example.invalid',now()),('${ids.admin}','admin@example.invalid',now());insert into public.profiles(email,display_name,role) values('viewer@example.invalid','Viewer','normal'),('admin@example.invalid','Admin','administrativo');`,
);
await db.exec(load("003_version_1_1.sql"));
async function login(id, email) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: ids[id], email }),
  ]);
  await db.exec("set role authenticated");
}

import { readHtmlTables } from "../src/agenda-import.ts";
import { blocksFromTable, missingFields, pdfTable, parseDate, parseTime } from "../src/system-blocks.ts";
for (const f of ["004_agendas_reference.sql","005_professionals_seed.sql","006_agenda_import.sql","007_import_serialization.sql","009_los_carros_blocks.sql","010_catalog_snapshot.sql","011_bloqueos_sistema.sql"]) await db.exec(load(f));

// Parser HTML: encabezados variables, fechas con hora, fila incompleta.
const html = `<table><tr><th>Código Bloqueo</th><th>Establecimiento</th><th>Profesional</th><th>Agenda</th><th>Motivo</th><th>Desde</th><th>Hasta</th></tr>
<tr><td>B-100</td><td>CESFAM Los Olivos</td><td>ANA PÉREZ</td><td>Morbilidad</td><td>Feriado legal</td><td>03/11/2026 08:00</td><td>05/11/2026 17:00</td></tr>
<tr><td></td><td>Rural</td><td>JUAN SOTO</td><td></td><td></td><td>10-11-2026</td><td></td></tr></table><script>alert(1)</script>`;
const blocks = readHtmlTables(html).flatMap(blocksFromTable);
assert.equal(blocks.length, 2);
assert.equal(blocks[0].establecimiento, "Los Olivos");
assert.deepEqual([blocks[0].fecha_inicio, blocks[0].hora_inicio, blocks[0].hora_termino], ["2026-11-03", "08:00", "17:00"]);
assert.deepEqual(missingFields(blocks[0]), []);
assert.deepEqual(missingFields(blocks[1]), ["código", "fecha de término", "tipo de bloqueo"]);
assert.equal(parseDate("31/02/2026"), "");
assert.equal(parseTime("25:00"), "");
const pdf = pdfTable([
  { text: "Código", x: 10, y: 700 }, { text: "Profesional", x: 80, y: 700 }, { text: "Fecha inicio", x: 200, y: 700 }, { text: "Fecha término", x: 280, y: 700 },
  { text: "B-7", x: 10, y: 680 }, { text: "LUIS ROJAS", x: 80, y: 680 }, { text: "01/12/2026", x: 200, y: 680 }, { text: "02/12/2026", x: 280, y: 680 },
]);
assert.equal(blocksFromTable(pdf)[0].codigo, "B-7");

// Base: permisos, sin duplicados, completar faltantes, mismo archivo rechazado.
const rpc = async (m, e) => (await db.query("select public.import_bloqueos_sistema($1::jsonb,$2::jsonb) r", [JSON.stringify(m), JSON.stringify(e)])).rows[0].r;
const meta = (n) => ({ name: "f" + n + ".html", sha256: String(n).padStart(64, "a") });
await login("viewer", "viewer@example.invalid");
await assert.rejects(() => rpc(meta(1), blocks), /no permite/);
await login("admin", "admin@example.invalid");
let r = await rpc(meta(1), [...blocks, blocks[0]]);
assert.deepEqual(r, { nuevos: 2, completados: 0, repetidos: 1, ya_en_app: 0 });
await assert.rejects(() => rpc(meta(1), blocks), /ya fue cargado/);
r = await rpc(meta(2), [{ ...blocks[1], tipo: "Capacitación", fecha_termino: "2026-11-12" }, { ...blocks[0], tipo: "OTRO VALOR" }]);
assert.deepEqual(r, { nuevos: 0, completados: 1, repetidos: 1, ya_en_app: 0 });
const rows = (await db.query("select codigo,tipo,fecha_termino::text f from public.bloqueos_sistema order by codigo")).rows;
assert.deepEqual(rows, [{ codigo: "", tipo: "Capacitación", f: "2026-11-12" }, { codigo: "B-100", tipo: "Feriado legal", f: "2026-11-05" }]);
await assert.rejects(() => db.query("insert into public.bloqueos_sistema(clave,carga_id) select 'x',id from public.bloqueos_sistema_cargas limit 1"), /permission denied/);
await assert.rejects(() => db.query("delete from public.bloqueos_sistema"), /permission denied/);
await login("viewer", "viewer@example.invalid");
assert.equal((await db.query("select count(*)::int n from public.bloqueos_sistema")).rows[0].n, 2);
// Código ya registrado manualmente en la app: no se duplica.
await db.exec("reset role");
await db.exec(`alter table public.bloqueos disable trigger user;insert into public.bloqueos("Codigo_Bloqueo","Establecimiento","Profesional","Tipo_Bloqueo","Fecha_Inicio","Fecha_Termino","Tipo_Horario",created_by,actor_id) values('B-200','Rural','X','Y','2026-11-01','2026-11-01','Jornada completa','${ids.admin}','${ids.admin}');alter table public.bloqueos enable trigger user;`);
await login("admin", "admin@example.invalid");
r = await rpc(meta(3), [{ ...blocks[0], codigo: "b-200" }]);
assert.deepEqual(r, { nuevos: 0, completados: 0, repetidos: 0, ya_en_app: 1 });
console.log("V1.4: parser de bloqueos del sistema, permisos, deduplicación, completado de faltantes y archivo repetido correctos.");
