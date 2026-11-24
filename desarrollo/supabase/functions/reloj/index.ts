// Reloj del obrador: un teléfono o tablet fijo donde cada persona marca entrada y salida con su legajo, su PIN y una foto.
// Quien llama es el usuario del reloj (rol 'reloj') o un supervisor. El PIN se comprueba igual que en 'ingresar'
// (cuenta intentos y bloquea el legajo al quinto error), pero no se entrega ninguna sesión: solo se registra la marcación.
//
// POST { empresa_id, obra_id?, legajo, pin, foto_path?, client_id }
// POST { empresa_id, obra_id?, legajo, sin_pin: true, foto_path, client_id, cuando }   (marcada sin señal: queda para revisar con la foto)
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { derivarClave, correoOperario, MAX_INTENTOS } from "../_shared/pin.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const INCORRECTO = "Legajo o PIN incorrectos.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const pepper = Deno.env.get("PIN_PEPPER") ?? "";
  if (pepper.length < 32) return json({ error: "El reloj no está configurado." }, 503);

  const url = Deno.env.get("SUPABASE_URL")!;
  const comoUsuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: quien } = await comoUsuario.auth.getUser();
  if (!quien?.user) return json({ error: "Iniciá sesión en el reloj" }, 401);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }
  const empresa = String(b.empresa_id ?? ""), legajo = String(b.legajo ?? "").trim(), pin = String(b.pin ?? "");
  const obra = b.obra_id ? String(b.obra_id) : null, foto = b.foto_path ? String(b.foto_path) : null, cid = String(b.client_id ?? "");
  const sinPin = b.sin_pin === true;
  if (!UUID.test(empresa) || !UUID.test(cid) || (obra && !UUID.test(obra))) return json({ error: "Pedido inválido" }, 400);
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(legajo)) return json({ error: INCORRECTO }, 401);

  // Solo un reloj o un supervisor de esa empresa (con su verificación en dos pasos al día: lo decide mi_rol).
  const { data: rol } = await comoUsuario.rpc("mi_rol", { e: empresa });
  if (!["reloj", "dueno", "admin", "supervisor"].includes(String(rol))) return json({ error: "Este usuario no puede usarse como reloj" }, 403);
  if (foto && !foto.startsWith(`${empresa}/${quien.user.id}/`)) return json({ error: "Foto inválida" }, 400);

  const { data: emp } = await admin.from("empresas").select("slug").eq("id", empresa).single();
  const { data: cand } = await admin.from("miembros").select("id, user_id, legajo, nombre, rol, activo, intentos_fallidos, bloqueado_en")
    .eq("empresa_id", empresa).not("legajo", "is", null);
  const m = (cand ?? []).find((x) => x.legajo.toLowerCase() === legajo.toLowerCase());
  if (!emp || !m || !m.user_id || !m.activo || m.rol === "reloj") { await esperar(400); return json({ error: INCORRECTO }, 401); }

  const registrar = async (verificada: boolean, obs: string | null, cuando: string | null) => {
    const { data, error } = await admin.rpc("registrar_marcacion", {
      p_empresa: empresa, p_miembro: m.id, p_obra: obra, p_tipo: null, p_cuando: cuando, p_modo: "reloj",
      p_lat: null, p_lng: null, p_precision: null, p_foto: foto, p_client: cid,
      p_registrado_por: (cand ?? []).find((x) => x.user_id === quien.user.id)?.id ?? null, p_verificada: verificada, p_obs: obs,
    });
    if (error) return json({ error: error.message }, 400);
    return json(data);
  };

  if (sinPin) {
    // Se marcó sin señal: el PIN no se guarda en el teléfono, así que queda sin verificar hasta que el supervisor mire la foto.
    if (!foto) return json({ error: "Falta la foto" }, 400);
    const cuando = b.cuando ? new Date(String(b.cuando)) : null;
    if (!cuando || isNaN(+cuando)) return json({ error: "Falta la hora" }, 400);
    return registrar(false, "Marcada en el reloj sin señal: revisar la foto", cuando.toISOString());
  }

  if (!/^\d{6}$/.test(pin)) { await esperar(400); return json({ error: INCORRECTO }, 401); }
  if (m.bloqueado_en) return json({ error: `El legajo de ${m.nombre} está bloqueado por intentos fallidos. Pedile al supervisor que lo desbloquee.`, bloqueado: true }, 423);

  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
  const { data: ses, error } = await anon.auth.signInWithPassword({ email: correoOperario(emp.slug, m.legajo), password: await derivarClave(pepper, m.user_id, pin) });
  if (error || !ses.session) {
    const n = (m.intentos_fallidos ?? 0) + 1, bloquear = n >= MAX_INTENTOS;
    await admin.from("miembros").update({ intentos_fallidos: n, bloqueado_en: bloquear ? new Date().toISOString() : null }).eq("id", m.id);
    await esperar(400);
    if (bloquear) return json({ error: "El legajo quedó bloqueado por intentos fallidos. Pedile al supervisor que lo desbloquee.", bloqueado: true }, 423);
    const quedan = MAX_INTENTOS - n;
    return json({ error: `${INCORRECTO} ${quedan === 1 ? "Queda 1 intento" : `Quedan ${quedan} intentos`}.` }, 401);
  }
  // La sesión que abrió la comprobación no se usa: se cierra enseguida.
  await admin.auth.admin.signOut(ses.session.access_token, "local").catch(() => {});
  if (m.intentos_fallidos) await admin.from("miembros").update({ intentos_fallidos: 0 }).eq("id", m.id);
  return registrar(true, null, null);
});
