import { useRef, useState } from "react";
import * as api from "./api.ts";
import {
  readSystemFile,
  missingFields,
  type ParsedSystemFile,
} from "./system-blocks.ts";
import { useLanguage } from "./language.ts";

// Panel "Agregar archivo": lee PDF/HTML/PHP guardado, muestra vista previa y confirma.
export function SystemImport({
  connected,
  existingCodes,
  done,
  onNew,
  newDisabled = false,
}: {
  connected: boolean;
  existingCodes: Set<string>;
  done: () => void;
  onNew?: () => void;
  newDisabled?: boolean;
}) {
  const { t } = useLanguage();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ParsedSystemFile[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  async function pick(list: FileList | null) {
    setError("");
    setResult("");
    setFiles([]);
    if (!list?.length) return;
    if (list.length > 6)
      return setError(
        t("Máximo 6 archivos por carga.", "Up to 6 files per upload."),
      );
    setBusy(true);
    try {
      const parsed: ParsedSystemFile[] = [];
      for (const f of list) parsed.push(await readSystemFile(f));
      setFiles(parsed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    setBusy(true);
    setError("");
    const msgs: string[] = [];
    try {
      for (const f of files.filter((f) => f.blocks.length)) {
        const r = await api.importSystemBlocks(f);
        msgs.push(
          `${f.name}: ${r.nuevos} ${t("nuevos", "new")}, ${r.completados} ${t("completados", "completed")}, ${r.repetidos + r.ya_en_app} ${t("ya registrados (omitidos)", "already registered (skipped)")}.`,
        );
      }
      setResult(msgs.join(" "));
      setFiles([]);
      if (input.current) input.current.value = "";
      done();
    } catch (e) {
      setResult(msgs.join(" "));
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const all = files.flatMap((f) => f.blocks);
  const known = all.filter(
    (b) => b.codigo && existingCodes.has(b.codigo.trim().toLowerCase()),
  ).length;
  const incomplete = all.filter((b) => missingFields(b).length).length;
  return (
    <section className="v-panel v-pad v-sys-import">
      <div className="v-sys-head">
        <div>
          <h2>{t("Ingresar bloqueos", "Add blocks")}</h2>
          <p>
            {t(
              "Nuevo bloqueo: ingreso manual paso a paso. Cargar bloqueos: Excel (.xlsx), PDF de texto, HTML o página guardada .php. Los bloqueos ya registrados no se repiten; a los incompletos se les marca ⚠ para completarlos después.",
              "New block: step-by-step manual entry. Upload blocks: Excel (.xlsx), text PDF, HTML or saved .php page. Already registered blocks are not duplicated; incomplete ones are flagged ⚠ to finish later.",
            )}
          </p>
        </div>
        <div className="v-sys-actions">
        {onNew && (
          <button
            className="v-btn primary"
            disabled={newDisabled}
            onClick={onNew}
          >
            ＋ {t("Nuevo bloqueo", "New block")}
          </button>
        )}
        <label
          className={"v-btn primary" + (!connected || busy ? " disabled" : "")}
        >
          ⇪ {t("Cargar bloqueos (Excel, PDF, PHP)", "Upload blocks (Excel, PDF, PHP)")}
          <input
            ref={input}
            type="file"
            hidden
            multiple
            disabled={!connected || busy}
            accept=".xlsx,.pdf,.html,.htm,.php,application/pdf,text/html,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => void pick(e.target.files)}
          />
        </label>
        </div>
      </div>
      {busy && <p>{t("Procesando…", "Processing…")}</p>}
      {files.length > 0 && (
        <div className="v-sys-preview">
          {files.map((f) => (
            <p key={f.sha256}>
              <strong>{f.name}</strong>: {f.blocks.length}{" "}
              {t("bloqueos leídos", "blocks read")}
              {f.errors.map((e) => (
                <span key={e} className="v-error">
                  {" "}
                  {e}
                </span>
              ))}
            </p>
          ))}
          <p>
            {all.length} {t("en total", "in total")} · {known}{" "}
            {t("ya están en la lista", "already listed")} · {incomplete}{" "}
            {t("con información incompleta", "with incomplete information")}
          </p>
          <button
            className="v-btn primary"
            disabled={busy || !all.length}
            onClick={() => void confirm()}
          >
            {t("Confirmar carga", "Confirm upload")}
          </button>{" "}
          <button
            className="v-btn"
            disabled={busy}
            onClick={() => setFiles([])}
          >
            {t("Cancelar", "Cancel")}
          </button>
        </div>
      )}
      {result && <p className="v-ok">{result}</p>}
      {error && <p className="v-error">{error}</p>}
    </section>
  );
}
