// Integración con John Deere (JDLink) mediante la API ISO 15143-3.
//
//   POST {accion: "conectar", empresa_id}      → URL de John Deere para autorizar (dueño/admin)
//   GET  /johndeere/callback?code&state        → John Deere vuelve acá; guarda tokens y redirige a la app
//   POST {accion: "sincronizar", empresa_id}   → baja las lecturas ahora (supervisor o superior)
//   POST {accion: "desconectar", empresa_id}   → borra los tokens (dueño/admin)
//   POST {accion: "sincronizar_todo"} + header x-cron-secret → todas las empresas (tarea programada)
//
// Secretos de la función: JD_CLIENT_ID, JD_CLIENT_SECRET, APP_URL, CRON_SECRET
// y opcionalmente JD_API_BASE (por defecto el sandbox de John Deere).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { XMLParser } from "npm:fast-xml-parser@4.5.0";
import { parsearFlota, claveSerie } from "../_shared/iso15143.js";

const WELL_KNOWN = "https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/.well-known/oauth-authorization-server";
const SCOPES = "eq2 offline_access";
const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const API_BASE = () => env("JD_API_BASE", "https://sandboxaemp.deere.com/Fleet").replace(/\/$/, "");
const CALLBACK = () => `${env("SUPABASE_URL")}/functions/v1/johndeere/callback`;
const PROVEEDOR = "john_deere";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const redirigir = (url: string) => new Response(null, { status: 302, headers: { Location: url } });
const conParam = (url: string, q: Record<string, string>) => url + (url.includes("?") ? "&" : "?") + new URLSearchParams(q).toString();

let metadatos: { authorization_endpoint: string; token_endpoint: string } | null = null;
async function oauth() {
  if (!metadatos) {
    const r = await fetch(WELL_KNOWN);
    if (!r.ok) throw new Error("No se pudo contactar a John Deere");
    metadatos = await r.json();
  }
  return metadatos!;
}

