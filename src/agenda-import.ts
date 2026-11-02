import { parse, type DefaultTreeAdapterMap } from "parse5";
import { unzipSync, strFromU8 } from "fflate";
import {
  dates,
  key as normalizedKey,
  minutes,
  type AgendaSession,
  type CatalogProfessional,
} from "./agenda-model.ts";

const key = (v: unknown) => normalizedKey(v).toLowerCase();
export const establishments = [
  "Buenos Aires",
  "Arrau Méndez",
  "Los Olivos",
  "Viña del Mar",
  "Los Carros",
  "Rural",
];
export const professionNames = [
  "Asistente social",
  "Asistente técnico/a dental",
  "Educador/a de párvulos",
  "Enfermero/a",
  "Fonoaudiólogo/a",
  "Higienista dental",
  "Kinesiólogo/a",
  "Matrón/a",
  "Médico/a",
  "Nutricionista",
  "Odontólogo/a",
  "Podólogo/a",
  "Profesor/a de educación física",
  "Psicólogo/a",
  "Químico/a farmacéutico/a",
  "Tecnólogo/a médico/a",
  "Terapeuta ocupacional",
  "Técnico/a en enfermería de nivel superior",
  "Técnico/a en salud (área no especificada)",
  "Profesiones no formales",
];
const professionAliases: Record<string, string> = {};
for (const [i, variants] of [
  [
    0,
    [
      "asistente social",
      "trabajador social",
      "trabajadora social",
      "trabajador/a social",
    ],
  ],
  [1, ["asistente tecnico dental"]],
  [2, ["educadora de parvulos", "educador de parvulos"]],
  [3, ["enfermera(o)", "enfermera", "enfermero", "enfermeria"]],
  [4, ["fonoaudiologo", "fonoaudiologa"]],
  [6, ["kinesiologo", "kinesiologa"]],
  [7, ["matron(a)", "matrona", "matron"]],
  [8, ["medico", "medica", "medico general", "medica general", "medicina"]],
  [10, ["odontologo", "odontologa", "odontologia"]],
  [11, ["podologo", "podologa"]],
  [12, ["profesor de educ fisica"]],
  [13, ["psicologo", "psicologa"]],
  [14, ["quimico farmaceutico", "quimica farmaceutica"]],
  [15, ["tecnologo medico"]],
  [
    17,
    [
      "tecnico enfermeria n. s.",
      "tens",
      "tecnico en enfermeria nivel superior",
    ],
  ],
  [18, ["tecnicos en salid", "tecnico en salud"]],
] as [number, string[]][])
  for (const v of variants) professionAliases[key(v)] = professionNames[i];
for (const p of professionNames) professionAliases[key(p)] = p;
export const standardProfession = (v: string) =>
  professionAliases[key(v)] || v.trim();
