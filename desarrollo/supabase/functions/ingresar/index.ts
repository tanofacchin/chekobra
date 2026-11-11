// Ingreso de operarios: código de empresa + legajo + PIN.
// Cuenta los intentos fallidos y bloquea el legajo al quinto; lo desbloquea un administrador desde el panel.
// POST { slug, legajo, pin } → { access_token, refresh_token }
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { derivarClave, correoOperario, MAX_INTENTOS } from "../_shared/pin.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const INCORRECTO = "Código de empresa, legajo o PIN incorrectos.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const pepper = Deno.env.get("PIN_PEPPER") ?? "";
  if (pepper.length < 32) return json({ error: "El ingreso de operarios no está configurado." }, 503);

  let b: Record<string, string>;
  try { b = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }
  const slug = String(b.slug ?? "").trim().toLowerCase(), legajo = String(b.legajo ?? "").trim(), pin = String(b.pin ?? "");
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug) || !/^[A-Za-z0-9._-]{1,30}$/.test(legajo) || !/^\d{6}$/.test(pin)) {
    await esperar(400); return json({ error: INCORRECTO }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: emp } = await admin.from("empresas").select("id").eq("slug", slug).maybeSingle();
  const { data: cand } = emp
    ? await admin.from("miembros").select("id, user_id, legajo, activo, intentos_fallidos, bloqueado_en").eq("empresa_id", emp.id).not("legajo", "is", null)
    : { data: [] };
  const m = (cand ?? []).find((x) => x.legajo.toLowerCase() === legajo.toLowerCase());
  if (!m || !m.user_id || !m.activo) { await esperar(400); return json({ error: INCORRECTO }, 401); }
  if (m.bloqueado_en) return json({ error: "Tu legajo está bloqueado por intentos fallidos. Pedile a tu supervisor que lo desbloquee.", bloqueado: true }, 423);

  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
  const { data: ses, error } = await anon.auth.signInWithPassword({ email: correoOperario(slug, m.legajo), password: await derivarClave(pepper, m.user_id, pin) });

  if (error || !ses.session) {
    const n = (m.intentos_fallidos ?? 0) + 1;
    const bloquear = n >= MAX_INTENTOS;
    await admin.from("miembros").update({ intentos_fallidos: n, bloqueado_en: bloquear ? new Date().toISOString() : null }).eq("id", m.id);
    await esperar(400);
    if (bloquear) return json({ error: "Tu legajo quedó bloqueado por intentos fallidos. Pedile a tu supervisor que lo desbloquee.", bloqueado: true }, 423);
    const quedan = MAX_INTENTOS - n;
    return json({ error: `${INCORRECTO} Te ${quedan === 1 ? "queda 1 intento" : `quedan ${quedan} intentos`}.` }, 401);
  }
  if (m.intentos_fallidos) await admin.from("miembros").update({ intentos_fallidos: 0 }).eq("id", m.id);
  return json({ access_token: ses.session.access_token, refresh_token: ses.session.refresh_token });
});
