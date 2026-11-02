// Versión 1.5: observaciones, guía por perfil, MPO y carga manual de agendas desde imagen.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "./api.ts";
import { establishments, chileToday, type Role } from "./model.ts";
import type { AgendaCatalog } from "./agenda-model.ts";
import { useLanguage } from "./language.ts";

export const CONTACT = {
  name: "Javiera Contreras Apablaza",
  email: "jcontreras@saludparral.cl",
  role: "Administradora de la plataforma · Departamento de Salud Comunal de Parral",
};
const err = (e: unknown) =>
  e instanceof Error ? e.message : "No se pudo completar la operación.";
const dmy = (v: string) => v.split("-").reverse().join("/");
const weekdays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/* ---------- Burbuja de observaciones ---------- */
export function Feedback({ page }: { page: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  async function send() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.sendObservation(text, page);
      setText("");
      setNotice(
        t(
          "¡Gracias! Tu observación fue enviada a la administradora. Te responderá a tu correo.",
          "Thanks! Your note was sent to the administrator. She will reply to your email.",
        ),
      );
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={"fb-wrap" + (open ? " open" : "")}>
      {open && (
        <section className="fb-card" role="dialog" aria-label={t("Enviar observación", "Send a note")}>
          <header>
            <strong>{t("Observaciones", "Feedback")}</strong>
            <button className="v-icon" aria-label={t("Cerrar", "Close")} onClick={() => setOpen(false)}>
              ×
            </button>
          </header>
          <p>
            {t(
              "Cuéntanos una duda, un error o una sugerencia. Tu nombre y correo se adjuntan automáticamente.",
              "Tell us about a question, an error or a suggestion. Your name and email are attached automatically.",
            )}
          </p>
          <textarea
            maxLength={3000}
            rows={5}
            value={text}
            placeholder={t("Escribe tu observación…", "Write your note…")}
            onChange={(e) => setText(e.target.value)}
          />
          <small>
            {t("Sección actual", "Current section")}: {page}
          </small>
          {notice && <p className="v-ok">{notice}</p>}
          {error && <p className="v-error">{error}</p>}
          <button className="v-btn primary" disabled={busy || !text.trim()} onClick={() => void send()}>
            {busy ? t("Enviando…", "Sending…") : t("Enviar observación", "Send")}
          </button>
        </section>
      )}
      <button
        className="fb-bubble"
        aria-expanded={open}
        title={t("Enviar observación a la administradora", "Send a note to the administrator")}
        onClick={() => {
          setOpen(!open);
          setNotice("");
        }}
      >
        {open ? "×" : "💬"}
      </button>
    </div>
  );
}

