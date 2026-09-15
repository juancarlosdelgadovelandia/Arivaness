import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import db from './db.js';
import { seedUsuarios } from './seed.js';
import { login, logout, attachUser, requireAuth } from './auth.js';
import { router as movimientosRouter } from './movimientos.js';
import { router as resumenRouter } from './resumen.js';
import { router as catalogosRouter } from './catalogos.js';
import { router as exportRouter } from './export.js';
import { router as usuariosRouter } from './usuarios.js';
import { router as importarRouter } from './importar.js';
import { obtenerTRM, fijarTRM, precargarHoy, hoyISO } from './trm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

seedUsuarios();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(attachUser);

// --- Salud (para el health check de Railway) --------------------------
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// --- Auth ---------------------------------------------------------------
app.post('/api/login', login);
app.post('/api/logout', logout);
app.get('/api/me', (req, res) => {
  if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
  res.json({ usuario: req.usuario });
});

// --- TRM --------------------------------------------------------------
app.get('/api/trm', requireAuth, async (req, res) => {
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fecha || '')) ? req.query.fecha : hoyISO();
  try {
    res.json(await obtenerTRM(fecha, { forzarRefresco: req.query.refrescar === '1' }));
  } catch (e) {
    res.status(502).json({ error: 'No se pudo obtener la TRM', detalle: e.message });
  }
});
app.put('/api/trm', requireAuth, (req, res) => {
  const fecha = String(req.body?.fecha || hoyISO());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Fecha inválida' });
  try {
    res.json(fijarTRM(fecha, req.body?.valor));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Recursos ---------------------------------------------------------
app.use('/api', movimientosRouter);
app.use('/api', resumenRouter);
app.use('/api', catalogosRouter);
app.use('/api', exportRouter);
app.use('/api', usuariosRouter);
app.use('/api', importarRouter);

// --- Frontend --------------------------------------------------------
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// --- Manejo de errores ---------------------------------------------
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno', detalle: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Arivaness App escuchando en http://localhost:${PORT}`);
});

// --- Cron diario: precargar la TRM del día -------------------------
precargarHoy();
setInterval(precargarHoy, 6 * 60 * 60 * 1000).unref();

export default app;
