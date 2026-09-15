import express from 'express';
import ExcelJS from 'exceljs';
import db from './db.js';
import { requireAuth } from './auth.js';
import { calcularResumen } from './resumen.js';

export const router = express.Router();

// Paleta de marca (ARGB)
const VINO = 'FF671410';
const DORADO = 'FFC4A362';
const BEIGE = 'FFD9CBB5';
const BLANCO = 'FFFFFFFF';

const COP = '#,##0';
const USD = '#,##0.00';

const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const titulo = { name: 'Georgia', bold: true, size: 13, color: { argb: DORADO } };
const headerFont = { name: 'Georgia', bold: true, size: 10, color: { argb: VINO } };
const totalFont = { bold: true, color: { argb: VINO } };

function bloqueTitulo(ws, texto, ncols = 4) {
  const row = ws.addRow([texto]);
  ws.mergeCells(row.number, 1, row.number, ncols);
  row.getCell(1).font = titulo;
  row.getCell(1).fill = fill(VINO);
  row.getCell(1).alignment = { vertical: 'middle' };
  row.height = 22;
  return row;
}

function filaHeader(ws, valores) {
  const row = ws.addRow(valores);
  row.eachCell((c) => {
    c.font = headerFont;
    c.fill = fill(BEIGE);
    c.border = { bottom: { style: 'thin', color: { argb: DORADO } } };
  });
  return row;
}

// ---------------------------------------------------------------------------
// Hoja INGRESOS  (bloques por plataforma, PESOS = DÓLARES x TRM)
// ---------------------------------------------------------------------------
function hojaIngresos(wb, rows, meta) {
  const ws = wb.addWorksheet('Ingresos', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { width: 16 }, { width: 14 }, { width: 20 }, { width: 18 },
    { width: 4 }, { width: 20 }, { width: 18 },
  ];

  const cab = ws.addRow([`INGRESOS · ${meta.sedeNombre} · ${meta.periodoTexto}`]);
  ws.mergeCells(cab.number, 1, cab.number, 4);
  cab.getCell(1).font = { name: 'Georgia', bold: true, size: 14, color: { argb: VINO } };
  ws.addRow([]);

  const plataformas = [...new Set(rows.map((r) => r.categoria))];
  const subtotalDolarCells = [];
  const subtotalPesoCells = [];

  for (const plat of plataformas) {
    const propias = rows
      .filter((r) => r.categoria === plat)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (!propias.length) continue;

    bloqueTitulo(ws, plat.toUpperCase());
    filaHeader(ws, ['PERIODO', 'DÓLARES', 'LIQUIDACIÓN DE DÓLAR', 'PESOS']);

    const primera = ws.rowCount + 1;
    for (const r of propias) {
      const row = ws.addRow([r.fecha, r.monto_usd || 0, r.trm || 0, null]);
      row.getCell(2).numFmt = USD;
      row.getCell(3).numFmt = COP;
      row.getCell(4).value = { formula: `B${row.number}*C${row.number}` };
      row.getCell(4).numFmt = COP;
    }
    const ultima = ws.rowCount;

    const sub = ws.addRow([
      'Subtotal ' + plat,
      { formula: `SUM(B${primera}:B${ultima})` },
      null,
      { formula: `SUM(D${primera}:D${ultima})` },
    ]);
    sub.getCell(1).font = totalFont;
    sub.getCell(2).font = totalFont; sub.getCell(2).numFmt = USD;
    sub.getCell(4).font = totalFont; sub.getCell(4).numFmt = COP;
    subtotalDolarCells.push(`B${sub.number}`);
    subtotalPesoCells.push(`D${sub.number}`);
    ws.addRow([]);
  }

  bloqueTitulo(ws, 'TOTALES');
  const tD = ws.addRow(['DÓLARES TOTALES', subtotalDolarCells.length ? { formula: subtotalDolarCells.join('+') } : 0]);
  tD.getCell(1).font = totalFont; tD.getCell(2).font = totalFont; tD.getCell(2).numFmt = USD;
  const tP = ws.addRow(['PESOS TOTALES', subtotalPesoCells.length ? { formula: subtotalPesoCells.join('+') } : 0]);
  tP.getCell(1).font = totalFont; tP.getCell(2).font = totalFont; tP.getCell(2).numFmt = COP;
  ws.pesosTotalesCell = `Ingresos!B${tP.number}`;
  ws.dolaresTotalesCell = `Ingresos!B${tD.number}`;
  return ws;
}

