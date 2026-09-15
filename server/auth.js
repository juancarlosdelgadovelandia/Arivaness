import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import db from './db.js';

const COOKIE = 'ari_sess';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);

const q = {
  userByName: db.prepare(`SELECT * FROM usuarios WHERE username = ? AND activo = 1`),
  userById: db.prepare(`SELECT id, username, nombre, rol FROM usuarios WHERE id = ? AND activo = 1`),
  insSesion: db.prepare(`INSERT INTO sesiones (token, usuario_id, expira_en) VALUES (?, ?, datetime('now', ?))`),
  sesion: db.prepare(`SELECT * FROM sesiones WHERE token = ? AND expira_en > datetime('now')`),
  delSesion: db.prepare(`DELETE FROM sesiones WHERE token = ?`),
  cleanup: db.prepare(`DELETE FROM sesiones WHERE expira_en <= datetime('now')`),
};

export function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Faltan credenciales' });

  const user = q.userByName.get(String(username).trim());
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  q.insSesion.run(token, user.id, `+${SESSION_DAYS} days`);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: String(process.env.COOKIE_SECURE) === 'true',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
  res.json({ usuario: { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol } });
}

export function logout(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) q.delSesion.run(token);
  res.clearCookie(COOKIE);
  res.json({ ok: true });
}

export function attachUser(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    const s = q.sesion.get(token);
    if (s) req.usuario = q.userById.get(s.usuario_id);
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
  next();
}

export function requireOwner(req, res, next) {
  if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
  if (req.usuario.rol !== 'dueño') return res.status(403).json({ error: 'Solo el dueño puede hacer esto' });
  next();
}

// Limpieza periódica de sesiones vencidas.
setInterval(() => q.cleanup.run(), 60 * 60 * 1000).unref();
