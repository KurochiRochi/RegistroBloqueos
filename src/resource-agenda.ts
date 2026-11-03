// Lectura del PDF "Gestión Agendas por Recurso" de SISMAULE.
// Cada fila es un cupo con fecha, hora, tipo (Nuevo/Control), cupos, citados,
// correlativo y nombre de agenda. En el original, las filas en negro son agenda
// activa y las filas en rojo son agenda bloqueada para esa fecha.
import { professionalKey as key } from "./model.ts";

export type ColoredItem = { text: string; x: number; y: number; color: string };
export type ResourceRow = {
  service_day: string;
  starts_at: string;
  attention: string;
  capacity: number;
  booked: number;
  agenda_code: string;
  agenda_name: string;
  source_blocked: boolean;
  page: number;
};
export type ResourceEntry = {
  service_day: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked: number;
  interval_minutes: number;
  agenda_code: string;
  agenda_name: string;
  attention: string;
  source_blocked: boolean;
  source_row: string;
};
export type ResourceDocument = {
  resource_name: string;
  resource_code: string;
  from: string;
  until: string;
  rows: ResourceRow[];
};

const WEEKDAY = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)$/i;
const isoDate = (d: string) => {
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
};
const hhmm = (h: string) => {
  const [a, b] = h.split(":");
  return `${a.padStart(2, "0")}:${b}`;
};
/** Rojo (o tono rojizo) = bloqueada en SISMAULE. */
export function isRed(color: string) {
  const m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return false;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return r >= 150 && g <= 110 && b <= 110;
}

/**
 * Asigna a cada texto el color con que fue pintado, alineando los caracteres de
 * getTextContent con los del flujo de operadores (ambos siguen el orden del PDF).
 */
export function alignColors(
  items: { text: string; x: number; y: number }[],
  glyphs: { ch: string; color: string }[],
): ColoredItem[] {
  const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
  const stream = glyphs.flatMap((g) =>
    [...norm(g.ch)].map((ch) => ({ ch, color: g.color })),
  );
  let p = 0;
  return items.map((it) => {
    const chars = [...norm(it.text)];
    if (!chars.length) return { ...it, color: "" };
    let start = -1;
    for (let i = p; i < Math.min(stream.length, p + 400); i++) {
      if (chars.every((c, k) => stream[i + k]?.ch === c)) {
        start = i;
        break;
      }
    }
    if (start < 0) return { ...it, color: "" };
    p = start + chars.length;
    return { ...it, color: stream[start].color };
  });
}

/** Interpreta los textos (en orden del documento) de todas las páginas. */
export function parseResourcePages(pages: ColoredItem[][]): ResourceDocument {
  const rows: ResourceRow[] = [];
  let resourceParts: string[] = [],
    from = "",
    until = "",
    day = "",
    open: (ResourceRow & { y: number; x: number; numbers: number; hasCode: boolean }) | null = null;
  pages.forEach((items, pageIndex) => {
    const page = pageIndex + 1;
    const close = () => {
      if (open) {
        const { y, x, numbers, hasCode, ...row } = open;
        if (hasCode || row.agenda_name) rows.push({ ...row, agenda_name: row.agenda_name.trim() });
      }
      open = null;
    };
    const texts = items.map((i) => i.text.replace(/\s+/g, " ").trim());
    for (let i = 0; i < items.length; i++) {
      const it = items[i],
        s = texts[i];
      if (!s) continue;
      // Encabezado del informe.
      if (page === 1 && /^Recurso:?$/i.test(s)) {
        for (let j = i + 1; j < items.length && !/^Fecha/i.test(texts[j]); j++)
          if (texts[j]) resourceParts.push(texts[j]);
        continue;
      }
      if (/^Fecha Inicio:?$/i.test(s) || /^Fecha T[ée]rmino:?$/i.test(s)) {
        const next = texts.slice(i + 1).find((t) => t);
        const v = isoDate(next || "");
        if (/Inicio/i.test(s)) from = from || v;
        else until = until || v;
        continue;
      }
      // Fecha de la agenda: "03/11/2026 Martes" (o fecha y día en textos separados).
      const dm = s.match(/^(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+(\S+))?$/);
      if (dm) {
        const weekday = dm[2] || texts.slice(i + 1).find((t) => t) || "";
        if (WEEKDAY.test(weekday)) {
          close();
          day = isoDate(dm[1]);
          continue;
        }
      }
      // Inicio de fila: "08:00 Nuevo".
      const tm = s.match(/^(\d{1,2}:\d{2})(?:\s+(.*))?$/);
      if (tm && day) {
        close();
        open = {
          service_day: day,
          starts_at: hhmm(tm[1]),
          attention: (tm[2] || "").trim(),
          capacity: 0,
          booked: 0,
          agenda_code: "",
          agenda_name: "",
          source_blocked: isRed(it.color),
          page,
          y: it.y,
          x: it.x,
          numbers: 0,
          hasCode: false,
        };
        continue;
      }
      if (!open) continue;
      const row = open as NonNullable<typeof open>;
      if (Math.abs(it.y - row.y) > 45 || it.x < row.x - 5) {
        close();
        continue;
      }
      if (!row.attention && /^(nuevo|control|[a-záéíóú]+)$/i.test(s) && row.numbers === 0 && !row.hasCode) {
        row.attention = s;
        continue;
      }
      if (!row.hasCode && /^\d{1,4}$/.test(s) && row.numbers < 2) {
        if (row.numbers === 0) row.capacity = Number(s);
        else row.booked = Number(s);
        row.numbers++;
        continue;
      }
      const cm = s.match(/^(\d{5,})(?:\s+(.*))?$/);
      if (!row.hasCode && cm) {
        row.agenda_code = cm[1];
        row.agenda_name = cm[2] || "";
        row.hasCode = true;
        continue;
      }
      if (row.hasCode) row.agenda_name += " " + s;
    }
    close();
  });
  const joined = resourceParts.join(" ").trim();
  const code = joined.match(/^(\d+)\b/)?.[1] || "";
  return {
    resource_code: code,
    resource_name: joined.replace(/^\d+\s*/, "").trim(),
    from,
    until,
    rows,
  };
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) =>
  `${String(Math.floor(Math.min(m, 1439) / 60)).padStart(2, "0")}:${String(Math.min(m, 1439) % 60).padStart(2, "0")}`;

