import express from 'express';
import db from './db.js';
import { requireAuth } from './auth.js';
import { valorValido, listaActiva, sociosActivos } from './catalogos.js';

export const router = express.Router();

const TIPOS = ['ingreso', 'gasto', 'inversion', 'multa', 'retiro_socio'];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const isFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

const q = {
  insert: db.prepare(`
    INSERT INTO movimientos
      (tipo, categoria, subcategoria, socio, fecha, periodo, descripcion, monto_usd, trm, monto_cop, sede, creado_por)
    VALUES
      (@tipo, @categoria, @subcategoria, @socio, @fecha, @periodo, @descripcion, @monto_usd, @trm, @monto_cop, @sede, @creado_por)
  `),
  update: db.prepare(`
    UPDATE movimientos SET
      tipo=@tipo, categoria=@categoria, subcategoria=@subcategoria, socio=@socio,
      fecha=@fecha, periodo=@periodo, descripcion=@descripcion,
      monto_usd=@monto_usd, trm=@trm, monto_cop=@monto_cop, sede=@sede,
      actualizado_en=datetime('now')
    WHERE id=@id
  `),
  byId: db.prepare(`SELECT * FROM movimientos WHERE id = ?`),
  del: db.prepare(`DELETE FROM movimientos WHERE id = ?`),
};

/**
 * Valida y normaliza un movimiento entrante.
 * Devuelve { data } listo para insertar, o { error }.
 */
export function normalizarMovimiento(body) {
  const b = body || {};
  const tipo = String(b.tipo || '').trim();
  if (!TIPOS.includes(tipo)) return { error: 'Tipo inválido' };

  const fecha = String(b.fecha || '').trim();
  if (!isFecha(fecha)) return { error: 'Fecha inválida (YYYY-MM-DD)' };
  const periodo = fecha.slice(0, 7);

  const sede = String(b.sede || 'Centro').trim();
  if (!valorValido('sede', sede)) return { error: `Sede no reconocida: ${sede}` };

  const descripcion = String(b.descripcion || '').trim();
  let categoria = String(b.categoria || '').trim();
  let subcategoria = String(b.subcategoria || '').trim();
  let socio = String(b.socio || '').trim();
  let monto_usd = null;
  let trm = null;
  let monto_cop;

  if (tipo === 'ingreso') {
    if (!valorValido('plataforma_ingreso', categoria)) return { error: 'Plataforma de ingreso inválida' };
    monto_usd = Number(b.monto_usd);
    trm = Number(b.trm);
    if (!(monto_usd > 0)) return { error: 'El monto en USD debe ser mayor a 0' };
    if (!(trm > 0)) return { error: 'La TRM debe ser mayor a 0' };
    monto_cop = round2(monto_usd * trm);
    subcategoria = '';
    socio = '';
  } else if (tipo === 'gasto') {
    if (!valorValido('categoria_gasto', categoria)) return { error: 'Categoría de gasto inválida' };
    if (categoria === 'Nómina Personal') {
      if (!subcategoria) return { error: 'La Nómina Personal necesita una subcategoría (Monitores, Aseo, Obreros…)' };
      if (!valorValido('subcategoria_nomina', subcategoria)) return { error: 'Subcategoría de nómina inválida' };
    } else {
      subcategoria = '';
    }
    monto_cop = Number(b.monto_cop);
    if (!(monto_cop > 0)) return { error: 'El monto en COP debe ser mayor a 0' };
    monto_cop = round2(monto_cop);
    socio = '';
  } else if (tipo === 'inversion') {
    if (!valorValido('categoria_inversion', categoria)) return { error: 'Categoría de inversión inválida' };
    monto_cop = round2(Number(b.monto_cop));
    if (!(monto_cop > 0)) return { error: 'El monto en COP debe ser mayor a 0' };
    subcategoria = '';
    socio = '';
  } else if (tipo === 'multa') {
    categoria = categoria || 'Multa';
    monto_cop = round2(Number(b.monto_cop));
    if (!(monto_cop > 0)) return { error: 'El monto en COP debe ser mayor a 0' };
    subcategoria = '';
    socio = '';
  } else if (tipo === 'retiro_socio') {
    const nombres = sociosActivos().map((s) => s.nombre);
    if (!nombres.includes(socio)) return { error: `Socio inválido. Debe ser uno de: ${nombres.join(', ')}` };
    categoria = categoria || 'Retiro a cuenta personal';
    monto_cop = round2(Number(b.monto_cop));
    if (!(monto_cop > 0)) return { error: 'El monto en COP debe ser mayor a 0' };
    subcategoria = '';
  }

  return {
    data: { tipo, categoria, subcategoria, socio, fecha, periodo, descripcion, monto_usd, trm, monto_cop, sede },
  };
}

// --- Rutas ---------------------------------------------------------------

router.get('/movimientos', requireAuth, (req, res) => {
  const { tipo, categoria, sede, periodo, desde, hasta, socio } = req.query;
  const where = [];
  const args = {};
  if (tipo) { where.push('tipo = @tipo'); args.tipo = String(tipo); }
  if (categoria) { where.push('categoria = @categoria'); args.categoria = String(categoria); }
  if (sede) { where.push('sede = @sede'); args.sede = String(sede); }
  if (socio) { where.push('socio = @socio'); args.socio = String(socio); }
  if (periodo) { where.push('periodo = @periodo'); args.periodo = String(periodo); }
  if (desde) { where.push('fecha >= @desde'); args.desde = String(desde); }
  if (hasta) { where.push('fecha <= @hasta'); args.hasta = String(hasta); }
  const sql = `SELECT * FROM movimientos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY fecha DESC, id DESC`;
  res.json(where.length ? db.prepare(sql).all(args) : db.prepare(sql).all());
});

router.post('/movimientos', requireAuth, (req, res) => {
  const { data, error } = normalizarMovimiento(req.body);
  if (error) return res.status(400).json({ error });
  const info = q.insert.run({ ...data, creado_por: req.usuario.id });
  res.status(201).json(q.byId.get(info.lastInsertRowid));
});

router.put('/movimientos/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!q.byId.get(id)) return res.status(404).json({ error: 'No existe' });
  const { data, error } = normalizarMovimiento(req.body);
  if (error) return res.status(400).json({ error });
  q.update.run({ ...data, id });
  res.json(q.byId.get(id));
});

router.delete('/movimientos/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!q.byId.get(id)) return res.status(404).json({ error: 'No existe' });
  q.del.run(id);
  res.json({ ok: true });
});

// Opciones para poblar formularios del frontend.
router.get('/opciones', requireAuth, (req, res) => {
  res.json({
    plataforma_ingreso: listaActiva('plataforma_ingreso'),
    categoria_gasto: listaActiva('categoria_gasto'),
    subcategoria_nomina: listaActiva('subcategoria_nomina'),
    categoria_inversion: listaActiva('categoria_inversion'),
    sede: listaActiva('sede'),
    socios: sociosActivos(),
  });
});
