// Ingreso manual de agendas con la misma secuencia de SISMAULE:
// 1) filtro por fechas y recurso → 2) agendas creadas → 3) ingreso de agenda →
// 4) detalle semanal (día, hora, intervalo, cupos, box, traslape) → 5) distribución de cupos.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "./api.ts";
import { establishments } from "./agenda-import.ts";
import type {
  AgendaCatalog,
  CatalogProfessional,
  ManualAgenda,
  ManualDetail,
  ManualQuota,
} from "./agenda-model.ts";
import { chileToday, professionalKey as key } from "./model.ts";
import { useLanguage } from "./language.ts";

const DAYS: [number, string][] = [
  [1, "LUNES"],
  [2, "MARTES"],
  [3, "MIERCOLES"],
  [4, "JUEVES"],
  [5, "VIERNES"],
  [6, "SABADO"],
  [0, "DOMINGO"],
];
const dayName = (n: number) => DAYS.find((d) => d[0] === n)?.[1] || "";
const FUNDING = [
  "PRODUCCIÓN - PRESTACIÓN INSTITUCIONAL",
  "COMPRA DE SERVICIOS",
  "CONVENIO",
  "PROGRAMA ESPECIAL",
];
// Solo se muestran códigos de establecimiento confirmados en SISMAULE.
const EST_CODE: Record<string, string> = { "Arrau Méndez": "607" };
const dmy = (d?: string | null) => (d ? d.split("-").reverse().join("/") : "");
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const yearEnd = () => chileToday().slice(0, 4) + "-12-31";

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="sis-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sis-dialog">
        <h3 className="sis-title">{title}</h3>
        {children}
      </div>
    </div>
  );
}

type HeaderForm = {
  agenda_code: string;
  agenda_name: string;
  starts_on: string;
  ends_on: string;
  staggered: boolean;
  requires_record: boolean;
  funding: string;
  agenda_type: "Consulta" | "Procedimiento";
  multi_hour: boolean;
};
type DetailForm = { weekday: number | ""; hh: string; mm: string; interval: string; capacity: string; box: string };
type QuotaForm = { establishment: string; attention: "" | "CONTROL" | "NUEVO"; capacity: string };

