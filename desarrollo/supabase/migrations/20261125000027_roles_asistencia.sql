-- Roles nuevos para el tarjetero (va sola: un valor nuevo de un tipo no se puede usar en la misma transacción).
-- personal: personal de obra sin máquina; solo marca entrada y salida.
-- reloj:    teléfono o tablet fijo del obrador donde cada persona marca con su legajo y PIN.
alter type public.rol_miembro add value if not exists 'personal';
alter type public.rol_miembro add value if not exists 'reloj';
