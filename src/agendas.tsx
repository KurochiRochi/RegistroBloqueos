import { useEffect, useMemo, useState } from "react";
import { ManualAgenda } from "./v15.tsx";
import type { MpoDate } from "./api.ts";
import { AgendaImport, ProfessionalEditor } from "./agenda-tools.tsx";
import { expandRules, establishments } from "./agenda-import.ts";
import { chileToday, type RecordRow } from "./model.ts";
import { useLanguage } from "./language.ts";
import {
  clampDate,
  crossCatalog,
  dates,
  key,
  monday,
  shift,
  unmatchedBlocks,
  type AgendaCatalog,
  type CrossedAgenda,
  type CatalogProfessional,
} from "./agenda-model.ts";
const stateNames = {
  scheduled: ["Programada", "Scheduled"],
  blocked: ["Bloqueada", "Blocked"],
  partial: ["Bloqueo parcial", "Partially blocked"],
  uncertain: ["Horario por verificar", "Time to verify"],
};
const format = (s: string, lang: string, options: Intl.DateTimeFormatOptions) =>
  new Date(s + "T12:00:00Z").toLocaleDateString(
    lang === "en" ? "en-GB" : "es-CL",
    { timeZone: "UTC", ...options },
  );
function Filters({
  catalog,
  est,
  setEst,
  profession,
  setProfession,
  person,
  setPerson,
  agenda,
  setAgenda,
}: {
  catalog: AgendaCatalog;
  est: string;
  setEst: (s: string) => void;
  profession: string;
  setProfession: (s: string) => void;
  person: string;
  setPerson: (s: string) => void;
  agenda: string;
  setAgenda: (s: string) => void;
}) {
  const { t } = useLanguage();
  const professionals = catalog.professionals.filter(
    (p) =>
      (!est || p.establishments.includes(est)) &&
      (!profession ||
        (profession === "__empty"
          ? !p.profession
          : p.profession === profession)),
  );
  return (
    <>
      <select
        aria-label={t(
          "Establecimiento del calendario",
          "Calendar establishment",
        )}
        value={est}
        onChange={(e) => {
          setEst(e.target.value);
          setPerson("");
          setAgenda("");
        }}
      >
        <option value="">
          {t("Todos los establecimientos", "All establishments")}
        </option>
        {establishments.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <select
        aria-label={t("Profesión del calendario", "Calendar profession")}
        value={profession}
        onChange={(e) => {
          setProfession(e.target.value);
          setPerson("");
        }}
      >
        <option value="">
          {t("Todas las profesiones", "All professions")}
        </option>
        <option value="__empty">
          {t("Profesión sin informar", "Profession unspecified")}
        </option>
        {[
          ...new Set(
            catalog.professionals.map((p) => p.profession).filter(Boolean),
          ),
        ]
          .sort()
          .map((s) => (
            <option key={s}>{s}</option>
          ))}
      </select>
      <select
        aria-label={t("Profesional del calendario", "Calendar professional")}
        value={person}
        onChange={(e) => setPerson(e.target.value)}
      >
        <option value="">
          {t("Todos los profesionales", "All professionals")}
        </option>
        {professionals
          .filter((p) => p.classification === "regular")
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
      <select
        aria-label={t("Agenda del calendario", "Calendar agenda")}
        value={agenda}
        onChange={(e) => setAgenda(e.target.value)}
      >
        <option value="">{t("Todas las agendas", "All agendas")}</option>
        {[
          ...new Set(
            [
              ...catalog.sessions,
              ...(catalog.rules || []).map((r) => ({
                ...r,
                professional_id: r.professional_id || "",
              })),
            ]
              .filter(
                (s) =>
                  (!est || s.establishment === est) &&
                  (!person || s.professional_id === person),
              )
              .map((s) => s.agenda_name),
          ),
        ]
          .sort()
          .map((s) => (
            <option key={s}>{s}</option>
          ))}
      </select>
    </>
  );
}
export function Agendas({
  catalog,
  blocks,
  openBlock,
  writer = false,
  refresh = async () => {},
  preview = false,
  loading = false,
  mpo = [],
  focus = null,
}: {
  catalog: AgendaCatalog;
  blocks: RecordRow[];
  openBlock: (r: RecordRow) => void;
  writer?: boolean;
  refresh?: () => Promise<void>;
  preview?: boolean;
  loading?: boolean;
  mpo?: MpoDate[];
  focus?: { date: string; professional: string; establishment: string; key: number } | null;
}) {
  const { t, lang } = useLanguage();
  const [shown, setShown] = useState(50);
  const [periodId, setPeriodId] = useState(""),
    [chosenDate, setDate] = useState(""),
    [mode, setMode] = useState<"day" | "week" | "month">("week");
  const [est, setEst] = useState(""),
    [profession, setProfession] = useState(""),
    [person, setPerson] = useState(""),
    [agenda, setAgenda] = useState(""),
    [state, setState] = useState(""),
    [selected, setSelected] = useState<CrossedAgenda | null>(null);
  // Enlace desde Pacientes citados: abre el día, establecimiento y profesional del bloqueo.
  useEffect(() => {
    if (!focus) return;
    const k = key(focus.professional);
    const p = catalog.professionals.find(
      (p) =>
        [p.name, ...(p.aliases || [])].some((n) => key(n) === k) &&
        (p.establishments.includes(focus.establishment) ||
          p.resource_establishment === focus.establishment),
    );
    setEst(focus.establishment);
    setPerson(p?.id || "");
    setProfession("");
    setAgenda("");
    setState("");
    setDate(focus.date);
    setMode("day");
    setSelected(null);
  }, [focus?.key]);
  const period =
    catalog.periods.find((p) => p.id === periodId) || catalog.periods[0];
  const current = period
    ? clampDate(chosenDate || chileToday(), period)
    : chileToday();
  const visibleFrom =
    mode === "day"
      ? current
      : mode === "week"
        ? monday(current)
        : monday(current.slice(0, 7) + "-01");
  const lastMonthDay = new Date(
    Date.UTC(Number(current.slice(0, 4)), Number(current.slice(5, 7)), 0),
  )
    .toISOString()
    .slice(0, 10);
  const visibleUntil =
    mode === "day"
      ? current
      : mode === "week"
        ? shift(visibleFrom, 6)
        : shift(monday(lastMonthDay), 6);
  const expandedCatalog = useMemo(
    () => ({
      ...catalog,
      sessions: [
        ...catalog.sessions,
        ...expandRules(
          catalog.rules || [],
          period?.id || "",
          visibleFrom,
          visibleUntil,
        ),
      ],
    }),
    [catalog, period, visibleFrom, visibleUntil],
  );
  const crossed = useMemo(
    () => (period ? crossCatalog(expandedCatalog, blocks, period.id) : []),
    [expandedCatalog, blocks, period],
  );
  const referenceIssues = useMemo(
    () =>
      (catalog.rules || []).filter(
        (r) =>
          shift(
            r.starts_on,
            (r.weekday - new Date(r.starts_on + "T00:00:00Z").getUTCDay() + 7) %
              7,
          ) > r.ends_on,
      ),
    [catalog.rules],
  );
  if (!period)
    return (
      <section className="v-panel v-pad">
        <h2>{t("Agendas por establecimiento", "Agendas by establishment")}</h2>
        <p>
          {t(
            loading ? "Cargando programación compartida…" : "No se ha cargado un período de referencia.",
            loading ? "Loading shared programming…" : "No reference period has been loaded.",
          )}
        </p>
      </section>
    );
  const day = clampDate(chosenDate || chileToday(), period);
  const visible = crossed.filter(
    (e) =>
      (!est || e.session.establishment === est) &&
      (!profession ||
        (profession === "__empty"
          ? !e.professional?.profession
          : e.professional?.profession === profession)) &&
      (!person || e.session.professional_id === person) &&
      (!agenda || e.session.agenda_name === agenda) &&
      (!state || e.state === state),
  );
  const monthStart = day.slice(0, 7) + "-01";
  const monthEnd = new Date(
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0),
  )
    .toISOString()
    .slice(0, 10);
  const days =
    mode === "day"
      ? [day]
      : mode === "week"
        ? dates(monday(day), shift(monday(day), 6))
        : dates(monday(monthStart), shift(monday(monthEnd), 6));
  const orphan = unmatchedBlocks(blocks, expandedCatalog, period).filter(
    (b) =>
      String(b.Fecha_Inicio) <= visibleUntil &&
      String(b.Fecha_Termino) >= visibleFrom &&
      (!est || key(b.Establecimiento) === key(est)) &&
      (!person ||
        key(b.Profesional) ===
          key(
            catalog.professionals.find((p) => p.id === person)?.name || "",
          )) &&
      (!profession ||
        (profession === "__empty"
          ? !b.Profesion
          : b.Profesion === profession)) &&
      (!agenda ||
        (b.Agendas || [String(b.Agenda || "")]).some(
          (a) => key(a) === key(agenda),
        )),
  );
  const orphanIds = new Set(orphan.map((b) => b.id));

  const go = (n: number) => {
    const next =
      mode === "month"
        ? new Date(
            Date.UTC(
              Number(day.slice(0, 4)),
              Number(day.slice(5, 7)) - 1 + n,
              1,
            ),
          )
            .toISOString()
            .slice(0, 10)
        : shift(day, n * (mode === "week" ? 7 : 1));
    setDate(clampDate(next, period));
    setSelected(null);
  };
  return (
    <>
      {writer && (
        <div className="a-load-row">
          <AgendaImport catalog={catalog} refresh={refresh} preview={preview} />
          <ManualAgenda catalog={catalog} refresh={refresh} preview={preview} />
        </div>
      )}
      {!!referenceIssues.length && (
        <details className="a-pending">
          <summary>
            {referenceIssues.length}{" "}
            {t(
              "filas conservadas sin fecha coincidente: revisar fuente",
              "retained rows without a matching date: review source",
            )}
          </summary>
          <p>
            {t(
              "El día semanal no cae dentro del rango informado. No se creó una atención en otra fecha.",
              "The weekday does not occur in the source date range. No appointment was created on a different date.",
            )}
          </p>
          {referenceIssues.slice(0, 40).map((r) => (
            <p key={r.id}>
              {r.establishment} · {r.resource_name} · {r.agenda_code} ·{" "}
              {r.starts_on} / {r.ends_on} · {r.source_name}, fila {r.source_row}
            </p>
          ))}
        </details>
      )}
      <div className="a-filters">
        <Filters
          {...{
            catalog,
            est,
            setEst,
            profession,
            setProfession,
            person,
            setPerson,
            agenda,
            setAgenda,
          }}
        />
        <input
          aria-label={t("Fecha del calendario", "Calendar date")}
          type="date"
          min={period.starts_on}
          max={period.ends_on}
          value={day}
          onChange={(e) => {
            if (e.target.value) setDate(clampDate(e.target.value, period));
          }}
        />
        <select
          aria-label={t("Estado de agenda", "Agenda status")}
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          <option value="">{t("Todos los estados", "All statuses")}</option>
          {Object.entries(stateNames).map(([s, n]) => (
            <option key={s} value={s}>
              {t(...(n as [string, string]))}
            </option>
          ))}
        </select>
      </div>
      <section className="v-panel a-calendar">
        <div className="a-cal-toolbar">
          <div className="a-cal-nav">
            <button
              className="v-btn"
              onClick={() => setDate(clampDate(chileToday(), period))}
            >
              {t("Hoy", "Today")}
            </button>
            <button
              className="v-btn"
              aria-label={t("Período anterior", "Previous period")}
              disabled={day === period.starts_on}
              onClick={() => go(-1)}
            >
              ‹
            </button>
            <button
              className="v-btn"
              aria-label={t("Período siguiente", "Next period")}
              disabled={day === period.ends_on}
              onClick={() => go(1)}
            >
              ›
            </button>
          </div>
          <h2>
            {mode === "month"
              ? format(day, lang, { month: "long", year: "numeric" })
              : mode === "day"
                ? format(day, lang, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })
                : `${format(days[0], lang, { day: "numeric", month: "short" })} — ${format(days[6], lang, { day: "numeric", month: "short", year: "numeric" })}`}
          </h2>
          <div
            className="a-segment"
            role="group"
            aria-label={t("Vista del calendario", "Calendar view")}
          >
            {(["day", "week", "month"] as const).map((m, i) => (
              <button
                aria-pressed={mode === m}
                key={m}
                className={mode === m ? "selected" : ""}
                onClick={() => {
                  setMode(m);
                  setSelected(null);
                }}
              >
                {[t("Día", "Day"), t("Semana", "Week"), t("Mes", "Month")][i]}
              </button>
            ))}
          </div>
        </div>
        <div className="a-calendar-scroll">
          <div className={`a-cal-grid ${mode}`}>
            {days.map((date) => {
              const outside = date < period.starts_on || date > period.ends_on;
              const events = visible
                .filter((e) => e.session.service_day === date)
                .sort(
                  (a, b) =>
                    (a.session.starts_at || "").localeCompare(
                      b.session.starts_at || "",
                    ) ||
                    (a.professional?.name || "").localeCompare(
                      b.professional?.name || "",
                    ),
                );
              const records = orphan.filter(
                (b) =>
                  String(b.Fecha_Inicio) <= date &&
                  String(b.Fecha_Termino) >= date,
              );
              return (
                <article
                  key={date}
                  className={
                    "a-day" +
                    (outside ? " outside" : "") +
                    (date === chileToday() ? " today" : "")
                  }
                >
                  <header>
                    {mpo.some(
                      (m) =>
                        m.day === date &&
                        (!m.establishment || !est || m.establishment === est),
                    ) && (
                      <em
                        className="a-mpo-tag"
                        title={mpo
                          .filter((m) => m.day === date)
                          .map((m) => `${m.name}${m.audience ? " · " + m.audience : ""}${m.establishment ? " · " + m.establishment : ""}`)
                          .join("\n")}
                      >
                        MPO
                      </em>
                    )}
                    <span>{format(date, lang, { weekday: "short" })}</span>
                    <strong>
                      {format(date, lang, {
                        day: "numeric",
                        month: mode === "month" ? undefined : "short",
                      })}
                    </strong>
                  </header>
                  {!outside && (
                    <div className="a-day-content">
                      {events
                        .slice(
                          0,
                          mode === "month" ? 3 : mode === "week" ? 10 : shown,
                        )
                        .map((e) => (
                          <button
                            key={e.session.id}
                            className={`a-event ${e.state}`}
                            onClick={() => setSelected(e)}
                          >
                            <span className="a-event-state">
                              {e.session.source_blocked
                                ? t("Bloqueada en origen", "Blocked in source")
                                : e.session.generated === false
                                  ? t(
                                      "Sin generar en origen",
                                      "Not generated in source",
                                    )
                                  : t(
                                      ...(stateNames[e.state] as [
                                        string,
                                        string,
                                      ]),
                                    )}
                            </span>
                            <strong>
                              {e.professional?.name ||
                                t(
                                  "Profesional sin identificar",
                                  "Unidentified professional",
                                )}
                            </strong>
                            <span>
                              {e.session.starts_at && e.session.ends_at
                                ? `${e.session.starts_at.slice(0, 5)}–${e.session.ends_at.slice(0, 5)}`
                                : `${e.session.starts_at?.slice(0, 5) || "—"} · ${t("Término por confirmar", "End to confirm")}`}
                            </span>
                            <span>{e.session.agenda_name}</span>
                            <small>{e.session.establishment}</small>
                          </button>
                        ))}
                      {events.length >
                        (mode === "month"
                          ? 3
                          : mode === "week"
                            ? 10
                            : shown) && (
                        <button
                          className="v-link"
                          onClick={() => {
                            if (mode === "day") setShown(shown + 50);
                            else {
                              setDate(date);
                              setMode("day");
                              setShown(50);
                            }
                          }}
                        >
                          {t("Ver todas", "View all")} ({events.length})
                        </button>
                      )}
                      {!state &&
                        records.map((b) => (
                          <button
                            key={b.id}
                            className="a-event reference-missing"
                            onClick={() => openBlock(b)}
                          >
                            <span className="a-event-state">
                              {t(
                                "Bloqueo · sin agenda coincidente",
                                "Block · no matching agenda",
                              )}
                            </span>
                            <strong>{b.Profesional}</strong>
                            <span>{b.Tipo_Bloqueo}</span>
                            <small>
                              {b.Establecimiento} · {b.Codigo_Bloqueo}
                            </small>
                          </button>
                        ))}
                      {!events.length && !records.length && (
                        <span className="a-no-event">
                          {t("Sin agenda", "No agenda")}
                        </span>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
        <div className="a-legend">
          {Object.entries(stateNames).map(([s, n]) => (
            <span key={s}>
              <i className={s} />
              {t(...(n as [string, string]))}
            </span>
          ))}
        </div>
        <p className="a-calendar-note">
          {t(
            "El cruce exige coincidencia de establecimiento, profesional, agenda y fecha. AM: antes de las 12:00; PM: desde las 12:00. Los horarios no informados quedan por verificar. Los cupos originales se conservan, sin descontarlos por estimación.",
            "Matching requires the same establishment, professional, agenda and date. AM is before 12:00; PM starts at 12:00. Unspecified hours require verification. Original capacities are preserved without estimated deductions.",
          )}
        </p>
      </section>
      {selected && (
        <section className="v-panel v-pad a-detail">
          <button className="v-link" onClick={() => setSelected(null)}>
            {t("Cerrar detalle", "Close details")}
          </button>
          <h2>{selected.session.agenda_name}</h2>
          <div className="a-detail-grid">
            <p>
              <strong>{t("Profesional", "Professional")}</strong>
              {selected.professional?.name}
            </p>
            <p>
              <strong>{t("Establecimiento", "Establishment")}</strong>
              {selected.session.establishment}
            </p>
            <p>
              <strong>{t("Horario original", "Original time")}</strong>
              {selected.session.service_day} ·{" "}
              {selected.session.starts_at?.slice(0, 5) || "—"} —{" "}
              {selected.session.ends_at?.slice(0, 5) || "—"}
            </p>
            <p>
              <strong>{t("Cupos originales", "Original capacity")}</strong>
              {selected.session.capacity ?? t("No informado", "Unspecified")}
            </p>
            <p>
              <strong>{t("Estado", "Status")}</strong>
              {t(...(stateNames[selected.state] as [string, string]))}
            </p>
          </div>
          <p>
            {selected.session.agenda_code} · {selected.session.source_name} ·{" "}
            {t("Fila(s)", "Row(s)")}: {selected.session.source_row || "—"}
          </p>
          <p>
            {selected.session.generated === false
              ? t(
                  "Sin generar en el archivo original.",
                  "Not generated in the original file.",
                )
              : null}{" "}
            {selected.session.source_blocked
              ? t(
                  "Marcada BLOQUEADA en el archivo original.",
                  "Marked BLOCKED in the original file.",
                )
              : null}{" "}
            {selected.session.attention}
          </p>
          {!selected.session.ends_at && (
            <p>
              {t(
                "Término pendiente de confirmar. Hora, intervalo y cupos se conservan según la fuente.",
                "End time pending confirmation. Original start, interval and capacity are preserved.",
              )}{" "}
              {selected.session.interval_minutes} min
            </p>
          )}
          <h3>{t("Bloqueos asociados", "Related blocks")}</h3>
          {selected.blocks.length ? (
            selected.blocks.map((b) => (
              <button key={b.id} className="v-btn" onClick={() => openBlock(b)}>
                {b.Codigo_Bloqueo} · {b.Tipo_Bloqueo}
              </button>
            ))
          ) : (
            <p>{t("Sin bloqueos coincidentes.", "No matching blocks.")}</p>
          )}
        </section>
      )}
      {!!orphanIds.size && (
        <p className="a-pending">
          {orphanIds.size}{" "}
          {t(
            "bloqueos sin una agenda de referencia coincidente. Se muestran como bloqueos registrados, sin afirmar que había una atención programada.",
            "blocks lack a matching reference agenda. They are shown as recorded blocks without claiming an appointment was scheduled.",
          )}
        </p>
      )}
    </>
  );
}
export function Professionals({
  catalog,
  openCalendar,
  writer = false,
  refresh = async () => {},
  preview = false,
}: {
  catalog: AgendaCatalog;
  openCalendar: () => void;
  writer?: boolean;
  refresh?: () => Promise<void>;
  preview?: boolean;
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState<
    CatalogProfessional | null | undefined
  >();
  const [est, setEst] = useState(""),
    [profession, setProfession] = useState(""),
    [query, setQuery] = useState(""),
    [classification, setClassification] = useState(""),
    [page, setPage] = useState(0);
  const list = catalog.professionals.filter(
    (p) =>
      (!est || p.establishments.includes(est)) &&
      (!profession ||
        (profession === "__empty"
          ? !p.profession
          : p.profession === profession)) &&
      (!classification || p.classification === classification) &&
      key(p.name).includes(key(query)),
  );
  const slice = list.slice(page * 25, page * 25 + 25);
  return (
    <>
      {writer && (
        <div className="a-directory-actions">
          <button className="v-btn primary" onClick={() => setEditing(null)}>
            {t("Agregar profesional", "Add professional")}
          </button>
        </div>
      )}
      {editing !== undefined && (
        <ProfessionalEditor
          key={editing?.id || "new"}
          professional={editing}
          onClose={() => setEditing(undefined)}
          refresh={refresh}
          preview={preview}
        />
      )}
      <div className="a-filters">
        <select
          aria-label={t(
            "Establecimiento del directorio",
            "Directory establishment",
          )}
          value={est}
          onChange={(e) => {
            setEst(e.target.value);
            setPage(0);
          }}
        >
          <option value="">
            {t("Todos los establecimientos", "All establishments")}
          </option>
          {establishments.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select
          aria-label={t("Profesión del directorio", "Directory profession")}
          value={profession}
          onChange={(e) => {
            setProfession(e.target.value);
            setPage(0);
          }}
        >
          <option value="">
            {t("Todas las profesiones", "All professions")}
          </option>
          <option value="__empty">
            {t("Sin informar en la fuente", "Unspecified in source")}
          </option>
          {[
            ...new Set(
              catalog.professionals.map((p) => p.profession).filter(Boolean),
            ),
          ].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select
          aria-label={t(
            "Vinculación del profesional",
            "Professional assignment",
          )}
          value={classification}
          onChange={(e) => {
            setClassification(e.target.value);
            setPage(0);
          }}
        >
          <option value="">
            {t("Todas las vinculaciones", "All assignments")}
          </option>
          <option value="regular">
            {t("Asignación regular", "Regular assignment")}
          </option>
          <option value="support">
            {t("Apoyo · sin agenda regular", "Support · no regular agenda")}
          </option>
          <option value="pending">
            {t("Asignación por confirmar", "Assignment pending")}
          </option>
        </select>
        <input
          aria-label={t("Buscar profesional", "Search professional")}
          placeholder={t("Buscar profesional…", "Search professional…")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </div>
      <section className="v-panel">
        <div className="v-scroll">
          <table className="v-table">
            <thead>
              <tr>
                {[
                  t("Nombre", "Name"),
                  t("Profesión", "Profession"),
                  t("Establecimiento(s)", "Establishment(s)"),
                  t("Vinculación", "Assignment"),
                  t("Programación", "Programming"),
                  t("Acciones", "Actions"),
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slice.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="a-person">
                      <span className="a-initials">
                        {p.name
                          .split(" ")
                          .slice(0, 2)
                          .map((s) => s[0])
                          .join("")}
                      </span>
                      <div>
                        <strong>{p.name}</strong>
                        <small className="a-resource-code">
                          {p.resource_code
                            ? `${p.resource_establishment} · SISMAULE ${p.resource_code}`
                            : t(
                                "Nómina anterior / ingreso manual",
                                "Earlier directory / manual record",
                              )}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>{p.profession || t("No informada", "Unspecified")}</td>
                  <td>
                    {p.establishments.join(" · ") ||
                      t(
                        "Sin establecimiento regular",
                        "No regular establishment",
                      )}
                  </td>
                  <td>
                    <span className={"a-badge " + p.classification}>
                      {p.classification === "regular"
                        ? t("Asignación regular", "Regular assignment")
                        : p.classification === "support"
                          ? t("Apoyo sin agenda", "Support without agenda")
                          : t("Por confirmar", "Pending")}
                    </span>
                  </td>
                  <td>
                    {catalog.sessions.some((s) => s.professional_id === p.id) ||
                    (catalog.rules || []).some(
                      (s) => s.professional_id === p.id,
                    ) ? (
                      <button className="v-link" onClick={openCalendar}>
                        {t("Ver calendario", "View calendar")}
                      </button>
                    ) : p.classification === "support" ? (
                      t("Sin agenda regular", "No regular agenda")
                    ) : (
                      t("Pendiente de cargar", "Pending upload")
                    )}
                  </td>
                  <td>
                    {writer && (
                      <button className="v-link" onClick={() => setEditing(p)}>
                        {t("Editar", "Edit")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="a-pagination">
          <span>
            {list.length} {t("fichas de profesionales", "professional records")}
          </span>
          <button
            className="v-btn"
            aria-label={t("Página anterior", "Previous page")}
            disabled={!page}
            onClick={() => setPage(page - 1)}
          >
            ‹
          </button>
          <span>
            {page + 1} / {Math.max(1, Math.ceil(list.length / 25))}
          </span>
          <button
            className="v-btn"
            aria-label={t("Página siguiente", "Next page")}
            disabled={(page + 1) * 25 >= list.length}
            onClick={() => setPage(page + 1)}
          >
            ›
          </button>
        </footer>
      </section>
      <p className="a-calendar-note">
        {t(
          "Las fichas SISMAULE se identifican por establecimiento y código de recurso. No equivalen a personas únicas; las discrepancias de profesión se conservan por ficha para revisión. “Ninguno” en la nómina anterior se mantiene como apoyo sin agenda regular.",
          "SISMAULE records use establishment and resource code, not a unique person identifier. Conflicting professions are retained per record for review. Earlier support entries remain without a regular agenda.",
        )}
      </p>
    </>
  );
}
