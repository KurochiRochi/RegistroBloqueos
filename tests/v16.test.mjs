// Versión 1.6: PDF por recurso, listas del Excel y agenda manual SISMAULE.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  alignColors,
  parseResourcePages,
  resourceEntries,
  fileNameWords,
  matchProfessionals,
  isRed,
} from "../src/resource-agenda.ts";
import { manualRules } from "../src/agenda-model.ts";
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
  viewer: "00000000-0000-4000-8000-000000000002",
  admin: "00000000-0000-4000-8000-000000000003",
};
await db.exec(
  `insert into auth.users values('${ids.root}','jcontreras@saludparral.cl',now()),('${ids.viewer}','viewer@example.invalid',now()),('${ids.admin}','admin@example.invalid',now());insert into public.profiles(email,display_name,role) values('viewer@example.invalid','Viewer','normal'),('admin@example.invalid','Admin','administrativo');`,
);
for (const f of ["003_version_1_1.sql", "004_agendas_reference.sql", "005_professionals_seed.sql", "006_agenda_import.sql", "007_import_serialization.sql", "009_los_carros_blocks.sql", "010_catalog_snapshot.sql", "011_bloqueos_sistema.sql", "012_version_1_5.sql", "013_agenda_recurso_y_manual.sql"])
  await db.exec(load(f));
async function login(id, email) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: ids[id], email })]);
  await db.exec("set role authenticated");
}
let checks = 0;
const ok = () => checks++;
const sha = (c) => c.repeat(64);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

// --- Parser (independiente de PDF.js): alineación de color, filas y franjas.
const glyphs = [
  { ch: "Recurso", color: "#000000" },
  { ch: "Fecha Inicio", color: "#000000" },
  { ch: "03/11/2026", color: "#336699" },
  { ch: "03/1", color: "#000000" }, { ch: "1/2026", color: "#000000" }, { ch: "Martes", color: "#000000" },
  { ch: "08:00", color: "#000000" }, { ch: "Nuevo", color: "#000000" }, { ch: "1", color: "#000000" }, { ch: "0", color: "#000000" }, { ch: "4583916", color: "#000000" }, { ch: "Consultas Morbilidad General", color: "#000000" }, { ch: "(programa Del Adulto Mayor)", color: "#000000" },
  { ch: "08:20", color: "#000000" }, { ch: "Nuevo", color: "#000000" }, { ch: "1", color: "#000000" }, { ch: "1", color: "#000000" }, { ch: "4583916", color: "#000000" }, { ch: "Consultas Morbilidad General", color: "#000000" }, { ch: "(programa Del Adulto Mayor)", color: "#000000" },
  { ch: "15:15", color: "#ff0000" }, { ch: "Control", color: "#ff0000" }, { ch: "1", color: "#ff0000" }, { ch: "1", color: "#ff0000" }, { ch: "4583992 Medicina Integral - Control", color: "#ff0000" }, { ch: "Medico G3", color: "#ff0000" },
];
const items = [
  ["Recurso", 56, 705], ["Fecha Inicio", 56, 687], ["03/11/2026", 161, 687],
  ["03/11/2026 Martes", 49, 341],
  ["08:00 Nuevo", 171, 560], ["1", 270, 560], ["0", 313, 560], ["4583916 ", 328, 560], ["Consultas Morbilidad General", 380, 567], ["(programa Del Adulto Mayor)", 380, 554],
  ["08:20 Nuevo", 171, 528], ["1", 270, 528], ["1", 313, 528], ["4583916 ", 328, 528], ["Consultas Morbilidad General", 380, 535], ["(programa Del Adulto Mayor)", 380, 521],
  ["15:15 Control", 171, 155], ["1", 270, 155], ["1", 313, 155], ["4583992 Medicina Integral - Control", 328, 155], ["Medico G3", 380, 148],
  ["Fecha", 49, 587], ["4/4", 577, 17],
].map(([text, x, y]) => ({ text, x, y }));
const doc = parseResourcePages([alignColors(items, glyphs)]);
assert.equal(doc.rows.length, 3);
assert.equal(doc.from, "2026-11-03");
assert.deepEqual(doc.rows.map((r) => r.source_blocked), [false, false, true]);
assert.equal(doc.rows[0].agenda_name, "Consultas Morbilidad General (programa Del Adulto Mayor)");
assert.equal(doc.rows[1].booked, 1);
assert.equal(doc.rows[2].agenda_code, "4583992");
ok();
const entries = resourceEntries(doc.rows, (n) => n.toUpperCase());
assert.equal(entries.length, 2, "08:00 y 08:20 de la misma agenda se reúnen");
assert.equal(entries[0].starts_at + "-" + entries[0].ends_at, "08:00-15:15".replace("15:15", entries[0].ends_at));
assert.equal(entries[0].capacity, 2);
assert.equal(entries[1].source_blocked, true);
ok();
assert.ok(isRed("#ff0000") && isRed("#cc0000") && !isRed("#000000") && !isRed("#336699"));
assert.deepEqual(fileNameWords("frugone.pdf"), ["FRUGONE"]);
assert.deepEqual(fileNameWords("93315aab-frugone.pdf"), ["FRUGONE"]);
assert.equal(matchProfessionals(["FRUGONE"], [{ name: "FRUGONE ZAROR CRISTOBAL JESUS" }, { name: "OTRO NOMBRE" }]).length, 1);
ok();

