// Lectura del formato ISO 15143-3 (AEMP 2.0) "Fleet snapshot" en XML.
// Lo publican John Deere (JDLink), Caterpillar, Komatsu, Volvo y otros.
// Se recibe el parser XML como parámetro para poder usarlo en Deno (función) y en Node (pruebas).

const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];
// Acceso sin distinguir mayúsculas: los fabricantes no siempre respetan el caso del estándar.
function campo(obj, nombre) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (nombre in obj) return obj[nombre];
  const k = Object.keys(obj).find(x => x.toLowerCase() === nombre.toLowerCase());
  return k === undefined ? undefined : obj[k];
}
const texto = v => {
  if (v == null) return null;
  if (typeof v === 'object') v = v['#text'];
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};
const numero = v => { const s = texto(v); if (s == null) return null; const n = Number(s.replace(',', '.')); return Number.isFinite(n) ? n : null; };
const fecha = o => { const s = o && typeof o === 'object' ? (o['@datetime'] ?? o['@DateTime']) : null; const d = s ? new Date(s) : null; return d && !isNaN(d) ? d.toISOString() : null; };

export function parsearFlota(xml, XMLParser) {
  const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, parseTagValue: false, trimValues: true });
  const doc = p.parse(xml);
  const fleet = campo(doc, 'Fleet') || {};
  const snapshot = texto(fleet['@snapshotTime']);
  const links = arr(campo(fleet, 'Links')).map(l => ({ rel: texto(campo(l, 'rel')), href: texto(campo(l, 'href')) })).filter(l => l.rel && l.href);
  const maquinas = arr(campo(fleet, 'Equipment')).map(e => {
    const h = campo(e, 'EquipmentHeader') || {};
    const loc = campo(e, 'Location'), horas = campo(e, 'CumulativeOperatingHours'), dist = campo(e, 'Distance');
    const comb = campo(e, 'FuelRemaining'), def = campo(e, 'DEFRemaining');
    let odo = numero(campo(dist, 'Odometer'));
    const uni = (texto(campo(dist, 'OdometerUnits')) || 'kilometre').toLowerCase();
    if (odo != null && uni.startsWith('mile')) odo = Math.round(odo * 1.609344 * 10) / 10;
    const fechas = [fecha(horas), fecha(loc), fecha(dist), fecha(comb)].filter(Boolean).sort();
    return {
      oem: texto(campo(h, 'OEMName')), modelo: texto(campo(h, 'Model')),
      pin: texto(campo(h, 'PIN')), serie: texto(campo(h, 'SerialNumber')), equipo_id_oem: texto(campo(h, 'EquipmentID')),
      medido_en: fechas[fechas.length - 1] || (snapshot ? new Date(snapshot).toISOString() : null),
      horas: numero(campo(horas, 'Hour')),
      lat: numero(campo(loc, 'Latitude')), lng: numero(campo(loc, 'Longitude')),
      odometro_km: odo,
      combustible_pct: numero(campo(comb, 'Percent')),
      def_pct: numero(campo(def, 'Percent')),
    };
  });
  return { links, maquinas, siguiente: (links.find(l => l.rel.toLowerCase() === 'next') || {}).href || null,
           conexiones: (links.find(l => l.rel.toLowerCase() === 'connections') || {}).href || null };
}

// Clave para vincular con equipos.serie: PIN o número de serie, sin espacios y en mayúsculas.
export const claveSerie = s => s ? String(s).replace(/\s+/g, '').toUpperCase() : null;
