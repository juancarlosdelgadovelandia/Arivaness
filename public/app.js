'use strict';

/* ============================ utilidades ============================ */
const $ = (id) => document.getElementById(id);
const nfCOP = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const nfUSD = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cop = (n) => '$ ' + nfCOP.format(Math.round(Number(n) || 0));
const usd = (n) => 'US$ ' + nfUSD.format(Number(n) || 0);
const hoy = () => new Date().toISOString().slice(0, 10);
const mesActual = () => new Date().toISOString().slice(0, 7);

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* respuesta sin cuerpo */ }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

let toastT;
function toast(msg, tipo = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = tipo === 'error' ? 'error' : '';
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('oculto'), 3200);
  t.classList.remove('oculto');
}

/* ============================ estado ============================ */
const S = {
  me: null,
  opciones: null,
  sede: 'Centro',
  trmManualEditada: false,
  tipoActual: 'ingreso',
  editando: null,
};

/* ============================ arranque ============================ */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  $('form-login').addEventListener('submit', onLogin);
  try {
    const r = await api('/me');
    S.me = r.usuario;
    await entrarApp();
  } catch {
    $('login').classList.remove('oculto');
  }
}

async function onLogin(e) {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    const r = await api('/login', {
      method: 'POST',
      body: { username: $('login-user').value, password: $('login-pass').value },
    });
    S.me = r.usuario;
    $('login').classList.add('oculto');
    await entrarApp();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
}

async function entrarApp() {
  $('login').classList.add('oculto');
  $('app').classList.remove('oculto');
  if (S.me.rol !== 'dueño') $('tab-config').classList.add('oculto');

  S.opciones = await api('/opciones');

  // Sedes
  const selSede = $('sede-actual');
  selSede.innerHTML = S.opciones.sede.map((s) => `<option>${s}</option>`).join('');
  S.sede = S.opciones.sede[0] || 'Centro';
  selSede.value = S.sede;
  selSede.addEventListener('change', () => {
    S.sede = selSede.value;
    $('e-sede-nombre').value = S.sede;
    refrescarVistaActual();
  });
  $('e-sede-nombre').value = S.sede;

  // Navegación
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-vista]');
    if (b) cambiarVista(b.dataset.vista);
  });
  $('btn-menu').addEventListener('click', menuCuenta);

  // Fechas por defecto
  $('m-fecha').value = hoy();
  $('f-periodo').value = mesActual();
  $('r-periodo').value = mesActual();
  $('e-periodo').value = mesActual();

  configurarRegistrar();
  bindMovimientos();
  bindResumen();
  bindExportar();

  cambiarVista('registrar');
}

function cambiarVista(v) {
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('activo', b.dataset.vista === v));
  document.querySelectorAll('section.vista').forEach((s) => s.classList.toggle('activo', s.id === 'vista-' + v));
  if (v === 'movimientos') cargarMovimientos();
  if (v === 'resumen') cargarResumen();
  if (v === 'config') cargarConfig();
}

function refrescarVistaActual() {
  const v = document.querySelector('nav.tabs button.activo')?.dataset.vista;
  if (v) cambiarVista(v);
}

async function menuCuenta() {
  const op = prompt(
    `Sesión: ${S.me.nombre || S.me.username} (${S.me.rol})\n\n` +
    `1 = Cambiar mi contraseña\n2 = Cerrar sesión\n\nEscribe 1 o 2:`
  );
  if (op === '1') {
    const p = prompt('Nueva contraseña (mínimo 6 caracteres):');
    if (p && p.length >= 6) {
      try { await api(`/usuarios/${S.me.id}/password`, { method: 'PUT', body: { password: p } }); toast('Contraseña actualizada'); }
      catch (e) { toast(e.message, 'error'); }
    } else if (p !== null) toast('Muy corta', 'error');
  } else if (op === '2') {
    await api('/logout', { method: 'POST' });
    location.reload();
  }
}

