import { parse, type DefaultTreeAdapterMap } from "parse5";
export const patientHeaders = [
  "RUT",
  "Nombre",
  "Comuna",
  "Fono",
  "Dirección",
  "Agenda",
  "Citación",
  "Atención",
  "Ficha",
  "Intercons.",
  "Usuario Dac.",
  "Nombre Usuario",
  "Observación",
];
type Item = { text: string; x: number; y: number };
const normalized = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
// Pure spatial reconstruction: no inferred or corrected clinical/identity information.
export function reconstructPage(items: Item[]): string[][] {
  const lines: Item[][] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    let line = lines.find((l) => Math.abs(l[0].y - item.y) < 2.5);
    if (!line) {
      line = [];
      lines.push(line);
    }
    line.push(item);
  }
  lines.forEach((l) => l.sort((a, b) => a.x - b.x));
  const header = lines.find(
    (l) =>
      l.some((i) => normalized(i.text) === "rut") &&
      l.some((i) => normalized(i.text) === "nombre"),
  );
  if (!header) return [];
  const anchors = patientHeaders.map(
    (h) => header.find((i) => normalized(i.text) === normalized(h))?.x,
  );
  if (anchors.some((x) => x === undefined)) return [];
  const xs = anchors as number[];
  if (xs.some((x, i) => i > 0 && x <= xs[i - 1])) return [];
  const rows: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines.filter((l) => l[0].y < header[0].y - 3)) {
    const rut = line.find((i) =>
      /^\s*\d{1,2}\.?\d{3}\.?\d{3}-[0-9kK]\s*$/.test(i.text),
    );
    if (rut) {
      current = Array(13).fill("");
      rows.push(current);
    }
    if (!current) continue;
    // Stop at footer rather than appending it to the last patient's observation.
    if (line.some((i) => /^p[aá]gina\s+\d/i.test(i.text))) {
      current = null;
      continue;
    }
    for (const item of line) {
      let col = 0;
      for (let i = 1; i < xs.length; i++) if (item.x >= xs[i] - 4) col = i;
      current[col] += (current[col] ? " " : "") + item.text.trim();
    }
  }
  // Ambiguous extraction is not presented as a reliable patient table.
  return rows.every(
    (r) =>
      /^\d{1,2}\.?\d{3}\.?\d{3}-[0-9kK]$/.test(r[0]) &&
      r[1] &&
      /\d{2}\/\d{2}\/\d{4}/.test(r[6]),
  )
    ? rows
    : [];
}
export function parsePatientHtml(html: string): string[][] {
  const tree = parse(html);
  const rows: string[][] = [];
  type N = DefaultTreeAdapterMap["node"];
  const text = (n: N): string =>
    "value" in n
      ? n.value
      : "childNodes" in n
        ? n.childNodes.map(text).join(" ")
        : "";
  const visit = (n: N) => {
    if ("tagName" in n && n.tagName === "tr") {
      const cells = n.childNodes
        .filter(
          (c): c is DefaultTreeAdapterMap["element"] =>
            "tagName" in c && ["td", "th"].includes(c.tagName),
        )
        .map((c) => text(c).replace(/\s+/g, " ").trim());
      if (
        cells.length === 13 &&
        /^\d{1,2}\.?\d{3}\.?\d{3}-[0-9kK]$/.test(cells[0])
      )
        rows.push(cells);
    }
    if ("childNodes" in n) n.childNodes.forEach(visit);
  };
  visit(tree);
  return rows;
}
