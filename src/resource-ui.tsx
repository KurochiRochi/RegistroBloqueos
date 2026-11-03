import { useEffect, useMemo } from "react";
import { establishments } from "./agenda-import.ts";
import type { AgendaCatalog, CatalogProfessional } from "./agenda-model.ts";
import type { ParsedAgendaFile } from "./agenda-files.ts";
import { professionalKey as key } from "./model.ts";
import {
  fileNameWords,
  matchProfessionals,
  resourceEntries,
} from "./resource-agenda.ts";
import { useLanguage } from "./language.ts";

export type ResourceChoice = { establishment: string; person: string };
const label = (p: CatalogProfessional) =>
  `${p.name}${p.profession ? " · " + p.profession : ""}${p.resource_code ? " · " + p.resource_code : ""}`;
const dmy = (d: string) => d.split("-").reverse().join("/");

/** Nombre de agenda con la escritura de la lista oficial (Excel), si coincide. */
export function canonicalAgenda(names: string[]) {
  const map = new Map(names.map((n) => [key(n), n]));
  return (n: string) => map.get(key(n)) || n.toLocaleUpperCase("es");
}
/** Profesional elegido: ficha existente o nombre nuevo escrito a mano. */
export function chosenProfessional(people: CatalogProfessional[], person: string) {
  const p = people.find((x) => label(x) === person || x.name === person);
  return p ? { id: p.id, name: p.name } : { name: person.trim() };
}

