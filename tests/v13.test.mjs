import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { validate, fields, groupedCounts } from "../src/model.ts";
import {
  parseAgendaRows,
  readXlsx,
  readHtmlTables,
  expandRules,
  standardProfession,
  agendaHeaders,
  pdfDirectoryRows,
} from "../src/agenda-import.ts";
import { crossAgenda } from "../src/agenda-model.ts";
import { buildXlsx, exportFields } from "../src/xlsx.ts";
import { unzipSync, strFromU8 } from "fflate";
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

await db.exec(load("004_agendas_reference.sql"));
await db.exec(load("005_professionals_seed.sql"));
await db.exec(load("006_agenda_import.sql"));
await db.exec(load("007_import_serialization.sql"));
await db.exec(load("009_los_carros_blocks.sql"));
await db.exec(load("010_catalog_snapshot.sql"));
const meta = (name, n) => ({ name, sha256: String(n).padStart(64, "0") });
const rpc = async (name, m, entries) =>
  (
    await db.query("select public." + name + "($1::jsonb,$2::jsonb) r", [
      JSON.stringify(m),
      JSON.stringify(entries),
    ])
  ).rows[0].r;
const entries = [
  {
    establishment: "Los Olivos",
    resource_code: "89",
    name: "KAREN ACUÑA CISTERNA",
    profession: "Matrón/a",
    source_origin: "1:2",
  },
  {
    establishment: "Los Carros",
    resource_code: "89",
    name: "Otra persona",
    profession: "Médico/a",
    source_origin: "1:1",
  },
];
await login("viewer", "viewer@example.invalid");
await assert.rejects(
  () => rpc("import_professionals", meta("test", 1), entries),
  /autorizado/,
);
await login("admin", "admin@example.invalid");
assert.equal(
  (await rpc("import_professionals", meta("test", 1), entries)).processed,
  2,
);
assert.equal(
  (await rpc("import_professionals", meta("test", 1), entries)).already_loaded,
  true,
);
const row = [
  "89-001",
  "89",
  "ACUÑA CISTERNA KAREN",
  "CONSULTA",
  "2026-10-01",
  "2027-02-28",
  "NO",
  "SI",
  "JUEVES",
  "CENTRO COMUNITARIO DE SALUD FAMILIAR LOS OLIVOS",
  "1",
  "08:30",
  "30",
  "CONTROL",
];
const parsed = parseAgendaRows([agendaHeaders, row], "fixture.xlsx");
assert.equal(parsed.errors.length, 0);
const rule = parsed.rules[0];
assert.equal(
  (await rpc("import_agendas", meta("agenda", 2), [rule, rule])).inserted,
  1,
);
let rules = (await db.query("select * from agenda_rules")).rows;
assert.equal(rules.length, 1);
assert.equal(
  (await db.query("select ends_on::text d from agenda_periods")).rows[0].d,
  "2027-02-28",
);
const before = (await db.query("select count(*)::int n from agenda_imports"))
  .rows[0].n;
await assert.rejects(
  () =>
    rpc("import_agendas", meta("internal", 9), [
      { ...rule, agenda_code: "new" },
      { ...rule, agenda_code: "new", capacity: 2 },
    ]),
  /incompatible/,
);
await assert.rejects(
  () => rpc("import_agendas", meta("conflict", 3), [{ ...rule, capacity: 2 }]),
  /superpuesta/,
);
await assert.rejects(
  () =>
    rpc("import_agendas", meta("missing", 4), [
      { ...rule, resource_code: "missing" },
    ]),
  /Faltan fichas/,
);
assert.equal(
  (await db.query("select count(*)::int n from agenda_imports")).rows[0].n,
  before,
);
const p = (
  await db.query(
    "select * from catalog_professionals where resource_code='89' and resource_establishment='Los Olivos'",
  )
).rows[0];
assert.equal(p.classification, "regular");
assert.ok(p.aliases.includes("ACUÑA CISTERNA KAREN"));
const save = (payload) =>
  db.query("select public.save_catalog_professional($1::jsonb)", [
    JSON.stringify(payload),
  ]);
