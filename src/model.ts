// Estos son, en el mismo orden, los 14 encabezados del Excel de referencia.
export const fields = [
  "Codigo_Bloqueo",
  "Establecimiento",
  "Sector",
  "Profesional",
  "Agenda",
  "Tipo_Bloqueo",
  "Observacion",
  "Fecha_Inicio",
  "Fecha_Termino",
  "Hora_Inicio",
  "Hora_Termino",
  "Tipo_Horario",
  "Cupos_Bloqueados",
  "Dias_Bloqueo",
] as const;
export const labels: Record<string, string> = {
  Codigo_Bloqueo: "Código de bloqueo",
  Establecimiento: "Establecimiento",
  Sector: "Sector",
  Profesional: "Profesional",
  Agenda: "Agenda",
  Tipo_Bloqueo: "Tipo de bloqueo",
  Observacion: "Observación",
  Fecha_Inicio: "Fecha de inicio",
  Fecha_Termino: "Fecha de término",
  Hora_Inicio: "Hora de inicio",
  Hora_Termino: "Hora de término",
  Tipo_Horario: "Tipo de horario",
  Cupos_Bloqueados: "Cupos bloqueados",
  Dias_Bloqueo: "Días de bloqueo",
};
export const types = [
  "REUNION",
  "LICENCIA MEDICA",
  "FERIADO LEGAL",
  "MODIFICACION DE AGENDA",
  "PERMISO GREMIAL",
  "TERMINO AGENDA",
  "CONGRESO,SIMPOSIO,CAPACI",
  "PERMISO PATERNAL",
  "PERM. ADMINISTRATIVO",
];
export const OTHER_TYPE = "OTRO";
export const isOtherType = (v: unknown) =>
  !!String(v || "").trim() && !types.includes(String(v));