/* ---------- Bandeja de observaciones (solo avanzada) ---------- */
function Inbox() {
  const { t } = useLanguage();
  const [list, setList] = useState<api.Observation[]>([]),
    [error, setError] = useState(""),
    [filter, setFilter] = useState<"" | api.Observation["status"]>("");
  const load = async () => {
    try {
      setList(await api.observations());
    } catch (e) {
      setError(err(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const mark = async (o: api.Observation, status: api.Observation["status"]) => {
    try {
      await api.markObservation(o.id, status);
      await load();
    } catch (e) {
      setError(err(e));
    }
  };
  const shown = list.filter((o) => !filter || o.status === filter);
  return (
    <section className="v-panel v-pad">
      <div className="i-section-heading">
        <h2>
          {t("Bandeja de observaciones", "Feedback inbox")}{" "}
          <span className="v-badge-mpo">{list.filter((o) => o.status === "nueva").length} {t("nuevas", "new")}</span>
        </h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="">{t("Todas", "All")}</option>
          <option value="nueva">{t("Nuevas", "New")}</option>
          <option value="leida">{t("Leídas", "Read")}</option>
          <option value="respondida">{t("Respondidas", "Answered")}</option>
        </select>
      </div>
      {error && <p className="v-error">{error}</p>}
      {!shown.length && <p className="v-empty">{t("Sin observaciones.", "No feedback.")}</p>}
      {shown.map((o) => (
        <article key={o.id} className={"fb-item " + o.status}>
          <header>
            <strong>{o.display_name}</strong> <small>{o.email} · {o.role} · {o.page}</small>
            <small>{new Date(o.created_at).toLocaleString("es-CL", { timeZone: "America/Santiago" })}</small>
          </header>
          <p>{o.message}</p>
          <footer>
            <a
              className="v-btn primary"
              href={`mailto:${o.email}?subject=${encodeURIComponent("Re: tu observación en Registro de bloqueos")}&body=${encodeURIComponent(`\n\n---\n${o.display_name} escribió (${o.page}):\n${o.message}`)}`}
              onClick={() => void mark(o, "respondida")}
            >
              ✉ {t("Responder por correo", "Reply by email")}
            </a>
            {o.status === "nueva" && (
              <button className="v-btn" onClick={() => void mark(o, "leida")}>
                {t("Marcar leída", "Mark read")}
              </button>
            )}
            <span className={"fb-status " + o.status}>{o.status}</span>
          </footer>
        </article>
      ))}
    </section>
  );
}

/* ---------- Modo de uso por perfil ---------- */
type Section = [string, ReactNode];
const Steps = ({ items }: { items: string[] }) => (
  <ol>
    {items.map((i) => (
      <li key={i}>{i}</li>
    ))}
  </ol>
);
export function UsageGuide({ role, preview }: { role: Role; preview: boolean }) {
  const { t } = useLanguage();
  const common: Section[] = [
    [
      "Entrar y cuidar tu cuenta",
      <Steps
        items={[
          "Ingresa con tu correo y contraseña. La primera vez usa “Primera vez: crear contraseña” con el correo que autorizó la administradora y confirma el mensaje que llega a tu bandeja.",
          "Si olvidaste tu clave, usa “Olvidé mi contraseña”. Nunca compartas tu clave: el historial registra quién hace cada cambio.",
          "Arriba a la derecha, el círculo con tus iniciales abre: Perfil (nombre, teléfono, correo y clave), Configuración (idioma, tamaño de texto, contraste, animaciones) y Cerrar sesión.",
        ]}
      />,
    ],
    [
      "Inicio",
      <Steps
        items={[
          "Muestra el total de bloqueos, los registrados hoy y los vigentes hoy.",
          "Usa el selector “Establecimiento” para ver la cantidad de bloqueos y la lista de un establecimiento en particular.",
          "Haz clic en el nombre de un profesional para abrir el detalle del bloqueo.",
        ]}
      />,
    ],
    [
      "Extraer reportes",
      <Steps
        items={[
          "Abre Reportes en el menú lateral.",
          "Pestaña “Bloqueos por establecimiento”: elige Desde, Hasta y (opcional) establecimiento, profesión o tipo.",
          "Revisa en pantalla el resumen por establecimiento: profesionales, agendas afectadas, días de bloqueo, tipos y MPO.",
          "Pulsa “Excel” para la tabla completa cruzada o “PDF” para el informe imprimible. El archivo queda en Descargas.",
          "Las pestañas “Cupos disponibles” e “Informe de calidad” están en desarrollo y se habilitarán más adelante.",
        ]}
      />,
    ],
    [
      "Consultar bloqueos y calendario",
      <Steps
        items={[
          "En Bloqueos busca por código, profesional, profesión o agenda y filtra por establecimiento.",
          "Un ⚠ “Información incompleta” indica un bloqueo cargado desde archivo al que le faltan datos.",
          "En Agendas por establecimiento filtra por establecimiento, profesión, profesional o agenda y cambia la vista Día / Semana / Mes. Azul = programada, rojo = bloqueada, amarillo = bloqueo parcial, morado = por verificar. La etiqueta MPO marca días reservados.",
        ]}
      />,
    ],
  ];
  const admin: Section[] = [
    [
      "Ingresar un bloqueo manual",
      <Steps
        items={[
          "En Bloqueos pulsa “＋ Nuevo bloqueo”.",
          "Paso 1 · Información: código SISMAULE, establecimiento, profesional (se autocompleta desde la nómina) y profesión.",
          "Tipo de bloqueo: elige de la lista o “OTRO (especificar)” y escribe cuál.",
          "¿Corresponde a una MPO?: responde Sí o No; si es Sí, indica cuál (se sugieren las MPO registradas en esas fechas).",
          "Ingresa las fechas. En “Agendas incluidas” aparecen como botones las agendas habilitadas de ese profesional en esas fechas: tócalas para agregarlas. También puedes escribir la agenda.",
          "Elige el tipo de horario (no informado, jornada completa, rango de horas o media jornada AM/PM).",
          "Paso 2 · Adjuntos: si había pacientes citados, responde Sí y adjunta los PDF/HTML de SISMAULE indicando la fecha de cada nómina.",
          "Paso 3 · Confirmación: revisa y pulsa “Guardar bloqueo”.",
        ]}
      />,
    ],
    [
      "Cargar bloqueos desde archivo",
      <Steps
        items={[
          "En Bloqueos pulsa “Cargar bloqueos (Excel, PDF, PHP)” y selecciona hasta 6 archivos (Excel .xlsx, PDF de texto, HTML o página .php guardada).",
          "Revisa la vista previa (leídos, ya registrados, incompletos) y pulsa “Confirmar carga”.",
          "Los bloqueos cargados aparecen en la misma tabla con la etiqueta “Archivo del sistema”. Si les falta información se marcan con ⚠.",
          "Para atender un ⚠: pulsa “Ver” y luego “Completar y registrar en la app”; se abre el formulario con los datos ya leídos para que completes lo que falta.",
        ]}
      />,
    ],
    [
      "Agendas por establecimiento",
      <Steps
        items={[
          "“Cargar agendas o nómina de profesionales”: sube los Excel de SISMAULE o la nómina PDF; revisa y confirma.",
          "“Carga manual de agenda (desde imagen)”: adjunta una o varias capturas de la agenda, y mirándolas completa establecimiento, profesional, nombre/código de agenda, vigencia y las franjas (día, hora de inicio, intervalo y cupos). Guarda: la agenda aparece en el calendario y en el autocompletado de bloqueos. Las imágenes quedan guardadas como respaldo.",
        ]}
      />,
    ],
    [
      "Profesionales",
      <Steps
        items={[
          "Busca por nombre, establecimiento o profesión.",
          "“Agregar profesional” o “Editar”: completa nombre, profesión y asignación. El código de recurso es distinto del código de bloqueo.",
          "No cambies un nombre para unir fichas dudosas; cada cambio queda en el historial.",
        ]}
      />,
    ],
    [
      "Pacientes citados",
      <Steps
        items={[
          "Lista las nóminas adjuntas por fecha. Cada fila tiene enlaces: el nombre del profesional ↗ abre el calendario en ese día con su agenda y bloqueo; el código abre el bloqueo.",
          "“Ver nómina” muestra los pacientes en solo lectura; cada paciente también tiene el enlace ↗ al calendario.",
          "Los originales no se editan ni eliminan; puedes descargarlos.",
        ]}
      />,
    ],
    [
      "Feriados y MPO",
      <Steps
        items={[
          "Feriados: elige el año, agrega o quita fechas según la fuente oficial y pulsa “Confirmar calendario revisado”. Sin confirmación no se pueden guardar bloqueos de ese año. Domingos y feriados no se cuentan como días de bloqueo.",
          "MPO: registra fechas reservadas para acciones específicas (p. ej. MPO de estadística). Usa “Repetir” para crear, por ejemplo, el último viernes de cada mes. Las MPO no se descuentan como feriados; se muestran en el calendario y se sugieren al registrar un bloqueo. Puedes modificarlas o quitarlas durante el año.",
        ]}
      />,
    ],
  ];
  const advanced: Section[] = [
    [
      "Guía rápida de administración avanzada",
      <Steps
        items={[
          "Administración de accesos (círculo de perfil): autoriza correos como Solo vista o Administrativo y desactiva accesos desmarcando Activo. Tu cuenta es la única avanzada.",
          "Puedes editar todos los bloqueos; los administrativos solo los propios.",
          "Revisa la bandeja de observaciones (abajo): responde por correo con un clic; la respuesta queda marcada.",
          "Al inicio de cada año: confirma feriados, registra las MPO del año y carga las agendas vigentes.",
          "Respaldo: la base PostgreSQL y el Storage (nóminas e imágenes de agendas) se respaldan por separado en Supabase. Las migraciones están en la carpeta database (última: 012).",
          "Publicación: compilar con pnpm build y subir dist a Cloudflare Pages (proyecto registro-de-bloqueos).",
        ]}
      />,
    ],
  ];
  const sections =
    role === "avanzado"
      ? [...advanced, ...common, ...admin]
      : role === "administrativo"
        ? [...common, ...admin]
        : common;
  const title =
    role === "avanzado"
      ? "Manual · Administradora avanzada"
      : role === "administrativo"
        ? "Manual · Perfil administrativo"
        : "Manual · Perfil solo vista";
  return (
    <>
      <section className="v-panel v-pad v-guide">
        <p className="v-eyebrow">{t("MODO DE USO", "HOW TO USE")}</p>
        <h2>{title}</h2>
        <p>
          {role === "normal"
            ? "Tu perfil permite consultar la información y extraer reportes. No puedes crear ni modificar registros."
            : role === "administrativo"
              ? "Tu perfil permite ingresar bloqueos, agendas, profesionales, feriados y MPO, además de extraer reportes."
              : "Tienes acceso completo a la plataforma."}
        </p>
        {sections.map(([h, body], i) => (
          <details key={h} open={i === 0}>
            <summary>
              <h3>
                {i + 1}. {h}
              </h3>
            </summary>
            {body}
          </details>
        ))}
      </section>
      <section className="v-panel v-pad v-contact">
        <h2>{t("Dudas, errores o capacitación", "Questions, errors or training")}</h2>
        <p>
          <strong>{CONTACT.name}</strong>
          <br />
          {CONTACT.role}
          <br />
          ✉ <a href={`mailto:${CONTACT.email}?subject=${encodeURIComponent("Registro de bloqueos: consulta")}`}>{CONTACT.email}</a>
        </p>
        <p className="v-muted">
          También puedes usar la burbuja 💬 abajo a la derecha: escribe tu observación y llegará directamente a la administradora con tu nombre y correo.
        </p>
      </section>
      {role === "avanzado" && !preview && <Inbox />}
    </>
  );
}

/* ---------- MPO ---------- */
function nthWeekdays(year: number, weekday: number, nth: number, months: number[]) {
  const out: string[] = [];
  for (const m of months) {
    const days: string[] = [];
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(Date.UTC(year, m, d));
      if (dt.getUTCMonth() !== m) break;
      if (dt.getUTCDay() === weekday) days.push(dt.toISOString().slice(0, 10));
    }
    const pick = nth === -1 ? days.at(-1) : days[nth - 1];
    if (pick) out.push(pick);
  }
  return out;
}
export function MpoPanel({
  mpo,
  writable,
  changed,
}: {
  mpo: api.MpoDate[];
  writable: boolean;
  changed: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [year, setYear] = useState(Number(chileToday().slice(0, 4))),
    [name, setName] = useState(""),
    [audience, setAudience] = useState(""),
    [est, setEst] = useState(""),
    [source, setSource] = useState(""),
    [mode, setMode] = useState<"single" | "repeat">("single"),
    [day, setDay] = useState(""),
    [weekday, setWeekday] = useState(5),
    [nth, setNth] = useState(-1),
    [fromMonth, setFromMonth] = useState(0),
    [toMonth, setToMonth] = useState(11),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const list = mpo.filter((m) => m.day.startsWith(String(year)));
  const preview =
    mode === "repeat"
      ? nthWeekdays(
          year,
          weekday,
          nth,
          Array.from({ length: Math.max(0, toMonth - fromMonth + 1) }, (_, i) => fromMonth + i),
        )
      : day
        ? [day]
        : [];
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await changed();
      setNotice(ok);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };
  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return (
    <section className="v-panel v-pad">
      <h2>{t("MPO · fechas reservadas", "MPO · reserved dates")}</h2>
      <p>
        {t(
          "Fechas reservadas para acciones específicas dentro del establecimiento (por ejemplo, MPO de estadística el último viernes de cada mes para médicos). Se definen a principio de año y pueden modificarse. No se descuentan como feriados; se muestran en el calendario y se sugieren al registrar bloqueos.",
          "Dates reserved for specific actions (e.g. statistics MPO on the last Friday of each month). They are not counted as holidays; they are shown in the calendar and suggested when registering blocks.",
        )}
      </p>
      <label className="v-field">
        <span>{t("Año", "Year")}</span>
        <input type="number" min="2000" max="2100" value={year} onChange={(e) => setYear(Number(e.target.value))} />
      </label>
      <div className="v-scroll">
        <table className="v-table">
          <thead>
            <tr>
              <th>{t("Fecha", "Date")}</th>
              <th>MPO</th>
              <th>{t("Dirigida a", "Audience")}</th>
              <th>{t("Establecimiento", "Establishment")}</th>
              <th>{t("Fuente", "Source")}</th>
              {writable && <th>{t("Acción", "Action")}</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id}>
                <td>
                  {dmy(m.day)}
                  <small>{weekdays[new Date(m.day + "T12:00:00Z").getUTCDay()]}</small>
                </td>
                <td>{m.name}</td>
                <td>{m.audience || "—"}</td>
                <td>{m.establishment || t("Todos", "All")}</td>
                <td>{m.source || "—"}</td>
                {writable && (
                  <td>
                    <button
                      className="v-link"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(t("¿Quitar esta MPO?", "Remove this MPO?")))
                          void run(() => api.removeMpo(m.id), t("MPO quitada.", "MPO removed."));
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
      </div>
      {!list.length && <p className="v-empty">{t("Sin MPO registradas para este año.", "No MPO for this year.")}</p>}
      {writable && (
        <form
          className="v-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (!preview.length) throw new Error("Selecciona al menos una fecha.");
              await api.saveMpo(
                preview.map((d) => ({ day: d, name: name.trim(), audience: audience.trim(), establishment: est, source: source.trim() })),
              );
              setDay("");
            }, `${preview.length} ${t("fecha(s) MPO guardadas.", "MPO date(s) saved.")}`);
          }}
        >
          <h3>{t("Agregar MPO", "Add MPO")}</h3>
          <div className="v-grid">
            <label className="v-field">
              <span>{t("Nombre de la MPO", "MPO name")}</span>
              <input required maxLength={200} value={name} placeholder="MPO de estadística" onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="v-field">
              <span>{t("Dirigida a", "Audience")}</span>
              <input maxLength={200} value={audience} placeholder="Médicos" onChange={(e) => setAudience(e.target.value)} />
            </label>
            <label className="v-field">
              <span>{t("Establecimiento", "Establishment")}</span>
              <select value={est} onChange={(e) => setEst(e.target.value)}>
                <option value="">{t("Todos", "All")}</option>
                {establishments.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="v-field">
              <span>{t("Fuente / resolución", "Source")}</span>
              <input maxLength={300} value={source} onChange={(e) => setSource(e.target.value)} />
            </label>
            <label className="v-field">
              <span>{t("Fechas", "Dates")}</span>
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="single">{t("Una fecha", "Single date")}</option>
                <option value="repeat">{t("Repetir cada mes", "Repeat monthly")}</option>
              </select>
            </label>
            {mode === "single" ? (
              <label className="v-field">
                <span>{t("Fecha", "Date")}</span>
                <input type="date" required min={`${year}-01-01`} max={`${year}-12-31`} value={day} onChange={(e) => setDay(e.target.value)} />
              </label>
            ) : (
              <>
                <label className="v-field">
                  <span>{t("Cuál", "Which")}</span>
                  <select value={nth} onChange={(e) => setNth(Number(e.target.value))}>
                    <option value={1}>Primer</option>
                    <option value={2}>Segundo</option>
                    <option value={3}>Tercer</option>
                    <option value={4}>Cuarto</option>
                    <option value={-1}>Último</option>
                  </select>
                </label>
                <label className="v-field">
                  <span>{t("Día", "Day")}</span>
                  <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                    {weekdays.map((w, i) => (
                      <option key={w} value={i}>
                        {w}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="v-field">
                  <span>{t("Desde el mes", "From month")}</span>
                  <select value={fromMonth} onChange={(e) => setFromMonth(Number(e.target.value))}>
                    {months.map((m, i) => (
                      <option key={m} value={i}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="v-field">
                  <span>{t("Hasta el mes", "To month")}</span>
                  <select value={toMonth} onChange={(e) => setToMonth(Number(e.target.value))}>
                    {months.map((m, i) => (
                      <option key={m} value={i}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
          {mode === "repeat" && (
            <p className="v-notice">
              {preview.length} {t("fechas", "dates")}: {preview.map(dmy).join(" · ") || "—"}
            </p>
          )}
          <button className="v-btn primary" disabled={busy || !name.trim()}>
            {t("Guardar MPO", "Save MPO")}
          </button>
        </form>
      )}
      {notice && <p className="v-ok">{notice}</p>}
      {error && <p className="v-error">{error}</p>}
    </section>
  );
}

/* ---------- Carga manual de agenda desde imágenes ---------- */
type Slot = { weekday: number; starts_at: string; interval_minutes: number; capacity: number };
export function ManualAgenda({
  catalog,
  refresh,
  preview = false,
}: {
  catalog: AgendaCatalog;
  refresh: () => Promise<void>;
  preview?: boolean;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false),
    [images, setImages] = useState<{ file: File; url: string }[]>([]),
    [zoom, setZoom] = useState(0),
    [est, setEst] = useState(""),
    [person, setPerson] = useState(""),
    [code, setCode] = useState(""),
    [agendaName, setAgendaName] = useState(""),
    [attention, setAttention] = useState(""),
    [from, setFrom] = useState(chileToday()),
    [until, setUntil] = useState(chileToday().slice(0, 4) + "-12-31"),
    [slots, setSlots] = useState<Slot[]>([{ weekday: 1, starts_at: "08:00", interval_minutes: 20, capacity: 1 }]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => () => images.forEach((i) => URL.revokeObjectURL(i.url)), [images]);
  const people = useMemo(
    () =>
      catalog.professionals
        .filter((p) => !est || p.establishments.includes(est) || p.resource_establishment === est)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [catalog.professionals, est],
  );
  const chosen = people.find((p) => `${p.name} · ${p.profession || "—"}${p.resource_code ? " · " + p.resource_code : ""}` === person);
  const setSlot = (i: number, patch: Partial<Slot>) =>
    setSlots((s) => s.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (preview) throw new Error("Vista de diseño: no guarda.");
      if (!est) throw new Error("Selecciona el establecimiento.");
      if (!chosen) throw new Error("Selecciona un profesional de la lista (si no existe, agrégalo antes en Profesionales).");
      if (!agendaName.trim()) throw new Error("Indica el nombre de la agenda.");
      if (!from || !until || until < from) throw new Error("Revisa la vigencia.");
      if (slots.some((s) => !s.starts_at)) throw new Error("Completa la hora de inicio de cada franja.");
      const r = await api.saveManualAgenda(
        `Ingreso manual${images.length ? " · " + images.map((i) => i.file.name).join(", ") : ""}`.slice(0, 250),
        slots.map((s) => ({
          professional_id: chosen.id,
          establishment: est,
          agenda_code: code.trim(),
          agenda_name: agendaName.trim(),
          starts_on: from,
          ends_on: until,
          weekday: s.weekday,
          starts_at: s.starts_at,
          interval_minutes: s.interval_minutes,
          capacity: s.capacity,
          attention: attention.trim(),
        })),
        images.map((i) => i.file),
      );
      setNotice(`${r.inserted} ${t("franja(s) guardadas. La agenda ya aparece en el calendario.", "slot(s) saved.")}`);
      setSlots([{ weekday: 1, starts_at: "08:00", interval_minutes: 20, capacity: 1 }]);
      setImages([]);
      setCode("");
      setAgendaName("");
      await refresh();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="v-panel v-pad a-import a-manual">
      <button className="v-btn primary" onClick={() => setOpen(!open)}>
        ✎ {t("Carga manual de agenda (desde imagen)", "Manual agenda entry (from image)")}
      </button>
      {open && (
        <div className="a-manual-grid">
          <div className="a-manual-images">
            <label className="v-field">
              <span>{t("Imágenes de la agenda (PNG, JPG, captura)", "Agenda images")}</span>
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => {
                  const list = Array.from(e.target.files || []).filter((f) => f.size <= 10 * 1024 * 1024);
                  setImages((s) => [...s, ...list.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 8));
                  e.target.value = "";
                }}
              />
            </label>
            {images.length ? (
              <>
                <img className="a-manual-zoom" src={images[Math.min(zoom, images.length - 1)].url} alt={t("Agenda adjunta", "Attached agenda")} />
                <div className="a-manual-thumbs">
                  {images.map((im, i) => (
                    <button key={im.url} className={i === zoom ? "selected" : ""} onClick={() => setZoom(i)} title={im.file.name}>
                      <img src={im.url} alt="" />
                    </button>
                  ))}
                  <button className="v-link" onClick={() => setImages([])}>
                    {t("Quitar imágenes", "Remove images")}
                  </button>
                </div>
              </>
            ) : (
              <p className="v-muted">
                {t(
                  "Adjunta las capturas de la agenda; se muestran aquí para transcribirlas al formulario y quedan guardadas como respaldo.",
                  "Attach screenshots; they are shown here to transcribe them and are stored as backup.",
                )}
              </p>
            )}
          </div>
          <div className="v-form">
            <div className="v-grid">
              <label className="v-field">
                <span>{t("Establecimiento", "Establishment")}</span>
                <select value={est} onChange={(e) => { setEst(e.target.value); setPerson(""); }}>
                  <option value="">{t("Selecciona…", "Select…")}</option>
                  {establishments.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="v-field">
                <span>{t("Profesional", "Professional")}</span>
                <input list="manual-people" value={person} onChange={(e) => setPerson(e.target.value)} placeholder={t("Escribe y elige…", "Type and pick…")} />
                <datalist id="manual-people">
                  {people.map((p) => (
                    <option key={p.id} value={`${p.name} · ${p.profession || "—"}${p.resource_code ? " · " + p.resource_code : ""}`} />
                  ))}
                </datalist>
                <small>{chosen ? "✓ " + chosen.name : person ? t("Elige una opción de la lista", "Pick from the list") : ""}</small>
              </label>
              <label className="v-field">
                <span>{t("Código de agenda (opcional)", "Agenda code (optional)")}</span>
                <input maxLength={100} value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
              <label className="v-field">
                <span>{t("Nombre de la agenda", "Agenda name")}</span>
                <input maxLength={250} value={agendaName} onChange={(e) => setAgendaName(e.target.value)} placeholder="Ej.: MORBILIDAD ADULTO" />
              </label>
              <label className="v-field">
                <span>{t("Tipo de atención (opcional)", "Attention type (optional)")}</span>
                <input maxLength={250} value={attention} onChange={(e) => setAttention(e.target.value)} />
              </label>
              <label className="v-field">
                <span>{t("Vigente desde", "Valid from")}</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="v-field">
                <span>{t("Vigente hasta", "Valid until")}</span>
                <input type="date" min={from} value={until} onChange={(e) => setUntil(e.target.value)} />
              </label>
            </div>
            <h3>{t("Franjas semanales", "Weekly slots")}</h3>
            <table className="v-table a-slots">
              <thead>
                <tr>
                  <th>{t("Día", "Day")}</th>
                  <th>{t("Hora inicio", "Start")}</th>
                  <th>{t("Intervalo (min)", "Interval (min)")}</th>
                  <th>{t("Cupos", "Slots")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {slots.map((s, i) => (
                  <tr key={i}>
                    <td>
                      <select value={s.weekday} onChange={(e) => setSlot(i, { weekday: Number(e.target.value) })}>
                        {weekdays.map((w, n) => (
                          <option key={w} value={n}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input type="time" value={s.starts_at} onChange={(e) => setSlot(i, { starts_at: e.target.value })} />
                    </td>
                    <td>
                      <input type="number" min={1} max={1440} value={s.interval_minutes} onChange={(e) => setSlot(i, { interval_minutes: Number(e.target.value) })} />
                    </td>
                    <td>
                      <input type="number" min={0} max={10000} value={s.capacity} onChange={(e) => setSlot(i, { capacity: Number(e.target.value) })} />
                    </td>
                    <td>
                      {slots.length > 1 && (
                        <button className="v-btn" aria-label={t("Quitar franja", "Remove slot")} onClick={() => setSlots(slots.filter((_, n) => n !== i))}>
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              <button className="v-btn" disabled={slots.length >= 60} onClick={() => setSlots([...slots, { ...slots[slots.length - 1] }])}>
                ＋ {t("Agregar franja", "Add slot")}
              </button>{" "}
              <button
                className="v-btn"
                onClick={() => {
                  const base = slots[0];
                  setSlots([1, 2, 3, 4, 5].map((w) => ({ ...base, weekday: w })));
                }}
              >
                {t("Copiar 1ª franja de lunes a viernes", "Copy 1st slot Mon–Fri")}
              </button>
            </p>
            {error && <p className="v-error">{error}</p>}
            {notice && <p className="v-ok">{notice}</p>}
            <button className="v-btn primary" disabled={busy} onClick={() => void save()}>
              {busy ? t("Guardando…", "Saving…") : t("Guardar agenda", "Save agenda")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
