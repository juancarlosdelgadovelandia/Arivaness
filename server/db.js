import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'data', 'arivaness.sqlite');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Esquema
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  nombre         TEXT NOT NULL DEFAULT '',
  rol            TEXT NOT NULL DEFAULT 'admin' CHECK (rol IN ('dueño','admin')),
  activo         INTEGER NOT NULL DEFAULT 1,
  creado_en      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sesiones (
  token       TEXT PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creada_en   TEXT NOT NULL DEFAULT (datetime('now')),
  expira_en   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS movimientos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo          TEXT NOT NULL CHECK (tipo IN ('ingreso','gasto','inversion','multa','retiro_socio')),
  categoria     TEXT NOT NULL DEFAULT '',
  subcategoria  TEXT NOT NULL DEFAULT '',
  socio         TEXT NOT NULL DEFAULT '',
  fecha         TEXT NOT NULL,               -- 'YYYY-MM-DD'
  periodo       TEXT NOT NULL,               -- 'YYYY-MM' (derivado de fecha)
  descripcion   TEXT NOT NULL DEFAULT '',
  monto_usd     REAL,                        -- solo ingreso
  trm           REAL,                        -- solo ingreso
  monto_cop     REAL NOT NULL,
  sede          TEXT NOT NULL DEFAULT 'Centro',
  creado_por    INTEGER REFERENCES usuarios(id),
  creado_en     TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mov_periodo  ON movimientos(periodo);
CREATE INDEX IF NOT EXISTS idx_mov_sede     ON movimientos(sede);
CREATE INDEX IF NOT EXISTS idx_mov_tipo     ON movimientos(tipo);
CREATE INDEX IF NOT EXISTS idx_mov_fecha    ON movimientos(fecha);

CREATE TABLE IF NOT EXISTS trm_diaria (
  fecha       TEXT PRIMARY KEY,              -- 'YYYY-MM-DD'
  valor       REAL NOT NULL,
  fuente      TEXT NOT NULL DEFAULT 'automatica' CHECK (fuente IN ('automatica','manual')),
  obtenida_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS catalogos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  grupo     TEXT NOT NULL,                   -- plataforma_ingreso | categoria_gasto | subcategoria_nomina | categoria_inversion | sede
  valor     TEXT NOT NULL,
  orden     INTEGER NOT NULL DEFAULT 0,
  activo    INTEGER NOT NULL DEFAULT 1,
  meta      TEXT NOT NULL DEFAULT '',        -- p.ej. la línea de cascada a la que mapea una subcategoría de nómina
  UNIQUE (grupo, valor)
);

CREATE TABLE IF NOT EXISTS socios (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre            TEXT NOT NULL UNIQUE,
  porcentaje        REAL NOT NULL DEFAULT 0,
  asume_inversiones INTEGER NOT NULL DEFAULT 0,
  orden             INTEGER NOT NULL DEFAULT 0,
  activo            INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ajustes_periodo (
  periodo          TEXT NOT NULL,            -- 'YYYY-MM'
  sede             TEXT NOT NULL,
  cruce_negativos  REAL NOT NULL DEFAULT 0,
  notas            TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (periodo, sede)
);

CREATE TABLE IF NOT EXISTS config (
  clave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL
);
`);

// ---------------------------------------------------------------------------
// Datos semilla (solo si las tablas están vacías)
// ---------------------------------------------------------------------------
const seedCatalogo = db.prepare(
  `INSERT OR IGNORE INTO catalogos (grupo, valor, orden, activo, meta) VALUES (?, ?, ?, ?, ?)`
);

function seedGrupo(grupo, valores) {
  valores.forEach(([valor, activo = 1, meta = ''], i) => {
    seedCatalogo.run(grupo, valor, i, activo ? 1 : 0, meta);
  });
}

const catalogosVacios = db.prepare(`SELECT COUNT(*) c FROM catalogos`).get().c === 0;
if (catalogosVacios) {
  // Todas las plataformas que aparecen en el Excel real del estudio.
  seedGrupo('plataforma_ingreso', [
    ['Stripchat'], ['Chaturbate'], ['MyFreeCams'],
    ['CAM4'], ['Amateur'], ['CamSoda'], ['Streamate'],
  ]);
  seedGrupo('categoria_gasto', [
    ['Nómina Modelos'], ['Nómina Personal'], ['Servicios'], ['Mantenimiento'],
  ]);
  // meta = línea de la cascada RELACIÓN: 'monitores' | 'aseo' | 'obreros'
  seedGrupo('subcategoria_nomina', [
    ['Monitores', 1, 'monitores'],
    ['Psicóloga', 1, 'monitores'],
    ['Señoras de Aseo', 1, 'aseo'],
    ['Obreros', 1, 'obreros'],
  ]);
  seedGrupo('categoria_inversion', [
    ['Hardware'], ['Infraestructura'], ['Construcción'],
  ]);
  seedGrupo('sede', [
    ['Centro', 1],
    ['Cajicá', 0],
    ['Colsubsidio', 0],
    ['Satelitales', 0],
  ]);
}

const sociosVacios = db.prepare(`SELECT COUNT(*) c FROM socios`).get().c === 0;
if (sociosVacios) {
  const insSocio = db.prepare(
    `INSERT INTO socios (nombre, porcentaje, asume_inversiones, orden) VALUES (?, ?, ?, ?)`
  );
  insSocio.run('Noel', 20, 0, 0);
  insSocio.run('Don Juan', 80, 1, 1);
}

const setConfig = db.prepare(`INSERT OR IGNORE INTO config (clave, valor) VALUES (?, ?)`);
setConfig.run('nombre_estudio', 'Arivaness');
setConfig.run('sede_default', 'Centro');

export default db;
export { DB_PATH };