export type Data = Record<(typeof fields)[number], string | number | null> & {
  Profesion?: string;
  Agendas?: string[];
  Media_Jornada?: string;
  Pacientes_Citados?: boolean;
  Es_MPO?: boolean;
  MPO_Nombre?: string;
};
export type RecordRow = Data & {
  id: string;
  archived: number;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  actor_name: string;
  actor_id: string;
};
export type EventRow = {
  id: number;
  bloqueo_id: string;
  codigo: string;
  accion: string;
  actor_name: string;
  fecha: string;
  datos: Record<string, unknown>;
};
export type Role = "normal" | "administrativo" | "avanzado";
export type Profile = {
  email: string;
  display_name: string;
  role: Role;
  active: boolean;
  auth_user_id?: string | null;
  phone?: string;
};
export type Calendar = {
  years: { year: number; reviewed: boolean; source: string }[];
  holidays: { day: string; name: string; source: string }[];
};
export function chileToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function daysBetween(start: string, end: string) {
  return (
    Math.round(
      (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) /
        86400000,
    ) + 1
  );
}
export function status(r: RecordRow) {
  const today = chileToday();
  return r.archived
    ? "Archivado"
    : String(r.Fecha_Termino) < today
      ? "Finalizado"
      : String(r.Fecha_Inicio) > today
        ? "Programado"
        : "Vigente";
}
export function validate(input: unknown, calendar: Calendar): Data {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("El registro debe ser un objeto.");
  const raw = input as Record<string, unknown>;
  const out = {} as Data;
  for (const f of fields) {
    const v = raw[f];
    if (f === "Cupos_Bloqueados" || f === "Dias_Bloqueo") {
      if (f === "Dias_Bloqueo") {
        out[f] = 0;
        continue;
      }
      if (
        f === "Cupos_Bloqueados" &&
        (v === "" || v === null || v === undefined)
      ) {
        out[f] = null;
        continue;
      }
      if (typeof v !== "number" && typeof v !== "string")
        throw new Error(labels[f] + ": ingresa un número entero.");
      if (String(v).trim() === "")
        throw new Error(labels[f] + ": ingresa un número entero.");
      const num = Number(v);
      if (!Number.isSafeInteger(num) || num < 0 || num > 100000)
        throw new Error(labels[f] + ": ingresa un entero válido.");
      out[f] = num;
    } else {
      if (v !== undefined && v !== null && typeof v !== "string")
        throw new Error(labels[f] + ": formato inválido.");
      const val = String(v ?? "").trim();
      if (val.length > (f === "Observacion" ? 3000 : 250))
        throw new Error(labels[f] + ": texto demasiado largo.");
      out[f] = val;
    }
  }
  for (const f of [
    "Codigo_Bloqueo",
    "Establecimiento",
    "Profesional",
    "Tipo_Bloqueo",
    "Fecha_Inicio",
    "Fecha_Termino",
    "Tipo_Horario",
  ])
    if (!out[f as keyof Data]) throw new Error(labels[f] + ": es obligatorio.");
  for (const f of ["Fecha_Inicio", "Fecha_Termino"] as const) {
    const v = String(out[f]);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      !Number.isFinite(Date.parse(v + "T00:00:00Z")) ||
      new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v ||
      v < "2000-01-01" ||
      v > "2100-12-31"
    )
      throw new Error("Fecha inválida (años 2000–2100).");
  }
  if (String(out.Fecha_Termino) < String(out.Fecha_Inicio))
    throw new Error(
      "La fecha de término debe ser igual o posterior al inicio.",
    );
  const span = daysBetween(String(out.Fecha_Inicio), String(out.Fecha_Termino));
  if (span > 1827) throw new Error("El período no puede superar cinco años.");
  out.Dias_Bloqueo = businessDates(
    String(out.Fecha_Inicio),
    String(out.Fecha_Termino),
    calendar,
  ).length;
  for (const f of ["Hora_Inicio", "Hora_Termino"] as const)
    if (out[f] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(out[f])))
      throw new Error("Horario inválido.");
  if (Boolean(out.Hora_Inicio) !== Boolean(out.Hora_Termino))
    throw new Error("Completa ambas horas o deja ambas vacías.");
  if (
    out.Tipo_Horario === "RANGO HORARIO" &&
    (!out.Hora_Inicio || !out.Hora_Termino)
  )
    throw new Error("El rango horario requiere ambas horas.");
  if (out.Hora_Inicio && String(out.Hora_Termino) <= String(out.Hora_Inicio))
    throw new Error(
      "La hora de término debe ser posterior al inicio; registra turnos nocturnos por separado.",
    );
  if (raw.Agendas !== undefined) {
    const agendas = raw.Agendas;
    if (
      !Array.isArray(agendas) ||
      agendas.length < 1 ||
      agendas.length > 30 ||
      agendas.some(
        (a) => typeof a !== "string" || !a.trim() || a.trim().length > 250,
      )
    )
      throw new Error("Agrega entre 1 y 30 agendas válidas.");
    out.Agendas = agendas.map((a) => a.trim());
    if (
      new Set(out.Agendas.map((a) => a.toLocaleLowerCase("es"))).size !==
      out.Agendas.length
    )
      throw new Error("No repitas agendas.");
    out.Agenda = out.Agendas[0];
    out.Profesion = String(raw.Profesion || "").trim();
    if (!out.Profesion || out.Profesion.length > 150)
      throw new Error("Indica la profesión (máximo 150 caracteres).");
    if (!establishments.includes(String(out.Establecimiento)))
      throw new Error("Selecciona un establecimiento del listado.");
    if (!scheduleTypes.includes(String(out.Tipo_Horario)))
      throw new Error("Tipo de horario inválido.");
    out.Media_Jornada =
      out.Tipo_Horario === "MEDIA JORNADA"
        ? String(raw.Media_Jornada || "")
        : "";
    if (
      out.Tipo_Horario === "MEDIA JORNADA" &&
      !["AM", "PM"].includes(out.Media_Jornada)
    )
      throw new Error("Selecciona AM o PM.");
    out.Pacientes_Citados = raw.Pacientes_Citados === true;
    out.Es_MPO = raw.Es_MPO === true;
    out.MPO_Nombre = out.Es_MPO ? String(raw.MPO_Nombre || "").trim() : "";
    if (out.MPO_Nombre.length > 250)
      throw new Error("Nombre de MPO demasiado largo.");
    if (out.Tipo_Horario !== "RANGO HORARIO") {
      out.Hora_Inicio = "";
      out.Hora_Termino = "";
    }
  }
  return out;
}
export const establishments = [
  "Los Carros",
  "Buenos Aires",
  "Arrau Méndez",
  "Los Olivos",
  "Viña del Mar",
  "Rural",
];
export const scheduleTypes = [
  "NO INFORMADO",
  "JORNADA COMPLETA",
  "RANGO HORARIO",
  "MEDIA JORNADA",
];
export const professions = [
  "Médico/a",
  "Enfermero/a",
  "Matrona / Matrón",
  "Odontólogo/a",
  "Kinesiólogo/a",
  "Nutricionista",
  "Psicólogo/a",
  "Trabajador/a social",
  "Tecnólogo/a médico/a",
  "Terapeuta ocupacional",
  "Fonoaudiólogo/a",
  "TENS",
];
export const roleLabel = (role: string) =>
  role === "avanzado"
    ? "Administradora avanzada"
    : role === "administrativo"
      ? "Administrativo"
      : "Solo vista";
