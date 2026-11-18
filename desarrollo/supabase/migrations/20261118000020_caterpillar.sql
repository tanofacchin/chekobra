-- Caterpillar (VisionLink) por la API ISO 15143-3 (AEMP 2.0).
-- A diferencia de John Deere, no hay "autorizar con tu cuenta": cada empresa le pide a Caterpillar (o a su concesionario)
-- credenciales propias (client id y client secret) y las carga en Operapto. Se guardan CIFRADAS por la función
-- 'caterpillar' (clave TELEMETRIA_CLAVE, fuera de la base) en una tabla a la que la app no tiene acceso.
alter table public.telemetria_conexiones drop constraint telemetria_conexiones_proveedor_check;
alter table public.telemetria_conexiones add constraint telemetria_conexiones_proveedor_check
  check (proveedor in ('john_deere', 'caterpillar', 'iso15143'));

create table public.telemetria_credenciales (
  conexion_id     uuid primary key references public.telemetria_conexiones on delete cascade,
  client_id       text not null,
  secreto_cifrado text not null,          -- AES-GCM: iv.base64 + '.' + datos.base64
  scope           text,
  actualizada_en  timestamptz not null default now()
);
alter table public.telemetria_credenciales enable row level security;   -- sin políticas: solo el servidor
revoke all on public.telemetria_credenciales from authenticated, anon;

-- Quién conectó o desconectó queda en la auditoría: lo registra la función con auditar_servidor().
