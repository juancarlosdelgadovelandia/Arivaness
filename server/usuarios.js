import express from 'express';
import bcrypt from 'bcryptjs';
import db from './db.js';
import { requireAuth, requireOwner } from './auth.js';

export const router = express.Router();

const q = {
  lista: db.prepare(`SELECT id, username, nombre, rol, activo, creado_en FROM usuarios ORDER BY id`),
  byId: db.prepare(`SELECT * FROM usuarios WHERE id = ?`),
  crear: db.prepare(`INSERT INTO usuarios (username, password_hash, nombre, rol) VALUES (?, ?, ?, ?)`),
  setPass: db.prepare(`UPDATE usuarios SET password_hash = ? WHERE id = ?`),
  setDatos: db.prepare(`UPDATE usuarios SET nombre = @nombre, rol = @rol, activo = @activo WHERE id = @id`),
  delSesiones: db.prepare(`DELETE FROM sesiones WHERE usuario_id = ?`),
};

router.get('/usuarios', requireOwner, (req, res) => {
  res.json(q.lista.all());
});

router.post('/usuarios', requireOwner, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const nombre = String(req.body?.nombre || '').trim();
  const rol = req.body?.rol === 'dueño' ? 'dueño' : 'admin';
  if (!username || password.length < 6) {
    return res.status(400).json({ error: 'Usuario requerido y contraseña de al menos 6 caracteres' });
  }
  try {
    const info = q.crear.run(username, bcrypt.hashSync(password, 10), nombre, rol);
    res.status(201).json(q.byId.get(info.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ese usuario ya existe' });
    throw e;
  }
});

router.put('/usuarios/:id', requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const u = q.byId.get(id);
  if (!u) return res.status(404).json({ error: 'No existe' });
  q.setDatos.run({
    id,
    nombre: String(req.body?.nombre ?? u.nombre),
    rol: req.body?.rol === 'dueño' ? 'dueño' : 'admin',
    activo: req.body?.activo === false ? 0 : 1,
  });
  res.json(q.byId.get(id));
});

// Cambio de contraseña: el dueño puede cambiar la de cualquiera; cada quien la propia.
router.put('/usuarios/:id/password', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const esPropia = req.usuario.id === id;
  if (!esPropia && req.usuario.rol !== 'dueño') {
    return res.status(403).json({ error: 'No autorizado' });
  }
  const nueva = String(req.body?.password || '');
  if (nueva.length < 6) return res.status(400).json({ error: 'Mínimo 6 caracteres' });
  if (!q.byId.get(id)) return res.status(404).json({ error: 'No existe' });
  q.setPass.run(bcrypt.hashSync(nueva, 10), id);
  q.delSesiones.run(id); // fuerza re-login en otros dispositivos
  res.json({ ok: true });
});
