// Aviso por correo de observaciones (opcional). Requiere secreto RESEND_API_KEY en Supabase.
// v1.6: CORS limitado al sitio, validación de entrada y sin cabeceras con saltos de línea.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://registro-de-bloqueos.pages.dev";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  Vary: "Origin",
};
const ADMIN = Deno.env.get("ADMIN_EMAIL") || "jcontreras@saludparral.cl";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const oneLine = (s: string) => String(s ?? "").replace(/[\r\n]+/g, " ").slice(0, 150);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ sent: false }, 405);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ sent: false }, 401);
  let id: unknown;
  try {
    ({ id } = await req.json());
  } catch {
    return json({ sent: false }, 400);
  }
  if (typeof id !== "string" || !UUID.test(id)) return json({ sent: false }, 400);
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: o } = await user.from("observaciones").select("*").eq("id", id).maybeSingle();
  if (!o) return json({ sent: false }, 404);
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ sent: false, reason: "email_not_configured" });
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("MAIL_FROM") || "Registro de bloqueos <onboarding@resend.dev>",
      to: [ADMIN], reply_to: oneLine(o.email),
      subject: `Observación de ${oneLine(o.display_name)} · Registro de bloqueos`,
      html: `<p><b>${esc(o.display_name)}</b> &lt;${esc(o.email)}&gt; · ${esc(o.role)} · ${esc(o.page)}</p><p style="white-space:pre-wrap">${esc(o.message)}</p>`,
    }),
  });
  return json({ sent: r.ok });
});
