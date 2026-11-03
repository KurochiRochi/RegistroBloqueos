import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  readXlsx,
  readHtmlTables,
  parseAgendaRows,
  pdfAgendaRows,
  pdfDirectoryRows,
  type DirectoryEntry,
  type PdfItem,
  type AgendaRule,
} from "./agenda-import.ts";
import {
  coloredPages,
  parseResourcePages,
  type ResourceDocument,
} from "./resource-agenda.ts";
import { professionalKey } from "./model.ts";
export type ParsedAgendaFile = {
  name: string;
  sha256: string;
  rules: AgendaRule[];
  professionals: DirectoryEntry[];
  errors: string[];
  warnings: string[];
  /** PDF "Gestión Agendas por Recurso" (agenda activa en negro, bloqueada en rojo). */
  resource?: ResourceDocument;
  /** Excel "BD Profesionales y Agenda": listas para autocompletar. */
  lists?: { professionals: string[]; agendas: string[] };
};
/** Busca una columna con encabezado PROFESIONAL o AGENDA y devuelve sus valores. */
function listColumn(table: string[][], header: string) {
  for (let r = 0; r < Math.min(table.length, 6); r++) {
    const c = table[r].findIndex((v) => professionalKey(v) === header);
    if (c < 0) continue;
    const values = table
      .slice(r + 1)
      .map((row) => String(row[c] || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return [...new Map(values.map((v) => [professionalKey(v), v])).values()];
  }
  return null;
}
export async function readAgendaFile(file: File): Promise<ParsedAgendaFile> {
  if (!file.size || file.size > 20 * 1024 * 1024)
    throw new Error("Cada archivo debe pesar entre 1 byte y 20 MB.");
  const data = new Uint8Array(await file.arrayBuffer());
  const sha256 = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  let tables: string[][][] = [],
    professionals: DirectoryEntry[] = [];
  if (data[0] === 0x50 && data[1] === 0x4b && /\.xlsx$/i.test(file.name)) {
    tables = readXlsx(data);
    const names = tables.map((t) => listColumn(t, "PROFESIONAL")).find(Boolean),
      agendas = tables.map((t) => listColumn(t, "AGENDA")).find(Boolean);
    const isSchedule = tables.some((t) =>
      t.slice(0, 6).some((row) => row.filter(Boolean).length >= 8),
    );
    if ((names || agendas) && !isSchedule)
      return {
        name: file.name,
        sha256,
        rules: [],
        professionals: [],
        errors:
          (names?.length || 0) + (agendas?.length || 0)
            ? []
            : ["Las hojas PROFESIONAL / AGENDA están vacías."],
        warnings: [],
        lists: { professionals: names || [], agendas: agendas || [] },
      };
  } else if (new TextDecoder().decode(data.slice(0, 5)) === "%PDF-") {
    const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
    GlobalWorkerOptions.workerSrc = workerUrl;
    const task = getDocument({ data: data.slice(), useSystemFonts: true });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 150) throw new Error("Máximo 150 páginas por PDF.");
      const first = await (await pdf.getPage(1)).getTextContent();
      const firstText = first.items
        .map((i) => ("str" in i ? i.str : ""))
        .join(" ");
      if (/Agendas\s+por\s+Recurso/i.test(firstText)) {
        const { OPS } = await import("pdfjs-dist");
        const resource = parseResourcePages(await coloredPages(pdf, OPS));
        return {
          name: file.name,
          sha256,
          rules: [],
          professionals: [],
          errors: resource.rows.length
            ? []
            : ["No se reconocieron filas de agenda en el PDF por recurso."],
          warnings: [],
          resource,
        };
      }
      let directoryStarted = false;
      for (let page = 1; page <= pdf.numPages; page++) {
        const text = await (await pdf.getPage(page)).getTextContent();
        const items = text.items
          .filter(
            (i): i is typeof i & { str: string; transform: number[] } =>
              "str" in i,
          )
          .map((i) => ({ text: i.str, x: i.transform[4], y: i.transform[5] }));
        if (
          directoryStarted &&
          /\bAnexo\s+[CDVQ]\b/.test(items.map((i) => i.text).join(" "))
        )
          break;
        const directory = pdfDirectoryRows(items, page);
        if (directory.length) {
          professionals.push(...directory);
          directoryStarted = true;
        } else {
          const rows = pdfAgendaRows(items);
          if (rows.length) tables.push(rows);
        }
      }
    } finally {
      await task.destroy();
    }
  } else if (/\.(php|html?)$/i.test(file.name)) {
    const head = new TextDecoder().decode(data.slice(0, 1500));
    const html = new TextDecoder(
      /windows-1252|iso-8859-1/i.test(head) ? "windows-1252" : "utf-8",
    ).decode(data);
    if (/<\?(?:php|=)/i.test(html))
      throw new Error(
        "Este PHP contiene código de servidor. Guarda la página de SISMAULE como HTML o exporta a Excel/PDF; la app no ejecuta PHP.",
      );
    tables = readHtmlTables(html);
  } else
    throw new Error(
      "Selecciona Excel .xlsx, PDF de texto o una página exportada .php/.html.",
    );
  const rules: AgendaRule[] = [],
    errors: string[] = [],
    warnings: string[] = [];
  for (const table of tables) {
    try {
      const parsed = parseAgendaRows(table, file.name);
      rules.push(...parsed.rules);
      errors.push(...parsed.errors);
      warnings.push(...parsed.warnings);
    } catch (e) {
      if (tables.length === 1) errors.push((e as Error).message);
    }
  }
  if (!rules.length && !professionals.length && !errors.length)
    errors.push(
      "No se reconoció una tabla. Usa un PDF de texto con los 14 encabezados SISMAULE o exporta a Excel. Los PDF escaneados necesitan OCR previo.",
    );
  if (
    professionals.length &&
    new Set(professionals.map((p) => p.establishment + "|" + p.resource_code))
      .size !== professionals.length
  )
    errors.push(
      "Códigos de profesionales repetidos: revisa que el PDF no contenga anexos duplicados.",
    );
  return { name: file.name, sha256, rules, professionals, errors, warnings };
}
