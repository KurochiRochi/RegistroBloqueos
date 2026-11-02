// Aviso por correo de observaciones (opcional). Requiere secreto RESEND_API_KEY en Supabase.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const ADMIN = Deno.env.get("ADMIN_EMAIL") || "jcontreras@saludparral.cl";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  const { id } = await req.json();
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
  const { data: o } = await user.from("observaciones").select("*").eq("id", id).maybeSingle();
  if (!o) return json({ sent: false }, 404);
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ sent: false, reason: "email_not_configured" });
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("MAIL_FROM") || "Registro de bloqueos <onboarding@resend.dev>",
      to: [ADMIN], reply_to: o.email,
      subject: `Observación de ${o.display_name} · Registro de bloqueos`,
      html: `<p><b>${esc(o.display_name)}</b> &lt;${esc(o.email)}&gt; · ${esc(o.role)} · ${esc(o.page)}</p><p style="white-space:pre-wrap">${esc(o.message)}</p>`,
    }),
  });
  return json({ sent: r.ok });
});
