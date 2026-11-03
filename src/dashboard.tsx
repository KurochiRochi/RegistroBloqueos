import { Agendas, Professionals } from "./agendas.tsx";
import { Home, ReportsHub, Icon } from "./institutional.tsx";
import { Feedback, UsageGuide, MpoPanel } from "./v15.tsx";
import { emptyCatalog, type AgendaCatalog } from "./agenda-model.ts";

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import * as api from "./api.ts";
import { SystemImport } from "./system-blocks-ui.tsx";
import { missingFields, type SystemBlock } from "./system-blocks.ts";
import {
  fields,
  labels,
  types,
  establishments,
  professions,
  scheduleTypes,
  agendaText,
  groupedCounts,
  roleLabel,
  chileToday,
  status,
  validate,
  uniqueAbsenceDays,
  OTHER_TYPE,
  isOtherType,
  type Data,
  type RecordRow,
  type Profile,
  type Calendar,
} from "./model.ts";
import { buildXlsx } from "./xlsx.ts";
import {
  readPatientPdf,
  patientHeaders,
  type PendingDocument,
  type PatientDocument,
} from "./patients.ts";
import {
  readPreferences,
  savePreferences,
  type Preferences,
} from "./preferences.ts";
import { useLanguage } from "./language.ts";
import "./v11.css";
import "./v15.css";
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "No se pudo completar la operación.";
const d = (v: unknown) =>
  String(v || "")
    .split("-")
    .reverse()
    .join("/");
const today = () => chileToday();
const empty = (): Data =>
  ({
    ...Object.fromEntries(fields.map((f) => [f, ""])),
    Fecha_Inicio: today(),
    Fecha_Termino: today(),
    Tipo_Horario: "NO INFORMADO",
    Dias_Bloqueo: 0,
    Cupos_Bloqueados: null,
    Profesion: "",
    Agendas: [""],
    Media_Jornada: "",
    Pacientes_Citados: false,
  }) as Data;