/* ============================ REGISTRAR ============================ */
function opcionesHtml(arr) {
  return ['<option value="">— Selecciona —</option>', ...arr.map((v) => `<option>${v}</option>`)].join('');
}

function configurarRegistrar() {
  const o = S.opciones;
  $('m-plataforma').innerHTML = opcionesHtml(o.plataforma_ingreso);
  $('m-categoria-gasto').innerHTML = opcionesHtml(o.categoria_gasto);
  $('m-categoria-inversion').innerHTML = opcionesHtml(o.categoria_inversion);
  $('m-subcategoria').innerHTML = opcionesHtml(o.subcategoria_nomina);
  $('m-socio').innerHTML = opcionesHtml(o.socios.map((s) => s.nombre));

  $('seg-tipo').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tipo]');
    if (!b) return;
    document.querySelectorAll('#seg-tipo button').forEach((x) => x.classList.toggle('activo', x === b));
    S.tipoActual = b.dataset.tipo;
    pintarCamposTipo();
  });

  $('m-categoria-gasto').addEventListener('change', () => {
    const esNomina = $('m-categoria-gasto').value === 'Nómina Personal';
    $('c-subcategoria').classList.toggle('oculto', !esNomina);
  });

  $('m-usd').addEventListener('input', calcularCOP);
  $('m-trm').addEventListener('input', () => { S.trmManualEditada = true; calcularCOP(); });
  $('m-fecha').addEventListener('change', () => { if (S.tipoActual === 'ingreso') cargarTRM(); });

  $('form-mov').addEventListener('submit', guardarMovimiento);
  $('btn-cancelar-edicion').addEventListener('click', resetForm);

  pintarCamposTipo();
}

function pintarCamposTipo() {
  const t = S.tipoActual;
  const show = (id, cond) => $(id).classList.toggle('oculto', !cond);
  show('c-plataforma', t === 'ingreso');
  show('c-categoria-gasto', t === 'gasto');
  show('c-categoria-inversion', t === 'inversion');
  show('c-socio', t === 'retiro_socio');
  show('c-subcategoria', t === 'gasto' && $('m-categoria-gasto').value === 'Nómina Personal');
  show('bloque-ingreso', t === 'ingreso');
  show('bloque-cop', t !== 'ingreso');
  if (t === 'ingreso') cargarTRM();
}

async function cargarTRM() {
  const info = $('trm-info');
  info.textContent = 'Consultando TRM…';
  try {
    const r = await api('/trm?fecha=' + $('m-fecha').value);
    if (r.valor == null) {
      info.textContent = '⚠ No se pudo traer la TRM automática. Ingrésala manualmente.';
    } else {
      if (!S.trmManualEditada) $('m-trm').value = r.valor;
      const etq = r.fuente === 'manual' ? 'manual'
        : r.aproximada ? `del ${r.fechaReal} (aún no hay dato de hoy)` : 'oficial';
      info.textContent = `TRM ${etq}: $ ${nfCOP.format(r.valor)}. Puedes editarla si usas otra tasa.`;
    }
  } catch {
    info.textContent = '⚠ No se pudo consultar la TRM.';
  }
  calcularCOP();
}

function calcularCOP() {
  const v = (Number($('m-usd').value) || 0) * (Number($('m-trm').value) || 0);
  $('m-cop-calc').value = v > 0 ? cop(v) : '';
}