export function canonicalEstablishment(v: string) {
  const k = key(v);
  const match = establishments.filter(
    (e) => k === key(e) || k.endsWith(" " + key(e)),
  );
  if (match.length !== 1)
    throw new Error(`Establecimiento no reconocido: ${v}. Revisa la fila.`);
  return match[0];
}
export type AgendaRule = {
  id?: string;
  professional_id?: string;
  establishment: string;
  resource_code: string;
  resource_name: string;
  agenda_code: string;
  agenda_name: string;
  starts_on: string;
  ends_on: string;
  weekday: number;
  starts_at: string;
  interval_minutes: number;
  capacity: number;
  generated: boolean;
  staggered: boolean;
  source_blocked: boolean;
  attention: string;
  source_row: string;
  source_name?: string;
};
export const agendaHeaders = [
  "ID agenda",
  "Código recurso",
  "Recurso catálogo",
  "Agenda",
  "Fecha inicio",
  "Fecha término",
  "Escalonada",
  "Generada",
  "Día agenda",
  "Establecimiento",
  "Cupos",
  "Hora inicio",
  "Intervalo",
  "Atención",
];
const headerKey = (v: string) => key(v).replace(/[^a-z0-9]/g, "");
const dayNames = [
  "DOMINGO",
  "LUNES",
  "MARTES",
  "MIERCOLES",
  "JUEVES",
  "VIERNES",
  "SABADO",
];
function date(v: string) {
  let s = v.trim(),
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) s = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  else if (/^\d+(\.\d+)?$/.test(s))
    s = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000)
      .toISOString()
      .slice(0, 10);
  else s = s.slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s + "T00:00:00Z")) ||
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s
  )
    throw new Error("Fecha inválida: " + v);
  return s;
}
function time(v: string) {
  if (/^0\.\d+$/.test(v)) {
    const n = Math.round(Number(v) * 1440);
    v = `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  }
  const m = v.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59)
    throw new Error("Hora inválida: " + v);
  return m[1].padStart(2, "0") + ":" + m[2];
}
export function parseAgendaRows(rows: string[][], source: string) {
  const header = rows.findIndex((r) =>
    agendaHeaders.every((h) => r.some((c) => headerKey(c) === headerKey(h))),
  );
  if (header < 0)
    throw new Error(
      "No se encontró la tabla SISMAULE. Se necesitan los 14 encabezados: " +
        agendaHeaders.join(", "),
    );
  const indexes = agendaHeaders.map((h) =>
    rows[header].findIndex((c) => headerKey(c) === headerKey(h)),
  );
  const rules: AgendaRule[] = [],
    errors: string[] = [],
    warnings: string[] = [];
  rows.slice(header + 1).forEach((raw, i) => {
    if (
      raw.every((v) => !v.trim()) ||
      headerKey(raw[indexes[0]] || "") === headerKey(agendaHeaders[0])
    )
      return;
    const row = String(i + header + 2),
      c = indexes.map((j) => (raw[j] || "").trim());
    try {
      const weekday = dayNames.indexOf(key(c[8]).toUpperCase());
      if (weekday < 0) throw new Error("Día de agenda no reconocido");
      const a = date(c[4]),
        b = date(c[5]);
      if (b < a || Date.parse(b) - Date.parse(a) > 367 * 86400000)
        throw new Error("Rango inválido o superior a un año");
      if (
        !dates(a, b).some(
          (d) => new Date(d + "T00:00:00Z").getUTCDay() === weekday,
        )
      )
        warnings.push(
          `Fila ${row}: el rango no contiene el día indicado; se conserva sin crear atención en otra fecha.`,
        );
      if (!c[0] || !c[1] || !c[2] || !c[3])
        throw new Error("Falta código, recurso o nombre de agenda");
      if (
        !/^\d+$/.test(c[10]) ||
        !/^\d+$/.test(c[12]) ||
        Number(c[12]) < 1 ||
        Number(c[12]) > 1440
      )
        throw new Error("Cupos o intervalo inválido");
      if (
        !["SI", "NO"].includes(key(c[6]).toUpperCase()) ||
        !["SI", "NO"].includes(key(c[7]).toUpperCase())
      )
        throw new Error("Escalonada y Generada deben indicar SI/NO");
      const start = time(c[11]);
      if (minutes(start) + Number(c[12]) > 1440)
        throw new Error("El intervalo atraviesa medianoche; requiere revisión");
      rules.push({
        establishment: canonicalEstablishment(c[9]),
        resource_code: c[1],
        resource_name: c[2],
        agenda_code: c[0],
        agenda_name: c[3],
        starts_on: a,
        ends_on: b,
        weekday,
        starts_at: start,
        interval_minutes: Number(c[12]),
        capacity: Number(c[10]),
        generated: key(c[7]) === "si",
        staggered: key(c[6]) === "si",
        source_blocked: /^bloquead[ao]\b/.test(key(c[3])),
        attention: c[13],
        source_row: row,
        source_name: source,
      });
    } catch (e) {
      errors.push(`Fila ${row}: ${(e as Error).message}`);
    }
  });
  if (!rules.length && !errors.length)
    errors.push("La tabla no contiene agendas.");
  return { rules, errors, warnings };
}
const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
const decode = (s: string) =>
  s.replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (v, n, e) =>
    n
      ? String.fromCodePoint(
          n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n),
        )
      : entities[e.toLowerCase()] || v,
  );
export function readXlsx(data: Uint8Array): string[][][] {
  let total = 0;
  const files = unzipSync(data, {
    filter: (f) => {
      if (
        f.originalSize > 40 * 1024 * 1024 ||
        (total += f.originalSize) > 150 * 1024 * 1024
      )
        throw new Error("Excel descomprimido demasiado grande");
      return /^xl\/(worksheets\/sheet\d+\.xml|sharedStrings\.xml|workbook\.xml)$/.test(
        f.name,
      );
    },
  });
  const xmlText = (d: Uint8Array) =>
    strFromU8(d).replace(/(<\/?)[\w-]+:/g, "$1");
  const strings = [
    ...xmlText(files["xl/sharedStrings.xml"] || new Uint8Array()).matchAll(
      /<si\b[^>]*>([\s\S]*?)<\/si>/g,
    ),
  ].map((m) =>
    [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((x) => decode(x[1]))
      .join(""),
  );
  if (
    /date1904=["'](?:1|true)/.test(
      strFromU8(files["xl/workbook.xml"] || new Uint8Array()),
    )
  )
    throw new Error(
      "El libro usa fechas 1904; exporta con fechas de texto ISO.",
    );
  return Object.entries(files)
    .filter(([n]) => /^xl\/worksheets\//.test(n))
    .sort()
    .map(([, data]) =>
      [...xmlText(data).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
        const cells: string[] = [];
        for (const m of r[1].matchAll(
          /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
        )) {
          const col = m[1].match(/\br=["']([A-Z]+)\d+["']/)?.[1];
          if (!col) continue;
          const index =
            [...col].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
          const body = m[2] || "",
            type = m[1].match(/\bt=["']([^"']+)/)?.[1],
            v = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] || "";
          if (/<f\b/.test(body))
            throw new Error(
              "La importación requiere valores, no fórmulas. Exporta el archivo como valores.",
            );
          cells[index] =
            type === "s"
              ? strings[Number(v)] || ""
              : type === "inlineStr"
                ? [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
                    .map((t) => decode(t[1]))
                    .join("")
                : decode(v);
        }
        return Array.from(
          { length: Math.max(14, cells.length) },
          (_, i) => cells[i] || "",
        );
      }),
    );
}
export function readHtmlTables(html: string): string[][][] {
  type N = DefaultTreeAdapterMap["node"];
  const out: string[][][] = [];
  const text = (n: N): string =>
    "value" in n
      ? n.value
      : "childNodes" in n &&
          (!("tagName" in n) ||
            !["script", "style", "iframe"].includes(n.tagName))
        ? n.childNodes.map(text).join(" ")
        : "";
  const visit = (n: N) => {
    if ("tagName" in n && n.tagName === "table") {
      const rows: string[][] = [];
      const tr = (n: N) => {
        if ("tagName" in n && n.tagName === "tr")
          rows.push(
            n.childNodes
              .filter((c) => "tagName" in c && ["td", "th"].includes(c.tagName))
              .map((c) => text(c).replace(/\s+/g, " ").trim()),
          );
        else if ("childNodes" in n) n.childNodes.forEach(tr);
      };
      tr(n);
      out.push(rows);
    } else if ("childNodes" in n) n.childNodes.forEach(visit);
  };
  visit(parse(html));
  return out;
}
export type PdfItem = { text: string; x: number; y: number };
// Reconstruct only a recognized complete SIS header. Never evaluate PHP/HTML or guess a missing column.
export function pdfAgendaRows(items: PdfItem[]): string[][] {
  const lines: PdfItem[][] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    let l = lines.find((l) => Math.abs(l[0].y - item.y) < 2);
    if (!l) {
      l = [];
      lines.push(l);
    }
    l.push(item);
  }
  const header = lines.find(
    (l) =>
      l.some((i) => headerKey(i.text) === "idagenda") &&
      l.some((i) => headerKey(i.text) === "cupos"),
  );
  if (!header) return [];
  const anchors = agendaHeaders.map(
    (h) => header.find((i) => headerKey(i.text) === headerKey(h))?.x,
  );
  if (anchors.some((a) => a === undefined))
    throw new Error(
      "PDF con encabezados divididos o incompletos: exporta esa agenda a Excel.",
    );
  const xs = anchors as number[];
  if (xs.some((x, i) => i > 0 && x <= xs[i - 1]))
    throw new Error("No se reconoce el orden de las columnas del PDF.");
  const out: string[][] = [agendaHeaders],
    data = lines.filter((l) => l[0].y < header[0].y - 3);
  let row: string[] | undefined;
  for (const line of data) {
    if (line.some((i) => /^p[aá]gina\s+\d/i.test(i.text))) {
      row = undefined;
      continue;
    }
    if (line.some((i) => i.x < xs[1] - 3 && /^\d+-\d+$/.test(i.text.trim()))) {
      row = Array(14).fill("");
      out.push(row);
    }
    if (!row) continue;
    for (const item of line) {
      let col = 0;
      for (let i = 1; i < xs.length; i++) if (item.x >= xs[i] - 3) col = i;
      row[col] += (row[col] ? " " : "") + item.text.trim();
    }
  }
  return out;
}
export function expandRules(
  rules: AgendaRule[],
  periodId: string,
  from: string,
  until: string,
): AgendaSession[] {
  const slots: AgendaSession[] = [];
  for (const r of rules) {
    if (!r.professional_id) continue;
    const a = r.starts_on > from ? r.starts_on : from,
      b = r.ends_on < until ? r.ends_on : until;
    for (const day of dates(a, b))
      if (new Date(day + "T00:00:00Z").getUTCDay() === r.weekday) {
        const end = minutes(r.starts_at) + r.interval_minutes;
        const endTime = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
        slots.push({
          id: r.id + "|" + day,
          period_id: periodId,
          professional_id: r.professional_id,
          establishment: r.establishment,
          agenda_name: r.agenda_name,
          agenda_code: r.agenda_code,
          service_day: day,
          starts_at: r.starts_at,
          ends_at: r.capacity === 1 ? endTime : null,
          capacity: r.capacity,
          source_name: r.source_name || "",
          source_blocked: r.source_blocked,
          generated: r.generated,
          attention: r.attention,
          interval_minutes: r.interval_minutes,
          source_row: r.source_row,
        });
      }
  }
  const unique = new Map<string, AgendaSession>();
  for (const s of slots)
    unique.set(
      JSON.stringify([
        s.professional_id,
        s.establishment,
        s.agenda_code,
        s.service_day,
        s.starts_at,
        s.ends_at,
        s.capacity,
        s.generated,
        s.source_blocked,
        s.attention,
      ]),
      s,
    );
  const group = (s: AgendaSession) =>
    JSON.stringify([
      s.professional_id,
      s.establishment,
      s.agenda_code,
      s.service_day,
      s.generated,
      s.source_blocked,
      s.attention,
    ]);
  const ordered = [...unique.values()].sort(
    (a, b) =>
      group(a).localeCompare(group(b)) ||
      String(a.starts_at).localeCompare(String(b.starts_at)),
  );
  const merged: AgendaSession[] = [];
  for (const s of ordered) {
    const p = merged.at(-1);
    if (
      p &&
      group(p) === group(s) &&
      p.ends_at &&
      p.ends_at === s.starts_at &&
      s.ends_at
    ) {
      p.ends_at = s.ends_at;
      p.capacity = (p.capacity || 0) + (s.capacity || 0);
      p.source_row += "; " + s.source_row;
    } else merged.push({ ...s });
  }
  return merged.sort(
    (a, b) =>
      a.service_day.localeCompare(b.service_day) ||
      String(a.starts_at).localeCompare(String(b.starts_at)),
  );
}

export type DirectoryEntry = {
  establishment: string;
  resource_code: string;
  name: string;
  profession: string;
  source_origin: string;
};
export function pdfDirectoryRows(
  items: PdfItem[],
  page: number,
): DirectoryEntry[] {
  const code = items.find((i) => i.text.trim() === "Código"),
    name = items.find((i) => i.text.includes("Nombre completo según fuente")),
    prof = items.find((i) => i.text.includes("Profesión normalizada")),
    est = items.find((i) => i.text.trim() === "Establecimiento"),
    origin = items.find((i) => i.text.trim() === "Origen");
  if (
    !code ||
    !name ||
    !prof ||
    !est ||
    !origin ||
    !items.some((i) => i.text.trim() === "p:f")
  )
    return [];
  const body = items.filter((i) => i.y < code.y - 4),
    codes = body
      .filter(
        (i) =>
          i.x >= code.x - 2 && i.x < name.x - 2 && /^\d+$/.test(i.text.trim()),
      )
      .sort((a, b) => b.y - a.y);
  return codes
    .map((c, i) => {
      const upper = i ? (codes[i - 1].y + c.y) / 2 : c.y + 10;
      const lower = codes[i + 1] ? (codes[i + 1].y + c.y) / 2 : c.y - 12;
      const cells = body
        .filter((t) => t.y < upper && t.y >= lower)
        .sort((a, b) => b.y - a.y || a.x - b.x);
      const cell = (a: number, b: number) =>
        cells
          .filter((t) => t.x >= a - 2 && t.x < b - 2)
          .map((t) => t.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
      return {
        establishment: cell(est.x, code.x),
        resource_code: c.text.trim(),
        name: cell(name.x, prof.x).replace(/\s*\[[A-Z]\d+\]/g, ""),
        profession: standardProfession(cell(prof.x, origin.x)),
        source_origin: `Página ${page}; origen ${cell(origin.x, 10000)}`,
      };
    })
    .filter(
      (p) =>
        p.name &&
        p.profession &&
        ["Los Olivos", "Arrau Méndez", "Buenos Aires", "Los Carros"].includes(
          p.establishment,
        ),
    );
}
