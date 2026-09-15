// Respaldo del archivo SQLite. Uso: node scripts/backup.js
// Recomendado: correrlo por cron una vez al día. Guarda los últimos 30.
import fs from 'node:fs';
import path from 'node:path';
import db, { DB_PATH } from '../server/db.js';

const DIR = path.join(path.dirname(DB_PATH), 'backups');
fs.mkdirSync(DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const destino = path.join(DIR, `arivaness-${stamp}.sqlite`);

await db.backup(destino);
console.log('Respaldo creado:', destino);

// Retención: conserva los 30 más recientes.
const previos = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.sqlite'))
  .sort()
  .reverse();
for (const viejo of previos.slice(30)) {
  fs.unlinkSync(path.join(DIR, viejo));
  console.log('Eliminado respaldo antiguo:', viejo);
}
process.exit(0);