export function SisAgendaEntry({
  catalog,
  refresh,
  preview = false,
}: {
  catalog: AgendaCatalog;
  refresh: () => Promise<void>;
  preview?: boolean;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  // Paso 1: filtro.
  const [from, setFrom] = useState(chileToday().slice(0, 4) + "-01-01"),
    [until, setUntil] = useState(yearEnd()),
    [code, setCode] = useState(""),
    [person, setPerson] = useState(""),
    [unit, setUnit] = useState(""),
    [filter, setFilter] = useState<"TODAS" | "VIGENTES" | "CERRADAS" | "NO GENERADAS">("TODAS"),
    [step, setStep] = useState<1 | 2>(1);
  // Paso 2 en adelante.
  const [selected, setSelected] = useState(""),
    [detailId, setDetailId] = useState(""),
    [headerDlg, setHeaderDlg] = useState<{ id?: string; form: HeaderForm } | null>(null),
    [detailDlg, setDetailDlg] = useState<{ id?: string; form: DetailForm } | null>(null),
    [quotaDlg, setQuotaDlg] = useState<{ id?: string; form: QuotaForm } | null>(null),
    [action, setAction] = useState<null | { kind: "close" | "copy" | "delete" | "delete-detail" | "delete-quota"; id: string; a?: string; b?: string }>(null),
    [overlap, setOverlap] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");

  useEffect(() => {
    setError("");
  }, [!!headerDlg, !!detailDlg, !!quotaDlg]);
  const people = useMemo(
    () => [...catalog.professionals].sort((a, b) => a.name.localeCompare(b.name)),
    [catalog.professionals],
  );
  const resource: CatalogProfessional | undefined =
    people.find((p) => key(p.name) === key(person)) ||
    (code.trim() ? people.find((p) => p.resource_code === code.trim()) : undefined);
  const manual = catalog.manual || [];
  const rows = manual
    .filter(
      (m) =>
        resource &&
        m.professional_id === resource.id &&
        (!unit || m.establishment === unit) &&
        m.starts_on <= until &&
        m.ends_on >= from &&
        (filter === "TODAS" ||
          (filter === "VIGENTES" && !m.closed_on && m.ends_on >= chileToday()) ||
          (filter === "CERRADAS" && !!m.closed_on) ||
          (filter === "NO GENERADAS" && !m.generated)),
    )
    .sort((a, b) => b.corr - a.corr);
  const agenda = manual.find((m) => m.id === selected);
  const detail = agenda?.details.find((d) => d.id === detailId);
  const agendaNames = catalog.agenda_names || [];

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (preview) throw new Error(t("Vista de diseño: no guarda.", "Design preview: not saved."));
      await fn();
      await refresh();
      setNotice(ok);
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function traslape(f: DetailForm, ignore?: string) {
    if (!agenda || f.weekday === "" || !f.hh) return t("Completa día y hora.", "Fill day and time.");
    const a = Number(f.hh) * 60 + Number(f.mm || 0);
    const z = a + Number(f.interval || 0) * Math.max(1, Number(f.capacity || 1));
    const clash: string[] = [];
    for (const m of manual)
      if (m.professional_id === agenda.professional_id && m.starts_on <= agenda.ends_on && m.ends_on >= agenda.starts_on)
        for (const d of m.details) {
          if (d.id === ignore || d.weekday !== f.weekday) continue;
          const b = toMin(d.starts_at),
            y = b + d.interval_minutes * Math.max(1, d.capacity);
          if (a < y && b < z) clash.push(`Corr. ${m.corr} ${m.agenda_name} · ${dayName(d.weekday)} ${d.starts_at.slice(0, 5)}`);
        }
    for (const r of catalog.rules || [])
      if (
        !String(r.id || "").startsWith("manual:") &&
        r.professional_id === agenda.professional_id &&
        r.weekday === f.weekday &&
        r.starts_on <= agenda.ends_on &&
        r.ends_on >= agenda.starts_on
      ) {
        const b = toMin(r.starts_at),
          y = b + r.interval_minutes * Math.max(1, r.capacity);
        if (a < y && b < z) clash.push(`${r.agenda_name} · ${dayName(r.weekday)} ${r.starts_at.slice(0, 5)} (${r.source_name || "archivo"})`);
      }
    for (const s of catalog.sessions)
      if (
        s.professional_id === agenda.professional_id &&
        s.service_day >= agenda.starts_on &&
        s.service_day <= agenda.ends_on &&
        new Date(s.service_day + "T12:00:00Z").getUTCDay() === f.weekday &&
        s.starts_at &&
        s.ends_at &&
        a < toMin(s.ends_at) &&
        toMin(s.starts_at) < z
      )
        clash.push(`${s.agenda_name} · ${dmy(s.service_day)} ${s.starts_at.slice(0, 5)} (PDF)`);
    return clash.length
      ? t("Traslape con: ", "Overlaps with: ") + [...new Set(clash)].slice(0, 6).join(" | ")
      : t("Sin traslape con otras agendas del recurso.", "No overlap with this resource's agendas.");
  }

  const newHeader = (): HeaderForm => ({
    agenda_code: "",
    agenda_name: "",
    starts_on: chileToday(),
    ends_on: chileToday(),
    staggered: false,
    requires_record: true,
    funding: FUNDING[0],
    agenda_type: "Consulta",
    multi_hour: false,
  });

  if (!open)
    return (
      <section className="v-panel v-pad a-import">
        <button className="v-btn primary" onClick={() => setOpen(true)}>
          ✎ {t("Ingreso manual de agenda", "Manual agenda entry")}
        </button>
        <p className="v-muted">
          {t(
            "Misma secuencia que SISMAULE: recurso, agenda, detalle y distribución de cupos.",
            "Same sequence as SISMAULE: resource, agenda, detail and slot distribution.",
          )}
        </p>
      </section>
    );

  return (
    <section className="v-panel v-pad sis">
      <div className="sis-top">
        <h2>{t("Ingreso de agendas", "Agenda entry")}</h2>
        <button className="v-link" onClick={() => setOpen(false)}>
          {t("Cerrar", "Close")}
        </button>
      </div>

      {step === 1 && (
        <div className="sis-card">
          <h3 className="sis-title">INGRESO DE AGENDAS</h3>
          <p className="sis-hint">{t("Ingrese los siguientes datos para filtrar las agendas creadas:", "Enter the data to filter created agendas:")}</p>
          <div className="sis-form">
            <label>Fecha Inicio</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <label>Fecha Término</label>
            <input type="date" min={from} value={until} onChange={(e) => setUntil(e.target.value)} />
            <label>Recurso</label>
            <div className="sis-pair">
              <input
                className="sis-code"
                aria-label={t("Código del recurso", "Resource code")}
                value={code}
                maxLength={20}
                onChange={(e) => {
                  setCode(e.target.value);
                  const p = people.find((x) => x.resource_code && x.resource_code === e.target.value.trim());
                  if (p) setPerson(p.name);
                }}
              />
              <input
                list="sis-people"
                aria-label={t("Nombre del recurso", "Resource name")}
                value={person}
                placeholder={t("Escribe apellido y elige…", "Type surname and pick…")}
                onChange={(e) => {
                  setPerson(e.target.value);
                  const p = people.find((x) => key(x.name) === key(e.target.value));
                  setCode(p?.resource_code || "");
                  if (p && !unit && p.establishments.length === 1) setUnit(p.establishments[0]);
                }}
              />
              <span className="sis-lupa" aria-hidden>
                🔍
              </span>
              <datalist id="sis-people">
                {people.map((p) => (
                  <option key={p.id} value={p.name}>
                    {[p.profession, p.establishments.join(", ")].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </datalist>
            </div>
            <label>{t("Unidad de atención", "Care unit")}</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">{t("Todas", "All")}</option>
              {establishments.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <label>Filtro Agendas</label>
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              {["TODAS", "VIGENTES", "CERRADAS", "NO GENERADAS"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          {person && !resource && (
            <p className="v-error">
              {t(
                "Recurso no encontrado. Elige un nombre de la lista (carga el Excel BD Profesionales y Agenda o agrégalo en Profesionales).",
                "Resource not found. Pick a name from the list (load the professionals Excel or add it in Professionals).",
              )}
            </p>
          )}
          <div className="sis-actions">
            <button
              className="sis-btn"
              disabled={!resource || !from || !until || until < from}
              onClick={() => {
                setStep(2);
                setSelected("");
                setDetailId("");
                setError("");
                setNotice("");
              }}
            >
              CONTINUAR
            </button>
          </div>
        </div>
      )}

      {step === 2 && resource && (
        <>
          <p className="sis-crumb">
            <button className="v-link" onClick={() => setStep(1)}>
              ‹ {t("Cambiar filtro", "Change filter")}
            </button>{" "}
            {resource.resource_code ? resource.resource_code + " · " : ""}
            <b>{resource.name}</b> · {dmy(from)} — {dmy(until)}
            {unit ? " · " + unit : ""} · {filter}
          </p>
          <div className="sis-card">
            <h3 className="sis-title">Agendas Creadas</h3>
            <div className="v-scroll sis-scroll">
              <table className="sis-table">
                <thead>
                  <tr>
                    {["Corr.", "Agenda", "U. Atención", "Recurso", "Fecha Inicio", "Fecha Término", "Fecha Cierre", "Estado", "M", "E"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr
                      key={m.id}
                      className={m.id === selected ? "selected" : ""}
                      onClick={() => {
                        setSelected(m.id);
                        setDetailId("");
                      }}
                    >
                      <td>{m.corr}</td>
                      <td>{m.agenda_code ? m.agenda_code + " · " : ""}{m.agenda_name}</td>
                      <td>{m.establishment}</td>
                      <td>{resource.name}</td>
                      <td>{dmy(m.starts_on)}</td>
                      <td>{dmy(m.ends_on)}</td>
                      <td>{dmy(m.closed_on)}</td>
                      <td>{m.generated ? "S" : "N"}</td>
                      <td>
                        <button
                          className="sis-icon"
                          title={t("Modificar", "Edit")}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(m.id);
                            setHeaderDlg({
                              id: m.id,
                              form: {
                                agenda_code: m.agenda_code,
                                agenda_name: m.agenda_name,
                                starts_on: m.starts_on,
                                ends_on: m.ends_on,
                                staggered: m.staggered,
                                requires_record: m.requires_record,
                                funding: m.funding,
                                agenda_type: m.agenda_type,
                                multi_hour: m.multi_hour,
                              },
                            });
                          }}
                        >
                          ✎
                        </button>
                      </td>
                      <td>
                        <button
                          className="sis-icon del"
                          title={t("Eliminar", "Delete")}
                          onClick={(e) => {
                            e.stopPropagation();
                            setAction({ kind: "delete", id: m.id });
                          }}
                        >
                          ✖
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={10} className="sis-empty">
                        {t("Sin agendas para este filtro. Usa AGREGAR AGENDA.", "No agendas for this filter. Use ADD AGENDA.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="sis-actions">
            <button
              className="sis-btn"
              disabled={busy}
              onClick={() => {
                if (!unit) {
                  setError(t("Selecciona la unidad de atención en el filtro antes de agregar.", "Select the care unit in the filter before adding."));
                  return;
                }
                setHeaderDlg({ form: newHeader() });
              }}
            >
              AGREGAR AGENDA
            </button>
            <button
              className="sis-btn"
              disabled={busy || !agenda || agenda.generated || !agenda.details.length}
              title={agenda && !agenda.details.length ? t("Agrega al menos un detalle", "Add at least one detail") : ""}
              onClick={() => agenda && void run(() => api.manualAgenda.generate(agenda.id), t("Agenda generada: ya aparece en el calendario como habilitada.", "Agenda generated."))}
            >
              GENERAR AGENDA
            </button>
            <button
              className="sis-btn"
              disabled={busy || !agenda}
              onClick={() => agenda && setAction({ kind: "copy", id: agenda.id, a: agenda.ends_on < chileToday() ? chileToday() : agenda.ends_on, b: yearEnd() })}
            >
              COPIAR AGENDAS
            </button>
            <button
              className="sis-btn"
              disabled={busy || !agenda || !!agenda.closed_on}
              onClick={() => agenda && setAction({ kind: "close", id: agenda.id, a: chileToday() })}
            >
              CERRAR AGENDA
            </button>
          </div>
          {action && (action.kind === "close" || action.kind === "copy") && (
            <div className="sis-inline">
              {action.kind === "close" ? (
                <>
                  <span>{t("Fecha de cierre:", "Closing date:")}</span>
                  <input type="date" min={agenda?.starts_on} value={action.a} onChange={(e) => setAction({ ...action, a: e.target.value })} />
                </>
              ) : (
                <>
                  <span>{t("Copiar con detalle y cupos a:", "Copy with detail and slots to:")}</span>
                  <input type="date" value={action.a} onChange={(e) => setAction({ ...action, a: e.target.value })} />
                  <input type="date" min={action.a} value={action.b} onChange={(e) => setAction({ ...action, b: e.target.value })} />
                </>
              )}
              <button
                className="sis-btn"
                disabled={busy}
                onClick={async () => {
                  const ok =
                    action.kind === "close"
                      ? await run(() => api.manualAgenda.close(action.id, action.a!), t("Agenda cerrada.", "Agenda closed."))
                      : await run(() => api.manualAgenda.copy(action.id, action.a!, action.b!), t("Agenda copiada (estado N, por generar).", "Agenda copied."));
                  if (ok) setAction(null);
                }}
              >
                GRABAR
              </button>
              <button className="sis-btn light" onClick={() => setAction(null)}>
                CANCELAR
              </button>
            </div>
          )}
          {action && action.kind.startsWith("delete") && (
            <div className="sis-inline warn">
              <span>
                {action.kind === "delete"
                  ? t("¿Eliminar la agenda con todo su detalle y cupos?", "Delete the agenda with all details and slots?")
                  : action.kind === "delete-detail"
                    ? t("¿Eliminar este detalle y su distribución de cupos?", "Delete this detail and its distribution?")
                    : t("¿Eliminar esta distribución de cupos?", "Delete this slot distribution?")}
              </span>
              <button
                className="sis-btn"
                disabled={busy}
                onClick={async () => {
                  const ok = await run(
                    () =>
                      action.kind === "delete"
                        ? api.manualAgenda.remove(action.id)
                        : action.kind === "delete-detail"
                          ? api.manualAgenda.removeDetail(action.id)
                          : api.manualAgenda.removeQuota(action.id),
                    t("Eliminado.", "Deleted."),
                  );
                  if (ok) {
                    if (action.kind === "delete") setSelected("");
                    if (action.kind === "delete-detail") setDetailId("");
                    setAction(null);
                  }
                }}
              >
                {t("Sí, eliminar", "Yes, delete")}
              </button>
              <button className="sis-btn light" onClick={() => setAction(null)}>
                CANCELAR
              </button>
            </div>
          )}

          <div className="sis-two">
            <div className="sis-card">
              <h3 className="sis-title">Detalle de Agenda</h3>
              <table className="sis-table">
                <thead>
                  <tr>
                    {["Nº", "Día", "Hora Inicio", "Intervalo", "Cupos", "Box", "M", "E"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(agenda?.details || []).map((d, i) => (
                    <tr key={d.id} className={d.id === detailId ? "selected" : ""} onClick={() => setDetailId(d.id)}>
                      <td>{i + 1}</td>
                      <td>{dayName(d.weekday)}</td>
                      <td>{d.starts_at.slice(0, 5).replace(":", "")}</td>
                      <td>{d.interval_minutes}</td>
                      <td>{d.capacity}</td>
                      <td>{d.box}</td>
                      <td>
                        <button
                          className="sis-icon"
                          title={t("Modificar", "Edit")}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailId(d.id);
                            setOverlap("");
                            setDetailDlg({
                              id: d.id,
                              form: {
                                weekday: d.weekday,
                                hh: d.starts_at.slice(0, 2),
                                mm: d.starts_at.slice(3, 5),
                                interval: String(d.interval_minutes),
                                capacity: String(d.capacity),
                                box: d.box,
                              },
                            });
                          }}
                        >
                          ✎
                        </button>
                      </td>
                      <td>
                        <button
                          className="sis-icon del"
                          title={t("Eliminar", "Delete")}
                          onClick={(e) => {
                            e.stopPropagation();
                            setAction({ kind: "delete-detail", id: d.id });
                          }}
                        >
                          ✖
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!agenda && (
                    <tr>
                      <td colSpan={8} className="sis-empty">
                        {t("Selecciona una agenda creada.", "Select a created agenda.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="sis-actions">
                <button
                  className="sis-btn"
                  disabled={busy || !agenda || (!!agenda.closed_on)}
                  onClick={() => {
                    setOverlap("");
                    setDetailDlg({ form: { weekday: "", hh: "", mm: "", interval: "", capacity: "", box: "" } });
                  }}
                >
                  AGREGAR DETALLE
                </button>
              </div>
            </div>
            <div className="sis-card">
              <h3 className="sis-title">Detalle de Cupos</h3>
              <table className="sis-table">
                <thead>
                  <tr>
                    {["Cód.", "Establecimiento", "Tipo Atención", "Cupos", "M", "E"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(detail?.quotas || []).map((q) => (
                    <tr key={q.id}>
                      <td>{EST_CODE[q.establishment] || "—"}</td>
                      <td>{q.establishment}</td>
                      <td>{q.attention}</td>
                      <td>{q.capacity}</td>
                      <td>
                        <button
                          className="sis-icon"
                          title={t("Modificar", "Edit")}
                          onClick={() =>
                            setQuotaDlg({ id: q.id, form: { establishment: q.establishment, attention: q.attention, capacity: String(q.capacity) } })
                          }
                        >
                          ✎
                        </button>
                      </td>
                      <td>
                        <button className="sis-icon del" title={t("Eliminar", "Delete")} onClick={() => setAction({ kind: "delete-quota", id: q.id })}>
                          ✖
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!detail && (
                    <tr>
                      <td colSpan={6} className="sis-empty">
                        {t("Selecciona un detalle de agenda.", "Select an agenda detail.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {detail && (
                <p className="sis-hint">
                  {detail.quotas.reduce((n, q) => n + q.capacity, 0)} / {detail.capacity} {t("cupos distribuidos", "slots distributed")}
                </p>
              )}
              <div className="sis-actions">
                <button
                  className="sis-btn"
                  disabled={busy || !detail || detail.quotas.reduce((n, q) => n + q.capacity, 0) >= detail.capacity}
                  onClick={() =>
                    detail &&
                    agenda &&
                    setQuotaDlg({
                      form: {
                        establishment: agenda.establishment,
                        attention: "",
                        capacity: String(detail.capacity - detail.quotas.reduce((n, q) => n + q.capacity, 0)),
                      },
                    })
                  }
                >
                  AGREGAR CUPOS
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {error && <p className="v-error">{error}</p>}
      {notice && <p className="v-ok">{notice}</p>}

      {headerDlg && resource && (
        <Dialog title="INGRESO DE AGENDA" onClose={() => setHeaderDlg(null)}>
          <form
            className="sis-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = headerDlg.form;
              const current = manual.find((m) => m.id === headerDlg.id);
              const est = current?.establishment || unit;
              if (!f.agenda_name.trim()) return setError(t("Indica la agenda.", "Enter the agenda."));
              if (!f.starts_on || !f.ends_on || f.ends_on < f.starts_on) return setError(t("Revisa las fechas.", "Check the dates."));
              let id = headerDlg.id;
              const ok = await run(async () => {
                const r = await api.manualAgenda.saveHeader(
                  {
                    professional_id: current?.professional_id || resource.id,
                    establishment: est,
                    agenda_code: f.agenda_code.trim(),
                    agenda_name: f.agenda_name.trim().toLocaleUpperCase("es"),
                    starts_on: f.starts_on,
                    ends_on: f.ends_on,
                    closed_on: current?.closed_on ?? null,
                    generated: current?.generated ?? false,
                    staggered: f.staggered,
                    requires_record: f.requires_record,
                    funding: f.funding,
                    agenda_type: f.agenda_type,
                    multi_hour: f.multi_hour,
                  },
                  headerDlg.id,
                );
                id = r.id;
              }, headerDlg.id ? t("Agenda modificada.", "Agenda updated.") : t("Agenda grabada. Ahora agrega el detalle.", "Agenda saved. Now add the detail."));
              if (ok) {
                setHeaderDlg(null);
                if (id) setSelected(id);
                if (from > f.starts_on) setFrom(f.starts_on);
                if (until < f.ends_on) setUntil(f.ends_on);
              }
            }}
          >
            <label>Agenda</label>
            <div className="sis-pair">
              <input
                className="sis-code"
                aria-label={t("Código de agenda", "Agenda code")}
                maxLength={100}
                value={headerDlg.form.agenda_code}
                onChange={(e) => setHeaderDlg({ ...headerDlg, form: { ...headerDlg.form, agenda_code: e.target.value } })}
              />
              <input
                required
                list="sis-agendas"
                aria-label={t("Nombre de agenda", "Agenda name")}
                maxLength={250}
                value={headerDlg.form.agenda_name}
                onChange={(e) => setHeaderDlg({ ...headerDlg, form: { ...headerDlg.form, agenda_name: e.target.value } })}
              />
              <span className="sis-lupa" aria-hidden>
                🔍
              </span>
              <datalist id="sis-agendas">
                {agendaNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
            <label>Fecha Inicio</label>
            <input type="date" required value={headerDlg.form.starts_on} onChange={(e) => setHeaderDlg({ ...headerDlg, form: { ...headerDlg.form, starts_on: e.target.value } })} />
            <label>Fecha Término</label>
            <input
              type="date"
              required
              min={headerDlg.form.starts_on}
              value={headerDlg.form.ends_on}
              onChange={(e) => setHeaderDlg({ ...headerDlg, form: { ...headerDlg.form, ends_on: e.target.value } })}
            />
            <label>Escalonada</label>
            <select
              className="sis-short"
              value={headerDlg.form.staggered ? "SI" : "NO"}
              onChange={(e) => setHeaderDlg({ ...headerDlg, form: { ...headerDlg.form, staggered: e.target.value === "SI" } })}
            >
              <option>NO</option>
              <option>SI</option>
            </select>
            <label>Requiere Ficha</label>
            <select
              className="sis-short"
              value={headerDlg.form.requires_record ? "SI" : "NO"}
              onChange={(e) => setHeaderDlg({ ...headerDlg, form: { ...headerDlg.form, requires_record: e.target.value === "SI" } })}
            >
              <option>SI</option>
              <option>NO</option>
            </select>
            <label>Modalidad de Financiamiento de Prestación</label>
            <select value={headerDlg.form.funding} onChange={(e) => setHeaderDlg({ ...headerDlg, form: { ...headerDlg.form, funding: e.target.value } })}>
              {[...new Set([...FUNDING, headerDlg.form.funding])].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <label>Tipo de Agenda</label>
            <div className="sis-radios">
              {(["Consulta", "Procedimiento"] as const).map((v) => (
                <label key={v}>
                  <input
                    type="radio"
                    name="sis-type"
                    checked={headerDlg.form.agenda_type === v}
                    onChange={() => setHeaderDlg({ ...headerDlg, form: { ...headerDlg.form, agenda_type: v } })}
                  />{" "}
                  {v}
                </label>
              ))}
            </div>
            <label>Permite mas de una hora diaria</label>
            <input
              type="checkbox"
              className="sis-check"
              checked={headerDlg.form.multi_hour}
              onChange={(e) => setHeaderDlg({ ...headerDlg, form: { ...headerDlg.form, multi_hour: e.target.checked } })}
            />
            <div className="sis-actions full">
              <button className="sis-btn light" disabled={busy}>
                GRABAR
              </button>
              <button type="button" className="sis-btn light" onClick={() => setHeaderDlg(null)}>
                CANCELAR
              </button>
            </div>
            {error && <p className="v-error full">{error}</p>}
          </form>
        </Dialog>
      )}

      {detailDlg && agenda && (
        <Dialog title="INGRESO DE DETALLE" onClose={() => setDetailDlg(null)}>
          <form
            className="sis-form narrow"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = detailDlg.form;
              const hh = Number(f.hh),
                mm = Number(f.mm || 0);
              if (f.weekday === "") return setError(t("Selecciona el día.", "Select the day."));
              if (!f.hh || hh > 23 || mm > 59) return setError(t("Hora de inicio inválida.", "Invalid start time."));
              if (!(Number(f.interval) >= 1)) return setError(t("Indica el intervalo en minutos.", "Enter the interval in minutes."));
              if (!(Number(f.capacity) >= 1)) return setError(t("Indica los cupos.", "Enter the slots."));
              const ok = await run(
                () =>
                  api.manualAgenda.saveDetail(
                    {
                      manual_agenda_id: agenda.id,
                      weekday: f.weekday as number,
                      starts_at: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
                      interval_minutes: Number(f.interval),
                      capacity: Number(f.capacity),
                      box: f.box.trim(),
                    },
                    detailDlg.id,
                  ),
                t("Detalle grabado. Distribuye los cupos con AGREGAR CUPOS.", "Detail saved. Distribute slots with ADD SLOTS."),
              );
              if (ok) setDetailDlg(null);
            }}
          >
            <label>Día :</label>
            <select
              value={detailDlg.form.weekday}
              onChange={(e) => setDetailDlg({ ...detailDlg, form: { ...detailDlg.form, weekday: e.target.value === "" ? "" : Number(e.target.value) } })}
            >
              <option value="" />
              {DAYS.map(([n, d]) => (
                <option key={n} value={n}>
                  {d}
                </option>
              ))}
            </select>
            <label>Hora de Inicio :</label>
            <div className="sis-time">
              <input inputMode="numeric" maxLength={2} aria-label="Hrs" value={detailDlg.form.hh} onChange={(e) => setDetailDlg({ ...detailDlg, form: { ...detailDlg.form, hh: e.target.value.replace(/\D/g, "") } })} />
              <span>Hrs.</span>
              <input inputMode="numeric" maxLength={2} aria-label="Min" value={detailDlg.form.mm} onChange={(e) => setDetailDlg({ ...detailDlg, form: { ...detailDlg.form, mm: e.target.value.replace(/\D/g, "") } })} />
              <span>Min.</span>
            </div>
            <label>Intervalo de Hora :</label>
            <input className="sis-short" inputMode="numeric" value={detailDlg.form.interval} onChange={(e) => setDetailDlg({ ...detailDlg, form: { ...detailDlg.form, interval: e.target.value.replace(/\D/g, "") } })} />
            <label>Cupos :</label>
            <input className="sis-short" inputMode="numeric" value={detailDlg.form.capacity} onChange={(e) => setDetailDlg({ ...detailDlg, form: { ...detailDlg.form, capacity: e.target.value.replace(/\D/g, "") } })} />
            <label>Box :</label>
            <div className="sis-pair">
              <input className="sis-short" maxLength={50} value={detailDlg.form.box} onChange={(e) => setDetailDlg({ ...detailDlg, form: { ...detailDlg.form, box: e.target.value } })} />
              <button type="button" className="sis-btn small" onClick={() => setOverlap(traslape(detailDlg.form, detailDlg.id))}>
                TRASLAPE
              </button>
            </div>
            {overlap && <p className={"full " + (/^(Traslape|Overlaps)/.test(overlap) ? "v-error" : "v-ok")}>{overlap}</p>}
            <div className="sis-actions full">
              <button className="sis-btn light" disabled={busy}>
                GRABAR
              </button>
              <button type="button" className="sis-btn light" onClick={() => setDetailDlg(null)}>
                CANCELAR
              </button>
            </div>
            {error && <p className="v-error full">{error}</p>}
          </form>
        </Dialog>
      )}

      {quotaDlg && detail && (
        <Dialog title="INGRESO DE DISTRIBUCIÓN DE CUPOS" onClose={() => setQuotaDlg(null)}>
          <form
            className="sis-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = quotaDlg.form;
              if (!f.establishment) return setError(t("Selecciona el establecimiento destino.", "Select the destination."));
              if (!f.attention) return setError(t("Selecciona el tipo de atención.", "Select the attention type."));
              if (!(Number(f.capacity) >= 1)) return setError(t("Indica los cupos.", "Enter the slots."));
              const ok = await run(
                () =>
                  api.manualAgenda.saveQuota(
                    { detail_id: detail.id, establishment: f.establishment, attention: f.attention, capacity: Number(f.capacity) },
                    quotaDlg.id,
                  ),
                t("Cupos distribuidos.", "Slots distributed."),
              );
              if (ok) setQuotaDlg(null);
            }}
          >
            <label>Establecimiento Destino:</label>
            <div className="sis-pair">
              <input className="sis-code" readOnly aria-label={t("Código", "Code")} value={EST_CODE[quotaDlg.form.establishment] || ""} />
              <select value={quotaDlg.form.establishment} onChange={(e) => setQuotaDlg({ ...quotaDlg, form: { ...quotaDlg.form, establishment: e.target.value } })}>
                <option value="" />
                {establishments.map((s) => (
                  <option key={s} value={s}>
                    {s === "Rural" ? "POSTAS / CENTROS RURALES" : "CENTRO DE SALUD FAMILIAR " + s.toLocaleUpperCase("es")}
                  </option>
                ))}
              </select>
            </div>
            <label>Tipo Atención:</label>
            <select
              className="sis-short"
              value={quotaDlg.form.attention}
              onChange={(e) => setQuotaDlg({ ...quotaDlg, form: { ...quotaDlg.form, attention: e.target.value as QuotaForm["attention"] } })}
            >
              <option value="" />
              <option>CONTROL</option>
              <option>NUEVO</option>
            </select>
            <label>Cupos:</label>
            <input className="sis-short" inputMode="numeric" value={quotaDlg.form.capacity} onChange={(e) => setQuotaDlg({ ...quotaDlg, form: { ...quotaDlg.form, capacity: e.target.value.replace(/\D/g, "") } })} />
            <div className="sis-actions full">
              <button className="sis-btn light" disabled={busy}>
                GRABAR
              </button>
              <button type="button" className="sis-btn light" onClick={() => setQuotaDlg(null)}>
                CANCELAR
              </button>
            </div>
            {error && <p className="v-error full">{error}</p>}
          </form>
        </Dialog>
      )}
    </section>
  );
}
export type { ManualAgenda, ManualDetail, ManualQuota };