function payloadMovimiento() {
  const t = S.tipoActual;
  const base = {
    tipo: t,
    fecha: $('m-fecha').value,
    sede: S.sede,
    descripcion: $('m-desc').value.trim(),
  };
  if (t === 'ingreso') {
    return { ...base, categoria: $('m-plataforma').value, monto_usd: Number($('m-usd').value), trm: Number($('m-trm').value) };
  }
  if (t === 'gasto') {
    return {
      ...base,
      categoria: $('m-categoria-gasto').value,
      subcategoria: $('m-categoria-gasto').value === 'Nómina Personal' ? $('m-subcategoria').value : '',
      monto_cop: Number($('m-cop').value),
    };
  }
  if (t === 'inversion') return { ...base, categoria: $('m-categoria-inversion').value, monto_cop: Number($('m-cop').value) };
  if (t === 'multa') return { ...base, categoria: 'Multa', monto_cop: Number($('m-cop').value) };
  if (t === 'retiro_socio') return { ...base, socio: $('m-socio').value, monto_cop: Number($('m-cop').value) };
}

async function guardarMovimiento(e) {
  e.preventDefault();
  $('mov-error').textContent = '';
  const body = payloadMovimiento();
  try {
    if (S.editando) {
      await api('/movimientos/' + S.editando, { method: 'PUT', body });
      toast('Movimiento actualizado');
    } else {
      await api('/movimientos', { method: 'POST', body });
      toast('Movimiento guardado');
    }
    resetForm();
  } catch (err) {
    $('mov-error').textContent = err.message;
  }
}

function resetForm() {
  S.editando = null;
  S.trmManualEditada = false;
  $('m-id').value = '';
  $('m-usd').value = '';
  $('m-cop').value = '';
  $('m-cop-calc').value = '';
  $('m-desc').value = '';
  $('m-plataforma').value = '';
  $('m-categoria-gasto').value = '';
  $('m-categoria-inversion').value = '';
  $('m-socio').value = '';
  $('m-fecha').value = hoy();
  $('btn-guardar-mov').textContent = 'Guardar movimiento';
  $('btn-cancelar-edicion').classList.add('oculto');
  $('mov-error').textContent = '';
  pintarCamposTipo();
}

function editarMovimiento(m) {
  S.editando = m.id;
  S.tipoActual = m.tipo;
  document.querySelectorAll('#seg-tipo button').forEach((x) => x.classList.toggle('activo', x.dataset.tipo === m.tipo));
  $('m-fecha').value = m.fecha;
  $('m-desc').value = m.descripcion || '';
  pintarCamposTipo();
  if (m.tipo === 'ingreso') {
    $('m-plataforma').value = m.categoria;
    $('m-usd').value = m.monto_usd;
    $('m-trm').value = m.trm;
    S.trmManualEditada = true;
    calcularCOP();
  } else if (m.tipo === 'gasto') {
    $('m-categoria-gasto').value = m.categoria;
    $('c-subcategoria').classList.toggle('oculto', m.categoria !== 'Nómina Personal');
    $('m-subcategoria').value = m.subcategoria || '';
    $('m-cop').value = m.monto_cop;
  } else if (m.tipo === 'inversion') {
    $('m-categoria-inversion').value = m.categoria;
    $('m-cop').value = m.monto_cop;
  } else {
    if (m.tipo === 'retiro_socio') $('m-socio').value = m.socio;
    $('m-cop').value = m.monto_cop;
  }
  $('btn-guardar-mov').textContent = 'Actualizar movimiento';
  $('btn-cancelar-edicion').classList.remove('oculto');
  cambiarVista('registrar');
  window.scrollTo(0, 0);
}

/* ============================ MOVIMIENTOS ============================ */
function bindMovimientos() {
  const cats = [
    ...S.opciones.plataforma_ingreso,
    ...S.opciones.categoria_gasto,
    ...S.opciones.categoria_inversion,
  ];
  $('f-categoria').innerHTML = '<option value="">Todas</option>' + cats.map((c) => `<option>${c}</option>`).join('');
  ['f-periodo', 'f-tipo', 'f-categoria'].forEach((id) => $(id).addEventListener('change', cargarMovimientos));
}

