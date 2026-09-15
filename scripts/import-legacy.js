// Importa los datos de la app vieja (localStorage -> "arivaness_entries").
//
// Uso:
//   node scripts/import-legacy.js  ruta/al/export.json  [Sede]
//
// El JSON puede ser:
//   - un array de entries (lo que guardaba localStorage), o
//   - un objeto { arivaness_entries: [...] }
import fs from 'node:fs';
import db from '../server/db.js';

const [, , archivo, sedeArg] = process.argv;
if (!archivo) {
  console.error('Falta la ruta al JSON. Uso: node scripts/import-legacy.js export.json [Sede]');
  process.exit(1);
}
const sede = sedeArg || 'Centro';
const raw = JSON.parse(fs.readFileSync(archivo, 'utf8'));
const entries = Array.isArray(raw) ? raw : raw.arivaness_entries || [];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const ins = db.prepare(`
  INSERT INTO movimientos
    (tipo, categoria, subcategoria, socio, fecha, periodo, descripcion, monto_usd, trm, monto_cop, sede)
  VALUES
    (@tipo, @categoria, @subcategoria, @socio, @fecha, @periodo, @descripcion, @monto_usd, @trm, @monto_cop, @sede)
`);

let ok = 0;
const revisar = [];

const tx = db.transaction(() => {
  for (const e of entries) {
    const tipo = e.tipo;
    if (!['ingreso', 'gasto', 'inversion'].includes(tipo)) { revisar.push([e, 'tipo desconocido']); continue; }
    const fecha = String(e.fecha || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { revisar.push([e, 'fecha inválida']); continue; }

    const categoria = e.plataforma || e.categoria || '';
    let subcategoria = '';
    if (tipo === 'gasto' && categoria === 'Nómina Personal') {
      subcategoria = '';
      revisar.push([e, 'asignar subcategoría de nómina (Monitores/Aseo/Obreros)']);
    }

    const monto_usd = tipo === 'ingreso' ? round2(e.monto_usd || 0) : null;
    const trm = tipo === 'ingreso' ? Number(e.trm) || null : null;
    const monto_cop = round2(e.monto_cop || (monto_usd && trm ? monto_usd * trm : 0));

    ins.run({
      tipo, categoria, subcategoria, socio: '',
      fecha, periodo: fecha.slice(0, 7),
      descripcion: e.descripcion || '',
      monto_usd, trm, monto_cop, sede,
    });
    ok++;
  }
});
tx();

console.log(`Importados: ${ok} movimientos (sede ${sede}).`);
if (revisar.length) {
  console.log(`\n${revisar.length} registros requieren revisión manual:`);
  for (const [e, motivo] of revisar) {
    console.log(`  - ${e.fecha} ${e.plataforma || e.categoria || ''} ${e.monto_cop || ''}  ->  ${motivo}`);
  }
}
process.exit(0);
