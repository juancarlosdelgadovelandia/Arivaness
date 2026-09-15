import express from 'express';
import db from './db.js';
import { requireOwner } from './auth.js';
import { valorValido } from './catalogos.js';

export const router = express.Router();

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const ins = db.prepare(`
  INSERT INTO movimientos
    (tipo, categoria, subcategoria, socio, fecha, periodo, descripcion, monto_usd, trm, monto_cop, sede, creado_por)
  VALUES
    (@tipo, @categoria, @subcategoria, @socio, @fecha, @periodo, @descripcion, @monto_usd, @trm, @monto_cop, @sede, @creado_por)
`);

/**
 * Importa entries de la app vieja (localStorage "arivaness_entries").
 * body: { entries: [...], sede }
 */
router.post('/importar', requireOwner, (req, res) => {
  let entries = req.body?.entries;
  if (typeof entries === 'string') {
    try { entries = JSON.parse(entries); } catch { return res.status(400).json({ error: 'El texto no es un JSON válido' }); }
  }
  if (Array.isArray(entries?.arivaness_entries)) entries = entries.arivaness_entries;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'Se esperaba una lista de movimientos' });

  const sede = valorValido('sede', String(req.body?.sede || 'Centro')) ? req.body.sede : 'Centro';
  let importados = 0;
  const revisar = [];

  const tx = db.transaction(() => {
    for (const e of entries) {
      const tipo = e.tipo;
      if (!['ingreso', 'gasto', 'inversion'].includes(tipo)) { revisar.push(`${e.fecha || '?'} — tipo desconocido`); continue; }
      const fecha = String(e.fecha || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { revisar.push(`${e.fecha || '?'} — fecha inválida`); continue; }

      const categoria = e.plataforma || e.categoria || '';
      let subcategoria = '';
      if (tipo === 'gasto' && categoria === 'Nómina Personal') {
        revisar.push(`${fecha} Nómina Personal ${e.monto_cop || ''} — asígnale subcategoría (Monitores/Aseo/Obreros)`);
      }
      const monto_usd = tipo === 'ingreso' ? round2(e.monto_usd || 0) : null;
      const trm = tipo === 'ingreso' ? Number(e.trm) || null : null;
      const monto_cop = round2(e.monto_cop || (monto_usd && trm ? monto_usd * trm : 0));
      if (!(monto_cop > 0)) { revisar.push(`${fecha} ${categoria} — monto en 0`); continue; }

      ins.run({
        tipo, categoria, subcategoria, socio: '',
        fecha, periodo: fecha.slice(0, 7),
        descripcion: e.descripcion || '',
        monto_usd, trm, monto_cop, sede,
        creado_por: req.usuario.id,
      });
      importados++;
    }
  });
  tx();

  res.json({ importados, revisar });
});
