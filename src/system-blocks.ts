import { readHtmlTables, readXlsx, canonicalEstablishment } from "./agenda-import.ts";

// Bloqueos leídos desde archivos del sistema. Valores literales: lo que no se
// reconoce queda vacío y se marca como información incompleta, nunca se inventa.
export type SystemBlock = {
  id?: string;
  codigo: string;
  establecimiento: string;
  profesional: string;
  profesion: string;
  agenda: string;
  tipo: string;
  observacion: string;
  fecha_inicio: string;
  fecha_termino: string;
  hora_inicio: string;
  hora_termino: string;
  fila: number;
};
export type ParsedSystemFile = {
  name: string;
  sha256: string;
  blocks: SystemBlock[];
  errors: string[];
};
type Field = Exclude<keyof SystemBlock, "id" | "fila">;
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const synonyms: Record<Field, string[]> = {
  codigo: [
    "codigobloqueo",
    "codbloqueo",
    "idbloqueo",
    "nbloqueo",
    "nrobloqueo",
    "numerobloqueo",
    "bloqueo",
    "codigo",
    "cod",
    "folio",
  ],
  establecimiento: ["establecimiento", "centro", "cesfam", "centrodesalud"],
  profesional: [
    "profesional",
    "nombreprofesional",
    "recurso",
    "nombrerecurso",
    "funcionario",
    "nombre",
  ],
  profesion: ["profesion", "especialidad", "estamento", "tipoprofesional"],
  agenda: ["agenda", "agendas", "nombreagenda", "codigoagenda", "codagenda"],
  tipo: ["tipobloqueo", "motivo", "motivobloqueo", "causa", "tipo"],
  observacion: [
    "observacion",
    "observaciones",
    "glosa",
    "comentario",
    "detalle",
  ],
  fecha_inicio: [
    "fechainicio",
    "fechadesde",
    "desde",
    "inicio",
    "fechainicial",
    "fecha",
  ],
  fecha_termino: [
    "fechatermino",
    "fechafin",
    "fechahasta",
    "hasta",
    "termino",
    "fin",
    "fechafinal",
  ],
  hora_inicio: ["horainicio", "horadesde", "hrinicio", "horainicial", "hora"],
  hora_termino: [
    "horatermino",
    "horafin",
    "horahasta",
    "hrtermino",
    "horafinal",
  ],
};
const fieldOf = (h: string): Field | undefined => {
  const k = norm(h);
  if (!k) return;
  for (const [f, list] of Object.entries(synonyms) as [Field, string[]][])
    if (list.includes(k)) return f;
};
export function mapHeader(row: string[]) {
  const cols: Partial<Record<Field, number>> = {};
  row.forEach((h, i) => {
    const f = fieldOf(h);
    if (f && cols[f] === undefined) cols[f] = i;
  });
  const n = Object.keys(cols).length;
  return n >= 3 && (cols.profesional !== undefined || cols.codigo !== undefined)
    ? cols
    : null;
}
const dateRe = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})|(\d{4})-(\d{2})-(\d{2})/;
export function parseDate(v: string) {
  // Excel guarda fechas como número de serie (días desde 1899-12-30).
  if (/^\d{5}(\.\d+)?$/.test(v.trim())) {
    const n = Math.floor(Number(v));
    if (n > 36526 && n < 73051)
      return new Date(Date.UTC(1899, 11, 30) + n * 86400000)
        .toISOString()
        .slice(0, 10);
  }
  const m = v.match(dateRe);
  if (!m) return "";
  const [y, mo, d] = m[4]
    ? [m[4], m[5], m[6]]
    : [m[3].length === 2 ? "20" + m[3] : m[3], m[2], m[1]];
  const s = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const t = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s
    ? s
    : "";
}
export function parseTime(v: string) {
  if (/^\d*\.\d+$/.test(v.trim())) {
    const mins = Math.round((Number(v) % 1) * 1440);
    if (mins > 0 && mins < 1440)
      return String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
  }
  const m = v.replace(dateRe, " ").match(/(\d{1,2}):(\d{2})/);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60
    ? m[1].padStart(2, "0") + ":" + m[2]
    : "";
}
function establishment(v: string) {
  try {
    return canonicalEstablishment(v);
  } catch {
    return v.trim();
  }
}
export function blocksFromTable(rows: string[][]): SystemBlock[] {
  const hi = rows.findIndex((r) => mapHeader(r));
  if (hi < 0) return [];
  const cols = mapHeader(rows[hi])!;
  const get = (r: string[], f: Field) =>
    cols[f] === undefined
      ? ""
      : (r[cols[f]!] || "").replace(/\s+/g, " ").trim();
  const out: SystemBlock[] = [];
  rows.slice(hi + 1).forEach((r, i) => {
    if (mapHeader(r) || !r.some((c) => c.trim())) return;
    const fi = get(r, "fecha_inicio"),
      ft = get(r, "fecha_termino");
    const b: SystemBlock = {
      codigo: get(r, "codigo"),
      establecimiento: establishment(get(r, "establecimiento")),
      profesional: get(r, "profesional"),
      profesion: get(r, "profesion"),
      agenda: get(r, "agenda"),
      tipo: get(r, "tipo"),
      observacion: get(r, "observacion"),
      fecha_inicio: parseDate(fi),
      fecha_termino: parseDate(ft),
      hora_inicio: parseTime(get(r, "hora_inicio")) || parseTime(fi),
      hora_termino: parseTime(get(r, "hora_termino")) || parseTime(ft),
      fila: hi + i + 2,
    };
    if (b.codigo || b.profesional) out.push(b);
  });
  return out;
}
// Campos obligatorios para considerar un bloqueo completo.
export function missingFields(b: SystemBlock) {
  const m: string[] = [];
  if (!b.codigo) m.push("código");
  if (!b.establecimiento) m.push("establecimiento");
  else
    try {
      canonicalEstablishment(b.establecimiento);
    } catch {
      m.push("establecimiento válido");
    }
  if (!b.profesional) m.push("profesional");
  if (!b.fecha_inicio) m.push("fecha de inicio");
  if (!b.fecha_termino) m.push("fecha de término");
  if (!b.tipo) m.push("tipo de bloqueo");
  return m;
}
type Item = { text: string; x: number; y: number };
// Reconstrucción espacial: líneas por altura y columnas por la posición de cada encabezado.
export function pdfTable(items: Item[]): string[][] {
  const lines: Item[][] = [];
  for (const it of [...items]
    .filter((i) => i.text.trim())
    .sort((a, b) => b.y - a.y || a.x - b.x)) {
    let l = lines.find((l) => Math.abs(l[0].y - it.y) < 2.5);
    if (!l) lines.push((l = []));
    l.push(it);
  }
  lines.forEach((l) => l.sort((a, b) => a.x - b.x));
  const hi = lines.findIndex((l) => mapHeader(l.map((i) => i.text)));
  if (hi < 0) return [];
  const xs = lines[hi].map((i) => i.x);
  const rows = [lines[hi].map((i) => i.text)];
  for (const l of lines.slice(hi + 1)) {
    if (l.some((i) => /^p[aá]gina\s+\d/i.test(i.text))) continue;
    const r = Array(xs.length).fill("");
    for (const it of l) {
      let c = 0;
      for (let i = 1; i < xs.length; i++) if (it.x >= xs[i] - 4) c = i;
      r[c] += (r[c] ? " " : "") + it.text.trim();
    }
    rows.push(r);
  }
  return rows;
}
export async function readSystemFile(file: File): Promise<ParsedSystemFile> {
  const errors: string[] = [];
  if (!file.size || file.size > 20 * 1024 * 1024)
    throw new Error(`${file.name}: debe pesar entre 1 byte y 20 MB.`);
  const data = new Uint8Array(await file.arrayBuffer());
  const sha256 = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  let tables: string[][][] = [];
  if (new TextDecoder().decode(data.slice(0, 5)) === "%PDF-") {
    const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url"))
      .default;
    const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
    GlobalWorkerOptions.workerSrc = worker;
    const task = getDocument({ data: data.slice(), useSystemFonts: true });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 150) throw new Error("Máximo 150 páginas por PDF.");
      for (let p = 1; p <= pdf.numPages; p++) {
        const tc = await (await pdf.getPage(p)).getTextContent();
        const t = pdfTable(
          tc.items
            .filter(
              (i): i is typeof i & { str: string; transform: number[] } =>
                "str" in i,
            )
            .map((i) => ({
              text: i.str,
              x: i.transform[4],
              y: i.transform[5],
            })),
        );
        if (t.length) tables.push(t);
      }
    } finally {
      await task.destroy();
    }
  } else if (data[0] === 0x50 && data[1] === 0x4b && /\.xlsx$/i.test(file.name)) {
    tables = readXlsx(data);
  } else if (/\.(php|html?)$/i.test(file.name)) {
    const head = new TextDecoder().decode(data.slice(0, 1500));
    const html = new TextDecoder(
      /windows-1252|iso-8859-1/i.test(head) ? "windows-1252" : "utf-8",
    ).decode(data);
    if (/<\?(?:php|=)/i.test(html))
      throw new Error(
        `${file.name}: contiene código PHP de servidor. Guarda la página desde el navegador (HTML); la app no ejecuta PHP.`,
      );
    tables = readHtmlTables(html);
  } else
    throw new Error(
      `${file.name}: usa Excel .xlsx, PDF de texto, HTML o página guardada .php.`,
    );
  const blocks = tables.flatMap(blocksFromTable);
  if (!blocks.length)
    errors.push(
      "No se reconoció una tabla de bloqueos (se buscan encabezados como Código, Profesional, Establecimiento, Fecha inicio y Fecha término). Los PDF escaneados no se pueden leer.",
    );
  return { name: file.name, sha256, blocks, errors };
}