export const agendaText = (r: Data) =>
  (r.Agendas?.length ? r.Agendas : [String(r.Agenda || "")]).join(" · ");
export function groupedCounts(
  rows: RecordRow[],
  field: "Profesional" | "Establecimiento",
) {
  const map = new Map<string, { name: string; count: number }>();
  for (const r of rows.filter((r) => !r.archived)) {
    const name = String(r[field] || "Sin información");
    const key = professionalKey(name);
    const g = map.get(key) || { name, count: 0 };
    g.count++;
    map.set(key, g);
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
}
// Evita que Excel interprete texto del usuario como fórmulas al abrir un CSV.
export function csvCell(v: unknown) {
  let s = String(v ?? "");
  if (/^[\s]*[=+@\-\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function toCsv(rows: RecordRow[]) {
  return (
    "\uFEFF" +
    [
      fields.join(";"),
      ...rows.map((r) => fields.map((f) => csvCell(r[f])).join(";")),
    ].join("\r\n")
  );
}
export function businessDates(
  from: string,
  until: string,
  calendar: Calendar,
): string[] {
  const count = daysBetween(from, until);
  if (!Number.isInteger(count) || count < 1 || count > 1827)
    throw new Error("Período inválido o superior a cinco años.");
  for (
    let year = Number(from.slice(0, 4));
    year <= Number(until.slice(0, 4));
    year++
  )
    if (!calendar.years.some((y) => y.year === year && y.reviewed))
      throw new Error(`Falta revisar el calendario de feriados de ${year}.`);
  const holidays = new Set(calendar.holidays.map((h) => h.day));
  const days: string[] = [];
  const start = Date.parse(from + "T00:00:00Z");
  for (let i = 0; i < count; i++) {
    const d = new Date(start + i * 86400000);
    const key = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== 0 && !holidays.has(key)) days.push(key);
  }
  return days;
}
export const professionalKey = (value: unknown) =>
  String(value)
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("es");
export function uniqueAbsenceDays(
  rows: RecordRow[],
  calendar: Calendar,
  from?: string,
  until?: string,
) {
  const unique = new Set<string>();
  for (const r of rows) {
    if (r.archived) continue;
    const a =
      from && from > String(r.Fecha_Inicio) ? from : String(r.Fecha_Inicio);
    const b =
      until && until < String(r.Fecha_Termino)
        ? until
        : String(r.Fecha_Termino);
    if (a > b) continue;
    for (const d of businessDates(a, b, calendar))
      unique.add(professionalKey(r.Profesional) + "|" + d);
  }
  return unique.size;
}
export function assertExportRange(from: string, until: string) {
  if (!from || !until)
    throw new Error("Selecciona desde y hasta antes de exportar.");
  if (from > until)
    throw new Error("La fecha hasta debe ser posterior o igual a desde.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(until))
    throw new Error("Fechas inválidas.");
}
export function filterExportRows(
  rows: RecordRow[],
  from: string,
  until: string,
) {
  assertExportRange(from, until);
  return rows.filter(
    (r) =>
      !r.archived &&
      String(r.Fecha_Inicio) <= until &&
      String(r.Fecha_Termino) >= from,
  );
}
