// v1.7 · Información cruzada: ficha única del profesional con agendas, cupos y bloqueos.
import { useMemo } from "react";
import { expandRules } from "./agenda-import.ts";
import {
  crossAgenda,
  key,
  missingBlocks,
  type AgendaCatalog,
  type AgendaSession,
  type MissingBlock,
  type SystemBlockLike,
} from "./agenda-model.ts";
import type { Data, RecordRow } from "./model.ts";
import { useLanguage } from "./language.ts";

const WEEK = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const dmy = (d: string) => d.split("-").reverse().join("/");

/** Datos para abrir «Nuevo bloqueo» ya llenado desde un bloqueo detectado en la agenda. */
export function prefillFromMissing(m: MissingBlock): Partial<Data> {
  const range = !!m.starts_at && !!m.ends_at;
  return {
    Establecimiento: m.establishment,
    Profesional: m.professional?.name || "",
    Profesion: m.professional?.profession || "",
    Agendas: [m.agenda_name],
    Fecha_Inicio: m.from,
    Fecha_Termino: m.until,
    Tipo_Horario: range ? "RANGO HORARIO" : "NO INFORMADO",
    ...(range
      ? { Hora_Inicio: m.starts_at!.slice(0, 5), Hora_Termino: m.ends_at!.slice(0, 5) }
      : {}),
    Observacion: "Bloqueo detectado en la agenda (marcado en rojo). Falta el código SISMAULE.",
  };
}

/** Sesiones (archivo por recurso + reglas + ingreso manual) de un conjunto de profesionales. */
export function professionalSessions(
  catalog: AgendaCatalog,
  ids: Set<string>,
): AgendaSession[] {
  const period = catalog.periods[0];
  if (!period) return [];
  return [
    ...catalog.sessions.filter((s) => ids.has(s.professional_id)),
    ...expandRules(
      (catalog.rules || []).filter((r) => r.professional_id && ids.has(r.professional_id)),
      period.id,
      period.starts_on,
      period.ends_on,
    ),
  ];
}

/** Todos los bloqueos detectados en rojo sin registrar (toda la app, o un profesional). */
export function allMissing(
  catalog: AgendaCatalog,
  blocks: RecordRow[],
  sys: SystemBlockLike[],
  ids?: Set<string>,
) {
  const period = catalog.periods[0];
  if (!period) return [];
  const sessions = ids
    ? professionalSessions(catalog, ids)
    : [
        ...catalog.sessions,
        ...expandRules(catalog.rules || [], period.id, period.starts_on, period.ends_on),
      ];
  return missingBlocks(sessions, catalog.professionals, blocks, sys);
}