async function pedirToken(form: Record<string, string>) {
  const { token_endpoint } = await oauth();
  const r = await fetch(token_endpoint, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${env("JD_CLIENT_ID")}:${env("JD_CLIENT_SECRET")}`),
      Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || !b.access_token) throw new Error("John Deere rechazó la autorización" + (b.error_description ? `: ${b.error_description}` : ""));
  return b as { access_token: string; refresh_token?: string; expires_in?: number };
}

async function guardarTokens(admin: SupabaseClient, conexionId: string, t: { access_token: string; refresh_token?: string; expires_in?: number }, refreshPrevio?: string | null) {
  await admin.from("telemetria_tokens").upsert({
    conexion_id: conexionId, access_token: t.access_token, refresh_token: t.refresh_token ?? refreshPrevio ?? null,
    expira_en: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
  });
}

async function tokenValido(admin: SupabaseClient, conexionId: string, forzar = false) {
  const { data: tk } = await admin.from("telemetria_tokens").select("*").eq("conexion_id", conexionId).single();
  if (!tk) throw new Error("La conexión no tiene autorización. Volvé a conectar John Deere.");
  if (!forzar && tk.expira_en && new Date(tk.expira_en).getTime() > Date.now() + 60_000) return tk.access_token as string;
  if (!tk.refresh_token) throw new Error("La autorización venció. Volvé a conectar John Deere.");
  const t = await pedirToken({ grant_type: "refresh_token", refresh_token: tk.refresh_token, scope: SCOPES, redirect_uri: CALLBACK() });
  await guardarTokens(admin, conexionId, t, tk.refresh_token);
  return t.access_token;
}

async function pedirXml(url: string, token: string) {
  return await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/xml" } });
}

// Baja todas las páginas de la flota, guarda lecturas y vincula equipos por número de serie / PIN.
async function sincronizar(admin: SupabaseClient, empresaId: string) {
  const { data: con } = await admin.from("telemetria_conexiones").select("*").eq("empresa_id", empresaId).eq("proveedor", PROVEEDOR).single();
  if (!con) throw new Error("John Deere no está conectado para esta empresa.");
  try {
    let token = await tokenValido(admin, con.id);
    const parser = XMLParser;
    let url: string | null = `${API_BASE()}/1`, paginas = 0, reintento = false;
    const maquinas: ReturnType<typeof parsearFlota>["maquinas"] = [];
    const vistas = new Set<string>();
    while (url && paginas < 100 && !vistas.has(url)) {
      vistas.add(url);
      let r = await pedirXml(url, token);
      if (r.status === 401 && !reintento) { reintento = true; token = await tokenValido(admin, con.id, true); vistas.delete(url); continue; }
      if (r.status === 403) throw new Error("John Deere no dio acceso a la organización. Revisá la conexión en Operations Center.");
      if (!r.ok) throw new Error(`John Deere respondió ${r.status}`);
      const flota = parsearFlota(await r.text(), parser);
      if (paginas === 0 && flota.conexiones && !flota.maquinas.length) throw new Error("Falta habilitar el acceso a la organización en John Deere. Volvé a conectar.");
      maquinas.push(...flota.maquinas);
      url = flota.siguiente; paginas++; reintento = false;
    }

    const { data: equipos } = await admin.from("equipos").select("id, serie, telemetria_ref").eq("empresa_id", empresaId);
    const porSerie = new Map<string, { id: string; telemetria_ref: string | null }>();
    for (const e of equipos ?? []) {
      if (e.serie) porSerie.set(claveSerie(e.serie)!, e);
      if (e.telemetria_ref) porSerie.set(claveSerie(e.telemetria_ref)!, e);
    }
    const lecturas = [], sinVincular = [];
    for (const m of maquinas) {
      const eq = porSerie.get(claveSerie(m.pin) ?? "") ?? porSerie.get(claveSerie(m.serie) ?? "");
      if (!eq) { sinVincular.push({ pin: m.pin, serie: m.serie, oem: m.oem, modelo: m.modelo, horas: m.horas }); continue; }
      if (!eq.telemetria_ref && (m.pin || m.serie)) {
        await admin.from("equipos").update({ telemetria_proveedor: PROVEEDOR, telemetria_ref: m.pin ?? m.serie }).eq("id", eq.id);
      }
      if (!m.medido_en) continue;
      lecturas.push({ empresa_id: empresaId, equipo_id: eq.id, proveedor: PROVEEDOR, medido_en: m.medido_en, horas: m.horas,
        odometro_km: m.odometro_km, lat: m.lat, lng: m.lng, combustible_pct: m.combustible_pct, def_pct: m.def_pct, raw: m });
    }
    if (lecturas.length) {
      const { error } = await admin.from("telemetria_lecturas").upsert(lecturas, { onConflict: "equipo_id,proveedor,medido_en", ignoreDuplicates: true });
      if (error) throw new Error("No se pudieron guardar las lecturas: " + error.message);
    }
    await admin.from("telemetria_conexiones").update({ estado: "conectada", ultima_sync: new Date().toISOString(), error: null, maquinas_sin_vincular: sinVincular }).eq("id", con.id);
    return { maquinas: maquinas.length, vinculadas: lecturas.length, sin_vincular: sinVincular.length };
  } catch (e) {
    await admin.from("telemetria_conexiones").update({ estado: "error", error: (e as Error).message }).eq("id", con.id);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const u = new URL(req.url);

  // ----- vuelta desde John Deere
  if (req.method === "GET" && u.pathname.endsWith("/callback")) {
    const state = u.searchParams.get("state") ?? "";
    const { data: st } = await admin.from("telemetria_oauth").select("*").eq("state", state).maybeSingle();
    const app = env("APP_URL", "/");
    if (!st || Date.now() - new Date(st.creado_en).getTime() > 15 * 60_000) return redirigir(conParam(app, { jd: "error", msg: "La autorización venció. Probá de nuevo." }));
    await admin.from("telemetria_oauth").delete().eq("state", state);
    const volver = st.volver_a;
    if (u.searchParams.get("error")) return redirigir(conParam(volver, { jd: "error", msg: "Cancelaste la autorización en John Deere." }));
    try {
      const t = await pedirToken({ grant_type: "authorization_code", code: u.searchParams.get("code") ?? "", redirect_uri: CALLBACK() });
      const { data: con } = await admin.from("telemetria_conexiones")
        .upsert({ empresa_id: st.empresa_id, proveedor: PROVEEDOR, estado: "conectada", conectada_en: new Date().toISOString(), error: null }, { onConflict: "empresa_id,proveedor" })
        .select("id").single();
      await guardarTokens(admin, con!.id, t);
      // ¿Falta habilitar el acceso a la organización? John Deere lo indica con un enlace "connections".
      const r = await pedirXml(`${API_BASE()}/1`, t.access_token);
      if (r.ok) {
        const flota = parsearFlota(await r.text(), XMLParser);
        if (flota.conexiones && !flota.maquinas.length) return redirigir(conParam(flota.conexiones, { redirect_uri: conParam(volver, { jd: "ok" }) }));
      }
      return redirigir(conParam(volver, { jd: "ok" }));
    } catch (e) {
      return redirigir(conParam(volver, { jd: "error", msg: (e as Error).message }));
    }
  }

  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  let b: Record<string, string>;
  try { b = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }

  // ----- tarea programada
  if (b.accion === "sincronizar_todo") {
    if (!env("CRON_SECRET") || req.headers.get("x-cron-secret") !== env("CRON_SECRET")) return json({ error: "No autorizado" }, 401);
    const { data: cons } = await admin.from("telemetria_conexiones").select("empresa_id").eq("proveedor", PROVEEDOR).in("estado", ["conectada", "error"]);
    const res: Record<string, unknown> = {};
    for (const c of cons ?? []) { try { res[c.empresa_id] = await sincronizar(admin, c.empresa_id); } catch (e) { res[c.empresa_id] = { error: (e as Error).message }; } }
    return json({ ok: true, res });
  }

  // ----- acciones del panel: verificar quién llama
  const comoUsuario = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: quien } = await comoUsuario.auth.getUser();
  if (!quien?.user) return json({ error: "Iniciá sesión" }, 401);
  const rol = async (fn: string) => (await comoUsuario.rpc(fn, { e: b.empresa_id })).data === true;

  try {
    if (b.accion === "conectar") {
      if (!(await rol("es_admin"))) return json({ error: "Solo el dueño o un administrador puede conectar John Deere" }, 403);
      if (!env("JD_CLIENT_ID") || !env("JD_CLIENT_SECRET")) return json({ error: "La conexión con John Deere todavía no está habilitada en CheckObra." }, 503);
      const { data: mid } = await comoUsuario.rpc("mi_miembro_id", { e: b.empresa_id });
      const state = crypto.randomUUID();
      const volver = (b.volver_a && /^https?:\/\//.test(b.volver_a)) ? b.volver_a : env("APP_URL", "/");
      await admin.from("telemetria_oauth").insert({ state, empresa_id: b.empresa_id, miembro_id: mid, volver_a: volver });
      await admin.from("telemetria_conexiones").upsert({ empresa_id: b.empresa_id, proveedor: PROVEEDOR, estado: "pendiente" }, { onConflict: "empresa_id,proveedor", ignoreDuplicates: true });
      const { authorization_endpoint } = await oauth();
      const url = conParam(authorization_endpoint, { client_id: env("JD_CLIENT_ID"), response_type: "code", scope: SCOPES, redirect_uri: CALLBACK(), state });
      return json({ url });
    }
    if (b.accion === "sincronizar") {
      if (!(await rol("es_gestor"))) return json({ error: "No tenés permiso" }, 403);
      return json({ ok: true, ...(await sincronizar(admin, b.empresa_id)) });
    }
    if (b.accion === "desconectar") {
      if (!(await rol("es_admin"))) return json({ error: "No tenés permiso" }, 403);
      const { data: con } = await admin.from("telemetria_conexiones").select("id").eq("empresa_id", b.empresa_id).eq("proveedor", PROVEEDOR).maybeSingle();
      if (con) {
        await admin.from("telemetria_tokens").delete().eq("conexion_id", con.id);
        await admin.from("telemetria_conexiones").update({ estado: "desconectada", error: null }).eq("id", con.id);
      }
      return json({ ok: true });
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
