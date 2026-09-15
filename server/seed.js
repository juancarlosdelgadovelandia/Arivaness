// Crea los usuarios iniciales a partir de variables de entorno.
// Se ejecuta solo (npm run seed) y también automáticamente al arrancar el servidor.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import db from './db.js';

export function seedUsuarios() {
  const count = db.prepare(`SELECT COUNT(*) c FROM usuarios`).get().c;
  if (count > 0) return;

  const owner = {
    username: process.env.SEED_OWNER_USERNAME || 'juan',
    password: process.env.SEED_OWNER_PASSWORD || 'arivaness-cambiar',
    nombre: process.env.SEED_OWNER_NOMBRE || 'Dueño',
    rol: 'dueño',
  };
  const admin = {
    username: process.env.SEED_ADMIN_USERNAME || 'admin',
    password: process.env.SEED_ADMIN_PASSWORD || 'arivaness-cambiar',
    nombre: process.env.SEED_ADMIN_NOMBRE || 'Administradora',
    rol: 'admin',
  };

  const ins = db.prepare(
    `INSERT INTO usuarios (username, password_hash, nombre, rol) VALUES (@username, @hash, @nombre, @rol)`
  );
  for (const u of [owner, admin]) {
    ins.run({ username: u.username, hash: bcrypt.hashSync(u.password, 10), nombre: u.nombre, rol: u.rol });
    console.log(`Usuario creado: ${u.username} (${u.rol})`);
  }
}

// Permite ejecutarlo directamente: node server/seed.js
if (import.meta.url === `file://${process.argv[1]}`) {
  seedUsuarios();
  console.log('Semilla completada.');
}