// ---------------------------------------------------------------------------
// Hoja tipo lista (Gastos / Inversión) con total y desglose por categoría
// ---------------------------------------------------------------------------
function hojaLista(wb, nombre, rows, meta, tituloTotal) {
  const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [{ width: 13 }, { width: 20 }, { width: 18 }, { width: 40 }, { width: 16 }];

  const cab = ws.addRow([`${nombre.toUpperCase()} · ${meta.sedeNombre} · ${meta.periodoTexto}`]);
  ws.mergeCells(cab.number, 1, cab.number, 5);
  cab.getCell(1).font = { name: 'Georgia', bold: true, size: 14, color: { argb: VINO } };
  ws.addRow([]);

  filaHeader(ws, ['FECHA', 'CATEGORÍA', 'SUBCATEGORÍA', 'DESCRIPCIÓN', 'MONTO COP']);
  const primera = ws.rowCount + 1;
  rows
    .slice()
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .forEach((r) => {
      const row = ws.addRow([r.fecha, r.categoria, r.subcategoria || '', r.descripcion || '', r.monto_cop]);
      row.getCell(5).numFmt = COP;
    });
  const ultima = Math.max(ws.rowCount, primera - 1);

  const tot = ws.addRow([tituloTotal, null, null, null, { formula: `SUM(E${primera}:E${ultima})` }]);
  tot.getCell(1).font = totalFont;
  tot.getCell(5).font = totalFont; tot.getCell(5).numFmt = COP;
  tot.getCell(1).fill = fill(BEIGE);
  ws.totalCell = `'${nombre}'!E${tot.number}`;

  ws.addRow([]);
  bloqueTitulo(ws, 'POR CATEGORÍA', 2);
  const cats = [...new Set(rows.map((r) => r.categoria))];
  for (const c of cats) {
    const row = ws.addRow([c, { formula: `SUMIF(B${primera}:B${ultima},"${c}",E${primera}:E${ultima})` }]);
    row.getCell(2).numFmt = COP;
  }
  return ws;
}

// ---------------------------------------------------------------------------
// Hoja MULTAS Y RETIROS
// ---------------------------------------------------------------------------
function hojaMultasRetiros(wb, multas, retiros, meta) {
  const ws = wb.addWorksheet('Multas y Retiros');
  ws.columns = [{ width: 13 }, { width: 22 }, { width: 40 }, { width: 16 }];

  bloqueTitulo(ws, `MULTAS · ${meta.periodoTexto}`, 4);
  filaHeader(ws, ['FECHA', 'CONCEPTO', 'DESCRIPCIÓN', 'MONTO COP']);
  let p = ws.rowCount + 1;
  multas.sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach((r) => {
    const row = ws.addRow([r.fecha, r.categoria, r.descripcion || '', r.monto_cop]);
    row.getCell(4).numFmt = COP;
  });
  let u = Math.max(ws.rowCount, p - 1);
  const tm = ws.addRow(['TOTAL MULTAS', null, null, { formula: `SUM(D${p}:D${u})` }]);
  tm.getCell(1).font = totalFont; tm.getCell(4).font = totalFont; tm.getCell(4).numFmt = COP;

  ws.addRow([]); ws.addRow([]);

  bloqueTitulo(ws, `RETIROS DE SOCIOS A CUENTA PERSONAL · ${meta.periodoTexto}`, 4);
  filaHeader(ws, ['FECHA', 'SOCIO', 'DESCRIPCIÓN', 'MONTO COP']);
  p = ws.rowCount + 1;
  retiros.sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach((r) => {
    const row = ws.addRow([r.fecha, r.socio, r.descripcion || '', r.monto_cop]);
    row.getCell(4).numFmt = COP;
  });
  u = Math.max(ws.rowCount, p - 1);
  const tr = ws.addRow(['TOTAL RETIROS', null, null, { formula: `SUM(D${p}:D${u})` }]);
  tr.getCell(1).font = totalFont; tr.getCell(4).font = totalFont; tr.getCell(4).numFmt = COP;

  ws.addRow([]);
  const socenc = [...new Set(retiros.map((r) => r.socio))];
  for (const s of socenc) {
    const row = ws.addRow([`Retiros ${s}`, null, null,
      { formula: `SUMIF(B${p}:B${u},"${s}",D${p}:D${u})` }]);
    row.getCell(1).font = { italic: true };
    row.getCell(4).numFmt = COP;
  }
  return ws;
}