export function ResourcePreview({
  file,
  catalog,
  extraNames,
  choice,
  setChoice,
  disabled,
}: {
  file: ParsedAgendaFile;
  catalog: AgendaCatalog;
  extraNames: string[];
  choice: ResourceChoice;
  setChoice: (c: ResourceChoice) => void;
  disabled: boolean;
}) {
  const { t } = useLanguage();
  const doc = file.resource!;
  const people = useMemo(
    () => [...catalog.professionals].sort((a, b) => a.name.localeCompare(b.name)),
    [catalog.professionals],
  );
  // Identificación del profesional: campo Recurso del PDF o, si viene vacío, nombre del archivo.
  const fromPdf = doc.resource_name.trim();
  const words = fromPdf ? fileNameWords(fromPdf) : fileNameWords(file.name);
  const candidates = useMemo(() => {
    const exact = fromPdf ? people.filter((p) => key(p.name) === key(fromPdf)) : [];
    return exact.length ? exact : matchProfessionals(words, people);
  }, [people, fromPdf, words.join(" ")]);
  useEffect(() => {
    if (choice.person) return;
    const only = candidates.length === 1 ? candidates[0] : undefined;
    const est =
      choice.establishment ||
      (only?.establishments.length === 1 ? only.establishments[0] : "");
    if (only) setChoice({ establishment: est, person: label(only) });
    else if (fromPdf && !candidates.length)
      setChoice({ establishment: est, person: fromPdf.toLocaleUpperCase("es") });
  }, [file.sha256, candidates.length]);
  const entries = useMemo(
    () =>
      resourceEntries(
        doc.rows,
        canonicalAgenda([...(catalog.agenda_names || []), ...extraNames]),
      ),
    [doc.rows, catalog.agenda_names, extraNames],
  );
  const chosen = choice.person ? chosenProfessional(people, choice.person) : null;
  const days = [...new Set(doc.rows.map((r) => r.service_day))];
  const blocked = doc.rows.filter((r) => r.source_blocked);
  const agendaSummary = [
    ...new Map(
      entries.map((e) => [
        e.agenda_name + "|" + e.source_blocked,
        {
          name: e.agenda_name,
          blocked: e.source_blocked,
          slots: entries
            .filter((x) => x.agenda_name === e.agenda_name && x.source_blocked === e.source_blocked)
            .reduce((n, x) => n + x.capacity, 0),
        },
      ]),
    ).values(),
  ].sort((a, b) => Number(a.blocked) - Number(b.blocked) || a.name.localeCompare(b.name));
  return (
    <div className="r-preview">
      <p className="r-kind">
        📄 {t("Gestión Agendas por Recurso (SISMAULE)", "Agenda by resource (SISMAULE)")}
        {" · "}
        {days.length ? `${dmy(days[0])} — ${dmy(days.at(-1)!)}` : "—"} · {days.length}{" "}
        {t("días", "days")} · {doc.rows.length - blocked.length}{" "}
        {t("cupos activos", "active slots")} ·{" "}
        <b className="r-red">
          {blocked.length} {t("cupos bloqueados", "blocked slots")}
        </b>
      </p>
      <div className="v-grid r-choice">
        <label className="v-field">
          <span>{t("Establecimiento de la agenda", "Agenda establishment")}</span>
          <select
            disabled={disabled}
            value={choice.establishment}
            onChange={(e) => setChoice({ ...choice, establishment: e.target.value })}
          >
            <option value="">{t("Selecciona…", "Select…")}</option>
            {establishments.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="v-field">
          <span>{t("Profesional", "Professional")}</span>
          <input
            disabled={disabled}
            list={"r-people-" + file.sha256.slice(0, 8)}
            value={choice.person}
            placeholder={t("Escribe y elige…", "Type and pick…")}
            onChange={(e) => setChoice({ ...choice, person: e.target.value })}
          />
          <datalist id={"r-people-" + file.sha256.slice(0, 8)}>
            {people.map((p) => (
              <option key={p.id} value={label(p)} />
            ))}
          </datalist>
          <small>
            {fromPdf
              ? t("Recurso indicado en el PDF: ", "Resource stated in the PDF: ") + fromPdf
              : words.length
                ? t("Recurso vacío en el PDF; se usó el nombre del archivo: ", "Empty resource in the PDF; file name used: ") +
                  words.join(" ")
                : t("El PDF no indica el recurso: elige el profesional.", "The PDF does not state the resource: pick the professional.")}
            {chosen &&
              (chosen.id
                ? " · ✓ " + chosen.name
                : " · " + t("se creará una ficha nueva con este nombre", "a new record will be created with this name"))}
          </small>
        </label>
      </div>
      {candidates.length > 1 && (
        <div className="v-agenda-suggest">
          <span>{t("Coincidencias con el nombre:", "Name matches:")}</span>
          {candidates.slice(0, 8).map((p) => (
            <button
              type="button"
              key={p.id}
              className={"v-chip" + (choice.person === label(p) ? " used" : "")}
              disabled={disabled}
              onClick={() => setChoice({ ...choice, person: label(p) })}
            >
              {label(p)}
            </button>
          ))}
        </div>
      )}
      <div className="r-agendas">
        {agendaSummary.map((a) => (
          <span key={a.name + a.blocked} className={a.blocked ? "r-tag blocked" : "r-tag"}>
            {a.blocked ? "⛔ " : "● "}
            {a.name} · {a.slots}
          </span>
        ))}
      </div>
      <details className="r-rows">
      <summary>
        {t("Ver las", "Show the")} {doc.rows.length} {t("filas leídas del PDF (rojo = bloqueada)", "rows read from the PDF (red = blocked)")}
      </summary>
      <div className="v-scroll">
        <table className="v-table r-table">
          <thead>
            <tr>
              {["Fecha", "Hora", "Tipo", "Cupos", "Citados", "Corr.", "Agenda", "Estado"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {doc.rows.slice(0, 400).map((r, i) => (
              <tr key={i} className={r.source_blocked ? "r-blocked" : ""}>
                <td>{dmy(r.service_day)}</td>
                <td>{r.starts_at}</td>
                <td>{r.attention}</td>
                <td>{r.capacity}</td>
                <td>{r.booked}</td>
                <td>{r.agenda_code}</td>
                <td>{r.agenda_name}</td>
                <td>{r.source_blocked ? t("Bloqueada", "Blocked") : t("Activa", "Active")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </details>
      <p className="v-muted">
        {t(
          "Al confirmar, la programación de este profesional y establecimiento se reemplaza solo en los días que cubre el archivo. Los cupos consecutivos de una misma agenda se reúnen en una franja; el término de cada cupo es la hora del cupo siguiente.",
          "On confirm, this professional's programming in this establishment is replaced only for the days covered by the file. Consecutive slots of the same agenda are merged; each slot ends at the next slot's time.",
        )}
      </p>
    </div>
  );
}

export function ListsPreview({ file }: { file: ParsedAgendaFile }) {
  const { t } = useLanguage();
  const l = file.lists!;
  return (
    <div className="r-preview">
      <p className="r-kind">
        📋 {t("Listas para autocompletar", "Autocomplete lists")} · {l.professionals.length}{" "}
        {t("profesionales", "professionals")} · {l.agendas.length} {t("agendas", "agendas")}
      </p>
      <div className="r-lists">
        <div>
          <strong>{t("Profesionales", "Professionals")}</strong>
          <p>{l.professionals.slice(0, 12).join(" · ")}{l.professionals.length > 12 ? " …" : ""}</p>
        </div>
        <div>
          <strong>{t("Agendas", "Agendas")}</strong>
          <p>{l.agendas.slice(0, 12).join(" · ")}{l.agendas.length > 12 ? " …" : ""}</p>
        </div>
      </div>
      <p className="v-muted">
        {t(
          "Se agregan solo los nombres que aún no existen. Los profesionales nuevos quedan sin establecimiento ni profesión hasta que se completen o tengan agenda.",
          "Only new names are added. New professionals have no establishment or profession until completed or given an agenda.",
        )}
      </p>
    </div>
  );
}
