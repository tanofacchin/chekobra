import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { parsearFlota, claveSerie } from './iso15143.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Fleet xmlns="http://standards.iso.org/iso/15143/-3" version="1" snapshotTime="2026-11-10T12:00:00Z">
  <Links><rel>self</rel><href>https://sandboxaemp.deere.com/Fleet/1</href></Links>
  <Links><rel>next</rel><href>https://sandboxaemp.deere.com/Fleet/2</href></Links>
  <Equipment>
    <EquipmentHeader><OEMName>John Deere</OEMName><Model>210G</Model><EquipmentID>Excavadora 1</EquipmentID>
      <SerialNumber>1FF210GX ABC123</SerialNumber><PIN>1FF210GXABC123</PIN></EquipmentHeader>
    <Location datetime="2026-11-10T11:55:00Z"><Latitude>-31.4201</Latitude><Longitude>-64.1888</Longitude></Location>
    <CumulativeOperatingHours datetime="2026-11-10T11:50:00Z"><Hour>1523.7</Hour></CumulativeOperatingHours>
    <FuelRemaining datetime="2026-11-10T11:50:00Z"><Percent>62</Percent></FuelRemaining>
    <DEFRemaining datetime="2026-11-10T11:50:00Z"><Percent>80</Percent></DEFRemaining>
  </Equipment>
  <Equipment>
    <EquipmentHeader><OEMName>John Deere</OEMName><Model>310L</Model><PIN>1T0310LXZZZ999</PIN></EquipmentHeader>
    <Distance datetime="2026-11-09T20:00:00Z"><OdometerUnits>mile</OdometerUnits><Odometer>100</Odometer></Distance>
    <cumulativeoperatinghours datetime="2026-11-09T20:00:00Z"><hour>88</hour></cumulativeoperatinghours>
  </Equipment>
  <Equipment><EquipmentHeader><PIN>SIN-DATOS</PIN></EquipmentHeader></Equipment>
</Fleet>`;

test('lee una página de flota ISO 15143-3', () => {
  const f = parsearFlota(XML, XMLParser);
  assert.equal(f.maquinas.length, 3);
  assert.equal(f.siguiente, 'https://sandboxaemp.deere.com/Fleet/2');
  assert.equal(f.conexiones, null);
  const [a, b, c] = f.maquinas;
  assert.deepEqual([a.pin, a.modelo, a.horas, a.lat, a.lng, a.combustible_pct, a.def_pct], ['1FF210GXABC123', '210G', 1523.7, -31.4201, -64.1888, 62, 80]);
  assert.equal(a.medido_en, '2026-11-10T11:55:00.000Z');           // la fecha más reciente
  assert.equal(b.odometro_km, 160.9);                                // millas → km
  assert.equal(b.horas, 88);                                         // tolera minúsculas
  assert.equal(c.medido_en, '2026-11-10T12:00:00.000Z');            // sin datos: usa la hora de la foto
  assert.equal(c.horas, null);
});

test('detecta que falta habilitar la organización', () => {
  const f = parsearFlota(`<Fleet xmlns="http://standards.iso.org/iso/15143/-3"><Links><rel>connections</rel><href>https://connections.deere.com/connections/abc/select-organizations</href></Links></Fleet>`, XMLParser);
  assert.equal(f.maquinas.length, 0);
  assert.match(f.conexiones, /connections\.deere\.com/);
});

test('normaliza números de serie para vincular', () => {
  assert.equal(claveSerie(' 1ff210gx abc123 '), '1FF210GXABC123');
  assert.equal(claveSerie(null), null);
});
