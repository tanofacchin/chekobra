// Verificación en dos pasos propia de Operapto (lo que Supabase no ofrece como factor):
//
// Código por correo
//   POST { accion: "enviar" } → manda un código de 6 números al correo de quien llama (vence en 10 minutos).
//   La verificación la hace la base: public.verificar_codigo_correo(código). Acá solo se guarda el hash.
//   Secretos: RESEND_API_KEY y AVISOS_REMITENTE (los mismos de los avisos).
//
// Huella o cara (llaves de acceso, estándar WebAuthn)
//   POST { accion: "huella_opciones_alta" }            → opciones para registrar el dispositivo
//   POST { accion: "huella_alta", respuesta, nombre }  → comprueba y guarda la llave pública
//   POST { accion: "huella_opciones" }                 → desafío para verificar al entrar
//   POST { accion: "huella_verificar", respuesta }     → comprueba la firma y marca la sesión como verificada
//   Orígenes permitidos: ORIGENES_APP (separados por coma; por defecto la app publicada). PERMITIR_LOCALHOST=1 para pruebas.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from "npm:@simplewebauthn/server@13.2.2";
import { isoBase64URL } from "npm:@simplewebauthn/server@13.2.2/helpers";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) ?? "";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const url = env("SUPABASE_URL");
  const comoUsuario = createClient(url, env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const admin = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: quien } = await comoUsuario.auth.getUser();
  const u = quien?.user;
  if (!u) return json({ error: "Iniciá sesión" }, 401);
  if (!u.email || u.email.endsWith(".operarios.invalid")) return json({ error: "La verificación en dos pasos es para quienes entran con correo" }, 400);

  // deno-lint-ignore no-explicit-any
  let b: Record<string, any>;
  try { b = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }
  if (b.accion?.startsWith("huella")) return await huella(b, u, req, comoUsuario, admin);
  if (b.accion !== "enviar") return json({ error: "Acción desconocida" }, 400);
  if (u.email.endsWith(".invalid")) return json({ error: "Esta cuenta no tiene un correo donde recibir el código" }, 400);
  if (!env("RESEND_API_KEY") || !env("AVISOS_REMITENTE")) {
    return json({ error: "El envío de correos todavía no está configurado. Usá la app autenticadora o la huella." }, 503);
  }

  // Límite: 3 códigos cada 10 minutos y 10 por día.
  const hace = (min: number) => new Date(Date.now() - min * 60000).toISOString();
  const { count: c10 } = await admin.from("codigos_correo").select("id", { count: "exact", head: true }).eq("user_id", u.id).gte("creado_en", hace(10));
  const { count: c24 } = await admin.from("codigos_correo").select("id", { count: "exact", head: true }).eq("user_id", u.id).gte("creado_en", hace(1440));
  if ((c10 ?? 0) >= 3 || (c24 ?? 0) >= 10) return json({ error: "Pediste muchos códigos. Esperá unos minutos." }, 429);

  const n = new Uint32Array(1); crypto.getRandomValues(n);
  const codigo = String(n[0] % 1_000_000).padStart(6, "0");
  const hash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${u.id}:${codigo}`)));
  await admin.from("codigos_correo").update({ usado: true }).eq("user_id", u.id).eq("usado", false);   // solo vale el último
  await admin.from("codigos_correo").delete().eq("user_id", u.id).lt("creado_en", hace(2880));
  const { error: ei } = await admin.from("codigos_correo").insert({ user_id: u.id, hash, expira: new Date(Date.now() + 10 * 60000).toISOString() });
  if (ei) return json({ error: "No se pudo generar el código" }, 500);

  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;color:#1a1e22">
    <p>Tu código de verificación de Operapto es:</p>
    <p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:12px 0">${codigo}</p>
    <p style="color:#555">Vence en 10 minutos. Si no fuiste vos, cambiá tu contraseña: alguien la conoce.</p>
    <p style="color:#888;font-size:12px">Operapto · nunca te vamos a pedir este código por teléfono ni por mensaje.</p></div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("AVISOS_REMITENTE"), to: [u.email], subject: `Tu código de Operapto: ${codigo}`, html,
      text: `Tu código de verificación de Operapto es ${codigo}. Vence en 10 minutos. Si no fuiste vos, cambiá tu contraseña.` }),
  });
  if (!r.ok) return json({ error: "No se pudo mandar el correo. Probá de nuevo en un rato." }, 502);
  return json({ ok: true, correo: u.email.replace(/^(.).*(@.*)$/, "$1•••$2") });
});

/* ================================================================ huella o cara */
function origenPermitido(req: Request): { origen: string; rpId: string } | null {
  const origen = req.headers.get("Origin") ?? "";
  let host = "";
  try { host = new URL(origen).hostname; } catch { return null; }
  const lista = (env("ORIGENES_APP") || "https://tanofacchin.github.io").split(",").map((x) => x.trim()).filter(Boolean);
  const local = env("PERMITIR_LOCALHOST") === "1" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origen);
  return lista.includes(origen) || local ? { origen, rpId: host } : null;
}
// session_id del token (ya validado por getUser): es lo que la base usa para saber que esta sesión se verificó.
function sesionDe(req: Request): string | null {
  try {
    const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").split(".")[1];
    return JSON.parse(atob(t.replace(/-/g, "+").replace(/_/g, "/"))).session_id ?? null;
  } catch { return null; }
}

// deno-lint-ignore no-explicit-any
async function huella(b: Record<string, any>, u: { id: string; email?: string }, req: Request, comoUsuario: any, admin: any) {
  const o = origenPermitido(req);
  if (!o) return json({ error: "Este sitio no está habilitado para usar huella o cara" }, 403);
  const { data: existentes } = await admin.from("huellas").select("id, credencial, clave_publica, contador, transportes, rp_id").eq("user_id", u.id);
  const guardar = (desafio: string, tipo: string) => admin.from("desafios_huella")
    .upsert({ user_id: u.id, desafio, tipo, expira: new Date(Date.now() + 5 * 60000).toISOString() });
  const desafio = async (tipo: string) => {
    const { data } = await admin.from("desafios_huella").select("*").eq("user_id", u.id).maybeSingle();
    await admin.from("desafios_huella").delete().eq("user_id", u.id);   // un solo uso
    return data && data.tipo === tipo && new Date(data.expira) > new Date() ? data.desafio : null;
  };

  if (b.accion === "huella_opciones_alta") {
    // Si ya tiene otra forma activada, para agregar una nueva tiene que haber verificado esta sesión.
    const { data: pend } = await comoUsuario.rpc("segundo_factor_pendiente");
    if (pend === "verificar") return json({ error: "Primero verificá esta sesión" }, 403);
    if ((existentes ?? []).length >= 10) return json({ error: "Ya tenés 10 dispositivos. Quitá alguno." }, 400);
    const opciones = await generateRegistrationOptions({
      rpName: "Operapto", rpID: o.rpId, userName: u.email ?? u.id, userDisplayName: u.email ?? "",
      userID: new TextEncoder().encode(u.id), attestationType: "none",
      // deno-lint-ignore no-explicit-any
      excludeCredentials: (existentes ?? []).filter((h: any) => h.rp_id === o.rpId).map((h: any) => ({ id: h.credencial, transports: h.transportes ?? undefined })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    });
    await guardar(opciones.challenge, "alta");
    return json({ opciones });
  }

  if (b.accion === "huella_alta") {
    const esperado = await desafio("alta");
    if (!esperado) return json({ error: "Se venció el pedido. Probá de nuevo." }, 400);
    let v;
    try {
      v = await verifyRegistrationResponse({ response: b.respuesta, expectedChallenge: esperado, expectedOrigin: o.origen, expectedRPID: o.rpId, requireUserVerification: true });
    } catch (e) { return json({ error: "No se pudo comprobar la huella: " + (e as Error).message }, 400); }
    if (!v.verified || !v.registrationInfo) return json({ error: "No se pudo comprobar la huella" }, 400);
    const c = v.registrationInfo.credential;
    const nombre = String(b.nombre ?? "Dispositivo").slice(0, 60);
    const { error } = await admin.from("huellas").insert({ user_id: u.id, credencial: c.id, clave_publica: isoBase64URL.fromBuffer(c.publicKey),
      contador: c.counter, transportes: c.transports ?? null, nombre, rp_id: o.rpId });
    if (error) return json({ error: /duplicate/.test(error.message) ? "Este dispositivo ya estaba agregado" : "No se pudo guardar" }, 400);
    // Quien acaba de registrarla está presente: esta sesión queda verificada.
    const sid = sesionDe(req);
    if (sid) await admin.from("sesiones_verificadas").upsert({ session_id: sid, user_id: u.id, verificada_en: new Date().toISOString(), expira: new Date(Date.now() + 30 * 864e5).toISOString() });
    return json({ ok: true });
  }

  if (b.accion === "huella_opciones") {
    // deno-lint-ignore no-explicit-any
    const aca = (existentes ?? []).filter((h: any) => h.rp_id === o.rpId);
    if (!aca.length) return json({ error: "No tenés huella o cara activada para este sitio" }, 400);
    // deno-lint-ignore no-explicit-any
    const opciones = await generateAuthenticationOptions({ rpID: o.rpId, userVerification: "required", allowCredentials: aca.map((h: any) => ({ id: h.credencial, transports: h.transportes ?? undefined })) });
    await guardar(opciones.challenge, "ingreso");
    return json({ opciones });
  }

  if (b.accion === "huella_verificar") {
    const esperado = await desafio("ingreso");
    if (!esperado) return json({ error: "Se venció el pedido. Probá de nuevo." }, 400);
    // deno-lint-ignore no-explicit-any
    const h = (existentes ?? []).find((x: any) => x.credencial === b.respuesta?.id && x.rp_id === o.rpId);
    if (!h) return json({ error: "Ese dispositivo no está registrado en tu cuenta" }, 400);
    let v;
    try {
      v = await verifyAuthenticationResponse({ response: b.respuesta, expectedChallenge: esperado, expectedOrigin: o.origen, expectedRPID: o.rpId, requireUserVerification: true,
        credential: { id: h.credencial, publicKey: isoBase64URL.toBuffer(h.clave_publica), counter: Number(h.contador), transports: h.transportes ?? undefined } });
    } catch (e) { return json({ error: "No se pudo comprobar la huella: " + (e as Error).message }, 400); }
    if (!v.verified) return json({ error: "No se pudo comprobar la huella" }, 400);
    const sid = sesionDe(req);
    if (!sid) return json({ error: "Sesión inválida" }, 400);
    await admin.from("huellas").update({ contador: v.authenticationInfo.newCounter, usada_en: new Date().toISOString() }).eq("id", h.id);
    await admin.from("sesiones_verificadas").upsert({ session_id: sid, user_id: u.id, verificada_en: new Date().toISOString(), expira: new Date(Date.now() + 30 * 864e5).toISOString() });
    return json({ ok: true });
  }
  return json({ error: "Acción desconocida" }, 400);
}
