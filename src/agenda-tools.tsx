import { useState } from "react";
import * as api from "./api.ts";
import { readAgendaFile, type ParsedAgendaFile } from "./agenda-files.ts";
import {
  establishments,
  professionNames,
  standardProfession,
} from "./agenda-import.ts";
import type { AgendaCatalog, CatalogProfessional } from "./agenda-model.ts";
import { useLanguage } from "./language.ts";
export function AgendaImport({
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
    [files, setFiles] = useState<ParsedAgendaFile[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [done, setDone] = useState<string[]>([]);
  const known = new Set([
    ...catalog.professionals
      .filter((p) => p.resource_code)
      .map((p) => p.resource_establishment + "|" + p.resource_code),
    ...files.flatMap((f) =>
      f.professionals.map((p) => p.establishment + "|" + p.resource_code),
    ),
  ]);
  const missing = [
    ...new Set(
      files.flatMap((f) =>
        f.rules
          .filter((r) => !known.has(r.establishment + "|" + r.resource_code))
          .map((r) => r.establishment + " / " + r.resource_code),
      ),
    ),
  ];
  const invalid = files.some((f) => f.errors.length) || !!missing.length;
  return (
    <section className="v-panel v-pad a-import">
      <button className="v-btn primary" onClick={() => setOpen(!open)}>
        {t(
          "Cargar agendas o nómina de profesionales",
          "Upload agendas or professional directory",
        )}
      </button>
      {open && (
        <>
          <h2>
            {t(
              "Revisar archivos antes de guardar",
              "Review files before saving",
            )}
          </h2>
          <p>
            {t(
              "Excel (.xlsx), PDF de texto y páginas guardadas (.php/.html). Los archivos PHP se leen como tablas: nunca se ejecutan. Puedes seleccionar varios archivos.",
              "Excel (.xlsx), text PDF and saved pages (.php/.html). PHP is read as tables and never executed. Multiple files are supported.",
            )}
          </p>
          <input
            aria-label={t(
              "Archivos de agendas o profesionales",
              "Agenda or directory files",
            )}
            type="file"
            multiple
            accept=".xlsx,.pdf,.php,.html,.htm"
            disabled={busy}
            onChange={async (e) => {
              const selected = Array.from(e.target.files || []);
              setMessage("");
              setDone([]);
              setFiles([]);
              setBusy(true);
              try {
                if (selected.length > 6)
                  throw new Error("Máximo seis archivos por carga.");
                const parsed: ParsedAgendaFile[] = [];
                for (const f of selected) parsed.push(await readAgendaFile(f));
                setFiles(parsed);
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
          {busy && <p role="status">{t("Procesando…", "Processing…")}</p>}
          {files.map((f, i) => (
            <article className="a-file-preview" key={f.sha256 + i}>
              <h3>{f.name}</h3>
              <p>
                {f.professionals.length
                  ? `${f.professionals.length} fichas de profesionales`
                  : `${f.rules.length} filas de programación · ${[...new Set(f.rules.map((r) => r.establishment))].join(", ")}`}
              </p>
              {!!f.rules.length && (
                <p>
                  {f.rules.map((r) => r.starts_on).sort()[0]} —{" "}
                  {f.rules
                    .map((r) => r.ends_on)
                    .sort()
                    .at(-1)}{" "}
                  · {f.rules.filter((r) => r.source_blocked).length} filas
                  marcadas BLOQUEADA ·{" "}
                  {f.rules.filter((r) => !r.generated).length} sin generar
                </p>
              )}
              {!!f.warnings.length && (
                <details>
                  <summary>
                    {f.warnings.length} filas sin día coincidente en su rango:
                    conservadas para revisión
                  </summary>
                  {f.warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </details>
              )}
              {f.errors.length > 0 && (
                <div role="alert">
                  {f.errors.slice(0, 10).map((s, i) => (
                    <p key={i}>{s}</p>
                  ))}
                  {f.errors.length > 10 && (
                    <p>… {f.errors.length} errores en total</p>
                  )}
                </div>
              )}
              <div className="v-scroll">
                <table className="v-table">
                  <thead>
                    <tr>
                      {(f.professionals.length
                        ? ["Establecimiento", "Código", "Nombre", "Profesión"]
                        : [
                            "Establecimiento",
                            "Recurso",
                            "Agenda",
                            "Desde / hasta",
                            "Día",
                            "Hora",
                            "Cupos",
                            "Intervalo",
                          ]
                      ).map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {f.professionals.length
                      ? f.professionals.slice(0, 8).map((p) => (
                          <tr key={p.establishment + p.resource_code}>
                            <td>{p.establishment}</td>
                            <td>{p.resource_code}</td>
                            <td>{p.name}</td>
                            <td>{p.profession}</td>
                          </tr>
                        ))
                      : f.rules.slice(0, 8).map((r, i) => (
                          <tr key={i}>
                            <td>{r.establishment}</td>
                            <td>
                              {r.resource_code} · {r.resource_name}
                            </td>
                            <td>
                              {r.agenda_code} · {r.agenda_name}
                            </td>
                            <td>
                              {r.starts_on} / {r.ends_on}
                            </td>
                            <td>
                              {
                                [
                                  "Dom",
                                  "Lun",
                                  "Mar",
                                  "Mié",
                                  "Jue",
                                  "Vie",
                                  "Sáb",
                                ][r.weekday]
                              }
                            </td>
                            <td>{r.starts_at}</td>
                            <td>{r.capacity}</td>
                            <td>{r.interval_minutes} min</td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
              {done.includes(f.sha256) ? (
                <strong>
                  {t("Guardado o ya cargado", "Saved or already loaded")}
                </strong>
              ) : (
                <button
                  className="v-btn"
                  disabled={busy}
                  onClick={() => setFiles(files.filter((_, j) => i !== j))}
                >
                  {t("Quitar de esta carga", "Remove from this upload")}
                </button>
              )}
            </article>
          ))}
          {!!missing.length && (
            <p role="alert">
              {t(
                "Primero agrega las fichas con estos códigos y establecimientos, o incluye la nómina PDF en esta carga:",
                "First add these resource records or include the PDF directory in this upload:",
              )}{" "}
              {missing.slice(0, 20).join("; ")}
            </p>
          )}
          {!!files.length && (
            <>
              <p>
                {t(
                  "Se conservarán días de semana, fechas, cupos, intervalo y marcas originales, incluso en festivos si el archivo programa atención. La carga es atómica por archivo y evita repetir filas idénticas. Los cambios incompatibles requieren revisión.",
                  "Weekdays, dates, capacity, interval and original flags are retained, including holidays when explicitly scheduled. Each file is saved atomically; identical rows are skipped and incompatible changes require review.",
                )}
              </p>
              <button
                className="v-btn primary"
                disabled={
                  busy ||
                  invalid ||
                  preview ||
                  files.every((f) => done.includes(f.sha256))
                }
                onClick={async () => {
                  setBusy(true);
                  setMessage("");
                  const saved = [...done];
                  try {
                    for (const f of [...files].sort(
                      (a, b) => b.professionals.length - a.professionals.length,
                    )) {
                      if (saved.includes(f.sha256)) continue;
                      await api.importAgendaFile(f);
                      saved.push(f.sha256);
                      setDone([...saved]);
                    }
                    setMessage(
                      t(
                        "Carga completada. El calendario y el directorio están actualizados.",
                        "Upload completed. Calendar and directory are updated.",
                      ),
                    );
                  } catch (e) {
                    setMessage((e as Error).message);
                  } finally {
                    await refresh();
                    setBusy(false);
                  }
                }}
              >
                {t("Confirmar carga", "Confirm upload")}
              </button>
            </>
          )}
          {message && <p role="status">{message}</p>}
        </>
      )}
      {!!catalog.imports?.length && (
        <details>
          <summary>
            {t("Historial de cargas", "Upload history")} (
            {catalog.imports.length})
          </summary>
          <ul>
            {catalog.imports
              .slice()
              .reverse()
              .slice(0, 20)
              .map((f) => (
                <li key={f.id}>
                  {new Date(f.created_at).toLocaleString("es-CL")} · {f.name} ·{" "}
                  {f.row_count} filas / {f.inserted_count} procesadas o nuevas
                </li>
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}
export function ProfessionalEditor({
  professional,
  onClose,
  refresh,
  preview = false,
}: {
  professional: CatalogProfessional | null;
  onClose: () => void;
  refresh: () => Promise<void>;
  preview?: boolean;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState<CatalogProfessional>(
    professional || {
      id: "",
      name: "",
      profession: "",
      source_assignment: "Ingreso manual",
      classification: "pending",
      establishments: [],
      resource_code: "",
      resource_establishment: "",
    },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section
      className="v-panel v-pad a-professional-editor"
      aria-label={t("Editar ficha profesional", "Edit professional record")}
    >
      <h2>
        {professional
          ? t("Editar profesional", "Edit professional")
          : t("Agregar profesional", "Add professional")}
      </h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api.saveCatalogProfessional({
              ...form,
              profession: standardProfession(form.profession),
            });
            await refresh();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="a-detail-grid">
          <label>
            {t("Nombre completo", "Full name")}
            <input
              required
              maxLength={250}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            {t("Profesión", "Profession")}
            <input
              required
              list="catalog-professions"
              maxLength={150}
              value={form.profession}
              onChange={(e) => setForm({ ...form, profession: e.target.value })}
            />
            <datalist id="catalog-professions">
              {professionNames.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </datalist>
          </label>
          <label>
            {t("Vinculación", "Assignment")}
            <select
              value={form.classification}
              onChange={(e) =>
                setForm({
                  ...form,
                  classification: e.target
                    .value as CatalogProfessional["classification"],
                  establishments:
                    e.target.value === "support" ? [] : form.establishments,
                })
              }
            >
              <option value="regular">Asignación regular</option>
              <option value="support">Apoyo sin agenda regular</option>
              <option value="pending">Por confirmar</option>
            </select>
          </label>
          <label>
            {t(
              "Establecimiento del código SISMAULE",
              "SISMAULE code establishment",
            )}
            <select
              disabled={!!professional?.resource_code}
              value={form.resource_establishment}
              onChange={(e) =>
                setForm({ ...form, resource_establishment: e.target.value })
              }
            >
              <option value="">Sin código de recurso</option>
              {establishments.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            {t("Código de recurso SISMAULE", "SISMAULE resource code")}
            <input
              maxLength={100}
              disabled={!!professional?.resource_code}
              value={form.resource_code}
              onChange={(e) =>
                setForm({ ...form, resource_code: e.target.value })
              }
            />
            <small>
              {t(
                "El código corresponde a ese establecimiento; no es el código de bloqueo.",
                "This code belongs to this establishment; it is not the block code.",
              )}
            </small>
          </label>
        </div>
        <fieldset>
          <legend>
            {t("Establecimientos de asignación", "Assigned establishments")}
          </legend>
          {establishments.map((s) => (
            <label className="a-check" key={s}>
              <input
                type="checkbox"
                disabled={form.classification === "support"}
                checked={form.establishments.includes(s)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    establishments: e.target.checked
                      ? [...form.establishments, s]
                      : form.establishments.filter((v) => v !== s),
                  })
                }
              />
              {s}
            </label>
          ))}
        </fieldset>
        {professional?.source_profession && (
          <p>
            {t("Profesión en la fuente", "Source profession")}:{" "}
            {professional.source_profession} · {professional.source_origin}
          </p>
        )}
        <p>
          {t(
            "Las correcciones quedan en el historial. No se unen fichas solo por tener nombres parecidos. Una actualización del PDF conserva las correcciones manuales de profesión.",
            "Corrections are retained in history. Similar names are not merged. PDF updates preserve manual profession corrections.",
          )}
        </p>
        {error && <p role="alert">{error}</p>}
        <button
          className="v-btn"
          type="button"
          onClick={onClose}
          disabled={busy}
        >
          {t("Cancelar", "Cancel")}
        </button>{" "}
        <button className="v-btn primary" disabled={busy || preview}>
          {t("Guardar ficha", "Save record")}
        </button>
      </form>
    </section>
  );
}
