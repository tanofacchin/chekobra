// Alta de operarios y cambio de PIN.
// Los operarios no tienen mail: se les crea un usuario interno <legajo>@<empresa>.operarios.invalid
// (dominio reservado, nunca recibe correos) y entran con código de empresa + legajo + PIN de 6 dígitos.
//
// POST { accion: "alta", empresa_id, nombre, legajo, pin, rol? }
// POST { accion: "pin", miembro_id, pin }
// Solo dueño o admin de la empresa.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const correo = (slug: string, legajo: string) => `${legajo.trim().toLowerCase()}@${slug.trim().toLowerCase()}.operarios.invalid`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

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

  if (b.accion === "alta") {
    const nombre = (b.nombre ?? "").trim(), legajo = (b.legajo ?? "").trim();
    const rol = b.rol === "supervisor" ? "supervisor" : "operario";
    if (!(await esAdmin(b.empresa_id))) return json({ error: "No tenés permiso para dar de alta personal" }, 403);
    if (nombre.length < 2) return json({ error: "Escribí el nombre" }, 400);
    if (!/^[A-Za-z0-9._-]{1,30}$/.test(legajo)) return json({ error: "El legajo admite letras, números, punto y guion" }, 400);
    if (!pinOk(b.pin)) return json({ error: "El PIN tiene que tener 6 números" }, 400);

    const { data: emp } = await admin.from("empresas").select("slug").eq("id", b.empresa_id).single();
    if (!emp) return json({ error: "Empresa no encontrada" }, 404);
    const { data: ya } = await admin.from("miembros").select("id").eq("empresa_id", b.empresa_id).eq("legajo", legajo).maybeSingle();
    if (ya) return json({ error: "Ya existe una persona con ese legajo" }, 409);

    const { data: u, error: eu } = await admin.auth.admin.createUser({
      email: correo(emp.slug, legajo), password: b.pin, email_confirm: true,
      user_metadata: { nombre, legajo, empresa_id: b.empresa_id },
    });
    if (eu || !u.user) return json({ error: "No se pudo crear el usuario: " + (eu?.message ?? "") }, 400);

    const { data: m, error: em } = await admin.from("miembros")
      .insert({ empresa_id: b.empresa_id, user_id: u.user.id, nombre, legajo, rol }).select("id").single();
    if (em) {
      await admin.auth.admin.deleteUser(u.user.id);
      return json({ error: "No se pudo registrar a la persona: " + em.message }, 400);
    }
    return json({ ok: true, miembro_id: m.id });
  }

  if (b.accion === "pin") {
    if (!pinOk(b.pin)) return json({ error: "El PIN tiene que tener 6 números" }, 400);
    const { data: m } = await admin.from("miembros").select("empresa_id, user_id, rol").eq("id", b.miembro_id).single();
    if (!m || !m.user_id) return json({ error: "Persona no encontrada" }, 404);
    if (m.rol === "dueno" || !(await esAdmin(m.empresa_id))) return json({ error: "No tenés permiso" }, 403);
    const { error } = await admin.auth.admin.updateUserById(m.user_id, { password: b.pin });
    if (error) return json({ error: "No se pudo cambiar el PIN" }, 400);
    return json({ ok: true });
  }

  return json({ error: "Acción desconocida" }, 400);
});
