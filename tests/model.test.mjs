import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fields,
  validate,
  businessDates,
  uniqueAbsenceDays,
  filterExportRows,
  assertExportRange,
} from "../src/model.ts";
import { buildXlsx,exportFields } from "../src/xlsx.ts";
import { unzipSync, strFromU8 } from "fflate";
const cal = {
  years: [
    { year: 2026, reviewed: true, source: "prueba" },
    { year: 2027, reviewed: true, source: "prueba" },
  ],
  holidays: [
    { day: "2026-10-31", name: "Iglesias", source: "prueba" },
    { day: "2026-12-25", name: "Navidad", source: "prueba" },
    { day: "2027-01-01", name: "Año nuevo", source: "prueba" },
  ],
};
const base = {
  ...Object.fromEntries(fields.map((f) => [f, ""])),
  Codigo_Bloqueo: "00012345",
  Profesional: "Profesional de prueba",
  Establecimiento: "Centro de prueba",
  Tipo_Bloqueo: "REUNION",
  Tipo_Horario: "NO INFORMADO",
  Fecha_Inicio: "2026-10-26",
  Fecha_Termino: "2026-11-02",
  Dias_Bloqueo: 999,
  Cupos_Bloqueados: "",
};
test("calcula lunes a sábado, excluye domingo y feriado que cae sábado", () => {
  assert.deepEqual(businessDates("2026-10-26", "2026-11-02", cal), [
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
    "2026-10-30",
    "2026-11-02",
  ]);
  assert.equal(businessDates("2026-10-24", "2026-10-24", cal).length, 1);
  assert.equal(businessDates("2026-10-25", "2026-10-25", cal).length, 0);
});
test("días se calculan, no se acepta el conteo manipulado; conserva código SISMAULE", () => {
  const r = validate(base, cal);
  assert.equal(r.Dias_Bloqueo, 6);
  assert.equal(r.Codigo_Bloqueo, "00012345");
  assert.equal(r.Cupos_Bloqueados, null);
});
test("requiere calendarios de todos los años y maneja cruce anual", () => {
  assert.throws(() => businessDates("2028-01-01", "2028-01-02", cal), /2028/);
  assert.throws(
    () => businessDates("2026-10-01", "2026-10-02", { ...cal, years: [] }),
    /revisar/,
  );
  assert.equal(businessDates("2026-12-31", "2027-01-02", cal).length, 2);
});
test("varias agendas no duplican días del mismo profesional", () => {
  const a = { ...base, archived: 0 },
    b = { ...base, Agenda: "Otra", Profesional: " PROFESIONAL  DE PRUEBA " },
    c = { ...base, Profesional: "Otro profesional", archived: 1 };
  assert.equal(uniqueAbsenceDays([a, b, c], cal), 6);
  assert.equal(uniqueAbsenceDays([a, b, { ...c, archived: 0 }], cal), 12);
  assert.equal(uniqueAbsenceDays([a, b], cal, "2026-10-29", "2026-11-02"), 3);
});
test("valida fechas imposibles, límites de período y cupos", () => {
  for (const bad of [
    { Fecha_Inicio: "2026-02-30" },
    { Fecha_Termino: "2026-10-25" },
    { Cupos_Bloqueados: -1 },
    { Cupos_Bloqueados: 1.2 },
    { Cupos_Bloqueados: true },
  ])
    assert.throws(() => validate({ ...base, ...bad }, cal));
});
test("exportar exige dos fechas y selecciona solo intersecciones del rango", () => {
  assert.throws(() => assertExportRange("", "2026-10-28"));
  assert.throws(() => assertExportRange("2026-10-29", "2026-10-28"));
  const a = { ...base, archived: 0 },
    b = { ...a, Fecha_Inicio: "2026-12-01", Fecha_Termino: "2026-12-02" },
    c = { ...a, archived: 1 };
  assert.equal(
    filterExportRows([a, b, c], "2026-10-29", "2026-10-30").length,
    1,
  );
});
test("XLSX nativo v1.1: encabezados nuevos, texto seguro, datos numéricos y fila fija", () => {
  const bytes = buildXlsx(
    [{ ...validate(base, cal), Observacion: '=HYPERLINK("x") & <texto>' }],
    "2026-10-26",
    "2026-11-02",
  );
  const zip = unzipSync(bytes);
  assert.ok(zip["[Content_Types].xml"]);
  const xml = strFromU8(zip["xl/worksheets/sheet1.xml"]);
  for (const f of exportFields) assert.ok(xml.includes(">" + f + "<"));
  assert.ok(xml.includes("00012345"));
  assert.ok(xml.includes('t="inlineStr"'));
  assert.ok(xml.includes("&amp; &lt;texto&gt;"));
  assert.ok(!xml.includes("<f>"));
  assert.ok(xml.includes("<v>6</v>"));
  assert.ok(xml.includes('state="frozen"'));
});
