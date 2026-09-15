# Arivaness — Gestor Financiero del Estudio

App web con backend y base de datos real para registrar **Ingresos, Gastos, Inversiones,
Multas y Retiros de socios**, calcular la **cascada de reparto (RELACIÓN)** y **exportar a Excel**.

- **Ingresos**: siempre en USD. Se registra el monto en USD + la TRM del día; el COP se calcula solo (`USD × TRM`).
- **Gastos / Inversiones / Multas / Retiros**: siempre en efectivo, directo en COP.
- **TRM automática** (TRM oficial de la Superintendencia Financiera vía datos.gov.co, con fallback), **editable manualmente**.
- **Multi-usuario**: el dueño y la administradora entran desde distintos celulares y ven los mismos datos.
- **Multi-sede**: por ahora activa **Centro**; Cajicá, Colsubsidio y Satelitales quedan listas para activar en Configuración.

## Stack

| | |
|---|---|
| Backend | Node.js + Express |
| Base de datos | SQLite (archivo único, fácil de respaldar) |
| Excel | ExcelJS (hojas con fórmulas reales) |
| Frontend | HTML/CSS/JS con la identidad de marca Arivaness |
| Hosting | Railway.app con volumen persistente |

---

## Correr en local (para desarrollo)

Requiere Node 20+.

```bash
npm install
cp .env.example .env      # edita las contraseñas semilla
npm start                 # http://localhost:3000
```

La primera vez se crean automáticamente los 2 usuarios definidos en `.env`.

## Desplegar en Railway (producción)

1. El código ya está en GitHub: `github.com/juancarlosdelgadovelandia/Arivaness`.
2. En [Railway](https://railway.app): **New Project → Deploy from GitHub repo** y selecciona
   `Arivaness`. Railway lee `railway.json` y detecta Node.js automáticamente (Nixpacks).
3. Agrega un **Volume** al servicio (pestaña *Volumes* → *New Volume*), con mount path `/data`.
4. En **Variables** define:
   - `DB_PATH` = `/data/arivaness.sqlite`
   - `COOKIE_SECURE` = `true`
   - `SESSION_DAYS` = `30`
   - `SEED_OWNER_USERNAME`, `SEED_OWNER_PASSWORD`
   - `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`
5. **Deploy**. En 2–3 min queda una URL tipo `https://arivaness-app.up.railway.app`.
6. En **Settings → Networking → Public Networking** puedes generar el dominio público y,
   desde ahí, agregar tu dominio personalizado de GoDaddy (te da un registro CNAME para
   pegar en la zona DNS de GoDaddy).
7. Entra, ve a **Configuración → Usuarios** y cambia las contraseñas.

> El archivo `arivaness.sqlite` vive en el volumen persistente: los datos **no se pierden**
> al reiniciar ni al desplegar una versión nueva.

## Respaldo

```bash
npm run backup        # copia data/arivaness.sqlite a data/backups/ (conserva 30)
```

En Railway se puede programar como **Cron Job** apuntando al mismo volumen, o descargar
el archivo periódicamente.

## Importar los datos de la app vieja

**Opción fácil (recomendada):** en la app nueva entra como dueño →
**Configuración → Importar datos de la app anterior**. En la app vieja abre la
consola del navegador, ejecuta `copy(localStorage.getItem('arivaness_entries'))`,
pega el texto y dale **Importar**.

**Opción por terminal:**

```bash
copy(localStorage.getItem('arivaness_entries'))   # en la consola de la app vieja
# guarda el texto en export.json y luego:
node scripts/import-legacy.js export.json Centro
```

En ambos casos se avisa qué registros de *Nómina Personal* necesitan que les
asignes una subcategoría (Monitores / Aseo / Obreros) editándolos en la app.

---

## Estructura

```
server/
  index.js        Express + rutas + cron TRM
  db.js           SQLite: esquema + catálogos semilla
  auth.js         login / sesión (cookie httpOnly) / bcrypt
  seed.js         usuarios iniciales
  trm.js          TRM automática + caché + override
  movimientos.js  CRUD + validación de reglas de negocio
  resumen.js      cascada RELACIÓN
  catalogos.js    listas configurables + socios + ajuste de periodo
  usuarios.js     gestión de usuarios
  export.js       generación del Excel
public/
  index.html app.js styles.css
scripts/
  backup.js  import-legacy.js
data/             arivaness.sqlite (ignorado por git)
```

## API (resumen)

```
POST   /api/login            {username, password}
POST   /api/logout
GET    /api/me

GET    /api/movimientos?tipo=&categoria=&sede=&periodo=&desde=&hasta=&socio=
POST   /api/movimientos
PUT    /api/movimientos/:id
DELETE /api/movimientos/:id
GET    /api/opciones                       listas para los formularios

GET    /api/resumen?periodo=YYYY-MM&sede=   cascada completa
GET    /api/ajuste?periodo=&sede=           cruce negativos + notas
PUT    /api/ajuste

GET    /api/trm?fecha=YYYY-MM-DD
PUT    /api/trm            {fecha, valor}   override manual

GET    /api/catalogos                       (leer todos)
POST   /api/catalogos/:grupo                (dueño)
PUT    /api/catalogos/:grupo/:valor         (dueño)
PUT    /api/socios                          (dueño)

GET    /api/usuarios                        (dueño)
POST   /api/usuarios                        (dueño)
PUT    /api/usuarios/:id/password
POST   /api/importar          {entries,sede} importar datos de la app vieja (dueño)

GET    /api/export.xlsx?periodo=&sede=&sede_nombre=
```

## Reglas de negocio (no cambiar sin querer)

Validadas en el servidor (`server/movimientos.js`):

- `ingreso` → `categoria` ∈ plataformas · `monto_usd` > 0 · `trm` > 0 · `monto_cop = monto_usd × trm`.
- `gasto` → `categoria` ∈ categorías de gasto · si es *Nómina Personal* exige `subcategoria` · `monto_cop` > 0.
- `inversion` → `categoria` ∈ categorías de inversión · `monto_cop` > 0.
- `multa` → `monto_cop` > 0.
- `retiro_socio` → `socio` válido · `monto_cop` > 0.

### Cascada RELACIÓN (`server/resumen.js`)

```
Ingresos totales
 (−) Nómina Modelos
 (−) Nómina Monitores / Aseo / Obreros
 (−) Gastos varios (todo gasto que no es nómina)
 (+) Multas
 (−) Cruce negativos (ajuste manual del mes)
 = GANANCIAS TOTALES
      Noel  20%  →  (−) retiros de Noel        = Restante oficial Noel
      Don Juan 80% → (−) retiros de Don Juan   = Restante oficial Don Juan
                     (−) Inversión del mes     = Restante oficial Don Juan tras inversiones
```

Los porcentajes, los nombres de los socios y quién asume la inversión se editan en
**Configuración → Socios**.
