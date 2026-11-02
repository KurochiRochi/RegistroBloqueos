import { useState } from "react";
import type { Profile, RecordRow, Calendar } from "./model.ts";
import {
  chileToday,
  groupedCounts,
  status,
  uniqueAbsenceDays,
  filterExportRows,
  establishments,
  types as blockTypes,
} from "./model.ts";
import type { EstablishmentReportRow } from "./reports.ts";
import type { AgendaCatalog } from "./agenda-model.ts";
import { useLanguage } from "./language.ts";
export function Icon({ name, size = 23 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7v10H3z" />
        <path d="M9 20v-7h6v7" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v5m10-5v5M3 11h18m-13 4h1m5 0h1m-7 3h1m5 0h1" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="7" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m1 5a5 5 0 0 1 3 5" />
      </>
    ),
    report: (
      <>
        <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 17v-4m3 4v-6m3 6v-3" />
      </>
    ),
    building: (
      <>
        <path d="M4 21h16M6 21V6h12v15M9 6V3h6v3M9 10h1m4 0h1m-6 4h1m4 0h1m-5 7v-3h4v3" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9a3 3 0 1 1 4 3l-1 1v1m0 3h.01" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="m15 15 6 6" />
      </>
    ),
    alert: (
      <>
        <path d="m12 3 10 18H2zM12 8v5m0 3h.01" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.calendar}
    </svg>
  );
}
export function Home({
  rows,
  profile,
  navigate,
  openBlock,
}: {
  rows: RecordRow[];
  catalog: AgendaCatalog;
  profile: Profile | null;
  navigate: (v: string) => void;
  openBlock: (r: RecordRow) => void;
}) {
  const { t, lang } = useLanguage();
  const today = chileToday();
  const [est, setEst] = useState("");
  const [day, setDay] = useState(today);
  const stamp = (r: RecordRow) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date(r.created_at));
  const scoped = rows.filter((r) => !est || r.Establecimiento === est);
  const createdOn = scoped.filter((r) => stamp(r) === day);
  const activeOn = scoped.filter(
    (r) => String(r.Fecha_Inicio) <= day && String(r.Fecha_Termino) >= day,
  );
  const counts = establishments.map((name) => ({
    name,
    count: rows.filter((r) => r.Establecimiento === name).length,
  }));
  const dayLabel = day === today ? t("hoy", "today") : day.split("-").reverse().join("/");
  const cards = [
    {
      icon: "calendar",
      value: scoped.length,
      label: est
        ? t("Bloqueos en ", "Blocks in ") + est
        : t("Bloqueos registrados", "Registered blocks"),
      hint: t("Total histórico", "All-time total"),
    },
    {
      icon: "report",
      value: createdOn.length,
      label: t("Registrados ", "Registered ") + dayLabel,
      hint: t("Ingresados en la plataforma ese día", "Entered that day"),
    },
    {
      icon: "alert",
      value: activeOn.length,
      label: t("Bloqueos vigentes ", "Active blocks ") + dayLabel,
      hint: t("Profesionales bloqueados ese día", "Professionals blocked that day"),
    },
    {
      icon: "people",
      value: new Set(activeOn.map((r) => String(r.Profesional).toLowerCase())).size,
      label: t("Profesionales afectados ", "Affected professionals ") + dayLabel,
      hint: est || t("Todos los establecimientos", "All establishments"),
    },
  ];
  const list = (activeOn.length ? activeOn : scoped).slice(0, 8);
  return (
    <>
      <div className="i-greeting">
        <div>
          <h1>
            {t("Hola", "Hello")},{" "}
            {profile?.display_name?.split(" ")[0] || t("bienvenida", "welcome")}
          </h1>
          <p>
            {t(
              "Gestiona los bloqueos y consulta las agendas de la red comunal.",
              "Manage blocks and view agendas across the community network.",
            )}
          </p>
        </div>
        <span>
          {new Date(today + "T12:00:00Z").toLocaleDateString(lang === "en" ? "en-GB" : "es-CL", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </span>
      </div>
      <div className="a-filters i-home-filters">
        <label>
          {t("Establecimiento", "Establishment")}
          <select value={est} onChange={(e) => setEst(e.target.value)}>
            <option value="">{t("Todos los establecimientos", "All establishments")}</option>
            {establishments.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Día", "Day")}
          <input type="date" value={day} onChange={(e) => setDay(e.target.value || today)} />
        </label>
      </div>
      <section className="i-cards">
        {cards.map((c) => (
          <article key={c.icon}>
            <Icon name={c.icon} size={34} />
            <strong>{c.value}</strong>
            <h2>{c.label}</h2>
            <p>{c.hint}</p>
          </article>
        ))}
      </section>
      <section className="v-charts">
        <article className="v-panel v-pad">
          <h2>{t("Cantidad de bloqueos por establecimiento", "Blocks by establishment")}</h2>
          <div className="i-count-bars">
            {counts.map((d) => (
              <div
                key={d.name}
                className={"i-bar-click" + (est === d.name ? " selected" : "")}
                role="button"
                tabIndex={0}
                onClick={() => setEst(est === d.name ? "" : d.name)}
                onKeyDown={(e) => e.key === "Enter" && setEst(est === d.name ? "" : d.name)}
              >
                <span>{d.name}</span>
                <i>
                  <b style={{ width: `${(d.count / Math.max(1, ...counts.map((c) => c.count))) * 100}%` }} />
                </i>
                <strong>{d.count}</strong>
              </div>
            ))}
          </div>
          <p className="v-muted">{t("Haz clic en un establecimiento para filtrar.", "Click an establishment to filter.")}</p>
        </article>
        <article className="v-panel">
          <div className="i-section-heading">
            <h2>
              {activeOn.length
                ? t("Bloqueos vigentes ", "Active blocks ") + dayLabel
                : t("Bloqueos recientes", "Recent blocks")}
              {est ? ` · ${est}` : ""}
            </h2>
            <button className="v-link" onClick={() => navigate("Bloqueos")}>
              {t("Ver todos", "View all")}
            </button>
          </div>
          <div className="v-scroll">
            <table className="v-table">
              <thead>
                <tr>
                  {[t("Período", "Period"), t("Profesional", "Professional"), t("Establecimiento", "Establishment"), t("Tipo", "Type"), t("Estado", "Status")].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {String(r.Fecha_Inicio).split("-").reverse().join("/")}
                      <small>{String(r.Fecha_Termino).split("-").reverse().join("/")}</small>
                    </td>
                    <td>
                      <button className="v-link" onClick={() => openBlock(r)}>
                        {r.Profesional}
                      </button>
                      <small>{r.Profesion}</small>
                    </td>
                    <td>{r.Establecimiento}</td>
                    <td>
                      {r.Tipo_Bloqueo}
                      {r.Es_MPO && <span className="v-badge-mpo">MPO</span>}
                    </td>
                    <td>
                      <span className={"i-state " + (status(r) === "Vigente" ? "active" : "planned")}>{status(r)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!list.length && (
            <p className="v-empty">{t("Aún no hay bloqueos registrados.", "No blocks have been registered yet.")}</p>
          )}
        </article>
      </section>
      <section className="i-next">
        <div>
          <Icon name="calendar" size={30} />
          <h2>{t("Agendas por establecimiento", "Agendas by establishment")}</h2>
          <p>
            {t(
              "Consulta las agendas y sus bloqueos en el calendario compartido.",
              "View agendas and their blocks in the shared calendar.",
            )}
          </p>
        </div>
        <button className="v-btn primary" onClick={() => navigate("Agendas por establecimiento")}>
          {t("Abrir calendario", "Open calendar")} →
        </button>
      </section>
    </>
  );
}
export function ReportsHub({
  rows,
  cal,
  connected,
  catalog,
  sys = [],
}: {
  rows: RecordRow[];
  cal: Calendar;
  connected: boolean;
  catalog?: AgendaCatalog;
  sys?: { codigo: string }[];
}) {
  const { t } = useLanguage();
  const year = chileToday().slice(0, 4);
  const [tab, setTab] = useState<"est" | "cupos" | "calidad">("est"),
    [from, setFrom] = useState(`${year}-01-01`),
    [until, setUntil] = useState(`${year}-12-31`),
    [est, setEst] = useState(""),
    [prof, setProf] = useState(""),
    [type, setType] = useState(""),
    [open, setOpen] = useState<string>(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const agendaNames = new Map<string, string>();
  for (const r of catalog?.rules || []) agendaNames.set(r.establishment + "|" + r.agenda_code, r.agenda_name);
  let base: RecordRow[] = [];
  try {
    base = filterExportRows(rows, from, until);
  } catch {}
  const list = base.filter(
    (r) =>
      (!est || r.Establecimiento === est) &&
      (!prof || r.Profesion === prof) &&
      (!type || (type === "OTRO" ? !blockTypes.includes(String(r.Tipo_Bloqueo)) : r.Tipo_Bloqueo === type)),
  );
  const inRange = (r: RecordRow) => {
    try {
      return uniqueAbsenceDays([r], cal, from, until);
    } catch {
      return 0;
    }
  };
  const agendaLabel = (r: RecordRow) =>
    (r.Agendas?.length ? r.Agendas : [String(r.Agenda || "")])
      .map((a) => {
        const n = agendaNames.get(r.Establecimiento + "|" + a);
        return n && n !== a ? `${a} (${n})` : a;
      })
      .join(" · ");
  const toRow = (r: RecordRow): EstablishmentReportRow => ({
    est: String(r.Establecimiento),
    code: String(r.Codigo_Bloqueo),
    professional: String(r.Profesional),
    profession: r.Profesion || "",
    agendas: agendaLabel(r),
    type: String(r.Tipo_Bloqueo),
    mpo: r.Es_MPO ? "Sí" + (r.MPO_Nombre ? " · " + r.MPO_Nombre : "") : "No",
    from: String(r.Fecha_Inicio),
    until: String(r.Fecha_Termino),
    schedule: `${r.Tipo_Horario}${r.Media_Jornada ? " " + r.Media_Jornada : ""}${r.Hora_Inicio ? ` ${r.Hora_Inicio}–${r.Hora_Termino}` : ""}`,
    days: Number(r.Dias_Bloqueo) || 0,
    daysInRange: inRange(r),
    patients: r.Pacientes_Citados ? "Sí" : "No",
    notes: String(r.Observacion || ""),
  });
  const groups = establishments
    .map((name) => {
      const rs = list.filter((r) => r.Establecimiento === name);
      let uniqueDays: number | string = "—";
      try {
        uniqueDays = uniqueAbsenceDays(rs, cal, from, until);
      } catch {}
      return {
        est: name,
        rows: rs.map(toRow).sort((a, b) => a.professional.localeCompare(b.professional) || a.from.localeCompare(b.from)),
        professionals: groupedCounts(rs, "Profesional").length,
        uniqueDays,
        byType: [...rs.reduce((m, r) => m.set(String(r.Tipo_Bloqueo), (m.get(String(r.Tipo_Bloqueo)) || 0) + 1), new Map<string, number>())],
      };
    })
    .filter((g) => g.rows.length);
  const professions = [...new Set(rows.map((r) => r.Profesion || "").filter(Boolean))].sort();
  let totalDays: number | string = "—";
  try {
    totalDays = uniqueAbsenceDays(list, cal, from, until);
  } catch {}
  const pending = sys.filter((b) => !b.codigo).length;
  async function exportFile(pdf: boolean) {
    setBusy(true);
    setError("");
    try {
      if (pdf) {
        const { establishmentPdf } = await import("./reports.ts");
        establishmentPdf(groups, from, until).save(`reporte-bloqueos-establecimiento-${from}-${until}.pdf`);
      } else {
        const header = ["Establecimiento", "Código", "Profesional", "Profesión", "Agendas afectadas", "Tipo de bloqueo", "MPO", "Fecha inicio", "Fecha término", "Horario", "Días bloqueo", "Días en el rango", "Pacientes citados", "Observación"];
        const detail = groups.flatMap((g) => g.rows.map((r) => [r.est, r.code, r.professional, r.profession, r.agendas, r.type, r.mpo, r.from, r.until, r.schedule, r.days, r.daysInRange, r.patients, r.notes]));
        const summary = groups.map((g) => [g.est, g.rows.length, g.professionals, typeof g.uniqueDays === "number" ? g.uniqueDays : 0, g.rows.filter((r) => r.mpo !== "No").length, g.rows.filter((r) => r.patients === "Sí").length]);
        const byProf = new Map<string, { est: string; name: string; prof: string; n: number; days: number; agendas: Set<string> }>();
        for (const g of groups)
          for (const r of g.rows) {
            const k = g.est + "|" + r.professional.toLowerCase();
            const cur = byProf.get(k) || { est: g.est, name: r.professional, prof: r.profession, n: 0, days: 0, agendas: new Set<string>() };
            cur.n++;
            cur.days += r.daysInRange;
            r.agendas.split(" · ").forEach((a) => a && cur.agendas.add(a));
            byProf.set(k, cur);
          }
        const profRows = [...byProf.values()].map((v) => [v.est, v.name, v.prof, v.n, v.days, [...v.agendas].join(" | ")] as (string | number)[]);
        const typeRows = groups.flatMap((g) => g.byType.map(([tp, n]) => [g.est, tp, n] as (string | number)[]));
        const { buildSheetsXlsx } = await import("./xlsx.ts");
        const data = buildSheetsXlsx([
          { name: "Resumen", header: ["Establecimiento", "Bloqueos", "Profesionales", "Días únicos en rango", "MPO", "Con pacientes citados"], rows: summary },
          { name: "Detalle", header, rows: detail },
          { name: "Por profesional", header: ["Establecimiento", "Profesional", "Profesión", "Bloqueos", "Días en rango", "Agendas afectadas"], rows: profRows },
          { name: "Por tipo", header: ["Establecimiento", "Tipo de bloqueo", "Bloqueos"], rows: typeRows },
        ]);
        const url = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `reporte-bloqueos-establecimiento-${from}-${until}.xlsx`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="i-report-tabs">
        {(
          [
            ["est", t("a. Bloqueos por establecimiento", "a. Blocks by establishment")],
            ["cupos", t("b. Cupos disponibles", "b. Available slots")],
            ["calidad", t("c. Informe de calidad", "c. Quality report")],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? "selected" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab !== "est" ? (
        <section className="v-panel v-pad i-soon">
          <h2>{tab === "cupos" ? t("Reporte de cupos disponibles", "Available slots report") : t("Informe de calidad", "Quality report")}</h2>
          <p className="v-notice">
            {tab === "cupos"
              ? t(
                  "En desarrollo. Este reporte se generará desde una nueva sección del menú dedicada a cupos, que extraerá la información de agendas y bloqueos para calcular la disponibilidad.",
                  "In development. It will be generated from a dedicated slots section.",
                )
              : t(
                  "En desarrollo. Se habilitará en una próxima versión con los indicadores de calidad que se definan.",
                  "In development. Will be enabled in a future version.",
                )}
          </p>
        </section>
      ) : (
        <>
          <div className="a-filters">
            <label>
              {t("Desde", "From")}
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              {t("Hasta", "To")}
              <input type="date" min={from} value={until} onChange={(e) => setUntil(e.target.value)} />
            </label>
            <select aria-label={t("Establecimiento", "Establishment")} value={est} onChange={(e) => setEst(e.target.value)}>
              <option value="">{t("Todos los establecimientos", "All establishments")}</option>
              {establishments.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select aria-label={t("Profesión", "Profession")} value={prof} onChange={(e) => setProf(e.target.value)}>
              <option value="">{t("Todas las profesiones", "All professions")}</option>
              {professions.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select aria-label={t("Tipo", "Type")} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">{t("Todos los tipos", "All types")}</option>
              {blockTypes.map((s) => (
                <option key={s}>{s}</option>
              ))}
              <option value="OTRO">OTRO</option>
            </select>
            <button disabled={!connected || busy || !groups.length} className="v-btn primary" onClick={() => void exportFile(false)}>
              ↓ Excel
            </button>
            <button disabled={!connected || busy || !groups.length} className="v-btn primary" onClick={() => void exportFile(true)}>
              ↓ PDF
            </button>
          </div>
          <section className="i-report-cards">
            {[
              [t("Total de bloqueos", "Total blocks"), list.length],
              [t("Profesionales afectados", "Affected professionals"), groupedCounts(list, "Profesional").length],
              [t("Días únicos de inasistencia", "Unique absence days"), totalDays],
              [t("Bloqueos MPO", "MPO blocks"), list.filter((r) => r.Es_MPO).length],
            ].map(([label, value]) => (
              <article key={String(label)}>
                <h2>{label}</h2>
                <strong>{value}</strong>
              </article>
            ))}
          </section>
          {pending > 0 && (
            <p className="a-pending">
              ⚠ {pending} {t("bloqueos cargados desde archivo sin código no se incluyen hasta completarlos.", "uploaded blocks without code are excluded until completed.")}
            </p>
          )}
          {!groups.length && <p className="v-empty">{t("Sin datos para este rango.", "No data for this range.")}</p>}
          {groups.map((g) => (
            <section className="v-panel v-pad i-est-report" key={g.est}>
              <button className="i-est-head" aria-expanded={open === g.est} onClick={() => setOpen(open === g.est ? "" : g.est)}>
                <strong>{g.est}</strong>
                <span>
                  {g.rows.length} {t("bloqueos", "blocks")} · {g.professionals} {t("profesionales", "professionals")} · {g.uniqueDays} {t("días únicos", "unique days")} · {g.rows.filter((r) => r.mpo !== "No").length} MPO
                </span>
                <span aria-hidden>{open === g.est ? "▲" : "▼"}</span>
              </button>
              <p className="i-type-line">
                {g.byType.map(([tp, n]) => (
                  <span key={tp} className="v-chip">
                    {tp}: {n}
                  </span>
                ))}
              </p>
              {open === g.est && (
                <div className="v-scroll">
                  <table className="v-table">
                    <thead>
                      <tr>
                        {[t("Profesional", "Professional"), t("Agendas afectadas", "Affected agendas"), t("Tipo", "Type"), "MPO", t("Período", "Period"), t("Horario", "Schedule"), t("Días", "Days"), t("Días en rango", "Days in range"), t("Citados", "Patients")].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.code}>
                          <td>
                            {r.professional}
                            <small>{r.profession} · {r.code}</small>
                          </td>
                          <td>{r.agendas}</td>
                          <td>{r.type}</td>
                          <td>{r.mpo}</td>
                          <td>
                            {r.from.split("-").reverse().join("/")}
                            <small>{r.until.split("-").reverse().join("/")}</small>
                          </td>
                          <td>{r.schedule}</td>
                          <td>{r.days}</td>
                          <td>{r.daysInRange}</td>
                          <td>{r.patients}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
          {error && <p className="v-error">{error}</p>}
          <p className="a-calendar-note">
            {t(
              "Incluye los bloqueos que intersectan el rango. “Días en rango” cuenta lunes a sábado sin domingos ni feriados. Los informes no contienen identificadores de pacientes.",
              "Includes blocks overlapping the range. No patient identifiers are included.",
            )}
          </p>
        </>
      )}
    </>
  );
}
function CountBars({ data }: { data: { name: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="i-count-bars">
      {data.map((d) => (
        <div key={d.name}>
          <span>{d.name}</span>
          <i>
            <b style={{ width: `${(d.count / max) * 100}%` }} />
          </i>
          <strong>{d.count}</strong>
        </div>
      ))}
    </div>
  );
}