async function cargarMovimientos() {
  const periodo = $('f-periodo').value;
  const params = new URLSearchParams({ sede: S.sede });
  if (periodo) params.set('periodo', periodo);
  if ($('f-tipo').value) params.set('tipo', $('f-tipo').value);
  if ($('f-categoria').value) params.set('categoria', $('f-categoria').value);

  const [movs, resumen] = await Promise.all([
    api('/movimientos?' + params),
    periodo ? api(`/resumen?periodo=${periodo}&sede=${encodeURIComponent(S.sede)}`).catch(() => null) : null,
  ]);

  if (resumen) {
    const s = resumen.simple;
    $('tarjetas-resumen').innerHTML = `
      ${tarjeta('ingreso', 'Ingresos', cop(s.ingresos), usd(resumen.ingresos.usd_total))}
      ${tarjeta('gasto', 'Gastos', cop(s.gastos))}
      ${tarjeta('inversion', 'Inversiones', cop(s.inversiones))}
      ${tarjeta('balance', 'Balance neto', cop(s.balance_neto))}
    `;
  } else {
    $('tarjetas-resumen').innerHTML = '';
  }

  $('lista-mov').innerHTML = movs.length
    ? movs.map(filaMov).join('')
    : '<div class="vacio">Sin movimientos para estos filtros.</div>';

  $('lista-mov').querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => editarMovimiento(movs.find((m) => m.id === +b.dataset.edit))));
  $('lista-mov').querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => borrarMov(+b.dataset.del)));
}

function tarjeta(clase, etq, val, extra) {
  return `<div class="tarjeta ${clase}"><div class="etq">${etq}</div>
    <div class="val">${val}${extra ? ` <small>${extra}</small>` : ''}</div></div>`;
}

const TIPO_ETQ = { ingreso: 'Ingreso', gasto: 'Gasto', inversion: 'Inversión', multa: 'Multa', retiro_socio: 'Retiro socio' };