// --- Base de datos.
await login("viewer", "viewer@example.invalid");
await assert.rejects(() => db.query("select public.import_reference_lists($1,$2,$3)", [{ name: "x", sha256: sha("a") }, ["A B"], []]), /No autorizado/);
await assert.rejects(() => db.exec(`insert into public.manual_agendas(professional_id,establishment,agenda_name,starts_on,ends_on) values(gen_random_uuid(),'Los Olivos','X','2026-11-01','2026-11-30')`), /No autorizado|row-level security|policy/);
ok();
await login("admin", "admin@example.invalid");
const lists = (await one("select public.import_reference_lists($1,$2,$3) r", [{ name: "BD.xlsx", sha256: sha("b") }, ["FRUGONE ZAROR CRISTOBAL JESUS", "NUÑEZ GODOY RODRIGO", "NUÑEZ GODOY RODRIGO"], ["CONSULTA MORBILIDAD", "consulta morbilidad", "CONTROL CRONICO 70 AÑOS Y MAS"]])).r;
assert.equal(lists.professionals, 2);
assert.equal(lists.agendas, 2);
assert.equal((await one("select public.import_reference_lists($1,$2,$3) r", [{ name: "BD.xlsx", sha256: sha("b") }, ["X Y"], []])).r.already_loaded, true);
const again = (await one("select public.import_reference_lists($1,$2,$3) r", [{ name: "BD2.xlsx", sha256: sha("c") }, ["frugone zaror cristobal jesus"], ["Consulta Morbilidad"]])).r;
assert.equal(again.professionals + again.agendas, 0, "sin duplicar nombres existentes");
ok();
const frugone = (await one("select id,classification from public.catalog_professionals where name='FRUGONE ZAROR CRISTOBAL JESUS'"));
assert.equal(frugone.classification, "pending");
const meta = (s) => ({ name: "frugone.pdf", sha256: sha(s), establishment: "Arrau Méndez", professional_id: frugone.id });
const e1 = entries.map((e) => ({ ...e, service_day: e.service_day }));
const r1 = (await one("select public.import_resource_agenda($1,$2) r", [meta("d"), e1])).r;
assert.equal(r1.inserted, 2);
assert.equal(r1.replaced, 0);
await assert.rejects(() => db.query("select public.import_resource_agenda($1,$2)", [meta("d"), e1]), /ya fue cargado/);
const r2 = (await one("select public.import_resource_agenda($1,$2) r", [meta("e"), e1.slice(0, 1)])).r;
assert.equal(r2.replaced, 2, "reemplaza solo los días del archivo");
assert.equal(r2.inserted, 1);
const p2 = await one("select classification, establishments from public.catalog_professionals where id=$1", [frugone.id]);
assert.equal(p2.classification, "regular");
assert.deepEqual(p2.establishments, ["Arrau Méndez"]);
const per = await one("select starts_on, ends_on from public.agenda_periods");
assert.ok(per.starts_on.toISOString().slice(0, 10) <= "2026-11-01" && per.ends_on.toISOString().slice(0, 10) >= "2026-11-30");
ok();
// Profesional nuevo indicado por nombre.
const r3 = (await one("select public.import_resource_agenda($1,$2) r", [{ name: "perez.pdf", sha256: sha("f"), establishment: "Los Olivos", professional_name: "Pérez Soto Ana" }, [{ ...e1[0], service_day: "2026-11-10" }]])).r;
assert.equal(r3.created_professional, true);
ok();