/**
 * Convierte las filas en franjas: el término de cada cupo es la hora del cupo
 * siguiente del mismo día (o la duración del cupo anterior si es el último).
 * Los cupos consecutivos de la misma agenda, tipo y estado se reúnen en una franja.
 */
export function resourceEntries(
  rows: ResourceRow[],
  canonical: (name: string) => string = (n) => n,
): ResourceEntry[] {
  const byDay = new Map<string, ResourceRow[]>();
  for (const r of rows) byDay.set(r.service_day, [...(byDay.get(r.service_day) || []), r]);
  const out: ResourceEntry[] = [];
  for (const [, list] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const starts = [...new Set(list.map((r) => toMin(r.starts_at)))];
    let lastGap = 15;
    const merged: ResourceEntry[] = [];
    for (const r of list) {
      const a = toMin(r.starts_at);
      const next = starts.find((s) => s > a);
      let gap = next !== undefined ? next - a : lastGap;
      if (gap > 120 || gap < 1) gap = Math.max(10, Math.min(60, lastGap));
      if (next !== undefined && next - a <= 120) lastGap = gap;
      const entry: ResourceEntry = {
        service_day: r.service_day,
        starts_at: r.starts_at,
        ends_at: toTime(a + gap),
        capacity: r.capacity || 1,
        booked: r.booked,
        interval_minutes: Math.max(1, Math.round(gap / Math.max(1, r.capacity || 1))),
        agenda_code: r.agenda_code,
        agenda_name: canonical(r.agenda_name.replace(/\s+/g, " ").trim()),
        attention: r.attention.toLocaleUpperCase("es"),
        source_blocked: r.source_blocked,
        source_row: `${r.starts_at} (${r.capacity || 1} cupo${(r.capacity || 1) > 1 ? "s" : ""}, ${r.booked} citado${r.booked === 1 ? "" : "s"})`,
      };
      const prev = merged.at(-1);
      if (
        prev &&
        prev.agenda_code === entry.agenda_code &&
        prev.attention === entry.attention &&
        prev.source_blocked === entry.source_blocked &&
        prev.ends_at === entry.starts_at
      ) {
        prev.ends_at = entry.ends_at;
        prev.capacity += entry.capacity;
        prev.booked += entry.booked;
        prev.interval_minutes = Math.max(1, Math.round((toMin(prev.ends_at) - toMin(prev.starts_at)) / prev.capacity));
        prev.source_row += "; " + entry.source_row;
      } else merged.push(entry);
    }
    out.push(...merged);
  }
  return out;
}

const STOP = new Set(["PDF", "AGENDA", "AGENDAS", "RECURSO", "GESTION", "DR", "DRA", "SIS", "MAULE", "SISMAULE", "COPIA", "DEL", "LOS", "LAS"]);
/** Palabras útiles del nombre del archivo ("frugone.pdf" → ["FRUGONE"]). */
export function fileNameWords(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .split(/[^\p{L}\d]+/u)
    .filter((w) => !/\d/.test(w))
    .map((w) => key(w))
    .filter((w) => w.length >= 3 && !STOP.has(w));
}
/** Profesionales cuyo nombre contiene todas las palabras indicadas. */
export function matchProfessionals<T extends { name: string; aliases?: string[] }>(
  words: string[],
  people: T[],
): T[] {
  if (!words.length) return [];
  const tokens = (p: T) =>
    [p.name, ...(p.aliases || [])].map((n) => key(n).replace(/[^A-Z]+/g, " ").split(" "));
  const all = people.filter((p) => tokens(p).some((t) => words.every((w) => t.includes(w))));
  if (all.length) return all;
  const long = words.filter((w) => w.length >= 4);
  return people.filter((p) => tokens(p).some((t) => long.some((w) => t.includes(w))));
}

/** Extrae los textos con su color desde un documento PDF.js (navegador o Node). */
export async function coloredPages(
  pdf: { numPages: number; getPage(n: number): Promise<any> },
  OPS: { setFillRGBColor: number; showText: number; showSpacedText: number; save: number; restore: number },
): Promise<ColoredItem[][]> {
  const pages: ColoredItem[][] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const [text, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
    const glyphs: { ch: string; color: string }[] = [];
    let color = "#000000";
    const stack: string[] = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const f = ops.fnArray[i],
        a = ops.argsArray[i];
      if (f === OPS.setFillRGBColor) color = typeof a?.[0] === "string" ? a[0] : color;
      else if (f === OPS.save) stack.push(color);
      else if (f === OPS.restore) color = stack.pop() ?? color;
      else if (f === OPS.showText || f === OPS.showSpacedText) {
        const list = (a?.[0] || []) as ({ unicode?: string } | number | null)[];
        const s = list.map((g) => (g && typeof g === "object" ? g.unicode || "" : "")).join("");
        if (s) glyphs.push({ ch: s, color });
      }
    }
    const items = (text.items as any[])
      .filter((i) => typeof i.str === "string")
      .map((i) => ({ text: i.str as string, x: i.transform[4] as number, y: i.transform[5] as number }));
    pages.push(alignColors(items, glyphs));
  }
  return pages;
}
