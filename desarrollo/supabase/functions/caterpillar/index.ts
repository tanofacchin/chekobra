// Integración con Caterpillar (Cat VisionLink) mediante la API ISO 15143-3 (AEMP 2.0).
//
// Cada empresa usa sus propias credenciales, que le da Caterpillar (o su concesionario) para la API ISO 15143-3:
// un client id (suele empezar con "fleet_mgmt" o "iso15143") y un client secret. Se guardan cifrados.
//
//   POST {accion: "conectar", empresa_id, client_id, client_secret, scope?} → prueba y guarda (dueño/admin)
//   POST {accion: "sincronizar", empresa_id}                                → baja las lecturas ahora (supervisión)
//   POST {accion: "desconectar", empresa_id}                                → borra las credenciales (dueño/admin)
//   POST {accion: "sincronizar_todo"} + header x-cron-secret                → todas las empresas (tarea programada)
//
// Secretos: TELEMETRIA_CLAVE (64 hex, cifra las credenciales), CRON_SECRET.
// Opcionales: CAT_TOKEN_URL, CAT_API_BASE, CAT_SCOPE (por defecto los de producción de Caterpillar).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { XMLParser } from "npm:fast-xml-parser@4.5.0";
import { parsearFlota, claveSerie } from "../_shared/iso15143.js";
import { cifrar, descifrar } from "../_shared/cifrado.js";

const PROVEEDOR = "caterpillar";
const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const TOKEN_URL = () => env("CAT_TOKEN_URL", "https://fedlogin.cat.com/as/token.oauth2");
const API_BASE = () => env("CAT_API_BASE", "https://services.cat.com/telematics/iso15143/fleet").replace(/\/$/, "");
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// Token por client credentials (dura 60 minutos; se pide uno por sincronización).
async function token(clientId: string, secreto: string, scope: string | null) {
  const intentar = async (sc: string | null) => {
    const form: Record<string, string> = { grant_type: "client_credentials", client_id: clientId, client_secret: secreto };
    if (sc) form.scope = sc;
    const r = await fetch(TOKEN_URL(), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(form).toString() });
    return { r, b: await r.json().catch(() => ({})) };
  };
  const sc = scope || env("CAT_SCOPE", "manage:all");
  let { r, b } = await intentar(sc);
  if (!r.ok && /scope/i.test(String(b.error ?? "") + String(b.error_description ?? ""))) ({ r, b } = await intentar(null));   // algunas cuentas no usan scope
  if (!r.ok || !b.access_token) {
    if (r.status === 400 || r.status === 401) throw new Error("Caterpillar rechazó las credenciales. Revisá el client id y el client secret de la API ISO 15143-3.");
    throw new Error(`Caterpillar no respondió bien (${r.status}). Probá más tarde.`);
  }
  return b.access_token as string;
}

async function credenciales(admin: SupabaseClient, conexionId: string) {
  const { data: c } = await admin.from("telemetria_credenciales").select("*").eq("conexion_id", conexionId).maybeSingle();
  if (!c) throw new Error("Faltan las credenciales de Caterpillar. Volvé a conectar.");
  return { clientId: c.client_id as string, secreto: await descifrar(c.secreto_cifrado, env("TELEMETRIA_CLAVE")), scope: c.scope as string | null };
}