function filaMov(m) {
  const detalle = m.tipo === 'ingreso'
    ? `${usd(m.monto_usd)} × TRM ${nfCOP.format(m.trm)}`
    : m.tipo === 'retiro_socio' ? `Socio: ${m.socio}` : 'Efectivo';
  const cat = m.categoria && m.categoria !== TIPO_ETQ[m.tipo] ? m.categoria : '';
  const sub = [cat, m.subcategoria].filter(Boolean).join(' · ');
  return `<div class="mov ${m.tipo}">
    <div class="cab">
      <span class="fecha">${m.fecha}</span>
      <span class="monto">${cop(m.monto_cop)}</span>
    </div>
    <div><span class="badge">${TIPO_ETQ[m.tipo]}</span> ${sub ? `<span class="badge">${sub}</span>` : ''}</div>
    ${m.descripcion ? `<div class="desc">${escapar(m.descripcion)}</div>` : ''}
    <div class="meta">${detalle}</div>
    <div class="acciones">
      <button class="btn contorno chico" data-edit="${m.id}">Editar</button>
      <button class="btn peligro chico" data-del="${m.id}">Eliminar</button>
    </div>
  </div>`;
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function borrarMov(id) {
  if (!confirm('¿Eliminar este movimiento? No se puede deshacer.')) return;
  try { await api('/movimientos/' + id, { method: 'DELETE' }); toast('Movimiento eliminado'); cargarMovimientos(); }
  catch (e) { toast(e.message, 'error'); }
}

/* ============================ RESUMEN ============================ */
function bindResumen() {
  $('r-periodo').addEventListener('change', cargarResumen);
  $('btn-guardar-ajuste').addEventListener('click', async () => {
    try {
      await api('/ajuste', {
        method: 'PUT',
        body: {
          periodo: $('r-periodo').value,
          sede: S.sede,
          cruce_negativos: Number($('r-cruce').value) || 0,
          notas: $('r-notas').value,
        },
      });
      toast('Ajuste guardado');
      cargarResumen();
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function cargarResumen() {
  const periodo = $('r-periodo').value;
  if (!periodo) return;
  const [R, ajuste] = await Promise.all([
    api(`/resumen?periodo=${periodo}&sede=${encodeURIComponent(S.sede)}`),
    api(`/ajuste?periodo=${periodo}&sede=${encodeURIComponent(S.sede)}`),
  ]);
  $('r-cruce').value = ajuste.cruce_negativos || 0;
  $('r-notas').value = ajuste.notas || '';
  $('cascada-cont').innerHTML = renderCascada(R);
}

function linea(txt, val, cls = '') {
  const neg = Number(val) < 0 ? ' negativo' : '';
  return `<div class="linea ${cls}${neg}"><span>${txt}</span><span class="num">${cop(val)}</span></div>`;
}

function renderCascada(R) {
  let h = '<div class="cascada">';
  h += linea('Ingresos totales', R.ingresos.total, 'fuerte');
  h += `<div class="linea sangria"><span>Dólares totales</span><span class="num">${usd(R.ingresos.usd_total)}</span></div>`;
  R.ingresos.por_plataforma.forEach((p) => { h += `<div class="linea sangria"><span>${p.nombre}</span><span class="num">${cop(p.monto)}</span></div>`; });

  h += linea('(−) Nómina Modelos', -R.nomina_modelos);
  R.nomina_personal.por_linea.forEach((l) => {
    const nom = l.linea === 'monitores' ? 'Monitores' : l.linea === 'aseo' ? 'Señoras de Aseo' : 'Obreros';
    h += linea(`(−) Nómina ${nom}`, -l.monto);
  });
  h += linea('(−) Gastos varios', -R.gastos_varios.total);
  R.gastos_varios.por_categoria.forEach((c) => { h += `<div class="linea sangria"><span>${c.nombre}</span><span class="num">${cop(c.monto)}</span></div>`; });
  h += linea('(+) Multas', R.multas);
  h += linea('(−) Cruce negativos', -R.cruce_negativos);
  h += linea('Ganancias totales', R.ganancias_totales, 'destacado');

  R.socios.forEach((s) => {
    h += linea(`${s.nombre} · ${s.porcentaje}% de las ganancias`, s.participacion, 'socio');
    h += linea(`(−) Retiros de ${s.nombre} a cuenta personal`, -s.retiros, 'sangria');
    h += linea(`= Restante oficial ${s.nombre}`, s.restante, 'fuerte');
    if (s.asume_inversiones) {
      h += linea(`(−) Inversión del mes (${s.nombre} la asume)`, -R.inversion.total, 'sangria');
      h += linea(`= Restante oficial ${s.nombre} tras inversiones`, s.restante_tras_inversiones, 'destacado');
    }
  });

  h += linea('Inversión del mes (total)', R.inversion.total, 'fuerte');
  R.inversion.por_categoria.forEach((c) => { h += `<div class="linea sangria"><span>${c.nombre}</span><span class="num">${cop(c.monto)}</span></div>`; });
  h += '</div>';
  return h;
}

/* ============================ EXPORTAR ============================ */
function bindExportar() {
  $('btn-descargar').addEventListener('click', () => {
    const periodo = $('e-periodo').value;
    if (!periodo) return toast('Elige un periodo', 'error');
    const params = new URLSearchParams({
      periodo,
      sede: S.sede,
      sede_nombre: $('e-sede-nombre').value || S.sede,
    });
    window.location.href = '/api/export.xlsx?' + params;
  });
}

/* ============================ CONFIG ============================ */
const GRUPOS_ETQ = {
  plataforma_ingreso: 'Plataformas de ingreso',
  categoria_gasto: 'Categorías de gasto',
  subcategoria_nomina: 'Subcategorías de Nómina Personal',
  categoria_inversion: 'Categorías de inversión',
  sede: 'Sedes',
};

async function cargarConfig() {
  const c = await api('/catalogos');
  const cont = $('config-cont');
  let h = '';

  for (const grupo of Object.keys(GRUPOS_ETQ)) {
    h += `<h3 class="sub">${GRUPOS_ETQ[grupo]}</h3><div data-grupo="${grupo}">`;
    for (const item of c[grupo]) {
      const metaSel = grupo === 'subcategoria_nomina'
        ? `<select data-meta title="Línea en la cascada">
             ${['monitores', 'aseo', 'obreros'].map((x) => `<option value="${x}" ${item.meta === x ? 'selected' : ''}>${x}</option>`).join('')}
           </select>` : '';
      h += `<div class="config-item ${item.activo ? '' : 'inactivo'}">
        <input type="text" value="${escapar(item.valor)}" data-valor data-original="${escapar(item.valor)}" />
        ${metaSel}
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;margin:0">
          <input type="checkbox" data-activo ${item.activo ? 'checked' : ''} style="width:auto"/> activo
        </label>
        <button class="btn dorado chico" data-guardar>Guardar</button>
      </div>`;
    }
    h += `<div class="config-item">
      <input type="text" placeholder="Agregar nuevo…" data-nuevo />
      <button class="btn contorno chico" data-agregar>Agregar</button>
    </div></div>`;
  }

  // Socios
  h += '<h3 class="sub">Socios y reparto</h3><div id="socios-cont">';
  for (const s of c.socios) {
    h += `<div class="config-item" data-socio="${s.id}">
      <input type="text" value="${escapar(s.nombre)}" data-nombre style="flex:2"/>
      <input type="number" value="${s.porcentaje}" data-porc step="1" min="0" max="100" style="flex:1"/>
      <label style="display:flex;align-items:center;gap:4px;font-size:11px;margin:0">
        <input type="checkbox" data-asume ${s.asume_inversiones ? 'checked' : ''} style="width:auto"/> asume inversión
      </label>
    </div>`;
  }
  h += `</div><button class="btn dorado chico" id="btn-guardar-socios">Guardar socios</button>`;

  // TRM manual
  h += `<h3 class="sub">TRM manual</h3>
    <div class="fila">
      <div class="campo"><label>Fecha</label><input type="date" id="trm-fecha" value="${hoy()}"/></div>
      <div class="campo"><label>Valor TRM</label><input type="number" id="trm-valor" step="0.01"/></div>
    </div>
    <button class="btn dorado chico" id="btn-trm-manual">Fijar TRM</button>`;

  // Importar datos de la app vieja
  h += `<h3 class="sub">Importar datos de la app anterior</h3>
    <p style="font-size:12.5px;color:var(--texto-suave);margin-bottom:8px">
      En la app vieja abre la consola del navegador, ejecuta
      <code>copy(localStorage.getItem('arivaness_entries'))</code> y pega aquí.
      Se importará a la sede <strong>${S.sede}</strong>.</p>
    <textarea id="import-json" rows="4" placeholder="[ ... ]"></textarea>
    <button class="btn dorado chico" id="btn-importar" style="margin-top:6px">Importar</button>
    <div id="import-res" style="font-size:12.5px;margin-top:8px"></div>`;

  // Usuarios
  h += '<h3 class="sub">Usuarios</h3><div id="usuarios-cont">Cargando…</div>';

  cont.innerHTML = h;
  bindConfigEventos();
  cargarUsuarios();
}

function bindConfigEventos() {
  document.querySelectorAll('[data-grupo]').forEach((box) => {
    const grupo = box.dataset.grupo;
    box.querySelectorAll('[data-agregar]').forEach((b) => b.addEventListener('click', async () => {
      const inp = b.previousElementSibling;
      if (!inp.value.trim()) return;
      try { await api('/catalogos/' + grupo, { method: 'POST', body: { valor: inp.value.trim() } }); toast('Agregado'); cargarConfig(); }
      catch (e) { toast(e.message, 'error'); }
    }));
    box.querySelectorAll('[data-guardar]').forEach((b) => b.addEventListener('click', async () => {
      const item = b.closest('.config-item');
      const original = item.querySelector('[data-valor]').dataset.original;
      const body = {
        valor: item.querySelector('[data-valor]').value.trim(),
        activo: item.querySelector('[data-activo]').checked,
        meta: item.querySelector('[data-meta]')?.value || '',
      };
      try {
        await api(`/catalogos/${grupo}/${encodeURIComponent(original)}`, { method: 'PUT', body });
        toast('Guardado'); cargarConfig();
      } catch (e) { toast(e.message, 'error'); }
    }));
  });

  $('btn-guardar-socios').addEventListener('click', async () => {
    const socios = [...document.querySelectorAll('#socios-cont [data-socio]')].map((row) => ({
      nombre: row.querySelector('[data-nombre]').value.trim(),
      porcentaje: Number(row.querySelector('[data-porc]').value) || 0,
      asume_inversiones: row.querySelector('[data-asume]').checked,
      activo: true,
    }));
    try { await api('/socios', { method: 'PUT', body: { socios } }); toast('Socios guardados'); S.opciones = await api('/opciones'); }
    catch (e) { toast(e.message, 'error'); }
  });

  $('btn-importar').addEventListener('click', async () => {
    const txt = $('import-json').value.trim();
    if (!txt) return;
    $('import-res').textContent = 'Importando…';
    try {
      const r = await api('/importar', { method: 'POST', body: { entries: txt, sede: S.sede } });
      $('import-res').innerHTML = `<strong>${r.importados}</strong> movimientos importados.` +
        (r.revisar.length ? `<br>Revisar manualmente:<br>· ${r.revisar.map(escapar).join('<br>· ')}` : '');
      toast('Importación completa');
    } catch (e) { $('import-res').textContent = ''; toast(e.message, 'error'); }
  });

  $('btn-trm-manual').addEventListener('click', async () => {
    try {
      await api('/trm', { method: 'PUT', body: { fecha: $('trm-fecha').value, valor: Number($('trm-valor').value) } });
      toast('TRM fijada');
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function cargarUsuarios() {
  let us;
  try { us = await api('/usuarios'); } catch { $('usuarios-cont').textContent = 'Solo el dueño.'; return; }
  $('usuarios-cont').innerHTML = `
    <table class="tabla-mini">
      <tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th></th></tr>
      ${us.map((u) => `<tr>
        <td>${escapar(u.username)}</td><td>${escapar(u.nombre)}</td><td>${u.rol}</td>
        <td><button class="btn contorno chico" data-pass="${u.id}">Clave</button></td>
      </tr>`).join('')}
    </table>
    <div class="config-item">
      <input type="text" id="nu-user" placeholder="usuario"/>
      <input type="text" id="nu-nombre" placeholder="nombre"/>
      <input type="password" id="nu-pass" placeholder="contraseña"/>
      <button class="btn dorado chico" id="btn-nuevo-usuario">Crear</button>
    </div>`;
  $('usuarios-cont').querySelectorAll('[data-pass]').forEach((b) => b.addEventListener('click', async () => {
    const p = prompt('Nueva contraseña (mín. 6):');
    if (p && p.length >= 6) {
      try { await api(`/usuarios/${b.dataset.pass}/password`, { method: 'PUT', body: { password: p } }); toast('Contraseña cambiada'); }
      catch (e) { toast(e.message, 'error'); }
    }
  }));
  $('btn-nuevo-usuario').addEventListener('click', async () => {
    try {
      await api('/usuarios', {
        method: 'POST',
        body: { username: $('nu-user').value, nombre: $('nu-nombre').value, password: $('nu-pass').value, rol: 'admin' },
      });
      toast('Usuario creado'); cargarUsuarios();
    } catch (e) { toast(e.message, 'error'); }
  });
}
