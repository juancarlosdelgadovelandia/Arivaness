import express from 'express';
import db from './db.js';
import { requireAuth } from './auth.js';
import { sociosActivos, subcategoriaCascadeLine, ajustePeriodo } from './catalogos.js';

export const router = express.Router();

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function filtro({ periodo, sede, desde, hasta }) {
  const where = [];
  const args = {};
  if (periodo) { where.push('periodo = @periodo'); args.periodo = periodo; }
  if (desde) { where.push('fecha >= @desde'); args.desde = desde; }
  if (hasta) { where.push('fecha <= @hasta'); args.hasta = hasta; }
  if (sede && sede !== 'TODAS') { where.push('sede = @sede'); args.sede = sede; }
  return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}

/**
 * Calcula la cascada financiera completa (equivalente a la hoja RELACIÓN del Excel).
 */
export function calcularResumen({ periodo = '', sede = 'Centro', desde = '', hasta = '' } = {}) {
  const { clause, args } = filtro({ periodo, sede, desde, hasta });
  const stmt = db.prepare(`SELECT * FROM movimientos ${clause}`);
  const rows = clause ? stmt.all(args) : stmt.all();

  const sum = (arr) => round2(arr.reduce((a, r) => a + r.monto_cop, 0));
  const grupo = (arr, key) => {
    const m = new Map();
    for (const r of arr) {
      const k = r[key] || '(sin clasificar)';
      m.set(k, round2((m.get(k) || 0) + r.monto_cop));
    }
    return [...m.entries()].map(([k, v]) => ({ nombre: k, monto: v })).sort((a, b) => b.monto - a.monto);
  };

  const ingresos = rows.filter((r) => r.tipo === 'ingreso');
  const gastos = rows.filter((r) => r.tipo === 'gasto');
  const inversiones = rows.filter((r) => r.tipo === 'inversion');
  const multas = rows.filter((r) => r.tipo === 'multa');
  const retiros = rows.filter((r) => r.tipo === 'retiro_socio');

  const ingresos_total = sum(ingresos);
  const ingresos_usd_total = round2(ingresos.reduce((a, r) => a + (r.monto_usd || 0), 0));
  const ingresos_por_plataforma = grupo(ingresos, 'categoria');

  const nomina_modelos = sum(gastos.filter((r) => r.categoria === 'Nómina Modelos'));

  const nominaPersonalRows = gastos.filter((r) => r.categoria === 'Nómina Personal');
  const nomina_personal_por_subcategoria = grupo(nominaPersonalRows, 'subcategoria').map((x) => ({
    ...x,
    linea: subcategoriaCascadeLine(x.nombre),
  }));
  const nomina_personal_por_linea = ['monitores', 'aseo', 'obreros'].map((linea) => ({
    linea,
    monto: round2(
      nomina_personal_por_subcategoria.filter((x) => x.linea === linea).reduce((a, x) => a + x.monto, 0)
    ),
  }));
  const nomina_personal_total = round2(nominaPersonalRows.reduce((a, r) => a + r.monto_cop, 0));

  const gastosVariosRows = gastos.filter(
    (r) => r.categoria !== 'Nómina Modelos' && r.categoria !== 'Nómina Personal'
  );
  const gastos_varios = sum(gastosVariosRows);
  const gastos_varios_por_categoria = grupo(gastosVariosRows, 'categoria');

  const multas_total = sum(multas);
  const { cruce_negativos, notas } = ajustePeriodo(periodo, sede);

  const ganancias_totales = round2(
    ingresos_total
    - nomina_modelos
    - nomina_personal_total
    - gastos_varios
    + multas_total
    - (Number(cruce_negativos) || 0)
  );

  const inversion_total = sum(inversiones);
  const inversion_por_categoria = grupo(inversiones, 'categoria');

  const retiros_por_socio = new Map();
  for (const r of retiros) {
    retiros_por_socio.set(r.socio, round2((retiros_por_socio.get(r.socio) || 0) + r.monto_cop));
  }

  const socios = sociosActivos().map((s) => {
    const participacion = round2(ganancias_totales * (Number(s.porcentaje) || 0) / 100);
    const retiros_socio = round2(retiros_por_socio.get(s.nombre) || 0);
    const restante = round2(participacion - retiros_socio);
    const asume_inversiones = !!s.asume_inversiones;
    const restante_tras_inversiones = asume_inversiones ? round2(restante - inversion_total) : restante;
    return {
      nombre: s.nombre,
      porcentaje: Number(s.porcentaje) || 0,
      participacion,
      retiros: retiros_socio,
      restante,
      asume_inversiones,
      restante_tras_inversiones,
    };
  });

  // Resumen "simple" para las tarjetas de la pestaña Movimientos.
  const gastos_total = round2(nomina_modelos + nomina_personal_total + gastos_varios);
  const balance_neto = round2(ingresos_total - gastos_total - inversion_total + multas_total);

  return {
    periodo, sede, desde, hasta,
    simple: {
      ingresos: ingresos_total,
      gastos: gastos_total,
      inversiones: inversion_total,
      multas: multas_total,
      balance_neto,
    },
    ingresos: {
      total: ingresos_total,
      usd_total: ingresos_usd_total,
      por_plataforma: ingresos_por_plataforma,
    },
    nomina_modelos,
    nomina_personal: {
      total: nomina_personal_total,
      por_subcategoria: nomina_personal_por_subcategoria,
      por_linea: nomina_personal_por_linea,
    },
    gastos_varios: {
      total: gastos_varios,
      por_categoria: gastos_varios_por_categoria,
    },
    multas: multas_total,
    cruce_negativos: Number(cruce_negativos) || 0,
    notas: notas || '',
    ganancias_totales,
    socios,
    inversion: {
      total: inversion_total,
      por_categoria: inversion_por_categoria,
    },
    conteos: {
      ingresos: ingresos.length,
      gastos: gastos.length,
      inversiones: inversiones.length,
      multas: multas.length,
      retiros: retiros.length,
    },
  };
}

router.get('/resumen', requireAuth, (req, res) => {
  const periodo = String(req.query.periodo || '');
  const sede = String(req.query.sede || 'Centro');
  const desde = String(req.query.desde || '');
  const hasta = String(req.query.hasta || '');
  if (!periodo && !desde && !hasta) {
    return res.status(400).json({ error: 'Indica un periodo (YYYY-MM) o un rango de fechas' });
  }
  res.json(calcularResumen({ periodo, sede, desde, hasta }));
});
