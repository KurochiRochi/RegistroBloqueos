// v1.7 · Ingreso simple de agenda: solo lo que se ve en el sistema
// (profesional, establecimiento, agenda, fechas, días, horario y cupos).
import { useMemo, useState } from "react";
import * as api from "./api.ts";
import { establishments } from "./agenda-import.ts";
import type { AgendaCatalog } from "./agenda-model.ts";
import { Combo } from "./combo.tsx";
import { chileToday, professionalKey as key } from "./model.ts";
import { useLanguage } from "./language.ts";

const DAYS: [number, string][] = [
  [1, "Lun"],
  [2, "Mar"],
  [3, "Mié"],
  [4, "Jue"],
  [5, "Vie"],
  [6, "Sáb"],
];
type Slot = { days: number[]; from: string; to: string; cupos: string };
const emptySlot = (): Slot => ({ days: [], from: "08:00", to: "12:00", cupos: "" });
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function QuickAgenda({
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
    [person, setPerson] = useState(""),
    [est, setEst] = useState(""),
    [agenda, setAgenda] = useState(""),
    [from, setFrom] = useState(chileToday()),
    [until, setUntil] = useState(chileToday().slice(0, 4) + "-12-31"),
    [slots, setSlots] = useState<Slot[]>([emptySlot()]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ok, setOk] = useState("");
  const people = useMemo(
    () =>
      [...catalog.professionals]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({
          value: p.name,
          hint: [p.profession, p.establishments.join(", ")].filter(Boolean).join(" · "),
        })),
    [catalog.professionals],
  );
  const fichas = catalog.professionals.filter((p) => key(p.name) === key(person));
  const ficha = fichas.find((p) => est && p.establishments.includes(est)) || fichas[0];
  const agendaOptions = useMemo(
    () => [
      ...new Set([
        ...(catalog.agenda_names || []),
        ...catalog.sessions.map((s) => s.agenda_name),
        ...(catalog.rules || []).map((r) => r.agenda_name),
      ]),
    ]
      .filter(Boolean)
      .sort()
      .map((value) => ({ value })),
    [catalog],
  );
  const set = (i: number, patch: Partial<Slot>) =>
    setSlots((s) => s.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const interval = (s: Slot) => {
    const c = Number(s.cupos),
      m = toMin(s.to) - toMin(s.from);
    return c >= 1 && m > 0 ? Math.max(1, Math.floor(m / c)) : 0;
  };
  function reset() {
    setPerson("");
    setEst("");
    setAgenda("");
    setSlots([emptySlot()]);
    setError("");
  }
  async function save() {
    setError("");
    setOk("");
    if (!ficha) return setError(t("Elige un profesional de la lista.", "Pick a professional from the list."));
    if (!est) return setError(t("Elige el establecimiento.", "Pick the establishment."));
    if (!agenda.trim()) return setError(t("Escribe el nombre de la agenda.", "Type the agenda name."));
    if (until < from) return setError(t("La fecha final es anterior a la inicial.", "End date is before start date."));
    for (const [i, s] of slots.entries()) {
      if (!s.days.length) return setError(`${t("Horario", "Slot")} ${i + 1}: ${t("marca al menos un día.", "pick at least one day.")}`);
      if (!s.from || !s.to || toMin(s.to) <= toMin(s.from))
        return setError(`${t("Horario", "Slot")} ${i + 1}: ${t("la hora de término debe ser posterior al inicio.", "end must be after start.")}`);
      if (!(Number(s.cupos) >= 1 && Number(s.cupos) <= 1000))
        return setError(`${t("Horario", "Slot")} ${i + 1}: ${t("indica los cupos (1 a 1000).", "enter slots (1 to 1000).")}`);
    }
    if (preview) return setError(t("Vista de diseño: no guarda información.", "Design preview: nothing is saved."));
    setBusy(true);
    let id = "";
    try {
      id = (
        await api.manualAgenda.saveHeader({
          professional_id: ficha.id,
          establishment: est,
          agenda_code: "",
          agenda_name: agenda.trim(),
          starts_on: from,
          ends_on: until,
          closed_on: null,
          generated: true,
          staggered: false,
          requires_record: true,
          funding: "PRODUCCIÓN - PRESTACIÓN INSTITUCIONAL",
          agenda_type: "Consulta",
          multi_hour: false,
        })
      ).id;
      for (const s of slots)
        for (const day of s.days)
          await api.manualAgenda.saveDetail({
            manual_agenda_id: id,
            weekday: day,
            starts_at: s.from,
            interval_minutes: interval(s),
            capacity: Number(s.cupos),
            box: "",
          });
      await refresh();
      setOk(t("Agenda guardada. Ya aparece en el calendario.", "Agenda saved. It now shows in the calendar."));
      reset();
    } catch (e) {
      if (id) await api.manualAgenda.remove(id).catch(() => {});
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="v-panel v-pad">
        <button className="v-btn primary" onClick={() => { setOpen(true); setOk(""); }}>
          ＋ {t("Agregar agenda (simple)", "Add agenda (simple)")}
        </button>
        <p className="v-muted">
          {t(
            "Solo profesional, agenda, fechas, días, horario y cupos.",
            "Only professional, agenda, dates, days, hours and slots.",
          )}
        </p>
      </section>
      {open && (
        <div className="sis-overlay" role="dialog" aria-modal="true" aria-label={t("Agregar agenda", "Add agenda")}>
          <div className="sis-dialog q-box">
            <h3 className="sis-title">{t("Agregar agenda", "Add agenda")}</h3>
            <div className="q-grid">
              <label>
                {t("Profesional", "Professional")}
                <Combo
                  required
                  value={person}
                  options={people}
                  placeholder={t("Escribe apellido o nombre…", "Type surname or name…")}
                  onChange={setPerson}
                  onPick={(o) => {
                    const p = catalog.professionals.filter((x) => x.name === o.value);
                    if (p.length === 1 && p[0].establishments.length === 1) setEst(p[0].establishments[0]);
                  }}
                />
              </label>
              <label>
                {t("Establecimiento", "Establishment")}
                <select value={est} onChange={(e) => setEst(e.target.value)}>
                  <option value="">{t("Selecciona…", "Select…")}</option>
                  {establishments.map((e) => (
                    <option key={e}>{e}</option>
                  ))}
                </select>
              </label>
              <label>
                {t("Agenda", "Agenda")}
                <Combo
                  required
                  value={agenda}
                  options={agendaOptions}
                  maxLength={250}
                  placeholder={t("Ej.: CONTROL GENERAL", "E.g. GENERAL CHECK-UP")}
                  onChange={setAgenda}
                />
              </label>
              <label>
                {t("Desde", "From")}
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                {t("Hasta", "Until")}
                <input type="date" min={from} value={until} onChange={(e) => setUntil(e.target.value)} />
              </label>
            </div>
            {slots.map((s, i) => (
              <div className="q-block" key={i}>
                <div className="q-days" role="group" aria-label={t("Días de atención", "Days")}>
                  {DAYS.map(([n, name]) => (
                    <label key={n}>
                      <input
                        type="checkbox"
                        checked={s.days.includes(n)}
                        onChange={(e) =>
                          set(i, { days: e.target.checked ? [...s.days, n] : s.days.filter((d) => d !== n) })
                        }
                      />
                      <span>{name}</span>
                    </label>
                  ))}
                </div>
                <div className="q-grid">
                  <label>
                    {t("Hora inicio", "Start")}
                    <input type="time" value={s.from} onChange={(e) => set(i, { from: e.target.value })} />
                  </label>
                  <label>
                    {t("Hora término", "End")}
                    <input type="time" value={s.to} onChange={(e) => set(i, { to: e.target.value })} />
                  </label>
                  <label>
                    {t("Cupos", "Slots")}
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={s.cupos}
                      onChange={(e) => set(i, { cupos: e.target.value })}
                    />
                  </label>
                </div>
                {interval(s) > 0 && (
                  <small>
                    {t("Un cupo cada", "One slot every")} {interval(s)} min
                  </small>
                )}
                {slots.length > 1 && (
                  <button className="v-link" type="button" onClick={() => setSlots(slots.filter((_, n) => n !== i))}>
                    {t("Quitar este horario", "Remove this slot")}
                  </button>
                )}
              </div>
            ))}
            <button className="v-btn" type="button" onClick={() => setSlots([...slots, emptySlot()])}>
              ＋ {t("Otro horario (otros días u horas)", "Another time slot")}
            </button>
            {error && <p className="v-error" role="alert">{error}</p>}
            {ok && <p role="status" className="v-ok">{ok}</p>}
            <footer className="v-form-actions">
              <button className="v-btn" disabled={busy} onClick={() => { setOpen(false); reset(); }}>
                {t("Cerrar", "Close")}
              </button>
              <button className="v-btn primary" disabled={busy} onClick={() => void save()}>
                {busy ? t("Guardando…", "Saving…") : t("Guardar agenda", "Save agenda")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