// ---------------------------------------------------------------------------
// Hoja RESUMEN  (cascada RELACIÓN)
// ---------------------------------------------------------------------------
function hojaResumen(wb, R, meta) {
  const ws = wb.addWorksheet('Resumen');
  ws.columns = [{ width: 46 }, { width: 20 }, { width: 12 }];

  const t = ws.addRow([`RELACIÓN ${meta.periodoTexto.toUpperCase()} · SEDE ${meta.sedeNombre.toUpperCase()}`]);
  ws.mergeCells(t.number, 1, t.number, 3);
  t.getCell(1).font = { name: 'Georgia', bold: true, size: 14, color: { argb: VINO } };
  t.getCell(1).fill = fill(VINO);
  t.getCell(1).font = { name: 'Georgia', bold: true, size: 14, color: { argb: DORADO } };
  ws.addRow([]);

  const linea = (label, valor, { bold = false, pct = null, fillArgb = null } = {}) => {
    const row = ws.addRow([label, valor, pct]);
    row.getCell(2).numFmt = COP;
    if (pct != null) row.getCell(3).numFmt = '0.0%';
    if (bold) { row.getCell(1).font = totalFont; row.getCell(2).font = totalFont; }
    if (fillArgb) {
      row.getCell(1).fill = fill(fillArgb);
      row.getCell(2).fill = fill(fillArgb);
      row.getCell(3).fill = fill(fillArgb);
    }
    return row.number;
  };

  const ingRow = linea('INGRESOS TOTALES', R.ingresos.total, { bold: true });
  linea('  Dólares totales (USD)', R.ingresos.usd_total);
  for (const p of R.ingresos.por_plataforma) linea(`  ${p.nombre}`, p.monto);
  ws.addRow([]);

  const nmRow = linea('(−) Nómina Modelos', R.nomina_modelos);
  const npRows = [];
  for (const l of R.nomina_personal.por_linea) {
    const nombre = l.linea === 'monitores' ? 'Monitores' : l.linea === 'aseo' ? 'Señoras de Aseo' : 'Obreros';
    npRows.push(linea(`(−) Nómina ${nombre}`, l.monto));
  }
  const gvRow = linea('(−) Gastos varios', R.gastos_varios.total);
  for (const c of R.gastos_varios.por_categoria) linea(`      ${c.nombre}`, c.monto);
  const muRow = linea('(+) Multas', R.multas);
  const crRow = linea('(−) Cruce negativos (ajuste manual)', R.cruce_negativos);
  ws.addRow([]);

  const restar = [nmRow, ...npRows, gvRow, crRow].map((n) => `B${n}`).join('+');
  const gananciasRow = ws.addRow([
    'GANANCIAS TOTALES',
    { formula: `B${ingRow}-(${restar})+B${muRow}` },
  ]);
  gananciasRow.getCell(2).numFmt = COP;
  gananciasRow.getCell(1).font = { name: 'Georgia', bold: true, size: 12, color: { argb: DORADO } };
  gananciasRow.getCell(1).fill = fill(VINO);
  gananciasRow.getCell(2).font = { bold: true, size: 12, color: { argb: DORADO } };
  gananciasRow.getCell(2).fill = fill(VINO);
  const gRow = gananciasRow.number;
  ws.addRow([]);

  for (const s of R.socios) {
    linea(`${s.nombre} — ${s.porcentaje}% de las ganancias`,
      { formula: `B${gRow}*${s.porcentaje}/100` }, { bold: true });
    const rMenos = ws.addRow([`  (−) Retiros de ${s.nombre} a cuenta personal`, s.retiros]);
    rMenos.getCell(2).numFmt = COP;
    const restRow = ws.addRow([`  = Restante oficial ${s.nombre}`,
      { formula: `B${ws.rowCount - 1}-B${ws.rowCount}` }]);
    restRow.getCell(2).numFmt = COP;
    restRow.getCell(1).font = totalFont; restRow.getCell(2).font = totalFont;

    if (s.asume_inversiones) {
      const invMenos = ws.addRow([`  (−) Inversión del mes (${s.nombre} la asume)`, R.inversion.total]);
      invMenos.getCell(2).numFmt = COP;
      const finalRow = ws.addRow([`  = Restante oficial ${s.nombre} tras inversiones`,
        { formula: `B${restRow.number}-B${invMenos.number}` }]);
      finalRow.getCell(2).numFmt = COP;
      finalRow.getCell(1).font = { name: 'Georgia', bold: true, color: { argb: VINO } };
      finalRow.getCell(2).font = { name: 'Georgia', bold: true, color: { argb: VINO } };
      finalRow.getCell(1).fill = fill(BEIGE);
      finalRow.getCell(2).fill = fill(BEIGE);
    }
    ws.addRow([]);
  }

  bloqueTitulo(ws, 'INVERSIÓN DEL MES (detalle)', 3);
  for (const c of R.inversion.por_categoria) linea(`  ${c.nombre}`, c.monto);
  linea('TOTAL INVERSIÓN', R.inversion.total, { bold: true });

  if (R.notas) {
    ws.addRow([]);
    const n = ws.addRow(['Notas: ' + R.notas]);
    n.getCell(1).font = { italic: true };
  }
  return ws;
}