// Baja todas las páginas de la flota.
async function bajarFlota(tk: string) {
  let url: string | null = `${API_BASE()}/1`, paginas = 0;
  const vistas = new Set<string>(), maquinas: ReturnType<typeof parsearFlota>["maquinas"] = [];
  while (url && paginas < 100 && !vistas.has(url)) {
    vistas.add(url);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${tk}`, Accept: "application/iso15143-snapshot+xml, application/xml" } });
    if (r.status === 401 || r.status === 403) throw new Error("Caterpillar no dio acceso a la flota con estas credenciales. Pedí que habiliten la API ISO 15143-3 para tu cuenta.");
    if (r.status === 404 && paginas > 0) break;
    if (!r.ok) throw new Error(`Caterpillar respondió ${r.status} al pedir la flota`);
    const flota = parsearFlota(await r.text(), XMLParser);
    maquinas.push(...flota.maquinas);
    url = flota.siguiente; paginas++;
  }
  return maquinas;
}

// Guarda lecturas y vincula equipos por número de serie (o el id que ya quedó guardado).
async function guardar(admin: SupabaseClient, empresaId: string, conexionId: string, maquinas: ReturnType<typeof parsearFlota>["maquinas"]) {
  const { data: equipos } = await admin.from("equipos").select("id, serie, telemetria_ref").eq("empresa_id", empresaId);
  const porSerie = new Map<string, { id: string; telemetria_ref: string | null }>();
  for (const e of equipos ?? []) {
    if (e.serie) porSerie.set(claveSerie(e.serie)!, e);
    if (e.telemetria_ref) porSerie.set(claveSerie(e.telemetria_ref)!, e);
  }
  const lecturas = [], sinVincular = [];
  for (const m of maquinas) {
    const eq = porSerie.get(claveSerie(m.serie) ?? "") ?? porSerie.get(claveSerie(m.pin) ?? "") ?? porSerie.get(claveSerie(m.equipo_id_oem) ?? "");
    if (!eq) { sinVincular.push({ pin: m.pin, serie: m.serie, oem: m.oem, modelo: m.modelo, horas: m.horas }); continue; }
    if (!eq.telemetria_ref && (m.serie || m.pin)) await admin.from("equipos").update({ telemetria_proveedor: PROVEEDOR, telemetria_ref: m.serie ?? m.pin }).eq("id", eq.id);
    if (!m.medido_en) continue;
    lecturas.push({ empresa_id: empresaId, equipo_id: eq.id, proveedor: PROVEEDOR, medido_en: m.medido_en, horas: m.horas,
      odometro_km: m.odometro_km, lat: m.lat, lng: m.lng, combustible_pct: m.combustible_pct, def_pct: m.def_pct, raw: m });
  }
  if (lecturas.length) {
    const { error } = await admin.from("telemetria_lecturas").upsert(lecturas, { onConflict: "equipo_id,proveedor,medido_en", ignoreDuplicates: true });
    if (error) throw new Error("No se pudieron guardar las lecturas: " + error.message);
  }
  await admin.from("telemetria_conexiones").update({ estado: "conectada", ultima_sync: new Date().toISOString(), error: null, maquinas_sin_vincular: sinVincular }).eq("id", conexionId);
  return { maquinas: maquinas.length, vinculadas: lecturas.length, sin_vincular: sinVincular.length };
}

async function sincronizar(admin: SupabaseClient, empresaId: string) {
  const { data: con } = await admin.from("telemetria_conexiones").select("*").eq("empresa_id", empresaId).eq("proveedor", PROVEEDOR).maybeSingle();
  if (!con || con.estado === "desconectada") throw new Error("Caterpillar no está conectado para esta empresa.");
  try {
    const c = await credenciales(admin, con.id);
    return await guardar(admin, empresaId, con.id, await bajarFlota(await token(c.clientId, c.secreto, c.scope)));
  } catch (e) {
    await admin.from("telemetria_conexiones").update({ estado: "error", error: (e as Error).message }).eq("id", con.id);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  // deno-lint-ignore no-explicit-any
  let b: Record<string, any>;
  try { b = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }

  if (b.accion === "sincronizar_todo") {
    if (!env("CRON_SECRET") || req.headers.get("x-cron-secret") !== env("CRON_SECRET")) return json({ error: "No autorizado" }, 401);
    const { data: cons } = await admin.from("telemetria_conexiones").select("empresa_id").eq("proveedor", PROVEEDOR).in("estado", ["conectada", "error"]);
    const res: Record<string, unknown> = {};
    for (const c of cons ?? []) { try { res[c.empresa_id] = await sincronizar(admin, c.empresa_id); } catch (e) { res[c.empresa_id] = { error: (e as Error).message }; } }
    return json({ ok: true, res });
  }

  const comoUsuario = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: quien } = await comoUsuario.auth.getUser();
  if (!quien?.user) return json({ error: "Iniciá sesión" }, 401);
  const rol = async (fn: string) => (await comoUsuario.rpc(fn, { e: b.empresa_id })).data === true;
  const auditar = (accion: string, detalle: Record<string, unknown>) => admin.rpc("auditar_servidor", { p_empresa: b.empresa_id, p_user: quien.user.id,
    p_accion: accion, p_tabla: "telemetria_conexiones", p_id: null, p_registro: "Caterpillar", p_detalle: detalle });

  try {
    if (b.accion === "conectar") {
      if (!(await rol("es_admin"))) return json({ error: "Solo el dueño o un administrador puede conectar Caterpillar" }, 403);
      if (!/^[0-9a-f]{64}$/i.test(env("TELEMETRIA_CLAVE"))) return json({ error: "La conexión con Caterpillar todavía no está habilitada en Operapto." }, 503);
      const clientId = String(b.client_id ?? "").trim(), secreto = String(b.client_secret ?? "").trim(), scope = String(b.scope ?? "").trim() || null;
      if (clientId.length < 4 || secreto.length < 8) return json({ error: "Cargá el client id y el client secret que te dio Caterpillar" }, 400);
      // Primero se prueban: si Caterpillar no las acepta, no se guarda nada.
      const tk = await token(clientId, secreto, scope);
      const maquinas = await bajarFlota(tk);
      const { data: con, error: ec } = await admin.from("telemetria_conexiones")
        .upsert({ empresa_id: b.empresa_id, proveedor: PROVEEDOR, estado: "conectada", conectada_en: new Date().toISOString(), error: null, cuenta_externa: clientId.slice(0, 6) + "…" }, { onConflict: "empresa_id,proveedor" })
        .select("id").single();
      if (ec || !con) return json({ error: "No se pudo guardar la conexión" }, 500);
      await admin.from("telemetria_credenciales").upsert({ conexion_id: con.id, client_id: clientId, secreto_cifrado: await cifrar(secreto, env("TELEMETRIA_CLAVE")), scope, actualizada_en: new Date().toISOString() });
      const r = await guardar(admin, b.empresa_id, con.id, maquinas);
      await auditar("conectar_telemetria", { maquinas: r.maquinas });
      return json({ ok: true, ...r });
    }
    if (b.accion === "sincronizar") {
      if (!(await rol("es_gestor"))) return json({ error: "No tenés permiso" }, 403);
      return json({ ok: true, ...(await sincronizar(admin, b.empresa_id)) });
    }
    if (b.accion === "desconectar") {
      if (!(await rol("es_admin"))) return json({ error: "No tenés permiso" }, 403);
      const { data: con } = await admin.from("telemetria_conexiones").select("id").eq("empresa_id", b.empresa_id).eq("proveedor", PROVEEDOR).maybeSingle();
      if (con) {
        await admin.from("telemetria_credenciales").delete().eq("conexion_id", con.id);
        await admin.from("telemetria_conexiones").update({ estado: "desconectada", error: null }).eq("id", con.id);
        await auditar("desconectar_telemetria", {});
      }
      return json({ ok: true });
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
