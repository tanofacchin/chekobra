// Envía por correo los avisos pendientes (equipo bloqueado y resumen del día) a supervisores y administradores.
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

// Resumen del día (lo arma la base a las 19 h: ver resumen_diario_interno).
// deno-lint-ignore no-explicit-any
function correoResumen(d: any) {
  const dia = new Date(d.fecha + "T12:00:00Z").toLocaleDateString("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
  const n = (v: unknown) => Number(v ?? 0).toLocaleString("es-AR", { maximumFractionDigits: 1 });
  const asunto = `Resumen del ${dia}: ${d.checklists} checklists${d.bloqueados.length ? `, ${d.bloqueados.length} equipo${d.bloqueados.length > 1 ? "s" : ""} bloqueado${d.bloqueados.length > 1 ? "s" : ""}` : ""}`;
  const sec = (titulo: string, items: string[], color = "#1a1e22") => items.length
    ? `<h3 style="font-size:15px;margin:18px 0 6px;color:${color}">${esc(titulo)} (${items.length})</h3><ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.5">${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "";
  // deno-lint-ignore no-explicit-any
  const bloq = d.bloqueados.map((b: any) => `<b>${esc(b.codigo)}</b> ${esc(b.equipo)}: ${esc(b.motivo || "falla crítica")}${b.orden ? ` · ${esc(b.orden)} en el taller` : " · <b>sin orden de trabajo</b>"}`);
  // deno-lint-ignore no-explicit-any
  const fallas = d.fallas_nuevas.map((f: any) => `<b>${esc(f.codigo)}</b> ${f.critica ? "CRÍTICA · " : f.grave ? "ADVERTENCIA · " : ""}${esc(f.texto)}: ${esc(f.nota)} (${esc(f.operario)})`);
  // deno-lint-ignore no-explicit-any
  const rep = d.repetidas.map((f: any) => `<b>${esc(f.codigo)}</b> ${esc(f.texto)}: ${f.motivo === "reaparecio" ? "volvió después de repararse" : `${f.veces} veces en 30 días`}`);
  // deno-lint-ignore no-explicit-any
  const abiertas = d.sin_cerrar.map((j: any) => `<b>${esc(j.codigo)}</b> ${esc(j.operario)}, desde ${esc(fecha(j.desde))} h`);
  // deno-lint-ignore no-explicit-any
  const obras = d.por_obra.map((o: any) => `${esc(o.obra)}: ${o.equipos} equipo${o.equipos === 1 ? "" : "s"}, ${n(o.horas)} h`);
  // deno-lint-ignore no-explicit-any
  const taller = d.ordenes_terminadas.map((o: any) => `OT ${o.numero} · <b>${esc(o.codigo)}</b> ${esc(o.titulo)}${o.libero ? " (liberó el equipo)" : ""}`);
  const caja = (v: string, t: string, rojo = false) => `<td style="padding:10px 12px;border:1px solid #ddd;border-radius:8px;text-align:center"><b style="font-size:22px;color:${rojo ? "#b3261e" : "#1a1e22"}">${v}</b><br><span style="font-size:12px;color:#666">${t}</span></td>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;color:#1a1e22">
    <div style="background:#1a1e22;color:#fff;padding:18px 20px;border-radius:10px 10px 0 0"><b style="font-size:20px">Resumen del día</b><br><span style="text-transform:capitalize">${esc(dia)}</span> · ${esc(d.empresa)}</div>
    <div style="border:1px solid #ddd;border-top:0;padding:18px 20px;border-radius:0 0 10px 10px">
      <table style="border-collapse:separate;border-spacing:6px;width:100%"><tr>${caja(String(d.checklists), "checklists")}${caja(String(d.equipos_trabajaron), "equipos trabajaron")}${caja(n(d.horas) + " h", "horas de máquina")}${caja(String(d.bloqueados.length), "bloqueados", d.bloqueados.length > 0)}</tr></table>
      <p style="font-size:13px;color:#555">${d.aptos} aptos · ${d.observaciones} con observaciones · ${d.no_aptos} no aptos${d.rapidos ? ` · ${d.rapidos} hechos en menos de 2 minutos` : ""}${Number(d.litros) ? ` · ${n(d.litros)} L de combustible` : ""} · ${d.ordenes_abiertas} órdenes de trabajo abiertas</p>
      ${sec("Equipos bloqueados", bloq, "#b3261e")}${sec("Fallas del día", fallas)}${sec("Fallas repetidas", rep, "#9a5b00")}${sec("Jornadas sin cerrar", abiertas, "#9a5b00")}${sec("Por obra", obras)}${sec("Taller: trabajos terminados", taller)}
      ${d.sin_checklist.length ? `<p style="font-size:13px;color:#555;margin-top:16px"><b>Operativos sin checklist (${d.sin_checklist.length}):</b> ${d.sin_checklist.map(esc).join(", ")}</p>` : ""}
      <p style="margin-top:18px"><a href="${esc(env("APP_URL", "#"))}" style="background:#f0a500;color:#1a1e22;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Abrir el panel</a></p>
      <p style="color:#888;font-size:12px">Resumen automático de CheckObra, todos los días a las 19 h. Podés dejar de recibirlo desde Personal y obras.</p>
    </div></div>`;
  const limpio = (s: string) => s.replace(/<[^>]+>/g, "");
  const texto = [`Resumen del ${dia} · ${d.empresa}`, `${d.checklists} checklists · ${d.equipos_trabajaron} equipos · ${n(d.horas)} h · ${d.bloqueados.length} bloqueados`,
    ...bloq.map((b: string) => "BLOQUEADO: " + limpio(b)), ...fallas.map((f: string) => "Falla: " + limpio(f)), "", `Abrir el panel: ${env("APP_URL")}`].join("\n");
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
    const c = n.tipo === "resumen_diario" ? correoResumen(n.datos) : correoBloqueo(n.datos);
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
