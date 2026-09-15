// TRM USD/COP: automática (con caché diaria en SQLite) y con override manual.
//
// Fuente primaria : TRM oficial de la Superintendencia Financiera vía datos.gov.co
//                   (dataset 32sa-8pi3, gratis, sin API key).
// Fuente fallback : open.er-api.com (gratis, sin API key).
import db from './db.js';

const q = {
  get: db.prepare(`SELECT * FROM trm_diaria WHERE fecha = ?`),
  latest: db.prepare(`SELECT * FROM trm_diaria ORDER BY fecha DESC LIMIT 1`),
  upsert: db.prepare(`
    INSERT INTO trm_diaria (fecha, valor, fuente, obtenida_en)
    VALUES (@fecha, @valor, @fuente, datetime('now'))
    ON CONFLICT(fecha) DO UPDATE SET valor = @valor, fuente = @fuente, obtenida_en = datetime('now')
  `),
};

export function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchJSON(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function desdeDatosGov(fecha) {
  // vigenciadesde <= fecha <= vigenciahasta
  const where = encodeURIComponent(
    `vigenciadesde <= '${fecha}T00:00:00.000' and vigenciahasta >= '${fecha}T00:00:00.000'`
  );
  const url = `https://www.datos.gov.co/resource/32sa-8pi3.json?$where=${where}&$limit=1`;
  const rows = await fetchJSON(url);
  const v = Array.isArray(rows) && rows[0] && Number(rows[0].valor);
  if (v && v > 0) return v;

  // Si no hay fila para esa fecha exacta, tomar la más reciente disponible.
  const url2 = `https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=1`;
  const rows2 = await fetchJSON(url2);
  const v2 = Array.isArray(rows2) && rows2[0] && Number(rows2[0].valor);
  if (v2 && v2 > 0) return v2;
  return null;
}

async function desdeErApi() {
  const data = await fetchJSON('https://open.er-api.com/v6/latest/USD');
  const v = data?.rates?.COP;
  return v && v > 0 ? Number(v) : null;
}

/**
 * Devuelve la TRM para una fecha. Si está en caché (manual o automática) la usa;
 * si no, intenta traerla de las APIs y la cachea. Nunca lanza: si todo falla,
 * devuelve la última TRM conocida o null.
 */
export async function obtenerTRM(fecha = hoyISO(), { forzarRefresco = false } = {}) {
  const cache = q.get.get(fecha);
  if (cache && !forzarRefresco) return { fecha, valor: cache.valor, fuente: cache.fuente, cacheada: true };
  if (cache && cache.fuente === 'manual') return { fecha, valor: cache.valor, fuente: 'manual', cacheada: true };

  let valor = null;
  try { valor = await desdeDatosGov(fecha); } catch { /* sigue al fallback */ }
  if (!valor) {
    try { valor = await desdeErApi(); } catch { /* sin fuentes */ }
  }

  if (valor) {
    q.upsert.run({ fecha, valor, fuente: 'automatica' });
    return { fecha, valor, fuente: 'automatica', cacheada: false };
  }

  const last = q.latest.get();
  if (last) return { fecha, valor: last.valor, fuente: last.fuente, cacheada: true, aproximada: true, fechaReal: last.fecha };
  return { fecha, valor: null, fuente: null, cacheada: false };
}

/** Fija manualmente la TRM de una fecha. */
export function fijarTRM(fecha, valor) {
  const v = Number(valor);
  if (!v || v <= 0) throw new Error('TRM inválida');
  q.upsert.run({ fecha, valor: v, fuente: 'manual' });
  return { fecha, valor: v, fuente: 'manual' };
}

/** Precarga la TRM de hoy (para el cron diario). */
export async function precargarHoy() {
  try {
    const r = await obtenerTRM(hoyISO(), { forzarRefresco: true });
    console.log(`[TRM] ${r.fecha}: ${r.valor ?? 'sin dato'} (${r.fuente ?? '—'})`);
  } catch (e) {
    console.warn('[TRM] precarga falló:', e.message);
  }
}
