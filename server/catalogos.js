import express from 'express';
import db from './db.js';
import { requireAuth, requireOwner } from './auth.js';

export const router = express.Router();

const q = {
  porGrupo: db.prepare(`SELECT valor, orden, activo, meta FROM catalogos WHERE grupo = ? ORDER BY orden, valor`),
  activosPorGrupo: db.prepare(`SELECT valor FROM catalogos WHERE grupo = ? AND activo = 1 ORDER BY orden, valor`),
  existe: db.prepare(`SELECT 1 FROM catalogos WHERE grupo = ? AND valor = ?`),
  insert: db.prepare(`INSERT INTO catalogos (grupo, valor, orden, activo, meta) VALUES (?, ?, ?, ?, ?)`),
  update: db.prepare(`UPDATE catalogos SET valor = @valor, activo = @activo, orden = @orden, meta = @meta WHERE grupo = @grupo AND valor = @valorOriginal`),
  maxOrden: db.prepare(`SELECT COALESCE(MAX(orden), -1) m FROM catalogos WHERE grupo = ?`),
  socios: db.prepare(`SELECT id, nombre, porcentaje, asume_inversiones, orden, activo FROM socios ORDER BY orden, nombre`),
  sociosActivos: db.prepare(`SELECT nombre, porcentaje, asume_inversiones FROM socios WHERE activo = 1 ORDER BY orden, nombre`),
  socioUpsert: db.prepare(`
    INSERT INTO socios (nombre, porcentaje, asume_inversiones, orden, activo)
    VALUES (@nombre, @porcentaje, @asume_inversiones, @orden, @activo)
    ON CONFLICT(nombre) DO UPDATE SET
      porcentaje = @porcentaje, asume_inversiones = @asume_inversiones, orden = @orden, activo = @activo
  `),
  socioDel: db.prepare(`DELETE FROM socios WHERE id = ?`),
  ajuste: db.prepare(`SELECT cruce_negativos, notas FROM ajustes_periodo WHERE periodo = ? AND sede = ?`),
  ajusteUpsert: db.prepare(`
    INSERT INTO ajustes_periodo (periodo, sede, cruce_negativos, notas)
    VALUES (@periodo, @sede, @cruce_negativos, @notas)
    ON CONFLICT(periodo, sede) DO UPDATE SET cruce_negativos = @cruce_negativos, notas = @notas
  `),
};

const GRUPOS = ['plataforma_ingreso', 'categoria_gasto', 'subcategoria_nomina', 'categoria_inversion', 'sede'];

export function listaActiva(grupo) {
  return q.activosPorGrupo.all(grupo).map((r) => r.valor);
}
export function valorValido(grupo, valor) {
  return !!q.existe.get(grupo, valor);
}
export function sociosActivos() {
  return q.sociosActivos.all();
}
export function subcategoriaCascadeLine(valor) {
  const row = db.prepare(`SELECT meta FROM catalogos WHERE grupo = 'subcategoria_nomina' AND valor = ?`).get(valor);
  return row?.meta || 'monitores';
}
export function ajustePeriodo(periodo, sede) {
  return q.ajuste.get(periodo, sede) || { cruce_negativos: 0, notas: '' };
}

// --- Catálogos (listas configurables) --------------------------------------

// Todo el mundo autenticado puede LEER los catálogos (para poblar formularios).
router.get('/catalogos', requireAuth, (req, res) => {
  const out = {};
  for (const g of GRUPOS) out[g] = q.porGrupo.all(g);
  out.socios = q.socios.all();
  res.json(out);
});

// Solo el dueño puede EDITAR.
router.post('/catalogos/:grupo', requireOwner, (req, res) => {
  const { grupo } = req.params;
  if (!GRUPOS.includes(grupo)) return res.status(400).json({ error: 'Grupo inválido' });
  const valor = String(req.body?.valor || '').trim();
  if (!valor) return res.status(400).json({ error: 'Falta el valor' });
  if (q.existe.get(grupo, valor)) return res.status(409).json({ error: 'Ya existe' });
  const orden = q.maxOrden.get(grupo).m + 1;
  q.insert.run(grupo, valor, orden, 1, String(req.body?.meta || ''));
  res.status(201).json({ ok: true });
});

router.put('/catalogos/:grupo/:valorOriginal', requireOwner, (req, res) => {
  const { grupo, valorOriginal } = req.params;
  if (!GRUPOS.includes(grupo)) return res.status(400).json({ error: 'Grupo inválido' });
  if (!q.existe.get(grupo, valorOriginal)) return res.status(404).json({ error: 'No existe' });
  const b = req.body || {};
  q.update.run({
    grupo,
    valorOriginal,
    valor: String(b.valor ?? valorOriginal).trim() || valorOriginal,
    activo: b.activo === false || b.activo === 0 ? 0 : 1,
    orden: Number.isFinite(b.orden) ? b.orden : q.maxOrden.get(grupo).m,
    meta: String(b.meta ?? ''),
  });
  res.json({ ok: true });
});

// --- Socios ---------------------------------------------------------------

router.put('/socios', requireOwner, (req, res) => {
  const lista = Array.isArray(req.body?.socios) ? req.body.socios : null;
  if (!lista) return res.status(400).json({ error: 'Se espera { socios: [...] }' });
  const tx = db.transaction(() => {
    lista.forEach((s, i) => {
      q.socioUpsert.run({
        nombre: String(s.nombre || '').trim(),
        porcentaje: Number(s.porcentaje) || 0,
        asume_inversiones: s.asume_inversiones ? 1 : 0,
        orden: i,
        activo: s.activo === false ? 0 : 1,
      });
    });
  });
  tx();
  res.json({ ok: true, socios: q.socios.all() });
});

router.delete('/socios/:id', requireOwner, (req, res) => {
  q.socioDel.run(Number(req.params.id));
  res.json({ ok: true });
});

// --- Ajuste de periodo (cruce negativos manual) ---------------------------

router.get('/ajuste', requireAuth, (req, res) => {
  const periodo = String(req.query.periodo || '');
  const sede = String(req.query.sede || 'Centro');
  res.json(ajustePeriodo(periodo, sede));
});

router.put('/ajuste', requireAuth, (req, res) => {
  const periodo = String(req.body?.periodo || '');
  const sede = String(req.body?.sede || 'Centro');
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'Periodo inválido (YYYY-MM)' });
  q.ajusteUpsert.run({
    periodo,
    sede,
    cruce_negativos: Number(req.body?.cruce_negativos) || 0,
    notas: String(req.body?.notas || ''),
  });
  res.json(ajustePeriodo(periodo, sede));
});
