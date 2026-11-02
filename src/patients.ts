import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  patientHeaders,
  reconstructPage,
  parsePatientHtml,
} from "./patient-parser.ts";
export { patientHeaders } from "./patient-parser.ts";

export type PatientDocument = {
  id: string;
  bloqueo_id: string;
  object_path: string;
  original_name: string;
  byte_size: number;
  sha256: string;
  appointment_day: string;
  extraction_status: "table" | "original";
  headers: string[];
  patients: string[][];
  created_at?: string;
  file_type: "pdf" | "html";
};
export type PendingDocument = Omit<
  PatientDocument,
  "bloqueo_id" | "object_path"
> & { file: File };
export async function readPatientPdf(
  file: File,
  day: string,
): Promise<PendingDocument> {
  if (file.size > 20 * 1024 * 1024 || file.size === 0)
    throw new Error("Cada PDF debe pesar entre 1 byte y 20 MB.");
  const data = new Uint8Array(await file.arrayBuffer());
  const isPdf = new TextDecoder().decode(data.slice(0, 5)) === "%PDF-";
  const isHtml = /\.html?$/i.test(file.name);
  if (!isPdf && !isHtml)
    throw new Error("Selecciona archivos PDF o HTML válidos.");
  const sha256 = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  let patients: string[][] = [];
  if (isHtml && !isPdf) {
    const head = new TextDecoder().decode(data.slice(0, 1024));
    patients = parsePatientHtml(
      new TextDecoder(
        /windows-1252|iso-8859-1/i.test(head) ? "windows-1252" : "utf-8",
      ).decode(data),
    );
  } else {
    const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
    GlobalWorkerOptions.workerSrc = workerUrl;
    const task = getDocument({ data: data.slice(), useSystemFonts: true });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 150) throw new Error("El PDF supera las 150 páginas.");
      let ambiguous = false;
      for (let p = 1; p <= pdf.numPages; p++) {
        const text = await (await pdf.getPage(p)).getTextContent();
        const items = text.items
          .filter(
            (i): i is typeof i & { str: string; transform: number[] } =>
              "str" in i,
          )
          .map((i) => ({ text: i.str, x: i.transform[4], y: i.transform[5] }));
        const rows = reconstructPage(items);
        if (!rows.length) ambiguous = true;
        patients.push(...rows);
      }
      if (ambiguous) patients = [];
    } finally {
      await task.destroy();
    }
  }
  return {
    id: crypto.randomUUID(),
    original_name: file.name.slice(0, 250),
    file,
    byte_size: file.size,
    sha256,
    appointment_day: day,
    extraction_status: patients.length ? "table" : "original",
    headers: patientHeaders,
    patients,
    file_type: isPdf ? "pdf" : "html",
  };
}