await save({ ...p, profession: "Profesión revisada" });
await assert.rejects(() => save({ ...p, name: "Stale" }), /cambió/);
await rpc("import_professionals", meta("updated directory", 5), entries);
assert.equal(
  (
    await db.query("select profession from catalog_professionals where id=$1", [
      p.id,
    ])
  ).rows[0].profession,
  "Profesión revisada",
);
await save({
  id: "",
  name: "Manual",
  profession: "Nutricionista",
  classification: "support",
  establishments: [],
  resource_code: "",
  resource_establishment: "",
});
await login("viewer", "viewer@example.invalid");
await assert.rejects(() => save({ ...p }), /autorizado/);
assert.equal((await db.query("select * from agenda_rules")).rows.length, 1);
await assert.rejects(
  () => db.exec("delete from agenda_rules"),
  /permission denied/,
);
await assert.rejects(
  () => db.exec("insert into agenda_rules(rule_key) values('bypass')"),
  /permission denied/,
);
assert.equal(
  (await db.query("select * from reference_history")).rows.length,
  0,
);
const expanded = expandRules(rules, "period", "2026-10-01", "2026-10-08");
assert.equal(expanded.length, 2);
assert.equal(expanded[0].ends_at, "09:00");
assert.equal(
  expandRules(
    [{ ...rule, professional_id: "p", id: "x", capacity: 3 }],
    "period",
    "2026-10-01",
    "2026-10-01",
  )[0].ends_at,
  null,
);
assert.equal(
  expandRules(
    [
      {
        ...rule,
        professional_id: "p",
        id: "x",
        starts_on: "2026-10-01",
        ends_on: "2026-10-01",
        weekday: 1,
      },
    ],
    "period",
    "2026-10-01",
    "2026-10-01",
  ).length,
  0,
);
assert.equal(
  parseAgendaRows(
    [
      agendaHeaders,
      [
        ...row.slice(0, 4),
        "2026-10-01",
        "2026-10-01",
        ...row.slice(6, 8),
        "LUNES",
        ...row.slice(9),
      ],
    ],
    "mismatch",
  ).warnings.length,
  1,
);
assert.equal(
  parseAgendaRows(
    [agendaHeaders, [...row.slice(0, 10), "evil", ...row.slice(11)]],
    "bad",
  ).errors.length,
  1,
);
assert.equal(standardProfession("ENFERMERA(O)"), "Enfermero/a");
assert.equal(
  standardProfession("TENS"),
  "Técnico/a en enfermería de nivel superior",
);
assert.notEqual(
  standardProfession("HIGIENISTA DENTAL"),
  standardProfession("ODONTOLOGO"),
);
const html =
  "<script>throw 1</script><table><tr>" +
  agendaHeaders.map((h) => "<th>" + h + "</th>").join("") +
  "</tr><tr>" +
  row.map((v) => "<td>" + v + "</td>").join("") +
  "</tr></table>";
assert.equal(
  parseAgendaRows(readHtmlTables(html)[0], "safe.php").rules.length,
  1,
);
await db.exec("reset role");
assert.ok((await db.query("select * from reference_history")).rows.length > 0);
await login('viewer','viewer@example.invalid');
assert.equal((await db.query('select agenda_catalog_v13() data')).rows[0].data.rules.length,1);
await db.exec('reset role');await db.exec('set role anon');await assert.rejects(()=>db.query('select agenda_catalog_v13()'),/permission denied/);await db.exec('reset role');
const merged = expandRules(
  [
    { ...rule, id: "a", professional_id: "p" },
    { ...rule, id: "b", professional_id: "p", starts_at: "09:00" },
    { ...rule, id: "c", professional_id: "p", starts_at: "10:00" },
  ],
  "period",
  "2026-10-01",
  "2026-10-01",
);
assert.equal(merged.length, 2);
assert.equal(merged[0].ends_at, "09:30");
assert.equal(merged[0].capacity, 2);
assert.equal(
  expandRules(
    [
      { ...rule, id: "a", professional_id: "p" },
      { ...rule, id: "b", professional_id: "p" },
    ],
    "period",
    "2026-10-01",
    "2026-10-01",
  ).length,
  1,
);
assert.equal(
  crossAgenda({ ...expanded[0], source_blocked: true }, p, []).state,
  "blocked",
);
assert.equal(
  crossAgenda({ ...expanded[0], generated: false }, p, []).state,
  "uncertain",
);
await login('root','jcontreras@saludparral.cl');
await db.exec("update calendar_years set reviewed=true,source='test local' where year=2026");
const blockLosCarros={...Object.fromEntries(fields.map(f=>[f,''])),Codigo_Bloqueo:'TEST-LOS-CARROS',Establecimiento:'Los Carros',Profesional:'Otra persona',Profesion:'Médico/a',Agendas:['89-001'],Tipo_Bloqueo:'REUNION',Fecha_Inicio:'2026-10-29',Fecha_Termino:'2026-10-29',Tipo_Horario:'JORNADA COMPLETA',Pacientes_Citados:false,Cupos_Bloqueados:null};
assert.ok((await db.query('select create_bloqueo_v11($1::jsonb) id',[JSON.stringify(blockLosCarros)])).rows[0].id);
await db.exec('reset role');
const cell = (text, x, y) => ({ text, x, y });
const pdfItems = [
  cell("Establecimiento", 20, 120),
  cell("Código", 100, 120),
  cell("Nombre completo según fuente", 150, 120),
  cell("Profesión normalizada", 400, 120),
  cell("Origen", 650, 120),
  cell("p:f", 650, 115),
  ...[100, 80, 60].flatMap((y, i) => [
    cell("Los Olivos", 20, y),
    cell(String(i + 1), 100, y),
    cell("NOMBRE " + i, 150, y),
    cell("1:" + i, 650, y),
  ]),
  cell("Médico/a", 400, 100),
  cell("Técnico/a en enfermería de nivel", 400, 84),
  cell("superior", 400, 76),
  cell("Matrón/a", 400, 60),
];
assert.deepEqual(
  pdfDirectoryRows(pdfItems, 4).map((p) => p.profession),
  ["Médico/a", "Técnico/a en enfermería de nivel superior", "Matrón/a"],
);
await db.exec(load("008_verified_professions.sql"));
console.log(
  "V1.3: permisos, importaciones atómicas e idempotentes, conflictos, códigos locales, edición concurrente, correcciones manuales, período 2027, recurrencia y parser inerte correctos.",
);
await db.close();
