// Lee el número de la foto del horómetro u odómetro de cada checklist con Claude (visión) y lo compara con el que
// cargó el operario. La llama la base cada 10 minutos (pg_cron, header x-cron-secret) con {accion: "pendientes"}.
//
// Secretos: ANTHROPIC_API_KEY (sin ella no hace nada), CRON_SECRET.
// Resultado en public.jornadas: lectura_foto, lectura_estado (ok | diferente | ilegible | error | omitida),
// lectura_confianza, lectura_nota, lectura_en.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import Anthropic from "npm:@anthropic-ai/sdk@1.7.0";

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const LOTE = 20;
// Diferencia tolerada entre lo cargado y lo que se lee en la foto.
const TOLERANCIA = { horas: 1, km: 5 } as const;

const SISTEMA = `Leés fotos de tableros de máquinas viales, mineras y agrícolas (excavadoras, cargadoras, camiones, camionetas, tractores).
Tu tarea es leer un solo número: el horómetro (horas de motor) o el odómetro (kilómetros), según se indique.
- Puede ser un display digital (LCD), un contador mecánico de rodillos o una pantalla del tablero.
- Abajo de la foto hay una franja oscura con texto agregado por la aplicación (equipo, nombre, fecha): ignorala por completo.
- Si hay decimales (por ejemplo el último rodillo de otro color o un punto), incluilos con punto decimal.
- No inventes: si el número no se ve claro, está cortado, borroso o tapado, marcá legible = false.
- Respondé solo con el JSON pedido.`;

const ESQUEMA = {
  type: "object",
  properties: {
    legible: { type: "boolean", description: "true si se puede leer el número con seguridad razonable" },
    valor: { type: ["number", "null"], description: "el número leído (horas o km), sin separadores de miles" },
    confianza: { type: "string", enum: ["alta", "media", "baja"] },
    nota: { type: "string", description: "explicación breve en castellano (máx. 120 caracteres)" },
  },
  required: ["legible", "valor", "confianza", "nota"],
  additionalProperties: false,
};

type Lectura = { legible: boolean; valor: number | null; confianza: "alta" | "media" | "baja"; nota: string };

function base64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function leer(claude: Anthropic, imagen: Uint8Array, tipo: string, medidor: "horas" | "km"): Promise<Lectura | null> {
  const r = await claude.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMA } },
    system: SISTEMA,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: tipo as "image/jpeg", data: base64(imagen) } },
        { type: "text", text: medidor === "km" ? "Leé el odómetro (kilómetros totales)." : "Leé el horómetro (horas de motor)." },
      ],
    }],
  });
  if (r.stop_reason === "refusal" || r.stop_reason === "max_tokens") return null;
  for (const b of r.content) if (b.type === "text") { try { return JSON.parse(b.text) as Lectura; } catch { return null; } }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (!env("CRON_SECRET") || req.headers.get("x-cron-secret") !== env("CRON_SECRET")) return json({ error: "No autorizado" }, 401);
  if (!env("ANTHROPIC_API_KEY")) return json({ ok: true, sin_clave: true });

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const claude = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY"), maxRetries: 2 });
  const { data: js } = await admin.from("jornadas").select("id, med_ini, medidor_foto_path, equipo:equipos(medidor)")
    .is("lectura_estado", null).not("medidor_foto_path", "is", null).gt("recibido_en", new Date(Date.now() - 7 * 864e5).toISOString())
    .order("recibido_en").limit(LOTE);
  const res = { leidas: 0, diferentes: 0, ilegibles: 0, errores: 0 };
  for (const j of js ?? []) {
    const medidor = (j.equipo as unknown as { medidor: "horas" | "km" } | null)?.medidor ?? "horas";
    const guardar = (c: Record<string, unknown>) => admin.from("jornadas").update({ ...c, lectura_en: new Date().toISOString() }).eq("id", j.id);
    try {
      const { data: foto, error } = await admin.storage.from("evidencias").download(j.medidor_foto_path);
      if (error || !foto) { await guardar({ lectura_estado: "omitida", lectura_nota: "La foto todavía no está o no se pudo bajar" }); continue; }
      const l = await leer(claude, new Uint8Array(await foto.arrayBuffer()), foto.type || "image/jpeg", medidor);
      if (!l || !l.legible || l.valor == null) {
        await guardar({ lectura_estado: "ilegible", lectura_confianza: l?.confianza ?? null, lectura_nota: (l?.nota ?? "No se pudo leer").slice(0, 200) });
        res.ilegibles++; continue;
      }
      const dif = Math.abs(Number(l.valor) - Number(j.med_ini));
      // Con confianza baja no se acusa al operario: queda como ilegible para que lo mire una persona.
      const estado = dif <= TOLERANCIA[medidor] ? "ok" : l.confianza === "baja" ? "ilegible" : "diferente";
      await guardar({ lectura_foto: l.valor, lectura_estado: estado, lectura_confianza: l.confianza, lectura_nota: l.nota.slice(0, 200) });
      res.leidas++; if (estado === "diferente") res.diferentes++;
    } catch (e) {
      // Errores de la API (límite, caída): queda pendiente para la próxima vuelta salvo que sea un pedido inválido.
      if (e instanceof Anthropic.BadRequestError) await guardar({ lectura_estado: "error", lectura_nota: e.message.slice(0, 200) });
      res.errores++;
      if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.AuthenticationError) break;
    }
  }
  return json({ ok: true, ...res });
});