export function ProfessionalPanel({
  name,
  establishment,
  catalog,
  blocks,
  sys,
  openBlock,
  openCalendar,
  register,
}: {
  name: string;
  establishment?: string;
  catalog: AgendaCatalog;
  blocks: RecordRow[];
  sys: (SystemBlockLike & { codigo: string; tipo: string })[];
  openBlock: (b: RecordRow) => void;
  openCalendar: () => void;
  register?: (p: Partial<Data>) => void;
}) {
  const { t } = useLanguage();
  const data = useMemo(() => {
    const k = key(name);
    const fichas = catalog.professionals.filter((p) =>
      [p.name, ...(p.aliases || [])].some((n) => key(n) === k),
    );
    const ids = new Set(fichas.map((p) => p.id));
    const sessions = professionalSessions(catalog, ids);
    const byId = new Map(catalog.professionals.map((p) => [p.id, p]));
    const crossed = sessions.map((s) => crossAgenda(s, byId.get(s.professional_id), blocks));
    const cupos = sessions.reduce((n, s) => n + (s.capacity || 0), 0);
    const bloqueados = crossed
      .filter((c) => c.state === "blocked")
      .reduce((n, c) => n + (c.session.capacity || 0), 0);
    const agendas = new Map<string, { sessions: number; cupos: number; days: Set<number>; ests: Set<string> }>();
    for (const s of sessions) {
      const a = agendas.get(s.agenda_name) || { sessions: 0, cupos: 0, days: new Set(), ests: new Set() };
      a.sessions++;
      a.cupos += s.capacity || 0;
      a.days.add(new Date(s.service_day + "T00:00:00Z").getUTCDay());
      a.ests.add(s.establishment);
      agendas.set(s.agenda_name, a);
    }
    const mine = blocks.filter((b) => !b.archived && key(b.Profesional) === k);
    const mySys = sys.filter((b) => key(b.profesional) === k);
    const missing = allMissing(catalog, blocks, sys, ids);
    return { fichas, sessions, cupos, bloqueados, agendas, mine, mySys, missing };
  }, [name, catalog, blocks, sys]);
  const ficha =
    data.fichas.find((p) => establishment && p.establishments.includes(establishment)) ||
    data.fichas[0];
  return (
    <div className="who-panel">
      <h3>{name}</h3>
      <p>
        {ficha?.profession || t("Profesión no informada", "Profession unspecified")} ·{" "}
        {[...new Set(data.fichas.flatMap((p) => p.establishments))].join(" · ") ||
          t("Sin establecimiento regular", "No regular establishment")}
      </p>
      <div className="who-grid">
        <div>
          <b>{data.agendas.size}</b>
          {t("agendas", "agendas")}
        </div>
        <div>
          <b>{data.cupos}</b>
          {t("cupos en el período", "slots in the period")}
        </div>
        <div>
          <b>{data.bloqueados}</b>
          {t("cupos bloqueados", "blocked slots")}
        </div>
        <div>
          <b>{data.mine.length + data.mySys.length}</b>
          {t("bloqueos registrados", "registered blocks")}
        </div>
      </div>
      {data.missing.length > 0 && (
        <div className="miss-panel">
          <h3>
            {data.missing.length} {t("bloqueo(s) en la agenda sin registrar", "agenda block(s) not registered")}
          </h3>
          {data.missing.map((m) => (
            <div className="miss-row" key={m.id}>
              <span>
                {m.agenda_name} · {dmy(m.from)}
                {m.until !== m.from && ` — ${dmy(m.until)}`}
              </span>
              {register && (
                <button className="v-btn primary" onClick={() => register(prefillFromMissing(m))}>
                  {t("Registrar bloqueo", "Register block")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <h4>{t("Agendas", "Agendas")}</h4>
      {data.agendas.size ? (
        <ul>
          {[...data.agendas].map(([agenda, a]) => (
            <li key={agenda}>
              <strong>{agenda}</strong> — {[...a.days].sort().map((d) => WEEK[d]).join(", ")} ·{" "}
              {a.cupos} {t("cupos", "slots")} · {[...a.ests].join(", ")}
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("Sin agendas cargadas.", "No agendas loaded.")}</p>
      )}
      <h4>{t("Bloqueos", "Blocks")}</h4>
      {data.mine.length + data.mySys.length ? (
        <ul>
          {data.mine.map((b) => (
            <li key={b.id}>
              <button className="who-link" onClick={() => openBlock(b)}>
                {b.Codigo_Bloqueo}
              </button>{" "}
              · {b.Tipo_Bloqueo} · {dmy(String(b.Fecha_Inicio))} — {dmy(String(b.Fecha_Termino))}
            </li>
          ))}
          {data.mySys.map((b, i) => (
            <li key={"s" + i}>
              {b.codigo || "—"} · {b.tipo} · {b.fecha_inicio && dmy(b.fecha_inicio)} —{" "}
              {b.fecha_termino && dmy(b.fecha_termino)} <em>({t("archivo del sistema", "system file")})</em>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("Sin bloqueos registrados.", "No registered blocks.")}</p>
      )}
      <button className="v-btn" onClick={openCalendar}>
        {t("Ver calendario de agendas", "View agenda calendar")}
      </button>
    </div>
  );
}