// ---------------------------------------------------------------------------
// Ruta
// ---------------------------------------------------------------------------
router.get('/export.xlsx', requireAuth, async (req, res) => {
  const periodo = String(req.query.periodo || '');
  const sede = String(req.query.sede || 'Centro');
  const desde = String(req.query.desde || '');
  const hasta = String(req.query.hasta || '');
  const sedeNombre = String(req.query.sede_nombre || sede);

  if (!periodo && !(desde && hasta)) {
    return res.status(400).json({ error: 'Indica periodo (YYYY-MM) o desde+hasta' });
  }

  const where = [];
  const args = {};
  if (periodo) { where.push('periodo = @periodo'); args.periodo = periodo; }
  if (desde) { where.push('fecha >= @desde'); args.desde = desde; }
  if (hasta) { where.push('fecha <= @hasta'); args.hasta = hasta; }
  if (sede && sede !== 'TODAS') { where.push('sede = @sede'); args.sede = sede; }
  const rowsStmt = db.prepare(
    `SELECT * FROM movimientos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY fecha`
  );
  const rows = where.length ? rowsStmt.all(args) : rowsStmt.all();

  const meta = {
    sedeNombre,
    periodoTexto: periodo || `${desde} a ${hasta}`,
  };
  const R = calcularResumen({ periodo, sede, desde, hasta });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Arivaness App';
  wb.created = new Date();

  hojaIngresos(wb, rows.filter((r) => r.tipo === 'ingreso'), meta);
  hojaLista(wb, 'Gastos', rows.filter((r) => r.tipo === 'gasto'), meta, 'TOTAL GASTOS');
  hojaLista(wb, 'Inversión', rows.filter((r) => r.tipo === 'inversion'), meta, 'TOTAL INVERSIÓN');
  hojaMultasRetiros(wb, rows.filter((r) => r.tipo === 'multa'), rows.filter((r) => r.tipo === 'retiro_socio'), meta);
  hojaResumen(wb, R, meta);

  const nombreArchivo = `Arivaness_${sedeNombre}_${(periodo || 'rango').replace(/-/g, '_')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  await wb.xlsx.write(res);
  res.end();
});
