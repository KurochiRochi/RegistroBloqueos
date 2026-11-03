import { professionalKey, type RecordRow } from "./model.ts";
export type ReferencePeriod = {
  id: string;
  label: string;
  starts_on: string;
  ends_on: string;
  source_name: string;
  programming_loaded: boolean;
};
export type CatalogProfessional = {
  id: string;
  name: string;
  profession: string;
  source_assignment: string;
  classification: "regular" | "support" | "pending";
  establishments: string[];
  resource_code?: string;
  resource_establishment?: string;
  aliases?: string[];
  source_profession?: string;
  source_origin?: string;
  version?: number;
};
export type AgendaSession = {
  id: string;
  period_id: string;
  professional_id: string;
  establishment: string;
  agenda_name: string;
  agenda_code: string;
  service_day: string;
  starts_at: string | null;
  ends_at: string | null;
  capacity: number | null;
  source_name: string;
  source_blocked?: boolean;
  generated?: boolean;
  attention?: string;
  interval_minutes?: number;
  source_row?: string;
  booked?: number | null;
};
export type ManualQuota = {
  id: string;
  detail_id: string;
  establishment: string;
  attention: "CONTROL" | "NUEVO";
  capacity: number;
};
export type ManualDetail = {
  id: string;
  manual_agenda_id: string;
  weekday: number;
  starts_at: string;
  interval_minutes: number;
  capacity: number;
  box: string;
  quotas: ManualQuota[];
};
export type ManualAgenda = {
  id: string;
  corr: number;
  professional_id: string;
  establishment: string;
  agenda_code: string;
  agenda_name: string;
  starts_on: string;
  ends_on: string;
  closed_on: string | null;
  generated: boolean;
  staggered: boolean;
  requires_record: boolean;
  funding: string;
  agenda_type: "Consulta" | "Procedimiento";
  multi_hour: boolean;
  details: ManualDetail[];
};
/** Convierte el detalle de las agendas manuales en reglas semanales para el calendario. */
export function manualRules(
  manual: ManualAgenda[],
  professionals: CatalogProfessional[],
): import("./agenda-import.ts").AgendaRule[] {
  const byId = new Map(professionals.map((p) => [p.id, p]));
  return manual.flatMap((m) => {
    const until = m.closed_on && m.closed_on < m.ends_on ? m.closed_on : m.ends_on;
    const p = byId.get(m.professional_id);
    return m.details.map((d) => ({
      id: "manual:" + d.id,
      professional_id: m.professional_id,
      establishment: m.establishment,
      resource_code: p?.resource_code || "",
      resource_name: p?.name || "",
      agenda_code: m.agenda_code || "M-" + m.corr,
      agenda_name: m.agenda_name,
      starts_on: m.starts_on,
      ends_on: until,
      weekday: d.weekday,
      starts_at: d.starts_at.slice(0, 5),
      interval_minutes: d.interval_minutes,
      capacity: d.capacity,
      generated: m.generated,
      staggered: m.staggered,
      source_blocked: false,
      attention: d.quotas
        .map((q) => `${q.attention} ${q.capacity}${q.establishment !== m.establishment ? " · " + q.establishment : ""}`)
        .join(", "),
      source_row: `Corr. ${m.corr}${d.box ? " · Box " + d.box : ""}`,
      source_name: "Ingreso manual",
    }));
  });
}
export type AgendaCatalog = {
  periods: ReferencePeriod[];
  professionals: CatalogProfessional[];
  sessions: AgendaSession[];
  rules?: import("./agenda-import.ts").AgendaRule[];
  imports?: {
    id: string;
    name: string;
    kind: string;
    row_count: number;
    inserted_count: number;
    created_at: string;
  }[];
  agenda_names?: string[];
  manual?: ManualAgenda[];
};
export const emptyCatalog: AgendaCatalog = {
  periods: [],
  professionals: [],
  sessions: [],
};
export const key = (v: unknown) => professionalKey(v);
export const minutes = (v: string) =>
  Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
