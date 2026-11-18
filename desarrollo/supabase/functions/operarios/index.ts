// Alta de operarios y cambio de PIN.
// Los operarios no tienen mail: se les crea un usuario interno <legajo>@<empresa>.operarios.invalid
// (dominio reservado, nunca recibe correos) y entran con código de empresa + legajo + PIN de 6 dígitos
// a través de la función 'ingresar'. La contraseña real se deriva del PIN (ver _shared/pin.js).
//
// POST { accion: "alta", empresa_id, nombre, legajo, pin, rol? }
// POST { accion: "pin", miembro_id, pin }
// POST { accion: "restablecer_2fa", miembro_id }   (quien perdió el celular de la verificación en dos pasos)
// Todo queda en la auditoría de la empresa.
// Solo dueño o admin de la empresa.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { derivarClave, correoOperario } from "../_shared/pin.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const pepper = Deno.env.get("PIN_PEPPER") ?? "";
  if (pepper.length < 32) return json({ error: "El alta de operarios no está configurada." }, 503);

  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") ?? "";
  // Cliente con la sesión de quien llama: las reglas de la base deciden qué puede ver.
  const comoUsuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data: quien } = await comoUsuario.auth.getUser();
  if (!quien?.user) return json({ error: "Iniciá sesión" }, 401);

  let b: Record<string, string>;
  try { b = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }

  const esAdmin = async (empresa: string) => {
    const { data } = await comoUsuario.rpc("es_admin", { e: empresa });
    return data === true;
  };
  const pinOk = (p: string) => /^\d{6}$/.test(p ?? "");
  const auditar = (empresa: string, accion: string, id: string, registro: string, detalle: Record<string, unknown>) =>
    admin.rpc("auditar_servidor", { p_empresa: empresa, p_user: quien.user.id, p_accion: accion, p_tabla: "miembros", p_id: id, p_registro: registro, p_detalle: detalle });

  if (b.accion === "alta") {
    const nombre = (b.nombre ?? "").trim(), legajo = (b.legajo ?? "").trim();
    const rol = b.rol === "supervisor" || b.rol === "mecanico" ? b.rol : "operario";
    if (!(await esAdmin(b.empresa_id))) return json({ error: "No tenés permiso para dar de alta personal" }, 403);
    if (nombre.length < 2) return json({ error: "Escribí el nombre" }, 400);
    if (!/^[A-Za-z0-9._-]{1,30}$/.test(legajo)) return json({ error: "El legajo admite letras, números, punto y guion" }, 400);
    if (!pinOk(b.pin)) return json({ error: "El PIN tiene que tener 6 números" }, 400);

    const { data: emp } = await admin.from("empresas").select("slug").eq("id", b.empresa_id).single();
    if (!emp) return json({ error: "Empresa no encontrada" }, 404);
    const { data: ya } = await admin.from("miembros").select("id").eq("empresa_id", b.empresa_id).eq("legajo", legajo).maybeSingle();
    if (ya) return json({ error: "Ya existe una persona con ese legajo" }, 409);

    // Se crea con una contraseña al azar y enseguida se le asigna la derivada del PIN (necesita el id del usuario).
    const { data: u, error: eu } = await admin.auth.admin.createUser({
      email: correoOperario(emp.slug, legajo), password: crypto.randomUUID() + crypto.randomUUID(), email_confirm: true,
      user_metadata: { nombre, legajo, empresa_id: b.empresa_id },
    });
    if (eu || !u.user) return json({ error: "No se pudo crear el usuario: " + (eu?.message ?? "") }, 400);
    const { error: ep } = await admin.auth.admin.updateUserById(u.user.id, { password: await derivarClave(pepper, u.user.id, b.pin) });
    if (ep) { await admin.auth.admin.deleteUser(u.user.id); return json({ error: "No se pudo asignar el PIN" }, 400); }

    const { data: m, error: em } = await admin.from("miembros")
      .insert({ empresa_id: b.empresa_id, user_id: u.user.id, nombre, legajo, rol }).select("id").single();
    if (em) {
      await admin.auth.admin.deleteUser(u.user.id);
      return json({ error: "No se pudo registrar a la persona: " + em.message }, 400);
    }
    await auditar(b.empresa_id, "alta", m.id, nombre, { rol, legajo });
    return json({ ok: true, miembro_id: m.id });
  }

  if (b.accion === "pin") {
    if (!pinOk(b.pin)) return json({ error: "El PIN tiene que tener 6 números" }, 400);
    const { data: m } = await admin.from("miembros").select("empresa_id, user_id, rol, nombre").eq("id", b.miembro_id).single();
    if (!m || !m.user_id) return json({ error: "Persona no encontrada" }, 404);
    if (m.rol === "dueno" || !(await esAdmin(m.empresa_id))) return json({ error: "No tenés permiso" }, 403);
    const { error } = await admin.auth.admin.updateUserById(m.user_id, { password: await derivarClave(pepper, m.user_id, b.pin) });
    if (error) return json({ error: "No se pudo cambiar el PIN" }, 400);
    // Un PIN nuevo también desbloquea el legajo.
    await admin.from("miembros").update({ intentos_fallidos: 0, bloqueado_en: null }).eq("id", b.miembro_id);
    await auditar(m.empresa_id, "pin", b.miembro_id, m.nombre, {});
    return json({ ok: true });
  }

  if (b.accion === "restablecer_2fa") {
    const { data: m } = await admin.from("miembros").select("empresa_id, user_id, rol, nombre").eq("id", b.miembro_id).single();
    if (!m || !m.user_id) return json({ error: "Persona no encontrada" }, 404);
    if (m.user_id === quien.user.id) return json({ error: "No podés restablecer tu propia verificación: pedíselo a otro administrador" }, 403);
    if (!(await esAdmin(m.empresa_id))) return json({ error: "No tenés permiso" }, 403);
    // Al dueño solo lo puede restablecer otro dueño de la misma empresa.
    if (m.rol === "dueno") {
      const { data: yo } = await admin.from("miembros").select("rol").eq("empresa_id", m.empresa_id).eq("user_id", quien.user.id).single();
      if (yo?.rol !== "dueno") return json({ error: "Solo otro dueño puede restablecer la verificación del dueño. Escribí a soporte de Operapto." }, 403);
    }
    const { data: fs, error: ef } = await admin.auth.admin.mfa.listFactors({ userId: m.user_id });
    if (ef) return json({ error: "No se pudo leer la verificación de esa persona" }, 400);
    for (const f of fs?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ userId: m.user_id, id: f.id });
    // También el código por correo y las sesiones que ya estaban verificadas.
    const { data: aj } = await admin.from("ajustes_2fa").select("correo").eq("user_id", m.user_id).maybeSingle();
    await admin.from("ajustes_2fa").upsert({ user_id: m.user_id, correo: false, actualizado_en: new Date().toISOString() });
    await admin.from("sesiones_verificadas").delete().eq("user_id", m.user_id);
    const { count: nh } = await admin.from("huellas").select("id", { count: "exact", head: true }).eq("user_id", m.user_id);
    await admin.from("huellas").delete().eq("user_id", m.user_id);
    // Cierra sus sesiones abiertas: quien tenga el celular perdido no puede seguir adentro.
    await admin.auth.admin.signOut(m.user_id, "global").catch(() => {});
    const total = (fs?.factors ?? []).length + (aj?.correo ? 1 : 0) + (nh ?? 0);
    await auditar(m.empresa_id, "restablecer_2fa", b.miembro_id, m.nombre, { formas: total });
    return json({ ok: true, factores: total });
  }

  return json({ error: "Acción desconocida" }, 400);
});
