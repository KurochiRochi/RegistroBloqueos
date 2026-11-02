import { createClient } from "@supabase/supabase-js";
import type { PendingDocument, PatientDocument } from "./patients.ts";
import type { AgendaCatalog } from "./agenda-model.ts";
import {
  fields,
  validate,
  assertExportRange,
  type Data,
  type RecordRow,
  type Profile,
  type Calendar,
  type EventRow,
} from "./model.ts";
const url = import.meta.env.VITE_SUPABASE_URL || "";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
export const configured = !!(
  url.startsWith("https://") &&
  key &&
  !url.includes("TU-PROYECTO") &&
  !key.startsWith("TU_")
);
export const supabase = configured
  ? createClient(url, key, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
function client() {
  if (!supabase)
    throw new Error("Configura la conexión de la app con su base de datos.");
  return supabase;
}
export function explain(error: { message: string; code?: string }) {
  if (error.code === "23505")
    return "El código SISMAULE ya está registrado, incluso si está archivado.";
  if (error.code === "42501")
    return "Tu perfil no permite realizar esta acción.";
  return error.message;
}
export async function identity() {
  const { data, error } = await client().auth.getUser();
  if (error || !data.user) throw new Error("Inicia sesión para continuar.");
  const p = await client().rpc("my_profile").maybeSingle();
  if (p.error) throw new Error(explain(p.error));
  if (!(p.data as Profile | null)?.active)
    throw Object.assign(
      new Error(
        "Tu correo todavía no tiene un perfil activo. Solicita acceso a la administración.",
      ),
      { status: 403 },
    );
  return { profile: p.data as Profile, id: data.user.id };
}
export async function calendar(): Promise<Calendar> {
  const [years, holidays] = await Promise.all([
    client().from("calendar_years").select("*").order("year"),
    client().from("holidays").select("*").order("day"),
  ]);
  if (years.error) throw new Error(explain(years.error));
  if (holidays.error) throw new Error(explain(holidays.error));
  return { years: years.data, holidays: holidays.data };
}
let cachedCatalog: AgendaCatalog | null = null;
export function invalidateAgendaCatalog() {
  cachedCatalog = null;
}
export async function agendaCatalog(): Promise<AgendaCatalog> {
  if (cachedCatalog) return cachedCatalog;
  const result = await client().rpc('agenda_catalog_v13');
  if (result.error) throw new Error(explain(result.error));
  cachedCatalog = result.data as AgendaCatalog;
  return cachedCatalog;
}
export async function importAgendaFile(
  file: import("./agenda-files.ts").ParsedAgendaFile,
) {
  const r = await client().rpc(
    file.professionals.length ? "import_professionals" : "import_agendas",
    {
      meta: { name: file.name, sha256: file.sha256 },
      entries: file.professionals.length ? file.professionals : file.rules,
    },
  );
  if (r.error) throw new Error(r.error.message);
  invalidateAgendaCatalog();
  return r.data;
}
export async function saveCatalogProfessional(payload: unknown) {
  const r = await client().rpc("save_catalog_professional", { payload });
  if (r.error)
    throw new Error(
      r.error.code === "23505"
        ? "Ese código SISMAULE ya tiene una ficha en el establecimiento."
        : r.error.message,
    );
  invalidateAgendaCatalog();
  return r.data;
}
// Paginación explícita: no pierde registros cuando se supera el límite REST.
export async function records(
  from?: string,
  until?: string,
): Promise<RecordRow[]> {
  if (from !== undefined || until !== undefined)
    assertExportRange(from || "", until || "");
  const all: RecordRow[] = [];
  for (let offset = 0; ; offset += 500) {
    let q = client().from("bloqueos").select("*").order("id");
    if (from && until)
      q = q
        .lte("Fecha_Inicio", until)
        .gte("Fecha_Termino", from)
        .eq("archived", 0);
    const r = await q.range(offset, offset + 499);
    if (r.error) throw new Error(explain(r.error));
    all.push(...(r.data as RecordRow[]));
    if (r.data.length < 500) break;
  }
  return all.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
export async function saveRecord(
  raw: Data,
  cal: Calendar,
  old?: RecordRow,
  archived?: number,
  documents: PendingDocument[] = [],
) {
  const clean = validate(raw, cal);
  const payload = {
    ...clean,
    ...(old
      ? { version: old.version + 1, archived: archived ?? old.archived }
      : {}),
  };
  if (!old) {
    const user = await client().auth.getUser();
    if (!user.data.user) throw new Error("Inicia sesión.");
    const uploaded: string[] = [];
    let committed = false;
    try {
      const metadata = [];
      for (const doc of documents) {
        const path = `${user.data.user.id}/${doc.id}.${doc.file_type}`;
        const up = await client()
          .storage.from("pacientes-citados")
          .upload(path, doc.file, {
            contentType:
              doc.file_type === "pdf" ? "application/pdf" : "text/html",
            upsert: false,
            cacheControl: "0",
          });
        if (up.error) throw new Error(explain(up.error));
        uploaded.push(path);
        const { file, ...meta } = doc;
        metadata.push({ ...meta, object_path: path });
      }
      const r = await client().rpc("create_bloqueo_v11", {
        payload,
        documents: metadata,
      });
      if (r.error) throw new Error(explain(r.error));
      committed = true;
      return r.data as string;
    } finally {
      if (!committed && uploaded.length)
        await client().storage.from("pacientes-citados").remove(uploaded);
    }
  }
  let q = old
    ? client()
        .from("bloqueos")
        .update(payload)
        .eq("id", old.id)
        .eq("version", old.version)
    : client().from("bloqueos").insert(payload);
  const result = await q.select("id");
  if (result.error) throw new Error(explain(result.error));
  if (!result.data?.length)
    throw new Error(
      "El registro cambió o tu perfil no permite editarlo. Actualiza la tabla; el formulario conserva tus datos.",
    );
  return result.data[0].id as string;
}
export async function history(id?: string): Promise<EventRow[]> {
  let q = client()
    .from("historial")
    .select("*")
    .order("id", { ascending: false })
    .limit(200);
  if (id) q = q.eq("bloqueo_id", id);
  const r = await q;
  if (r.error) throw new Error(explain(r.error));
  return r.data;
}
export async function profiles(): Promise<Profile[]> {
  const r = await client().from("profiles").select("*").order("email");
  if (r.error) throw new Error(explain(r.error));
  return r.data;
}
export async function saveProfile(profile: Profile) {
  const p = {
    role: profile.role,
    active: profile.active,
    email: profile.email.trim().toLowerCase(),
    display_name: profile.display_name.trim(),
  };
  const r = await client().from("profiles").upsert(p, { onConflict: "email" });
  if (r.error) throw new Error(explain(r.error));
}
export async function saveHoliday(day: string, name: string, source: string) {
  const r = await client()
    .from("holidays")
    .upsert({ day, name, source }, { onConflict: "day" });
  if (r.error) throw new Error(explain(r.error));
}
export async function removeHoliday(day: string) {
  const r = await client().from("holidays").delete().eq("day", day);
  if (r.error) throw new Error(explain(r.error));
}
export async function reviewYear(year: number, source: string) {
  const r = await client()
    .from("calendar_years")
    .upsert({ year, source, reviewed: true }, { onConflict: "year" });
  if (r.error) throw new Error(explain(r.error));
}
export { fields };
export async function updateOwnProfile(display_name: string, phone: string) {
  const user = await client().auth.getUser();
  const r = await client()
    .from("profiles")
    .update({ display_name: display_name.trim(), phone: phone.trim() })
    .eq("auth_user_id", user.data.user?.id)
    .select("email");
  if (r.error) throw new Error(explain(r.error));
  if (!r.data?.length) throw new Error("Perfil no encontrado.");
}
export async function patientDocuments(
  blockId?: string,
): Promise<PatientDocument[]> {
  const all: PatientDocument[] = [];
  for (let offset = 0; ; offset += 200) {
    let q = client()
      .from("patient_documents")
      .select("*")
      .order("appointment_day")
      .order("id");
    if (blockId) q = q.eq("bloqueo_id", blockId);
    const r = await q.range(offset, offset + 199);
    if (r.error) throw new Error(explain(r.error));
    all.push(...r.data);
    if (r.data.length < 200) break;
  }
  return all;
}
export async function downloadPatientDocument(doc: PatientDocument) {
  const r = await client()
    .storage.from("pacientes-citados")
    .download(doc.object_path);
  if (r.error) throw new Error(explain(r.error));
  return r.data;
}

// Bloqueos importados desde archivos del sistema (011).
export async function systemBlocks(): Promise<
  (import("./system-blocks.ts").SystemBlock & { id: string; carga_id: string })[]
> {
  const all: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await client()
      .from("bloqueos_sistema")
      .select("*")
      .order("fecha_inicio", { ascending: false, nullsFirst: true })
      .range(offset, offset + 999);
    if (r.error) {
      // Migración 011 aún no aplicada: la vista sigue funcionando sin esta lista.
      if (r.error.code === "42P01" || r.error.code === "PGRST205") return [];
      throw new Error(explain(r.error));
    }
    all.push(
      ...r.data.map((b) => ({
        ...b,
        fecha_inicio: b.fecha_inicio || "",
        fecha_termino: b.fecha_termino || "",
      })),
    );
    if (r.data.length < 1000) return all;
  }
}
export async function importSystemBlocks(
  file: import("./system-blocks.ts").ParsedSystemFile,
) {
  const r = await client().rpc("import_bloqueos_sistema", {
    meta: { name: file.name, sha256: file.sha256 },
    entries: file.blocks,
  });
  if (r.error)
    throw new Error(
      r.error.code === "23505"
        ? `${file.name}: este archivo ya fue cargado anteriormente.`
        : r.error.message,
    );
  return r.data as {
    nuevos: number;
    completados: number;
    repetidos: number;
    ya_en_app: number;
  };
}

// ---- Versión 1.5 ----
export type MpoDate = {
  id: string;
  day: string;
  name: string;
  audience: string;
  establishment: string;
  source: string;
};
export async function mpoDates(): Promise<MpoDate[]> {
  const r = await client().from("mpo_dates").select("*").order("day");
  if (r.error) {
    if (r.error.code === "42P01" || r.error.code === "PGRST205") return [];
    throw new Error(explain(r.error));
  }
  return r.data as MpoDate[];
}
export async function saveMpo(rows: Omit<MpoDate, "id">[]) {
  const r = await client()
    .from("mpo_dates")
    .upsert(rows, { onConflict: "day,name,establishment", ignoreDuplicates: true });
  if (r.error) throw new Error(explain(r.error));
}
export async function removeMpo(id: string) {
  const r = await client().from("mpo_dates").delete().eq("id", id);
  if (r.error) throw new Error(explain(r.error));
}
export type Observation = {
  id: string;
  created_at: string;
  email: string;
  display_name: string;
  role: string;
  page: string;
  message: string;
  status: "nueva" | "leida" | "respondida";
};
export async function sendObservation(message: string, page: string) {
  const r = await client()
    .from("observaciones")
    .insert({ message: message.trim(), page })
    .select("id")
    .single();
  if (r.error) throw new Error(explain(r.error));
  // Aviso por correo si la función de envío está configurada; si no, queda en la bandeja.
  try {
    await client().functions.invoke("enviar-observacion", { body: { id: r.data.id } });
  } catch {}
  return r.data.id as string;
}
export async function observations(): Promise<Observation[]> {
  const r = await client()
    .from("observaciones")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (r.error) throw new Error(explain(r.error));
  return r.data as Observation[];
}
export async function markObservation(id: string, status: Observation["status"]) {
  const r = await client().from("observaciones").update({ status }).eq("id", id);
  if (r.error) throw new Error(explain(r.error));
}
export type ManualAgendaEntry = {
  professional_id: string;
  establishment: string;
  agenda_code: string;
  agenda_name: string;
  starts_on: string;
  ends_on: string;
  weekday: number;
  starts_at: string;
  interval_minutes: number;
  capacity: number;
  attention: string;
};
export async function saveManualAgenda(
  name: string,
  entries: ManualAgendaEntry[],
  images: File[],
) {
  const user = await client().auth.getUser();
  if (!user.data.user) throw new Error("Inicia sesión.");
  const paths: string[] = [];
  for (const img of images) {
    const ext = (img.name.split(".").pop() || "png").toLowerCase();
    const path = `${user.data.user.id}/${crypto.randomUUID()}.${ext}`;
    const up = await client()
      .storage.from("agenda-imagenes")
      .upload(path, img, { contentType: img.type || "image/png", upsert: false });
    if (up.error) throw new Error(explain(up.error));
    paths.push(path);
  }
  const text = JSON.stringify({ entries, paths, at: Date.now() });
  const sha256 = [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const r = await client().rpc("save_manual_agenda", {
    meta: { name, sha256, attachments: paths },
    entries,
  });
  if (r.error) {
    if (paths.length) await client().storage.from("agenda-imagenes").remove(paths);
    throw new Error(r.error.message);
  }
  invalidateAgendaCatalog();
  return r.data as { inserted: number };
}