// Agenda manual SISMAULE.
const nunez = await one("select id from public.catalog_professionals where name='NUÑEZ GODOY RODRIGO'");
const ag = await one(`insert into public.manual_agendas(professional_id,establishment,agenda_code,agenda_name,starts_on,ends_on) values($1,'Arrau Méndez','151','CONTROL CRONICO 70 AÑOS Y MAS','2026-11-02','2026-11-30') returning id, corr, generated`, [nunez.id]);
assert.equal(ag.generated, false);
const det = await one(`insert into public.manual_agenda_details(manual_agenda_id,weekday,starts_at,interval_minutes,capacity) values($1,3,'08:00',10,2) returning id`, [ag.id]);
await db.query(`insert into public.manual_agenda_quotas(detail_id,establishment,attention,capacity) values($1,'Arrau Méndez','CONTROL',1)`, [det.id]);
await assert.rejects(() => db.query(`insert into public.manual_agenda_quotas(detail_id,establishment,attention,capacity) values($1,'Arrau Méndez','NUEVO',2)`, [det.id]), /supera/);
await assert.rejects(() => db.query(`update public.manual_agenda_details set capacity=0 where id=$1`, [det.id]));
assert.equal((await one("select classification from public.catalog_professionals where id=$1", [nunez.id])).classification, "regular");
const copy = (await one("select public.copy_manual_agenda($1,'2026-12-01','2026-12-31') id", [ag.id])).id;
assert.equal((await one("select count(*)::int n from public.manual_agenda_quotas q join public.manual_agenda_details d on d.id=q.detail_id where d.manual_agenda_id=$1", [copy])).n, 1);
await db.query("update public.manual_agendas set generated=true, closed_on='2026-11-15' where id=$1", [ag.id]);
const cat = (await one("select public.agenda_catalog_v13() c")).c;
assert.equal(cat.manual.length, 2);
assert.equal(cat.agenda_names.length, 2);
assert.equal(cat.sessions.length, 2);
const rules = manualRules(cat.manual, cat.professionals);
const closed = rules.find((r) => r.id === "manual:" + det.id);
assert.equal(closed.ends_on, "2026-11-15", "la fecha de cierre acota la agenda");
assert.equal(closed.attention, "CONTROL 1");
assert.equal(closed.generated, true);
ok();
await login("viewer", "viewer@example.invalid");
assert.equal((await one("select count(*)::int n from public.manual_agendas")).n, 2, "solo vista puede consultar");
await assert.rejects(() => db.query("delete from public.manual_agendas where id=$1 returning id", [ag.id]).then((r) => { if (!r.rows.length) throw new Error("policy"); }), /policy/);
await assert.rejects(() => db.query("select public.copy_manual_agenda($1,'2026-12-01','2026-12-31')", [ag.id]), /No autorizado/);
ok();
await login("admin", "admin@example.invalid");
await db.query("delete from public.manual_agendas where id=$1", [ag.id]);
assert.equal((await one("select count(*)::int n from public.manual_agenda_details where manual_agenda_id=$1", [ag.id])).n, 0);
ok();
console.log(`v16: ${checks} grupos de verificaciones correctos`);