export function dates(from: string, until: string) {
  const result: string[] = [];
  for (
    let n = Date.parse(from + "T00:00:00Z"),
      end = Date.parse(until + "T00:00:00Z");
    n <= end;
    n += 86400000
  )
    result.push(new Date(n).toISOString().slice(0, 10));
  return result;
}
export function shift(day: string, n: number) {
  return new Date(Date.parse(day + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function monday(day: string) {
  const d = new Date(day + "T00:00:00Z").getUTCDay();
  return shift(day, -((d + 6) % 7));
}
export function clampDate(day: string, period: ReferencePeriod) {
  return day < period.starts_on
    ? period.starts_on
    : day > period.ends_on
      ? period.ends_on
      : day;
}
export type CrossedAgenda = {
  session: AgendaSession;
  professional: CatalogProfessional | undefined;
  state: "scheduled" | "blocked" | "partial" | "uncertain";
  blocks: RecordRow[];
  blockedMinutes: number | null;
};
// Exact normalized keys only: no fuzzy name matching, no inference of other establishments.
export function relatedBlocks(
  session: AgendaSession,
  p: CatalogProfessional | undefined,
  blocks: RecordRow[],
) {
  if (!p) return [];
  return blocks.filter(
    (b) =>
      !b.archived &&
      key(b.Establecimiento) === key(session.establishment) &&
      [p.name, ...(p.aliases || [])].some(
        (n) => key(b.Profesional) === key(n),
      ) &&
      String(b.Fecha_Inicio) <= session.service_day &&
      String(b.Fecha_Termino) >= session.service_day &&
      (b.Agendas?.length ? b.Agendas : [String(b.Agenda || "")]).some(
        (a) =>
          key(a) === key(session.agenda_name) ||
          (session.agenda_code && key(a) === key(session.agenda_code)),
      ),
  );
}
export function crossAgenda(
  session: AgendaSession,
  p: CatalogProfessional | undefined,
  blocks: RecordRow[],
): CrossedAgenda {
  const candidates = relatedBlocks(session, p, blocks);
  const timeKnown = !!session.starts_at && !!session.ends_at;
  const start = timeKnown ? minutes(session.starts_at!) : 0,
    end = timeKnown ? minutes(session.ends_at!) : 1440;
  const ranges: [number, number][] = [];
  const relevant: RecordRow[] = [];
  let uncertain = false;
  for (const b of candidates) {
    let a = 0,
      z = 1440;
    if (b.Tipo_Horario === "RANGO HORARIO") {
      if (!b.Hora_Inicio || !b.Hora_Termino) {
        uncertain = true;
        relevant.push(b);
        continue;
      }
      a = minutes(String(b.Hora_Inicio));
      z = minutes(String(b.Hora_Termino));
    } else if (b.Tipo_Horario === "MEDIA JORNADA") {
      if (b.Media_Jornada === "AM") z = 720;
      else if (b.Media_Jornada === "PM") a = 720;
      else {
        uncertain = true;
        relevant.push(b);
        continue;
      }
    } else if (b.Tipo_Horario !== "JORNADA COMPLETA") {
      uncertain = true;
      relevant.push(b);
      continue;
    }
    if (!timeKnown && b.Tipo_Horario !== "JORNADA COMPLETA") {
      uncertain = true;
      relevant.push(b);
      continue;
    }
    const left = Math.max(a, start),
      right = Math.min(z, end);
    if (left < right) {
      ranges.push([left, right]);
      relevant.push(b);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let total = 0,
    lastStart = -1,
    lastEnd = -1;
  for (const [a, z] of ranges) {
    if (a > lastEnd) {
      if (lastStart >= 0) total += lastEnd - lastStart;
      lastStart = a;
      lastEnd = z;
    } else lastEnd = Math.max(lastEnd, z);
  }
  if (lastStart >= 0) total += lastEnd - lastStart;
  const state = session.source_blocked
    ? "blocked"
    : session.generated === false
      ? "uncertain"
      : total >= end - start
        ? "blocked"
        : total > 0
          ? "partial"
          : uncertain || !timeKnown
            ? "uncertain"
            : "scheduled";
  return {
    session,
    professional: p,
    state,
    blocks: relevant,
    blockedMinutes: timeKnown ? total : null,
  };
}
export function crossCatalog(
  catalog: AgendaCatalog,
  blocks: RecordRow[],
  periodId: string,
) {
  const byId = new Map(catalog.professionals.map((p) => [p.id, p]));
  return catalog.sessions
    .filter((s) => s.period_id === periodId)
    .map((s) => crossAgenda(s, byId.get(s.professional_id), blocks));
}
export function unmatchedBlocks(
  blocks: RecordRow[],
  catalog: AgendaCatalog,
  period: ReferencePeriod,
) {
  const byId = new Map(catalog.professionals.map((p) => [p.id, p]));
  return blocks.filter(
    (b) =>
      !b.archived &&
      String(b.Fecha_Inicio) <= period.ends_on &&
      String(b.Fecha_Termino) >= period.starts_on &&
      !catalog.sessions.some(
        (s) =>
          s.period_id === period.id &&
          relatedBlocks(s, byId.get(s.professional_id), [b]).length,
      ),
  );
}
