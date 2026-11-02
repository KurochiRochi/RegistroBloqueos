import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  agendaText,
  groupedCounts,
  uniqueAbsenceDays,
  type RecordRow,
  type Calendar,
} from "./model.ts";
export function reportPdf(
  rows: RecordRow[],
  from: string,
  until: string,
  cal: Calendar,
  lang = "es",
) {
  const doc = new jsPDF({ orientation: "landscape", format: "a4" });
  const en = lang === "en";
  doc.setFontSize(20);
  doc.text(
    en
      ? "Blocking registry - full report"
      : "Registro de bloqueos - informe completo",
    14,
    18,
  );
  doc.setFontSize(10);
  doc.text(
    `${from} / ${until}  | ${rows.length} ${en ? "blocks" : "bloqueos"} | ${en ? "Generated" : "Generado"}: ${new Date().toLocaleString(en ? "en-GB" : "es-CL")}`,
    14,
    26,
  );
  let days = "";
  try {
    days = String(uniqueAbsenceDays(rows, cal, from, until));
  } catch {
    days = en ? "Calendar pending review" : "Calendario pendiente de revisión";
  }
  doc.text(
    `${en ? "Unique absence days in range" : "Días únicos de inasistencia dentro del rango"}: ${days}`,
    14,
    33,
  );
  const totals = (field: "Profesional" | "Establecimiento") =>
    groupedCounts(rows, field).map((g) => [g.name, g.count]);
  autoTable(doc, {
    startY: 40,
    head: [
      [en ? "Establishment" : "Establecimiento", en ? "Blocks" : "Bloqueos"],
    ],
    body: totals("Establecimiento"),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [39, 104, 82] },
    margin: { left: 14, right: 154 },
  });
  autoTable(doc, {
    startY: 40,
    head: [[en ? "Professional" : "Profesional", en ? "Blocks" : "Bloqueos"]],
    body: totals("Profesional"),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [39, 104, 82] },
    margin: { left: 154, right: 14 },
  });
  // Detail begins on a fresh page so summaries can grow without colliding.
  doc.addPage();
  autoTable(doc, {
    head: [
      [
        en ? "Code" : "Código",
        en ? "Establishment / sector" : "Establecimiento / sector",
        en ? "Professional / profession" : "Profesional / profesión",
        en ? "Agendas" : "Agendas",
        en ? "Block type" : "Tipo de bloqueo",
        en ? "Period" : "Período",
        en ? "Schedule" : "Horario",
        en ? "Days" : "Días",
        en ? "Patients" : "Citados",
        en ? "Notes" : "Observación",
      ],
    ],
    body: rows.map((r) =>
      [
        r.Codigo_Bloqueo,
        `${r.Establecimiento}\n${r.Sector || ""}`,
        `${r.Profesional}\n${r.Profesion || ""}`,
        agendaText(r),
        r.Tipo_Bloqueo,
        `${r.Fecha_Inicio}\n${r.Fecha_Termino}`,
        `${r.Tipo_Horario} ${r.Media_Jornada || ""}\n${r.Hora_Inicio || ""} ${r.Hora_Termino || ""}`,
        r.Dias_Bloqueo,
        r.Pacientes_Citados ? (en ? "Yes" : "Sí") : "No",
        r.Observacion,
      ].map(String),
    ),
    styles: { fontSize: 7, overflow: "linebreak", cellPadding: 2 },
    headStyles: { fillColor: [39, 104, 82] },
    margin: { top: 16, bottom: 18 },
  });
  const count = doc.getNumberOfPages();
  for (let i = 1; i <= count; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(
      `${en ? "Page" : "Página"} ${i}/${count} · ${en ? "The report includes overlapping blocks with their original full periods. No patient identifiers are included." : "Incluye bloqueos que intersectan el rango y conserva sus períodos completos. No incluye identificadores de pacientes."}`,
      14,
      202,
    );
  }
  return doc;
}

// ---- 1.5: reporte de bloqueos por establecimiento ----
export type EstablishmentReportRow = {
  est: string;
  code: string;
  professional: string;
  profession: string;
  agendas: string;
  type: string;
  mpo: string;
  from: string;
  until: string;
  schedule: string;
  days: number;
  daysInRange: number;
  patients: string;
  notes: string;
};
export function establishmentPdf(
  groups: { est: string; rows: EstablishmentReportRow[]; professionals: number; uniqueDays: number | string }[],
  from: string,
  until: string,
) {
  const doc = new jsPDF({ orientation: "landscape", format: "a4" });
  const dmy = (v: string) => v.split("-").reverse().join("/");
  doc.setFontSize(18);
  doc.text("Reporte de bloqueos por establecimiento", 14, 18);
  doc.setFontSize(10);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  doc.text(
    `Período ${dmy(from)} – ${dmy(until)} · ${total} bloqueos · Generado: ${new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })}`,
    14,
    26,
  );
  autoTable(doc, {
    startY: 32,
    head: [["Establecimiento", "Bloqueos", "Profesionales", "Días únicos en el rango", "MPO", "Con pacientes citados"]],
    body: groups.map((g) => [
      g.est,
      g.rows.length,
      g.professionals,
      g.uniqueDays,
      g.rows.filter((r) => r.mpo !== "No").length,
      g.rows.filter((r) => r.patients === "Sí").length,
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [33, 86, 179] },
  });
  for (const g of groups) {
    doc.addPage();
    doc.setFontSize(14);
    doc.text(`${g.est} · ${g.rows.length} bloqueos · ${g.professionals} profesionales`, 14, 16);
    autoTable(doc, {
      startY: 22,
      head: [["Código", "Profesional / profesión", "Agendas afectadas", "Tipo", "MPO", "Período", "Horario", "Días", "Días en rango", "Citados"]],
      body: g.rows.map((r) => [
        r.code,
        `${r.professional}\n${r.profession}`,
        r.agendas,
        r.type,
        r.mpo,
        `${dmy(r.from)}\n${dmy(r.until)}`,
        r.schedule,
        r.days,
        r.daysInRange,
        r.patients,
      ].map(String)),
      styles: { fontSize: 7.5, overflow: "linebreak", cellPadding: 2 },
      headStyles: { fillColor: [33, 86, 179] },
      margin: { top: 16, bottom: 18 },
    });
  }
  const count = doc.getNumberOfPages();
  for (let i = 1; i <= count; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(
      `Página ${i}/${count} · Registro de bloqueos 1.5 · Días: lunes a sábado sin domingos ni feriados. Sin identificadores de pacientes.`,
      14,
      202,
    );
  }
  return doc;
}
