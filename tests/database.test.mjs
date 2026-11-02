import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
await db.exec(
  readFileSync(new URL("../database/001_schema.sql", import.meta.url), "utf8"),
);
await db.exec(
  readFileSync(
    new URL("../database/002_feriados_2026.sql", import.meta.url),
    "utf8",
  ),
);
const ids = {
  owner: "00000000-0000-4000-8000-000000000001",
  normal: "00000000-0000-4000-8000-000000000002",
  other: "00000000-0000-4000-8000-000000000003",
  admin: "00000000-0000-4000-8000-000000000004",
  outsider: "00000000-0000-4000-8000-000000000005",
};
async function login(name, email) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: ids[name], email }),
  ]);
  await db.exec("set role authenticated");
}
async function rejects(fn, pattern) {
  await assert.rejects(fn, pattern);
}
let checks = 0;
const ok = () => checks++;
await login("owner", "jcontreras@saludparral.cl");
assert.equal((await db.query("select * from public.profiles")).rows.length, 1);
ok();
await db.exec(
  `insert into public.profiles(email,display_name,role) values('normal@example.test','Normal','normal'),('other@example.test','Otro','normal'),('admin@example.test','Administrativo','administrativo');`,
);
ok();
await rejects(
  () =>
    db.exec(
      "update public.profiles set role='normal' where email='jcontreras@saludparral.cl'",
    ),
  /cuenta principal/,
);
ok();
await db.exec(
  "update public.profiles set display_name='Nombre actualizado',role='administrativo' where email='other@example.test'",
);
const modified = (
  await db.query(
    "select * from public.profiles where email='other@example.test'",
  )
).rows[0];
assert.equal(modified.display_name, "Nombre actualizado");
assert.equal(modified.role, "administrativo");
ok();
await db.exec(
  "update public.profiles set role='normal' where email='other@example.test'",
);
ok();
const insert = `insert into public.bloqueos("Codigo_Bloqueo","Establecimiento","Profesional","Tipo_Bloqueo","Fecha_Inicio","Fecha_Termino","Tipo_Horario","Dias_Bloqueo") values($1,'Centro prueba','Profesional prueba','REUNION','2026-10-26','2026-11-02','NO INFORMADO',999) returning *`;
await rejects(() => db.query(insert, ["PRE"]), /calendario/);
ok();
await db.exec("update public.calendar_years set reviewed=true where year=2026");
await login("normal", "normal@example.test");
const record = (await db.query(insert, ["00012345"])).rows[0];
assert.equal(record.Dias_Bloqueo, 6);
assert.equal(record.actor_name, "normal@example.test");
assert.equal(record.created_by, ids.normal);
ok();
await rejects(() => db.query(insert, ["00012345"]), /unique|duplicate/);
ok();
await rejects(
  () =>
    db.exec(
      "insert into public.profiles(email,display_name,role) values('evil@example.test','Mal','avanzado')",
    ),
  /row-level security/,
);
ok();
await rejects(
  () => db.exec("update public.bloqueos set archived=1,version=version+1"),
  /administrativo/,
);
ok();
await rejects(
  () => db.exec("delete from public.bloqueos"),
  /permission denied/,
);
ok();
await rejects(
  () => db.exec("update public.historial set accion='Manipulado'"),
  /permission denied/,
);
ok();
await login("other", "other@example.test");
assert.equal((await db.query("select * from public.bloqueos")).rows.length, 1);
assert.equal(
  (await db.query("update public.bloqueos set version=version+1 returning id"))
    .rows.length,
  0,
);
assert.equal((await db.query("select * from public.historial")).rows.length, 0);
ok();
await login("admin", "admin@example.test");
assert.equal(
  (
    await db.query(
      "update public.bloqueos set \"Observacion\"='Cambio 1',version=2 where id=$1 and version=1 returning id",
      [record.id],
    )
  ).rows.length,
  1,
);
assert.equal(
  (
    await db.query(
      "update public.bloqueos set \"Observacion\"='Cambio atrasado',version=2 where id=$1 and version=1 returning id",
      [record.id],
    )
  ).rows.length,
  0,
);
ok();
await db.exec("update public.bloqueos set archived=1,version=version+1");
assert.equal(
  (
    await db.query(
      "select accion from public.historial order by id desc limit 1",
    )
  ).rows[0].accion,
  "Archivado",
);
ok();
await rejects(
  () =>
    db.exec(
      "update public.profiles set role='avanzado' where email='admin@example.test'",
    ),
  /row-level|permission/,
).catch(async () => {
  assert.equal(
    (
      await db.query(
        "select role from public.profiles where email='admin@example.test'",
      )
    ).rows[0].role,
    "administrativo",
  );
});
ok();
await login("outsider", "outsider@example.test");
assert.equal((await db.query("select * from public.bloqueos")).rows.length, 0);
await rejects(() => db.query(insert, ["OUT"]), /autorizado|row-level/);
ok();
await login("owner", "jcontreras@saludparral.cl");
await db.exec(
  "insert into public.holidays(day,name) values('2026-10-30','Feriado de prueba');",
);
assert.equal(
  (await db.query("select reviewed from public.calendar_years where year=2026"))
    .rows[0].reviewed,
  false,
);
ok();
await db.exec("update public.calendar_years set reviewed=true where year=2026");
assert.equal(
  (await db.query('select "Dias_Bloqueo" from public.bloqueos')).rows[0]
    .Dias_Bloqueo,
  5,
);
assert.equal(
  (await db.query("select count(*)::integer n from public.historial")).rows[0]
    .n,
  4,
);
ok();
await db.exec(
  "update public.profiles set active=false where email='normal@example.test'",
);
await login("normal", "normal@example.test");
assert.equal((await db.query("select * from public.bloqueos")).rows.length, 0);
ok();
await db.exec("reset role;set role anon");
await rejects(
  () => db.query("select * from public.bloqueos"),
  /permission denied/,
);
ok();
await db.close();
console.log(
  `PostgreSQL: ${checks} comprobaciones de permisos, fechas, auditoría, duplicados y concurrencia correctas.`,
);
