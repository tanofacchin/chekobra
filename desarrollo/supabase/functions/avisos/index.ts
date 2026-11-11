// Envía por correo los avisos pendientes (hoy: equipo bloqueado) a supervisores y administradores.
// La llama la base de datos cada 2 minutos (pg_cron) con el header x-cron-secret.
//
// Secretos: CRON_SECRET, RESEND_API_KEY, AVISOS_REMITENTE (ej.: "CheckObra <avisos@tudominio.com>"), APP_URL.
// Sin RESEND_API_KEY los avisos quedan pendientes y se ven igual en el panel.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fecha = (s: string) => new Date(s).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" });

function correoBloqueo(d: Record<string, string>) {
  const asunto = `Equipo bloqueado: ${d.codigo} · ${d.equipo}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a1e22">
    <div style="background:#b3261e;color:#fff;padding:18px 20px;border-radius:10px 10px 0 0"><b style="font-size:20px">Equipo bloqueado</b><br>${esc(d.codigo)} · ${esc(d.equipo)}</div>
    <div style="border:1px solid #ddd;border-top:0;padding:18px 20px;border-radius:0 0 10px 10px">
      <p>El checklist de inicio de jornada encontró fallas en puntos críticos. El equipo no puede operar hasta que alguien lo libere desde el panel.</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="color:#666;padding:4px 12px 4px 0">Fallas</td><td><b>${esc(d.motivo)}</b></td></tr>
        <tr><td style="color:#666;padding:4px 12px 4px 0">Operario</td><td>${esc(d.operario)}</td></tr>
        <tr><td style="color:#666;padding:4px 12px 4px 0">Obra</td><td>${esc(d.obra || "—")}</td></tr>
        <tr><td style="color:#666;padding:4px 12px 4px 0">Cuándo</td><td>${esc(fecha(d.cuando))} h</td></tr>
      </table>
      <p style="margin-top:18px"><a href="${esc(env("APP_URL", "#"))}" style="background:#f0a500;color:#1a1e22;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Abrir el panel</a></p>
      <p style="color:#888;font-size:12px">${esc(d.empresa)} · Aviso automático de CheckObra. Podés dejar de recibirlos desde Personal y obras.</p>
    </div></div>`;
  const texto = `Equipo bloqueado: ${d.codigo} · ${d.equipo}\nFallas: ${d.motivo}\nOperario: ${d.operario}\nObra: ${d.obra || "—"}\nCuándo: ${fecha(d.cuando)} h\n\nAbrir el panel: ${env("APP_URL")}`;
  return { asunto, html, texto };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (!env("CRON_SECRET") || req.headers.get("x-cron-secret") !== env("CRON_SECRET")) return json({ error: "No autorizado" }, 401);
  if (!env("RESEND_API_KEY") || !env("AVISOS_REMITENTE")) return json({ ok: true, sin_proveedor: true });

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: pend } = await admin.from("notificaciones").select("*").eq("estado", "pendiente").order("creada_en").limit(50);
  const res = { enviadas: 0, sin_destinatarios: 0, errores: 0 };
  for (const n of pend ?? []) {
    const { data: dest } = await admin.rpc("destinatarios_avisos", { p_empresa: n.empresa_id });
    if (!dest || !dest.length) {
      await admin.from("notificaciones").update({ estado: "sin_destinatarios" }).eq("id", n.id); res.sin_destinatarios++; continue;
    }
    const c = correoBloqueo(n.datos);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env("AVISOS_REMITENTE"), to: dest.map((d: { correo: string }) => d.correo), subject: c.asunto, html: c.html, text: c.texto }),
    });
    if (r.ok) {
      await admin.from("notificaciones").update({ estado: "enviada", enviada_en: new Date().toISOString(), error: null }).eq("id", n.id); res.enviadas++;
    } else {
      const intentos = n.intentos + 1, err = (await r.text()).slice(0, 300);
      await admin.from("notificaciones").update({ intentos, error: err, estado: intentos >= 5 ? "error" : "pendiente" }).eq("id", n.id); res.errores++;
    }
  }
  return json({ ok: true, ...res });
});
