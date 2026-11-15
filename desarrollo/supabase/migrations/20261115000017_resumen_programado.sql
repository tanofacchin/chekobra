-- Resumen diario por correo: se encola todos los días a las 19:00 de Argentina (22:00 UTC).
-- El envío lo hace la función 'avisos' (cada 2 minutos toma los avisos pendientes).
select cron.schedule('resumen-diario-19h', '0 22 * * *', $$select public.encolar_resumenes()$$);