const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};
const nav = [
  ["Inicio", "Home", "home"],
  ["Bloqueos", "Blocks", "calendar"],
  ["Agendas por establecimiento", "Agendas by establishment", "calendar"],
  ["Profesionales", "Professionals", "people"],
  ["Reportes", "Reports", "report"],
  ["Pacientes citados", "Scheduled patients", "♧"],
  ["Feriados", "Holidays", "▣"],
  ["Modo de uso", "How to use", "?"],
];
function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={"v-field" + (wide ? " wide" : "")}>
      <span>{label}</span>
      {children}
    </label>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useLanguage();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="v-modal"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          type="button"
          className="v-icon"
          aria-label={t("Cerrar", "Close")}
          onClick={close}
        >
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Dashboard({
  preview,
  session,
  onExitPreview,
}: {
  preview: boolean;
  session: Session | null;
  onExitPreview: () => void;
}) {
  const { t, lang } = useLanguage();
  const [view, setView] = useState("Inicio");
  const [profile, setProfile] = useState<Profile | null>(
    preview
      ? {
          email: "demo@example.invalid",
          display_name: "Administradora de demostración",
          role: "avanzado",
          active: true,
        }
      : null,
  );
  const [catalog, setCatalog] = useState<AgendaCatalog>(emptyCatalog);
  const [catalogError, setCatalogError] = useState("");
  const [sys, setSys] = useState<(SystemBlock & { id: string })[]>([]),
    [sysDetail, setSysDetail] = useState<(SystemBlock & { id: string }) | null>(
      null,
    );
  const [rows, setRows] = useState<RecordRow[]>([]),
    [cal, setCal] = useState<Calendar>({ years: [], holidays: [] });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(preview),
    [menu, setMenu] = useState(false),
    [modal, setModal] = useState<"profile" | "settings" | "access" | null>(
      null,
    );
  const [mpo, setMpo] = useState<api.MpoDate[]>([]),
    [focus, setFocus] = useState<{ date: string; professional: string; establishment: string; key: number } | null>(null),
    [prefill, setPrefill] = useState<Partial<Data> | null>(null);
  const [edit, setEdit] = useState<RecordRow | null | undefined>(),
    [patientsBlock, setPatientsBlock] = useState<string | undefined>(),
    [search, setSearch] = useState(""),
    [est, setEst] = useState(""),
    [last, setLast] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const advanced = profile?.role === "avanzado",
    writer = advanced || profile?.role === "administrativo";
  const refresh = useCallback(async () => {
    if (preview) {
      setCal({
        years: [{ year: 2026, reviewed: true, source: "Demostración" }],
        holidays: [],
      });
      if (import.meta.env.DEV) {
        const fixture = await import("./demo-agendas.ts");
        setCatalog(fixture.demoCatalog);
        setRows(fixture.demoBlocks);
        setSys(fixture.demoSystemBlocks);
      }
      return;
    }
    setBusy(true);
    try {
      const me = await api.identity();
      setProfile(me.profile);
      const [r, c, sb, m] = await Promise.all([
        api.records(),
        api.calendar(),
        api.systemBlocks(),
        api.mpoDates().catch(() => []),
      ]);
      setRows(r);
      setMpo(m);
      setSys(sb);
      try {
        setCatalog(await api.agendaCatalog());
        setCatalogError("");
      } catch (e) {
        setCatalog(emptyCatalog);
        setCatalogError(errorText(e));
      }
      setCal(c);
      setConnected(true);
      setLast(new Date().toLocaleTimeString("es-CL"));
      setError("");
    } catch (e) {
      setError(errorText(e));
      setConnected(false);
      setRows([]);
    } finally {
      setBusy(false);
    }
  }, [preview]);
  useEffect(() => {
    void refresh();
    if (preview) return;
    const c = api.supabase!;
    let timer: ReturnType<typeof setTimeout>;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 250);
    };
    const referenceChanged = () => {
      api.invalidateAgendaCatalog();
      changed();
    };
    const channel = c
      .channel("registro-v13")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agenda_rules" },
        referenceChanged,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agenda_imports" },
        referenceChanged,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agenda_sessions" },
        referenceChanged,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "catalog_professionals" },
        referenceChanged,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agenda_periods" },
        referenceChanged,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "catalog_agendas" },
        referenceChanged,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "manual_agendas" },
        referenceChanged,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "manual_agenda_details" },
        referenceChanged,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "manual_agenda_quotas" },
        referenceChanged,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bloqueos" },
        changed,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bloqueos_sistema" },
        changed,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        changed,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "holidays" },
        changed,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calendar_years" },
        changed,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mpo_dates" },
        changed,
      )
      .subscribe();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    window.addEventListener("focus", changed);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("focus", changed);
      void c.removeChannel(channel);
    };
  }, [refresh, preview]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", key);
    };
  }, []);
  const active = rows.filter((r) => !r.archived);
  const visible = active.filter(
    (r) =>
      (!est || r.Establecimiento === est) &&
      `${r.Codigo_Bloqueo} ${r.Profesional} ${r.Profesion || ""} ${r.Establecimiento} ${agendaText(r)}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const manualCodes = new Set(
    rows.map((r) =>
      String(r.Codigo_Bloqueo ?? "")
        .trim()
        .toLowerCase(),
    ),
  );
  // Un bloqueo del sistema ya ingresado en la app con el mismo código no se repite.
  const visibleSys = sys.filter(
    (b) =>
      !(b.codigo && manualCodes.has(b.codigo.trim().toLowerCase())) &&
      (!est || b.establecimiento === est) &&
      `${b.codigo} ${b.profesional} ${b.profesion} ${b.establecimiento} ${b.agenda}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  let days: string | number = "—";
  try {
    days = uniqueAbsenceDays(active, cal);
  } catch {}
  const openPatients = (id?: string) => {
    setPatientsBlock(id);
    setView("Pacientes citados");
  };
  async function signOut() {
    if (preview) {
      onExitPreview();
      return;
    }
    const r = await api.supabase!.auth.signOut({ scope: "local" });
    if (r.error) setError(r.error.message);
  }
  return (
    <div className="v-app">
      <aside className="v-sidebar">
        <a className="v-logo" href="/">
          <Icon name="building" size={44} />
          <span>
            Departamento de
            <br />
            Salud Comunal<small>Municipalidad de Parral</small>
          </span>
        </a>
        <small className="v-version">Registro de bloqueos · 1.5</small>
        <nav aria-label={t("Navegación principal", "Main navigation")}>
          {nav
            .filter(([name]) => name !== "Pacientes citados" || writer)
            .map(([name, en, icon]) => (
              <button
                key={name}
                aria-label={t(name, en)}
                title={t(name, en)}
                aria-current={view === name ? "page" : undefined}
                className={
                  view === name ||
                  (name === "Reportes" && view.startsWith("Extracción"))
                    ? "selected"
                    : ""
                }
                onClick={() => {
                  setView(name);
                  setPatientsBlock(undefined);
                }}
              >
                <span aria-hidden>
                  <Icon name={icon} />
                </span>
                <span>{t(name, en)}</span>
              </button>
            ))}
        </nav>
        <p className="v-side-note">
          {t(
            "Un registro compartido. Cada cambio conserva su historial.",
            "One shared registry. Every change keeps its history.",
          )}
        </p>
      </aside>
      <div className="v-body">
        <header className="v-top">
          <div className="i-global-search">
            <Icon name="search" />
            <input
              aria-label={t("Buscar en los bloqueos", "Search blocks")}
              placeholder={t(
                "Buscar profesional, establecimiento o agenda…",
                "Search professional, establishment or agenda…",
              )}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (e.target.value) setView("Bloqueos");
              }}
            />
          </div>
          <div className="v-top-right">
            <span className={"v-status " + (connected ? "ok" : "")}>
              {busy
                ? t("Actualizando…", "Updating…")
                : connected
                  ? t("Conectado", "Connected")
                  : t("Sin conexión", "Offline")}
            </span>
            <div className="i-profile-name">
              <strong>{profile?.display_name}</strong>
              <small>{profile ? roleLabel(profile.role) : ""}</small>
            </div>
            <div className="v-profile-menu" ref={menuRef}>
              <button
                className="v-avatar"
                onClick={() => setMenu(!menu)}
                aria-label={t(
                  "Abrir menú de mi perfil",
                  "Open my profile menu",
                )}
                aria-expanded={menu}
                aria-haspopup="menu"
              >
                {(profile?.display_name || "U")
                  .split(" ")
                  .slice(0, 2)
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()}
              </button>
              {menu && (
                <div className="v-dropdown" role="menu">
                  <strong>
                    {profile?.display_name || t("Mi cuenta", "My account")}
                  </strong>
                  <small>{profile ? roleLabel(profile.role) : ""}</small>
                  {[
                    [
                      "profile",
                      t("Perfil", "Profile"),
                    ],
                    [
                      "settings",
                      t("Configuración", "Settings"),
                    ],
                    ...(advanced
                      ? [
                          [
                            "access",
                            t(
                              "Administración de accesos",
                              "Access administration",
                            ),
                          ],
                        ]
                      : []),
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      role="menuitem"
                      onClick={() => {
                        setMenu(false);
                        setModal(value as typeof modal);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                  <button role="menuitem" onClick={() => void signOut()}>
                    {t("Cerrar sesión", "Sign out")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="v-main">
          <div className="v-heading" hidden={view === "Inicio"}>
            <div>
              <p className="v-eyebrow">
                {t("CONTROL Y TRAZABILIDAD", "CONTROL AND HISTORY")}
              </p>
              <h1>{t(view, nav.find((n) => n[0] === view)?.[1])}</h1>
              <p>
                {t(
                  "Información compartida, organizada y disponible para tu equipo.",
                  "Shared, organized information available to your team.",
                )}
              </p>
            </div>
          </div>
          {preview && (
            <p className="v-notice">
              {t(
                "Vista de diseño local: no guarda información.",
                "Local design preview: information is not saved.",
              )}
            </p>
          )}
          {error && (
            <p role="alert" className="v-error">
              {error}{" "}
              <button className="v-btn" onClick={() => void refresh()}>
                {t("Reintentar", "Retry")}
              </button>
            </p>
          )}
          {catalogError && (
            <p className="v-error" role="alert">
              {t(
                "No se pudo cargar el directorio de agendas:",
                "Could not load the agenda directory:",
              )}{" "}
              {catalogError}
            </p>
          )}
          {view === "Inicio" && (
            <Home
              rows={active}
              catalog={catalog}
              profile={profile}
              navigate={setView}
              openBlock={setEdit}
            />
          )}
          {view === "Agendas por establecimiento" && (
            <Agendas
              catalog={catalog}
              loading={busy}
              blocks={rows}
              openBlock={setEdit}
              writer={writer}
              refresh={refresh}
              preview={preview}
              mpo={mpo}
              focus={focus}
            />
          )}
          {view === "Profesionales" && (
            <Professionals
              catalog={catalog}
              writer={writer}
              refresh={refresh}
              preview={preview}
              openCalendar={() => setView("Agendas por establecimiento")}
            />
          )}
          {view === "Reportes" && (
            <ReportsHub
              rows={rows}
              cal={cal}
              connected={connected && !preview}
              catalog={catalog}
              sys={sys}
            />
          )}
          {view === "Bloqueos" && (
            <>
              {writer && (
                <SystemImport
                  connected={connected && !preview}
                  existingCodes={
                    new Set([
                      ...manualCodes,
                      ...sys.map((b) => b.codigo.trim().toLowerCase()),
                    ])
                  }
                  done={() => void refresh()}
                  newDisabled={!connected}
                  onNew={() => {
                    setPrefill(null);
                    setEdit(null);
                  }}
                />
              )}
              <section className="v-panel">
                <div className="v-toolbar">
                  <input
                    aria-label={t("Buscar bloqueos", "Search blocks")}
                    placeholder={t(
                      "Buscar código, profesional, profesión o agenda…",
                      "Search code, professional, profession or agenda…",
                    )}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <select
                    aria-label={t(
                      "Filtrar establecimiento",
                      "Filter establishment",
                    )}
                    value={est}
                    onChange={(e) => setEst(e.target.value)}
                  >
                    <option value="">
                      {t("Todos los establecimientos", "All establishments")}
                    </option>
                    {establishments.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <button
                    className="v-btn"
                    disabled={busy}
                    onClick={() => void refresh()}
                  >
                    ↻ {t("Actualizar", "Refresh")}
                  </button>
                </div>
                <div className="v-scroll">
                  <table className="v-table">
                    <thead>
                      <tr>
                        {[
                          t("Código", "Code"),
                          t(
                            "Profesional / profesión",
                            "Professional / profession",
                          ),
                          t("Establecimiento", "Establishment"),
                          t("Agendas", "Agendas"),
                          t("Período / horario", "Period / schedule"),
                          t("Días", "Days"),
                          t("Pacientes citados", "Scheduled patients"),
                          t("Acciones", "Actions"),
                        ].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <strong>{r.Codigo_Bloqueo}</strong>
                            <small>{r.Tipo_Bloqueo}</small>
                            {r.Es_MPO && (
                              <span className="v-badge-mpo" title={r.MPO_Nombre || "MPO"}>
                                MPO{r.MPO_Nombre ? ` · ${r.MPO_Nombre}` : ""}
                              </span>
                            )}
                          </td>
                          <td>
                            {r.Profesional}
                            <small>
                              {r.Profesion || t("Sin informar", "Unspecified")}
                            </small>
                          </td>
                          <td>
                            {r.Establecimiento}
                            <small>{r.Sector}</small>
                          </td>
                          <td>{agendaText(r)}</td>
                          <td>
                            {d(r.Fecha_Inicio)} — {d(r.Fecha_Termino)}
                            <small>
                              {r.Tipo_Horario} {r.Media_Jornada}{" "}
                              {r.Hora_Inicio &&
                                `${r.Hora_Inicio}–${r.Hora_Termino}`}
                            </small>
                          </td>
                          <td>{r.Dias_Bloqueo}</td>
                          <td>
                            {r.Pacientes_Citados ? (
                              writer ? (
                                <button
                                  className="v-link"
                                  onClick={() => openPatients(r.id)}
                                >
                                  {t(
                                    "Ver nómina por fecha",
                                    "View list by date",
                                  )}{" "}
                                  ↗
                                </button>
                              ) : (
                                t("Sí", "Yes")
                              )
                            ) : (
                              "No"
                            )}
                          </td>
                          <td>
                            <button
                              className="v-link"
                              onClick={() => setEdit(r)}
                            >
                              {writer &&
                              (advanced || r.created_by === session?.user.id)
                                ? t("Ver / editar", "View / edit")
                                : t("Ver", "View")}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {visibleSys.map((b) => {
                        const miss = missingFields(b);
                        return (
                          <tr
                            key={"s" + b.id}
                            className={
                              "v-sys-row" + (miss.length ? " v-incomplete" : "")
                            }
                          >
                            <td>
                              <strong>{b.codigo || "—"}</strong>
                              <small>{b.tipo}</small>
                              <span className="v-badge-sys">
                                {t("Archivo del sistema", "System file")}
                              </span>
                              {miss.length > 0 && (
                                <span
                                  className="v-badge-miss"
                                  title={
                                    t("Falta: ", "Missing: ") + miss.join(", ")
                                  }
                                >
                                  ⚠{" "}
                                  {t(
                                    "Información incompleta",
                                    "Incomplete information",
                                  )}
                                </span>
                              )}
                            </td>
                            <td>
                              {b.profesional || "—"}
                              <small>
                                {b.profesion ||
                                  t("Sin informar", "Unspecified")}
                              </small>
                            </td>
                            <td>{b.establecimiento || "—"}</td>
                            <td>{b.agenda || "—"}</td>
                            <td>
                              {b.fecha_inicio ? d(b.fecha_inicio) : "—"} —{" "}
                              {b.fecha_termino ? d(b.fecha_termino) : "—"}
                              <small>
                                {b.hora_inicio &&
                                  `${b.hora_inicio}–${b.hora_termino || "?"}`}
                              </small>
                            </td>
                            <td>—</td>
                            <td>—</td>
                            <td>
                              <button
                                className="v-link"
                                onClick={() => setSysDetail(b)}
                              >
                                {t("Ver", "View")}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!visible.length && !visibleSys.length && (
                  <p className="v-empty">
                    {busy
                      ? t("Cargando…", "Loading…")
                      : t(
                          "No hay bloqueos para mostrar.",
                          "There are no blocks to display.",
                        )}
                  </p>
                )}
                <footer className="v-table-footer">
                  {visible.length + visibleSys.length}{" "}
                  {t("registros", "records")}
                  {visibleSys.length > 0 &&
                    ` (${visibleSys.length} ${t("desde archivo del sistema", "from system file")}, ${visibleSys.filter((b) => missingFields(b).length).length} ${t("incompletos", "incomplete")})`}{" "}
                  · {t("Última actualización", "Last refreshed")}: {last || "—"}
                </footer>
              </section>
            </>
          )}
          {view === "Extracción Excel" && (
            <Extraction
              pdf={false}
              cal={cal}
              connected={connected && !preview}
            />
          )}
          {view === "Extracción informe completo PDF" && (
            <Extraction pdf cal={cal} connected={connected && !preview} />
          )}
          {view === "Feriados" && (
            <>
              <Holidays
                cal={cal}
                writable={writer && !preview && connected}
                changed={refresh}
              />
              <MpoPanel
                mpo={mpo}
                writable={!!writer && !preview && connected}
                changed={refresh}
              />
            </>
          )}
          {view === "Pacientes citados" && writer && (
            <Patients
              blockId={patientsBlock}
              rows={rows}
              preview={preview}
              clear={() => setPatientsBlock(undefined)}
              openCalendar={(b, day) => {
                setFocus({
                  date: day,
                  professional: String(b.Profesional),
                  establishment: String(b.Establecimiento),
                  key: Date.now(),
                });
                setView("Agendas por establecimiento");
              }}
              openBlock={setEdit}
            />
          )}
          {view === "Modo de uso" && (
            <UsageGuide role={profile?.role || "normal"} preview={preview} />
          )}
        </main>
        {!preview && profile && <Feedback page={view} />}
        <footer className="v-footer">
          Registro de bloqueos · 1.5{" "}
          <span>
            {t(
              "Lunes a sábado; sin domingos ni feriados.",
              "Monday to Saturday; excluding Sundays and holidays.",
            )}
          </span>
        </footer>
      </div>
      {sysDetail && (
        <Modal
          title={t(
            "Bloqueo desde archivo del sistema",
            "Block from system file",
          )}
          close={() => setSysDetail(null)}
        >
          <dl className="v-sys-detail">
            {(
              [
                ["Código", sysDetail.codigo],
                ["Profesional", sysDetail.profesional],
                ["Profesión", sysDetail.profesion],
                ["Establecimiento", sysDetail.establecimiento],
                ["Agenda", sysDetail.agenda],
                ["Tipo de bloqueo", sysDetail.tipo],
                [
                  "Fecha inicio",
                  sysDetail.fecha_inicio && d(sysDetail.fecha_inicio),
                ],
                [
                  "Fecha término",
                  sysDetail.fecha_termino && d(sysDetail.fecha_termino),
                ],
                [
                  "Horario",
                  sysDetail.hora_inicio &&
                    `${sysDetail.hora_inicio}–${sysDetail.hora_termino}`,
                ],
                ["Observación", sysDetail.observacion],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className={v ? "" : "v-incomplete"}>
                <dt>{k}</dt>
                <dd>{v || t("Falta información", "Missing")}</dd>
              </div>
            ))}
          </dl>
          {missingFields(sysDetail).length > 0 && (
            <p className="v-error">
              ⚠ {t("Información incompleta. Falta: ", "Incomplete. Missing: ")}
              {missingFields(sysDetail).join(", ")}.{" "}
              {t(
                "Se completará automáticamente si un próximo archivo trae esos datos, o puedes completarlo ahora.",
                "It will be completed automatically if a later file includes that data, or you can complete it now.",
              )}
            </p>
          )}
          {writer && (
            <footer className="v-form-actions">
              <button
                className="v-btn primary"
                disabled={!connected}
                onClick={() => {
                  const b = sysDetail;
                  const est = establishments.find(
                    (e) => e.toLowerCase() === b.establecimiento.toLowerCase(),
                  );
                  const tipo = b.tipo.trim().toUpperCase();
                  setPrefill({
                    Codigo_Bloqueo: b.codigo,
                    Establecimiento: est || "",
                    Profesional: b.profesional,
                    Profesion: b.profesion,
                    Agendas: [b.agenda || ""],
                    Tipo_Bloqueo: types.includes(tipo)
                      ? tipo
                      : b.tipo
                        ? "OTRO: " + b.tipo
                        : "",
                    Observacion: b.observacion,
                    Fecha_Inicio: b.fecha_inicio || today(),
                    Fecha_Termino: b.fecha_termino || b.fecha_inicio || today(),
                    ...(b.hora_inicio && b.hora_termino
                      ? {
                          Tipo_Horario: "RANGO HORARIO",
                          Hora_Inicio: b.hora_inicio,
                          Hora_Termino: b.hora_termino,
                        }
                      : {}),
                  });
                  setSysDetail(null);
                  setEdit(null);
                }}
              >
                {t("Completar y registrar en la app", "Complete and register")}
              </button>
            </footer>
          )}
        </Modal>
      )}
      {modal === "profile" && profile && (
        <Modal
          title={t("Mi perfil", "My profile")}
          close={() => setModal(null)}
        >
          <ProfileEditor
            profile={profile}
            preview={preview}
            changed={refresh}
          />
        </Modal>
      )}
      {modal === "settings" && (
        <Modal
          title={t("Configuración", "Settings")}
          close={() => setModal(null)}
        >
          <Settings />
        </Modal>
      )}
      {modal === "access" && advanced && (
        <Modal
          title={t("Administrar accesos", "Manage access")}
          close={() => setModal(null)}
        >
          <Access preview={preview} changed={refresh} />
        </Modal>
      )}
      {edit !== undefined && (
        <RecordEditor
          row={edit}
          initial={edit ? undefined : prefill || undefined}
          mpo={mpo}
          catalog={catalog}
          rows={rows}
          cal={cal}
          connected={connected && !preview}
          writable={
            !!writer &&
            (!edit || !!advanced || edit.created_by === session?.user.id)
          }
          close={() => {
            setEdit(undefined);
            setPrefill(null);
          }}
          saved={async () => {
            setEdit(undefined);
            setPrefill(null);
            await refresh();
          }}
          openPatients={openPatients}
        />
      )}
    </div>
  );
}
function Chart({
  title,
  data,
}: {
  title: string;
  data: { name: string; count: number }[];
}) {
  const { t } = useLanguage();
  const max = Math.max(1, ...data.map((g) => g.count));
  return (
    <article className="v-panel v-chart">
      <h2>{title}</h2>
      <div>
        {data.length ? (
          data.map((g) => (
            <div className="v-chart-row" key={g.name}>
              <span>{g.name}</span>
              <div>
                <i style={{ width: `${(g.count / max) * 100}%` }} />
              </div>
              <strong>{g.count}</strong>
            </div>
          ))
        ) : (
          <p className="v-empty">
            {t("Aún no hay información.", "No information yet.")}
          </p>
        )}
      </div>
    </article>
  );
}
function RecordEditor({
  catalog,
  initial,
  mpo,
  row,
  rows,
  cal,
  connected,
  writable,
  close,
  saved,
  openPatients,
}: {
  row: RecordRow | null;
  initial?: Partial<Data>;
  mpo: api.MpoDate[];
  catalog: AgendaCatalog;
  rows: RecordRow[];
  cal: Calendar;
  connected: boolean;
  writable: boolean;
  close: () => void;
  saved: () => Promise<void>;
  openPatients: (id: string) => void;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState<Data>(
    row
      ? {
          ...row,
          Agendas: row.Agendas?.length
            ? row.Agendas
            : [String(row.Agenda || "")],
        }
      : ({ ...empty(), ...(initial || {}) } as Data),
  );
  const [otherType, setOtherType] = useState(
    isOtherType(row?.Tipo_Bloqueo ?? initial?.Tipo_Bloqueo),
  );
  const otherText = String(form.Tipo_Bloqueo || "").replace(/^OTRO:\s*/i, "");
  const [docs, setDocs] = useState<PendingDocument[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reading, setReading] = useState(false),
    [success, setSuccess] = useState("");
  const update = (f: string, v: unknown) => setForm((s) => ({ ...s, [f]: v }));
  const agendas = form.Agendas || [""];
  const profKey = String(form.Profesional || "").trim().toLowerCase();
  const enabledAgendas = [
    ...new Map(
      (catalog.rules || [])
        .filter(
          (r) =>
            r.establishment === form.Establecimiento &&
            r.starts_on <= String(form.Fecha_Termino || form.Fecha_Inicio) &&
            r.ends_on >= String(form.Fecha_Inicio) &&
            !r.source_blocked &&
            catalog.professionals.some(
              (p) =>
                p.id === r.professional_id &&
                [p.name, ...(p.aliases || [])].some(
                  (n) => n.trim().toLowerCase() === profKey,
                ),
            ),
        )
        .map((r) => [r.agenda_code, r]),
    ).values(),
    // Agendas activas (no bloqueadas) cargadas desde el PDF por recurso.
    ...new Map(
      catalog.sessions
        .filter(
          (s) =>
            s.establishment === form.Establecimiento &&
            s.service_day >= String(form.Fecha_Inicio) &&
            s.service_day <= String(form.Fecha_Termino || form.Fecha_Inicio) &&
            !s.source_blocked &&
            catalog.professionals.some(
              (p) =>
                p.id === s.professional_id &&
                [p.name, ...(p.aliases || [])].some(
                  (n) => n.trim().toLowerCase() === profKey,
                ),
            ),
        )
        .map((s) => [
          s.agenda_name,
          { agenda_code: s.agenda_name, agenda_name: s.agenda_code },
        ]),
    ).values(),
  ].sort((a, b) => a.agenda_name.localeCompare(b.agenda_name));
  const agendaNames = (catalog.agenda_names || []).filter(
    (n) => !enabledAgendas.some((r) => r.agenda_code === n),
  );
  const [stage, setStage] = useState(0);
  let days = 0,
    dayError = "";
  try {
    days = validate(
      {
        ...form,
        Agendas: ["valid"],
        Profesion: form.Profesion || "valid",
        Establecimiento: form.Establecimiento || establishments[0],
        Profesional: form.Profesional || "valid",
        Codigo_Bloqueo: form.Codigo_Bloqueo || "valid",
        Tipo_Bloqueo: form.Tipo_Bloqueo || types[0],
        Media_Jornada: form.Media_Jornada || "AM",
      },
      cal,
    ).Dias_Bloqueo as number;
  } catch (e) {
    dayError = errorText(e);
  }
  async function attach(files: FileList | null) {
    if (!files) return;
    setError("");
    if (docs.length + files.length > 10) {
      setError(
        t("Máximo 10 archivos por bloqueo.", "Maximum 10 files per block."),
      );
      return;
    }
    setReading(true);
    try {
      const next: PendingDocument[] = [];
      for (const f of Array.from(files)) {
        const doc = await readPatientPdf(f, String(form.Fecha_Inicio));
        if ([...docs, ...next].some((d) => d.sha256 === doc.sha256))
          throw new Error(
            t(
              "Este archivo ya fue agregado.",
              "This file has already been added.",
            ),
          );
        next.push(doc);
      }
      setDocs((s) => [...s, ...next]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setReading(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!row && stage !== 2) return;
    if (!writable || !connected) return;
    setBusy(true);
    setError("");
    try {
      const clean = validate(form, cal);
      if (!row && clean.Pacientes_Citados && !docs.length)
        throw new Error(
          t(
            "Adjunta al menos un PDF o HTML.",
            "Attach at least one PDF or HTML.",
          ),
        );
      for (const doc of docs)
        if (
          doc.appointment_day < String(form.Fecha_Inicio) ||
          doc.appointment_day > String(form.Fecha_Termino)
        )
          throw new Error(
            t(
              "La fecha de cada nómina debe estar dentro del bloqueo.",
              "Each list date must be within the block period.",
            ),
          );
      await api.saveRecord(clean, cal, row || undefined, undefined, docs);
      await saved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        row
          ? t("Detalle del bloqueo", "Block details")
          : t("Nuevo bloqueo", "New block")
      }
      close={() => {
        if (!busy && !reading) close();
      }}
    >
      <form onSubmit={submit} className="v-form">
        {!row && (
          <div
            className="i-wizard"
            aria-label={t("Pasos del registro", "Registration steps")}
          >
            {[
              t("Información", "Information"),
              t("Adjuntos", "Attachments"),
              t("Confirmación", "Confirmation"),
            ].map((title, i) => (
              <div
                className={stage === i ? "current" : stage > i ? "done" : ""}
                key={title}
              >
                <b>{i + 1}</b>
                <span>{title}</span>
              </div>
            ))}
          </div>
        )}

        <fieldset
          hidden={!row && stage !== 0}
          disabled={!writable || busy || reading}
        >
          <legend>{t("Datos del bloqueo", "Block information")}</legend>
          <div className="v-grid">
            <Field label={t("Código SISMAULE", "SISMAULE code")}>
              <input
                required
                value={String(form.Codigo_Bloqueo)}
                maxLength={250}
                onChange={(e) => update("Codigo_Bloqueo", e.target.value)}
              />
              <small>
                {t(
                  "Copia el código único entregado por SISMAULE.",
                  "Copy the unique SISMAULE code.",
                )}
              </small>
            </Field>
            <Field label={t("Establecimiento", "Establishment")}>
              <select
                required
                value={String(form.Establecimiento)}
                onChange={(e) => update("Establecimiento", e.target.value)}
              >
                <option value="">{t("Selecciona…", "Select…")}</option>
                {row &&
                  !establishments.includes(String(row.Establecimiento)) && (
                    <option>{String(row.Establecimiento)}</option>
                  )}
                {establishments.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field
              label={t("Sector / centro rural", "Sector / rural facility")}
            >
              <input
                value={String(form.Sector)}
                maxLength={250}
                onChange={(e) => update("Sector", e.target.value)}
              />
            </Field>
            <Field label={t("Profesional", "Professional")}>
              <input
                required
                value={String(form.Profesional)}
                maxLength={250}
                list="professionals"
                onChange={(e) => {
                  const name = e.target.value;
                  const named = catalog.professionals.filter(
                    (p) => p.name === name && p.profession,
                  );
                  const inEst = named.filter((p) =>
                    p.establishments.includes(String(form.Establecimiento)),
                  );
                  const matches = inEst.length ? inEst : named;
                  setForm({
                    ...form,
                    Profesional: name,
                    ...(matches.length === 1
                      ? { Profesion: matches[0].profession }
                      : {}),
                  });
                }}
              />
              <datalist id="professionals">
                {[
                  ...new Set([
                    ...catalog.professionals
                      .filter(
                        (p) =>
                          !form.Establecimiento ||
                          !p.establishments.length ||
                          p.establishments.includes(
                            String(form.Establecimiento),
                          ),
                      )
                      .map((p) => p.name),
                    ...rows.map((r) => String(r.Profesional)),
                  ]),
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </datalist>
            </Field>
            <Field
              label={t("Profesión del profesional", "Professional occupation")}
            >
              <input
                required
                value={form.Profesion || ""}
                maxLength={150}
                list="professions"
                onChange={(e) => update("Profesion", e.target.value)}
              />
              <datalist id="professions">
                {professions.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </datalist>
            </Field>
            <Field label={t("Tipo de bloqueo", "Block type")}>
              <select
                required
                value={otherType ? OTHER_TYPE : String(form.Tipo_Bloqueo)}
                onChange={(e) => {
                  const v = e.target.value;
                  setOtherType(v === OTHER_TYPE);
                  update("Tipo_Bloqueo", v === OTHER_TYPE ? "" : v);
                }}
              >
                <option value="">{t("Selecciona…", "Select…")}</option>
                {types.map((v) => (
                  <option key={v}>{v}</option>
                ))}
                <option value={OTHER_TYPE}>{t("OTRO (especificar)", "OTHER (specify)")}</option>
              </select>
            </Field>
            {otherType && (
              <Field label={t("Especifica el tipo de bloqueo", "Specify block type")}>
                <input
                  required
                  maxLength={240}
                  value={otherText}
                  placeholder={t("Ej.: Visita domiciliaria", "E.g. Home visit")}
                  onChange={(e) =>
                    update(
                      "Tipo_Bloqueo",
                      e.target.value.trim() ? "OTRO: " + e.target.value : "",
                    )
                  }
                />
              </Field>
            )}
            <Field label={t("¿El bloqueo corresponde a una MPO?", "Is this block part of an MPO?")}>
              <select
                value={form.Es_MPO ? "yes" : "no"}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    Es_MPO: e.target.value === "yes",
                    MPO_Nombre: e.target.value === "yes" ? s.MPO_Nombre || "" : "",
                  }))
                }
              >
                <option value="no">No</option>
                <option value="yes">{t("Sí", "Yes")}</option>
              </select>
            </Field>
            {form.Es_MPO && (
              <Field label={t("¿Cuál MPO?", "Which MPO?")}>
                <input
                  maxLength={250}
                  list="mpo-names"
                  value={form.MPO_Nombre || ""}
                  placeholder={t("Ej.: MPO de estadística", "E.g. Statistics MPO")}
                  onChange={(e) => update("MPO_Nombre", e.target.value)}
                />
                <datalist id="mpo-names">
                  {[
                    ...new Set(
                      mpo
                        .filter(
                          (m) =>
                            m.day >= String(form.Fecha_Inicio) &&
                            m.day <= String(form.Fecha_Termino),
                        )
                        .concat(mpo)
                        .map((m) => m.name),
                    ),
                  ].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </datalist>
                <small>
                  {mpo.filter(
                    (m) =>
                      m.day >= String(form.Fecha_Inicio) &&
                      m.day <= String(form.Fecha_Termino),
                  ).length
                    ? t("Hay MPO programadas en estas fechas.", "MPOs are scheduled in these dates.")
                    : t("No hay MPO registradas en estas fechas.", "No MPO recorded in these dates.")}
                </small>
              </Field>
            )}
            <Field label={t("Fecha de inicio", "Start date")}>
              <input
                type="date"
                required
                value={String(form.Fecha_Inicio)}
                onChange={(e) => update("Fecha_Inicio", e.target.value)}
              />
            </Field>
            <Field label={t("Fecha de término", "End date")}>
              <input
                type="date"
                required
                min={String(form.Fecha_Inicio)}
                value={String(form.Fecha_Termino)}
                onChange={(e) => update("Fecha_Termino", e.target.value)}
              />
            </Field>
            <div className="wide v-agendas">
              <h3>{t("Agendas incluidas", "Included agendas")}</h3>
              <p>
                {t(
                  "Un mismo código puede cubrir varias agendas, sin duplicar los días.",
                  "One code can cover several agendas without duplicating days.",
                )}
              </p>
              {agendas.map((a, i) => (
                <div key={i}>
                  <label>
                    <span>
                      {t("Agenda", "Agenda")} {i + 1}
                    </span>
                    <input
                      required
                      maxLength={250}
                      list="available-agendas"
                      value={a}
                      onChange={(e) => {
                        const values = [...agendas];
                        values[i] = e.target.value;
                        update("Agendas", values);
                      }}
                    />
                  </label>
                  {agendas.length > 1 && (
                    <button
                      type="button"
                      className="v-btn"
                      aria-label={
                        t("Quitar agenda", "Remove agenda") + ` ${i + 1}`
                      }
                      onClick={() =>
                        update(
                          "Agendas",
                          agendas.filter((_, n) => n !== i),
                        )
                      }
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <datalist id="available-agendas">
                {enabledAgendas.map((r) => (
                  <option key={r.agenda_code} value={r.agenda_code}>
                    {r.agenda_name}
                  </option>
                ))}
                {agendaNames.map((n) => (
                  <option key={"n:" + n} value={n} />
                ))}
              </datalist>
              {form.Profesional && form.Establecimiento ? (
                enabledAgendas.length ? (
                  <div className="v-agenda-suggest">
                    <span>
                      {t(
                        "Agendas habilitadas del profesional en estas fechas (toca para agregar):",
                        "Professional's enabled agendas in these dates (tap to add):",
                      )}
                    </span>
                    {enabledAgendas.map((r) => {
                      const used = agendas.includes(r.agenda_code);
                      return (
                        <button
                          type="button"
                          key={r.agenda_code}
                          className={"v-chip" + (used ? " used" : "")}
                          disabled={used || agendas.length >= 30}
                          onClick={() => {
                            const list = agendas.filter((a) => a.trim());
                            update("Agendas", [...list, r.agenda_code]);
                          }}
                        >
                          {used ? "✓ " : "＋ "}
                          {r.agenda_code} · {r.agenda_name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="v-muted">
                    {t(
                      "No se encontraron agendas habilitadas para este profesional en el establecimiento y fechas indicadas. Puedes escribir la agenda manualmente.",
                      "No enabled agendas found for this professional, establishment and dates. You can type the agenda manually.",
                    )}
                  </p>
                )
              ) : null}
              <button
                className="v-btn"
                type="button"
                disabled={agendas.length >= 30}
                onClick={() => update("Agendas", [...agendas, ""])}
              >
                ＋ {t("Agregar otra agenda", "Add another agenda")}
              </button>
            </div>
            <Field label={t("Tipo de horario", "Schedule type")}>
              <select
                value={String(form.Tipo_Horario)}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    Tipo_Horario: e.target.value,
                    Hora_Inicio: "",
                    Hora_Termino: "",
                    Media_Jornada: "",
                  }))
                }
              >
                {scheduleTypes.map((v, i) => (
                  <option key={v} value={v}>
                    {
                      [
                        t("No informado", "Not specified"),
                        t("Jornada completa", "Full day"),
                        t("Rango de horas", "Time range"),
                        t("Media jornada", "Half day"),
                      ][i]
                    }
                  </option>
                ))}
              </select>
            </Field>
            {form.Tipo_Horario === "MEDIA JORNADA" && (
              <Field label={t("Media jornada AM / PM", "Half day AM / PM")}>
                <select
                  required
                  value={form.Media_Jornada || ""}
                  onChange={(e) => update("Media_Jornada", e.target.value)}
                >
                  <option value="">{t("Selecciona…", "Select…")}</option>
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </Field>
            )}
            {form.Tipo_Horario === "RANGO HORARIO" && (
              <>
                <Field label={t("Hora de inicio", "Start time")}>
                  <input
                    type="time"
                    required
                    value={String(form.Hora_Inicio)}
                    onChange={(e) => update("Hora_Inicio", e.target.value)}
                  />
                </Field>
                <Field label={t("Hora de término", "End time")}>
                  <input
                    type="time"
                    required
                    value={String(form.Hora_Termino)}
                    onChange={(e) => update("Hora_Termino", e.target.value)}
                  />
                </Field>
              </>
            )}
            <Field label={t("Observación del bloqueo", "Block notes")} wide>
              <textarea
                maxLength={3000}
                value={String(form.Observacion)}
                onChange={(e) => update("Observacion", e.target.value)}
              />
              <small>
                {t(
                  "Los datos de pacientes se adjuntan abajo; no los escribas aquí.",
                  "Attach patient data below; do not type it here.",
                )}
              </small>
            </Field>
            <div className="v-notice wide">
              {t("Días de bloqueo", "Block days")}:{" "}
              <strong>{dayError ? "—" : days}</strong> ·{" "}
              {t(
                "Lunes a sábado, excluyendo domingos y feriados.",
                "Monday to Saturday, excluding Sundays and holidays.",
              )}
              {dayError && <p>{dayError}</p>}
            </div>
          </div>
        </fieldset>
        <section className="v-patient-upload" hidden={!row && stage !== 1}>
          <h3>{t("Pacientes citados", "Scheduled patients")}</h3>
          {row ? (
            <p>
              {row.Pacientes_Citados ? (
                <button
                  type="button"
                  className="v-link"
                  onClick={() => {
                    openPatients(row.id);
                    close();
                  }}
                >
                  {t(
                    "Ver nóminas adjuntas (solo lectura)",
                    "View attached lists (read only)",
                  )}{" "}
                  ↗
                </button>
              ) : (
                t(
                  "Este bloqueo no contiene nóminas.",
                  "This block has no patient lists.",
                )
              )}
            </p>
          ) : (
            <>
              <Field
                label={t(
                  "¿Hay pacientes citados?",
                  "Are there scheduled patients?",
                )}
              >
                <select
                  disabled={!writable || busy || reading}
                  value={form.Pacientes_Citados ? "yes" : "no"}
                  onChange={(e) => {
                    update("Pacientes_Citados", e.target.value === "yes");
                    if (e.target.value === "no") setDocs([]);
                  }}
                >
                  <option value="no">No</option>
                  <option value="yes">{t("Sí", "Yes")}</option>
                </select>
              </Field>
              {form.Pacientes_Citados && (
                <>
                  <Field
                    label={t(
                      "Adjuntar archivos PDF o HTML (varios)",
                      "Attach PDF or HTML files (multiple)",
                    )}
                  >
                    <input
                      type="file"
                      accept=".pdf,.html,.htm,application/pdf,text/html"
                      multiple
                      disabled={reading || busy || !writable}
                      onChange={(e) => {
                        void attach(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </Field>
                  <p>
                    {t(
                      "Máximo 10 archivos, 20 MB cada uno. Se conservarán originales sin edición.",
                      "Maximum 10 files, 20 MB each. Original files will be preserved without editing.",
                    )}
                  </p>
                  {reading && (
                    <p role="status">
                      {t("Leyendo archivos…", "Reading files…")}
                    </p>
                  )}
                  {docs.map((doc, i) => (
                    <div className="v-file-card" key={doc.id}>
                      <strong>{doc.original_name}</strong>
                      <small>
                        {doc.patients.length
                          ? `${doc.patients.length} ${t("pacientes leídos", "patients read")}`
                          : t(
                              "Tabla no reconocida: se conserva el original para lectura.",
                              "Table not recognized: original retained for reading.",
                            )}
                      </small>
                      <label>
                        {t("Fecha de la nómina", "List date")}
                        <input
                          type="date"
                          required
                          min={String(form.Fecha_Inicio)}
                          max={String(form.Fecha_Termino)}
                          value={doc.appointment_day}
                          onChange={(e) =>
                            setDocs((s) =>
                              s.map((d, n) =>
                                n === i
                                  ? { ...d, appointment_day: e.target.value }
                                  : d,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="v-link"
                        disabled={busy || reading}
                        onClick={() =>
                          setDocs((s) => s.filter((d) => d.id !== doc.id))
                        }
                      >
                        {t("Quitar antes de guardar", "Remove before saving")}
                      </button>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </section>
        {!row && stage === 2 && (
          <section className="i-confirm">
            <h3>{t("Revisa antes de guardar", "Review before saving")}</h3>
            <dl>
              {[
                [t("Código SISMAULE", "SISMAULE code"), form.Codigo_Bloqueo],
                [t("Profesional", "Professional"), form.Profesional],
                [t("Establecimiento", "Establishment"), form.Establecimiento],
                [t("Profesión", "Profession"), form.Profesion],
                [t("Tipo de bloqueo", "Block type"), form.Tipo_Bloqueo],
                ["MPO", form.Es_MPO ? t("Sí", "Yes") + (form.MPO_Nombre ? " · " + form.MPO_Nombre : "") : "No"],
                [t("Agendas", "Agendas"), agendas.join(" · ")],
                [
                  t("Período", "Period"),
                  `${form.Fecha_Inicio} — ${form.Fecha_Termino}`,
                ],
                [
                  t("Horario", "Schedule"),
                  `${form.Tipo_Horario} ${form.Media_Jornada || ""} ${form.Hora_Inicio || ""} ${form.Hora_Termino || ""}`,
                ],
                [t("Nóminas", "Patient lists"), String(docs.length)],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt>{label}</dt>
                  <dd>{value || "—"}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {error && (
          <p className="v-error" role="alert">
            {error}
          </p>
        )}
        {success && <p role="status">{success}</p>}
        <footer className="v-form-actions">
          <button
            type="button"
            className="v-btn"
            disabled={busy || reading}
            onClick={close}
          >
            {t("Cerrar", "Close")}
          </button>
          {!row && stage > 0 && (
            <button
              type="button"
              className="v-btn"
              disabled={busy || reading}
              onClick={() => setStage(stage - 1)}
            >
              {t("Atrás", "Back")}
            </button>
          )}
          {!row && stage < 2 && (
            <button
              type="button"
              className="v-btn primary"
              disabled={busy || reading}
              onClick={(e) => {
                const formElement = e.currentTarget.form;
                if (stage === 0 || stage === 1) {
                  const inputs = Array.from(
                    formElement
                      ?.querySelector(
                        stage === 0 ? "fieldset" : ".v-patient-upload",
                      )
                      ?.querySelectorAll<
                        HTMLInputElement | HTMLSelectElement
                      >("input,select,textarea") || [],
                  );
                  for (const input of inputs) {
                    if (!input.checkValidity()) {
                      input.reportValidity();
                      return;
                    }
                  }
                }
                if (stage === 0) {
                  try {
                    validate(form, cal);
                  } catch (e) {
                    setError(errorText(e));
                    return;
                  }
                }
                if (
                  stage === 1 &&
                  form.Pacientes_Citados &&
                  docs.length === 0
                ) {
                  setError(t("Adjunta una nómina.", "Attach a patient list."));
                  return;
                }
                setError("");
                setStage(stage + 1);
              }}
            >
              {t("Siguiente", "Next")} →
            </button>
          )}
          {writable && (row || stage === 2) && (
            <button
              className="v-btn primary"
              disabled={!connected || busy || reading}
            >
              {busy
                ? t("Guardando…", "Saving…")
                : t("Guardar bloqueo", "Save block")}
            </button>
          )}
        </footer>
      </form>
    </Modal>
  );
}
function Extraction({
  pdf,
  cal,
  connected,
}: {
  pdf: boolean;
  cal: Calendar;
  connected: boolean;
}) {
  const { t, lang } = useLanguage();
  const [from, setFrom] = useState(""),
    [until, setUntil] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const rows = await api.records(from, until);
      if (pdf) {
        const { reportPdf } = await import("./reports.ts");
        reportPdf(rows, from, until, cal, lang).save(
          `informe-bloqueos-${from}-${until}.pdf`,
        );
      } else
        download(
          new Blob([buildXlsx(rows, from, until) as BlobPart], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
          `bloqueos-${from}-${until}.xlsx`,
        );
      setNotice(
        `${rows.length} ${t("bloqueos incluidos.", "blocks included.")}`,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="v-panel v-pad">
      <h2>
        {pdf
          ? t("Informe completo de bloqueos", "Full block report")
          : t("Tabla de información en Excel", "Excel data table")}
      </h2>
      <p>
        {t(
          "Selecciona el rango. Incluye bloqueos que coinciden con esas fechas y conserva su período original completo. Las nóminas de pacientes se consultan en su espacio privado y no se incluyen en estos informes.",
          "Choose a date range. Includes overlapping blocks and preserves their original full periods. Patient lists are available in their private workspace and are not included in these reports.",
        )}
      </p>
      <form className="v-form" onSubmit={run}>
        <div className="v-grid">
          <Field label={t("Desde", "From")}>
            <input
              type="date"
              value={from}
              required
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label={t("Hasta", "To")}>
            <input
              type="date"
              value={until}
              required
              min={from}
              onChange={(e) => setUntil(e.target.value)}
            />
          </Field>
        </div>
        <button className="v-btn primary" disabled={busy || !connected}>
          {busy
            ? t("Generando…", "Generating…")
            : pdf
              ? t("Descargar informe PDF", "Download PDF report")
              : t("Descargar Excel", "Download Excel")}
        </button>
      </form>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="v-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
function Patients({
  blockId,
  rows,
  preview,
  clear,
  openCalendar,
  openBlock,
}: {
  blockId?: string;
  rows: RecordRow[];
  preview: boolean;
  clear: () => void;
  openCalendar: (b: RecordRow, day: string) => void;
  openBlock: (b: RecordRow) => void;
}) {
  const { t } = useLanguage();
  const [docs, setDocs] = useState<PatientDocument[]>([]),
    [day, setDay] = useState(""),
    [selected, setSelected] = useState(""),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setDay("");
    setSelected("");
    setDocs([]);
    if (preview) {
      setBusy(false);
      return;
    }
    api
      .patientDocuments(blockId)
      .then((d) => {
        if (alive) setDocs(d);
      })
      .catch((e) => {
        if (alive) setError(errorText(e));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [blockId, preview]);
  const shown = docs.filter((d) => !day || d.appointment_day === day);
  const doc = shown.find((d) => d.id === selected) || shown[0];
  const docBlock = doc ? rows.find((r) => r.id === doc.bloqueo_id) : undefined;
  return (
    <section className="v-panel v-pad">
      <h2>
        {t("Nóminas de pacientes · solo lectura", "Patient lists · read only")}
      </h2>
      <p>
        {t(
          "Los datos provienen del archivo adjunto. No se pueden editar, sustituir ni eliminar desde este espacio.",
          "Data comes from the attached file. It cannot be edited, replaced or deleted from this workspace.",
        )}
      </p>
      {blockId && (
        <button className="v-link" onClick={clear}>
          {t("Ver todos los bloqueos", "View all blocks")}
        </button>
      )}
      <div className="v-toolbar">
        <Field label={t("Fecha de nómina", "List date")}>
          <input
            type="date"
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              setSelected("");
            }}
          />
        </Field>
        <Field label={t("Archivo / bloqueo", "File / block")}>
          <select
            value={doc?.id || ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">
              {t("Selecciona un archivo", "Select a file")}
            </option>
            {shown.map((d) => (
              <option key={d.id} value={d.id}>
                {d.appointment_day} ·{" "}
                {rows.find((r) => r.id === d.bloqueo_id)?.Codigo_Bloqueo} ·{" "}
                {d.original_name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {busy && <p>{t("Cargando…", "Loading…")}</p>}
      {error && <p className="v-error">{error}</p>}
      {!busy && !shown.length && (
        <p className="v-empty">
          {t(
            "No hay nóminas para esta selección.",
            "No patient lists for this selection.",
          )}
        </p>
      )}
      {!!shown.length && (
        <div className="v-scroll">
          <table className="v-table">
            <thead>
              <tr>
                {[
                  t("Fecha", "Date"),
                  t("Profesional", "Professional"),
                  t("Establecimiento", "Establishment"),
                  t("Agenda(s)", "Agenda(s)"),
                  t("Bloqueo", "Block"),
                  t("Pacientes", "Patients"),
                  t("Ir a", "Go to"),
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => {
                const b = rows.find((r) => r.id === x.bloqueo_id);
                return (
                  <tr key={x.id} className={x.id === doc?.id ? "v-row-selected" : ""}>
                    <td>{d(x.appointment_day)}</td>
                    <td>
                      {b ? (
                        <button
                          className="v-link"
                          title={t("Abrir en el calendario", "Open in calendar")}
                          onClick={() => openCalendar(b, x.appointment_day)}
                        >
                          {b.Profesional} ↗
                        </button>
                      ) : (
                        "—"
                      )}
                      <small>{b?.Profesion}</small>
                    </td>
                    <td>{b?.Establecimiento || "—"}</td>
                    <td>{b ? agendaText(b) : "—"}</td>
                    <td>
                      {b ? (
                        <button className="v-link" onClick={() => openBlock(b)}>
                          {b.Codigo_Bloqueo}
                        </button>
                      ) : (
                        "—"
                      )}
                      <small>{b?.Tipo_Bloqueo}</small>
                    </td>
                    <td>{x.patients.length}</td>
                    <td>
                      <button className="v-link" onClick={() => setSelected(x.id)}>
                        {t("Ver nómina", "View list")}
                      </button>
                      {b && (
                        <>
                          {" · "}
                          <button
                            className="v-link"
                            onClick={() => openCalendar(b, x.appointment_day)}
                          >
                            {t("Calendario", "Calendar")} ↗
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {doc && (
        <>
          <div className="v-file-heading">
            <div>
              <strong>{doc.original_name}</strong>
              <small>
                {t("Bloqueo", "Block")}:{" "}
                {rows.find((r) => r.id === doc.bloqueo_id)?.Codigo_Bloqueo} ·{" "}
                {d(doc.appointment_day)} · {doc.patients.length}{" "}
                {t("filas", "rows")}
              </small>
            </div>
            {docBlock && (
              <button
                className="v-btn"
                onClick={() => openCalendar(docBlock, doc.appointment_day)}
              >
                {t("Ver agenda y bloqueo en calendario", "View agenda and block in calendar")} ↗
              </button>
            )}
            <button
              className="v-btn"
              onClick={() => {
                void api
                  .downloadPatientDocument(doc)
                  .then((blob) => download(blob, doc.original_name))
                  .catch((e) => setError(errorText(e)));
              }}
            >
              {t("Descargar original", "Download original")}
            </button>
          </div>
          {doc.extraction_status === "table" ? (
            <>
              <input
                className="v-search"
                aria-label={t("Buscar en nómina", "Search patient list")}
                placeholder={t(
                  "Buscar nombre, RUT, agenda o citación…",
                  "Search name, ID, agenda or appointment…",
                )}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="v-scroll">
                <table className="v-table patient-table">
                  <thead>
                    <tr>
                      <th>{t("Calendario", "Calendar")}</th>
                      {(doc.headers || patientHeaders).map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {doc.patients
                      .filter((r) =>
                        r
                          .join(" ")
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((r, i) => (
                        <tr key={i}>
                          <td>
                            {docBlock ? (
                              <button
                                className="v-link"
                                title={t(
                                  "Ver profesional, agenda y bloqueo en el calendario",
                                  "View professional, agenda and block in calendar",
                                )}
                                onClick={() => openCalendar(docBlock, doc.appointment_day)}
                              >
                                ↗ {String(docBlock.Profesional || "").split(" ")[0]}
                              </button>
                            ) : (
                              "—"
                            )}
                          </td>
                          {r.map((cell, j) => (
                            <td key={j}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="v-notice">
              {t(
                "El formato del archivo no permitió reconstruir la tabla de forma confiable. Descarga el original para consultarlo; no se han inventado ni corregido datos. Si es un PDF escaneado, prueba adjuntar la versión HTML al crear el bloqueo.",
                "This file could not be reliably reconstructed as a table. Download the original to read it; no data has been invented or corrected. For scanned PDFs, try attaching the HTML version when creating the block.",
              )}
            </p>
          )}
          <small className="v-hash">SHA-256: {doc.sha256}</small>
        </>
      )}
    </section>
  );
}
function Holidays({
  cal,
  writable,
  changed,
}: {
  cal: Calendar;
  writable: boolean;
  changed: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [year, setYear] = useState(new Date().getFullYear()),
    [date, setDate] = useState(""),
    [name, setName] = useState(""),
    [source, setSource] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const execute = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await changed();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="v-panel v-pad">
      <h2>{t("Calendario anual", "Annual calendar")}</h2>
      <p>
        {t(
          "Los días se cuentan de lunes a sábado. Al cambiar un feriado, revisa y confirma el año para recalcular los bloqueos.",
          "Days are counted Monday to Saturday. After changing a holiday, review and confirm the year to recalculate blocks.",
        )}
      </p>
      <Field label={t("Año", "Year")}>
        <input
          type="number"
          min="2000"
          max="2100"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        />
      </Field>
      <p className="v-notice">
        {cal.years.find((y) => y.year === year)?.reviewed
          ? t("Calendario confirmado", "Calendar confirmed")
          : t(
              "Pendiente de revisión y confirmación",
              "Pending review and confirmation",
            )}
      </p>
      <table className="v-table">
        <thead>
          <tr>
            <th>{t("Fecha", "Date")}</th>
            <th>{t("Feriado", "Holiday")}</th>
            <th>{t("Fuente", "Source")}</th>
            {writable && <th>{t("Acción", "Action")}</th>}
          </tr>
        </thead>
        <tbody>
          {cal.holidays
            .filter((h) => h.day.startsWith(String(year)))
            .map((h) => (
              <tr key={h.day}>
                <td>{d(h.day)}</td>
                <td>{h.name}</td>
                <td>{h.source}</td>
                {writable && (
                  <td>
                    <button
                      className="v-link"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            t(
                              "¿Quitar este feriado del calendario? Puedes volver a agregarlo.",
                              "Remove this holiday? You can add it again.",
                            ),
                          )
                        )
                          void execute(() => api.removeHoliday(h.day));
                      }}
                    >
                      {t("Quitar", "Remove")}
                    </button>
                  </td>
                )}
              </tr>
            ))}
        </tbody>
      </table>
      {writable && (
        <>
          <form
            className="v-form"
            onSubmit={(e) => {
              e.preventDefault();
              void execute(async () => {
                await api.saveHoliday(date, name, source);
                setName("");
                setDate("");
              });
            }}
          >
            <div className="v-grid">
              <Field label={t("Fecha del feriado", "Holiday date")}>
                <input
                  required
                  type="date"
                  min={`${year}-01-01`}
                  max={`${year}-12-31`}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field label={t("Nombre del feriado", "Holiday name")}>
                <input
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label={t("Fuente de revisión", "Review source")} wide>
                <input
                  required
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder={t(
                    "Documento o enlace oficial consultado",
                    "Official document or link consulted",
                  )}
                />
              </Field>
            </div>
            <button className="v-btn" disabled={busy}>
              {t("Guardar feriado", "Save holiday")}
            </button>
          </form>
          <button
            className="v-btn primary"
            disabled={busy || !source.trim()}
            onClick={() => void execute(() => api.reviewYear(year, source))}
          >
            {t("Confirmar calendario revisado", "Confirm reviewed calendar")}
          </button>
        </>
      )}
      {error && (
        <p className="v-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
function ProfileEditor({
  profile,
  preview,
  changed,
}: {
  profile: Profile;
  preview: boolean;
  changed: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState(profile.display_name),
    [phone, setPhone] = useState(profile.phone || ""),
    [email, setEmail] = useState(profile.email),
    [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>, message: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (preview)
        throw new Error(
          t(
            "La vista de diseño no guarda cambios.",
            "Design preview does not save changes.",
          ),
        );
      await fn();
      setNotice(message);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="v-form">
      <p>
        {t(
          "Tu permiso de acceso lo define la administradora.",
          "Your access level is assigned by the administrator.",
        )}{" "}
        {roleLabel(profile.role)}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            async () => {
              await api.updateOwnProfile(name, phone);
              await changed();
            },
            t("Perfil guardado.", "Profile saved."),
          );
        }}
      >
        <div className="v-grid">
          <Field label={t("Nombre", "Name")}>
            <input
              required
              maxLength={150}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={t("Número telefónico", "Phone number")}>
            <input
              type="tel"
              maxLength={30}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>
        <p className="v-muted">
          {t(
            "El teléfono queda como dato de contacto. La recuperación de cuenta se realiza por correo; SMS aún no está habilitado.",
            "Phone is stored as contact information. Account recovery uses email; SMS is not enabled yet.",
          )}
        </p>
        <button className="v-btn primary" disabled={busy}>
          {t("Guardar perfil", "Save profile")}
        </button>
      </form>
      <hr />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            async () => {
              const r = await api.supabase!.auth.updateUser(
                { email: email.trim().toLowerCase() },
                { emailRedirectTo: location.origin + "/" },
              );
              if (r.error) throw r.error;
            },
            t(
              "Confirma el cambio en los correos solicitados por Supabase. Tu acceso se conserva con el mismo identificador de cuenta.",
              "Confirm the change in the emails requested by Supabase. Your access remains linked to the same account ID.",
            ),
          );
        }}
      >
        <Field label={t("Actualizar correo", "Update email")}>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <button className="v-btn" disabled={busy || email === profile.email}>
          {t("Solicitar cambio de correo", "Request email change")}
        </button>
      </form>
      <hr />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            async () => {
              if (password !== repeat)
                throw new Error(
                  t("Las contraseñas no coinciden.", "Passwords do not match."),
                );
              const r = await api.supabase!.auth.updateUser({ password });
              if (r.error) throw r.error;
              setPassword("");
              setRepeat("");
            },
            t("Contraseña actualizada.", "Password updated."),
          );
        }}
      >
        <div className="v-grid">
          <Field label={t("Nueva contraseña", "New password")}>
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label={t("Repetir contraseña", "Repeat password")}>
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </Field>
        </div>
        <p>{t("Usa al menos 12 caracteres.", "Use at least 12 characters.")}</p>
        <button className="v-btn" disabled={busy}>
          {t("Actualizar clave", "Update password")}
        </button>
      </form>
      {notice && (
        <p className="v-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="v-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
function Settings() {
  const { t } = useLanguage();
  const [p, setP] = useState<Preferences>(readPreferences),
    [error, setError] = useState("");
  function change(next: Preferences) {
    setP(next);
    if (!savePreferences(next))
      setError(
        t(
          "El navegador no permitió guardar las preferencias.",
          "The browser could not save your preferences.",
        ),
      );
  }
  return (
    <div className="v-form">
      <Field label={t("Idioma", "Language")}>
        <select
          value={p.language}
          onChange={(e) =>
            change({ ...p, language: e.target.value as "es" | "en" })
          }
        >
          <option value="es">Español</option>
          <option value="en">English</option>
        </select>
      </Field>
      <h3>{t("Accesibilidad", "Accessibility")}</h3>
      <Field label={t("Tamaño del texto", "Text size")}>
        <select
          value={p.text}
          onChange={(e) =>
            change({ ...p, text: e.target.value as Preferences["text"] })
          }
        >
          <option value="normal">{t("Normal", "Normal")}</option>
          <option value="large">{t("Grande", "Large")}</option>
          <option value="extra">{t("Muy grande", "Extra large")}</option>
        </select>
      </Field>
      <label className="v-check">
        <input
          type="checkbox"
          checked={p.contrast}
          onChange={(e) => change({ ...p, contrast: e.target.checked })}
        />
        {t("Alto contraste", "High contrast")}
      </label>
      <label className="v-check">
        <input
          type="checkbox"
          checked={p.reduceMotion}
          onChange={(e) => change({ ...p, reduceMotion: e.target.checked })}
        />
        {t("Reducir animaciones", "Reduce motion")}
      </label>
      <p>
        {t(
          "Estas preferencias se guardan en este navegador. Los nombres, agendas y archivos originales conservan su idioma.",
          "These preferences are saved in this browser. Names, agendas and original files retain their language.",
        )}
      </p>
      {error && <p className="v-error">{error}</p>}
    </div>
  );
}
function Access({
  preview,
  changed,
}: {
  preview: boolean;
  changed: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [list, setList] = useState<Profile[]>([]),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [role, setRole] = useState<"normal" | "administrativo">("normal"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (preview) return;
    try {
      setList(await api.profiles());
    } catch (e) {
      setError(errorText(e));
    }
  }, [preview]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (p: Profile) => {
    setBusy(true);
    setError("");
    try {
      if (preview) throw new Error("Vista de diseño");
      await api.saveProfile(p);
      await load();
      await changed();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="v-form">
      <p>
        {t(
          "Solo tu cuenta puede tener acceso avanzado. Los demás perfiles serán Solo vista o Administrativo.",
          "Only your account can have advanced access. Other profiles are View only or Administrative.",
        )}
      </p>
      <table className="v-table">
        <thead>
          <tr>
            <th>{t("Nombre / correo", "Name / email")}</th>
            <th>{t("Permiso", "Permission")}</th>
            <th>{t("Activo", "Active")}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.email}>
              <td>
                {p.display_name}
                <small>{p.email}</small>
              </td>
              <td>
                {p.role === "avanzado" ? (
                  roleLabel(p.role)
                ) : (
                  <select
                    disabled={busy}
                    value={p.role}
                    aria-label={
                      t("Permiso de", "Permission for") + " " + p.email
                    }
                    onChange={(e) =>
                      void save({
                        ...p,
                        role: e.target.value as Profile["role"],
                      })
                    }
                  >
                    <option value="normal">
                      {t("Solo vista", "View only")}
                    </option>
                    <option value="administrativo">
                      {t("Administrativo", "Administrative")}
                    </option>
                  </select>
                )}
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label={
                    t("Acceso activo de", "Active access for") + " " + p.email
                  }
                  disabled={busy || p.role === "avanzado"}
                  checked={p.active}
                  onChange={(e) =>
                    void save({ ...p, active: e.target.checked })
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>{t("Autorizar un correo", "Authorize an email")}</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save({ email, display_name: name, role, active: true });
        }}
      >
        <div className="v-grid">
          <Field label={t("Nombre", "Name")}>
            <input
              required
              maxLength={150}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={t("Correo", "Email")}>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label={t("Permiso", "Permission")}>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              <option value="normal">{t("Solo vista", "View only")}</option>
              <option value="administrativo">
                {t("Administrativo", "Administrative")}
              </option>
            </select>
          </Field>
        </div>
        <button disabled={busy || preview} className="v-btn primary">
          {t("Guardar acceso", "Save access")}
        </button>
      </form>
      <p>
        {t(
          "Luego, la persona crea su contraseña en “Primera vez” con ese mismo correo y confirma el mensaje recibido.",
          "The person then creates a password using “First time” with the same email and confirms the received message.",
        )}
      </p>
      {error && <p className="v-error">{error}</p>}
    </div>
  );
}
