'use strict';
/* =========================================================================
   Consultorio ISSSTE · app local (PWA) — todos los datos viven en este iPad
   ========================================================================= */

/* ---------------- utilidades ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const fmtLong = s => { const d = parseISO(s); return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; };
const fmtShort = s => { const d = parseISO(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const fmtDM = d => `${d.getDate()} de ${MESES[d.getMonth()]}`;
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const cap = s => { s = String(s ?? '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };
const lcFirst = s => { s = String(s ?? '').trim(); if (!s) return s; if (s.length > 1 && s[1] === s[1].toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(s[1])) return s; return s[0].toLowerCase() + s.slice(1); };
const endDot = s => { s = String(s ?? '').trim(); return !s ? s : (/[.!?]$/.test(s) ? s : s + '.'); };
const noDot = s => String(s ?? '').trim().replace(/[.\s]+$/, '');
const joinY = a => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1];
const titleCase = s => String(s ?? '').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());

function ageAt(fnac, onISO) {
  if (!fnac) return null;
  const b = parseISO(fnac), d = onISO ? parseISO(onISO) : new Date();
  let a = d.getFullYear() - b.getFullYear();
  if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) a--;
  return a;
}
function ageLabel(fnac, onISO) {
  const a = ageAt(fnac, onISO);
  if (a === null) return '';
  if (a >= 1) return `${a}`;
  const b = parseISO(fnac), d = onISO ? parseISO(onISO) : new Date();
  let m = (d.getFullYear() - b.getFullYear()) * 12 + d.getMonth() - b.getMonth(); if (d.getDate() < b.getDate()) m--;
  return `${Math.max(0, m)} m`;
}

/* -------- semana epidemiológica (SSA): domingo a sábado; la semana 1 termina el
   primer sábado de enero que tenga al menos 4 días del año nuevo -------- */
function epiStart(y) {
  const j = new Date(y, 0, 1);
  let sat = 1 + ((6 - j.getDay() + 7) % 7);
  if (sat < 4) sat += 7;
  return new Date(y, 0, sat - 6);
}
function epiWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  for (const y of [d.getFullYear() + 1, d.getFullYear(), d.getFullYear() - 1]) {
    const s = epiStart(y);
    if (d >= s) return { year: y, week: Math.floor(Math.round((d - s) / 864e5) / 7) + 1 };
  }
}
const weeksInYear = y => Math.round((epiStart(y + 1) - epiStart(y)) / 864e5 / 7);
function epiRange(y, w) { const start = addDays(epiStart(y), (w - 1) * 7); return { start, end: addDays(start, 6) }; }
const rangeTxt = r => r.start.getMonth() === r.end.getMonth()
  ? `del ${r.start.getDate()} al ${r.end.getDate()} de ${MESES[r.end.getMonth()]}`
  : `del ${fmtDM(r.start)} al ${fmtDM(r.end)}`;

const ORD = ['primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava', 'novena', 'décima', 'undécima'];
function decada(edad) {
  const n = S.settings.decada === 'clinica' ? Math.max(1, Math.floor(edad / 10)) : Math.floor(edad / 10) + 1;
  return ORD[n - 1] || `${n}ª`;
}

/* ---------------- almacenamiento (IndexedDB) ---------------- */
const Store = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('consultorio-issste', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this._db = r.result; res(r.result); };
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
};

const EXPLORACION_NORMAL = 'Paciente llega por su propio pie, consciente, orientad@, Glasgow 15 puntos, pupilas isocóricas normorreflécticas, con pulsos carotídeos presentes, sin ingurgitación yugular, cardiorrespiratorio sin compromiso, abdomen blando, depresible, no doloroso, con peristalsis presente, extremidades íntegras, simétricas, fuerza conservada, llenado capilar de 2 seg.';

function defaults() {
  return {
    version: 1,
    settings: {
      medico: 'DRA. NANCY ANAARA MENDOZA HERRERA', cedula: '',
      jefe: 'DRA. NANCY ANAARA MENDOZA HERRERA',
      director: 'DR JOSE JESUS EDUARDO CASTRO', directorCargo: 'DIRECCION',
      unidadEmisora: 'XICHU. Gto', claveEmisora: '1120608',
      unidadReceptora: 'HOSPITAL GENERAL ISSSTE GUANAJUATO', claveReceptora: '',
      motivo: 'NO CONTAMOS CON EL SERVICIO', servicio: 'MEDICINA INTERNA',
      decada: 'estandar', exploracionNormal: EXPLORACION_NORMAL,
      tipos: Array(10).fill(''), pinHash: '', logo: '', lastBackup: ''
    },
    patients: [], consultas: [], referencias: [],
    suive: (window.SUIVE_BASE || []).map(([clave, nombre, grupo]) => ({ id: uid(), clave, nombre, grupo, fav: false, activo: true }))
  };
}

let S = null;
let saveTimer = null;
function save(now) {
  clearTimeout(saveTimer);
  const run = () => Store.set('db', S).catch(e => toast('No se pudo guardar: ' + e.message));
  if (now) return run();
  saveTimer = setTimeout(run, 250);
}

const pat = id => S.patients.find(p => p.id === id);
const suiveById = id => S.suive.find(s => s.id === id);
const consultasDe = pid => S.consultas.filter(c => c.patientId === pid).sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
const tipoTxt = n => (n === '' || n === null || n === undefined) ? '' : (S.settings.tipos[n] ? `${n} · ${S.settings.tipos[n]}` : String(n));
const sexoTxt = s => s === 'F' ? 'Femenino' : s === 'M' ? 'Masculino' : '';
const sexoCorto = s => s === 'F' ? 'Fem.' : s === 'M' ? 'Masc.' : '';
const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

/* ---------------- íconos ---------------- */
const I = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const IC = {
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  back: I('<path d="M15 18l-6-6 6-6"/>'),
  x: I('<path d="M18 6 6 18M6 6l12 12"/>'),
  edit: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  trash: I('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  pdf: I('<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 15h6"/>'),
  word: I('<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="m8 12 1.5 6 2.5-5 2.5 5L16 12"/>'),
  star: I('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  starF: I('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/>'),
  wand: I('<path d="M15 4V2M15 10V8M11 6h2M17 6h2M3 21l12-12"/><path d="M18.5 12.5 20 14M20 10l1.5-1.5"/>'),
  doc: I('<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>'),
  lock: I('<rect x="4" y="11" width="16" height="10" rx="3"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  down: I('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
  up: I('<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>'),
  steth: I('<path d="M6 3v6a6 6 0 0 0 12 0V3"/><path d="M12 15v2a4 4 0 0 0 8 0v-2"/><circle cx="20" cy="13" r="2"/>')
};

/* ---------------- avisos y hojas modales ---------------- */
function toast(msg) {
  $$('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
function openSheet(html, { small = false } = {}) {
  const layer = document.createElement('div');
  layer.className = 'scrim';
  layer.innerHTML = `<div class="sheet milk ${small ? 'small' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  $('#modal').appendChild(layer);
  return $('.sheet', layer);
}
function closeSheet() {
  const layers = $$('#modal .scrim');
  if (layers.length) layers[layers.length - 1].remove();
}
function confirmBox(msg, { ok = 'Confirmar', danger = false, title = '¿Seguro?' } = {}) {
  return new Promise(res => {
    const sh = openSheet(`<div class="shead"><h2>${esc(title)}</h2></div><p>${esc(msg)}</p>
      <div class="row" style="justify-content:flex-end;margin-top:18px">
        <button class="btn ghost" data-r="0">Cancelar</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div>`, { small: true });
    sh.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; closeSheet(); res(b.dataset.r === '1'); });
  });
}

/* ---------------- enlace de formularios ---------------- */
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => (a[k] ??= {}), o); t[last] = v; }
/* data-b="ruta" (inputs) · data-seg="ruta" + data-v (segmentados) · data-tog="ruta" (interruptores) · data-step="ruta" (contadores) */
function bindForm(root, obj, onChange = () => { }) {
  $$('[data-b]', root).forEach(el => {
    const v = getPath(obj, el.dataset.b);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
    el.addEventListener('input', () => { setPath(obj, el.dataset.b, el.type === 'checkbox' ? el.checked : el.value); onChange(el.dataset.b); });
  });
  $$('[data-seg]', root).forEach(g => {
    const cur = getPath(obj, g.dataset.seg);
    $$('button', g).forEach(b => {
      const val = 'num' in g.dataset ? Number(b.dataset.v) : b.dataset.v;
      b.classList.toggle('on', cur === val);
      b.type = 'button';
      b.addEventListener('click', () => {
        $$('button', g).forEach(x => x.classList.remove('on')); b.classList.add('on');
        setPath(obj, g.dataset.seg, val); onChange(g.dataset.seg);
      });
    });
  });
  $$('[data-tog]', root).forEach(t => {
    t.classList.toggle('on', !!getPath(obj, t.dataset.tog));
    t.setAttribute('role', 'switch'); t.tabIndex = 0;
    const flip = () => { const v = !getPath(obj, t.dataset.tog); setPath(obj, t.dataset.tog, v); t.classList.toggle('on', v); t.setAttribute('aria-checked', v); onChange(t.dataset.tog); };
    t.addEventListener('click', flip);
    t.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
  });
  $$('[data-step]', root).forEach(s => {
    const out = $('output', s);
    out.textContent = getPath(obj, s.dataset.step) || 0;
    $$('button', s).forEach(b => {
      b.type = 'button';
      b.addEventListener('click', () => {
        const v = Math.max(0, (Number(getPath(obj, s.dataset.step)) || 0) + Number(b.dataset.d));
        setPath(obj, s.dataset.step, v); out.textContent = v; onChange(s.dataset.step);
      });
    });
  });
}
const segDigits = (path) => `<div class="seg digits" data-seg="${path}" data-num>${Array.from({ length: 10 }, (_, i) => `<button data-v="${i}">${i}</button>`).join('')}</div>`;
const toggle = (path, label, sub = '') => `<div class="toggle" data-tog="${path}"><span class="sw"></span><div><b>${label}</b>${sub ? `<div class="small muted">${sub}</div>` : ''}</div></div>`;
const stepper = path => `<div class="stepper" data-step="${path}"><button data-d="-1" aria-label="Menos">−</button><output>0</output><button data-d="1" aria-label="Más">+</button></div>`;
const vitalsHTML = (prefix) => `<div class="vitals">
  ${[['ta', 'Tensión arterial', 'mmHg', 'text', '120/80'], ['fc', 'Frec. cardíaca', 'lpm', 'number', ''], ['fr', 'Frec. respiratoria', 'rpm', 'number', ''], ['temp', 'Temperatura', '°C', 'number', ''],
    ['sat', 'Saturación O₂', '%', 'number', ''], ['peso', 'Peso', 'kg', 'number', ''], ['talla', 'Talla', 'm', 'number', ''], ['gluc', 'Glucosa capilar', 'mg/dl', 'number', '']]
    .map(([k, l, u, t, ph]) => `<div class="vital"><label for="v-${prefix}-${k}">${l} <span class="u">${u}</span></label><input id="v-${prefix}-${k}" type="${t === 'number' ? 'text' : 'text'}" inputmode="${t === 'number' ? 'decimal' : 'text'}" placeholder="${ph || '—'}" data-b="${prefix}.${k}"></div>`).join('')}
</div>`;

/* ---------------- autocompletado ---------------- */
function attachList(wrap, input, getItems, onPick) {
  let list = null, act = -1, items = [];
  const close = () => { list?.remove(); list = null; act = -1; };
  const open = () => {
    items = getItems(input.value);
    if (!items.length) return close();
    if (!list) { list = document.createElement('div'); list.className = 'list'; wrap.appendChild(list); }
    list.innerHTML = items.map((it, i) => it.group ? `<div class="grp">${esc(it.group)}</div>` :
      `<button type="button" class="opt ${i === act ? 'act' : ''}" data-i="${i}">${it.k ? `<span class="k">${esc(it.k)}</span>` : ''}<span>${esc(it.label)}</span>${it.fav ? `<span class="star">★</span>` : ''}</button>`).join('');
    $$('.opt', list).forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); onPick(items[+b.dataset.i]); close(); }));
  };
  input.addEventListener('focus', () => { open(); setTimeout(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250); });
  input.addEventListener('input', () => { act = -1; open(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', e => {
    if (!list) return;
    const sel = items.map((it, i) => it.group ? -1 : i).filter(i => i >= 0);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); const pos = sel.indexOf(act);
      act = sel[(pos + (e.key === 'ArrowDown' ? 1 : -1) + sel.length) % sel.length]; open();
    } else if (e.key === 'Enter') {
      e.preventDefault(); const i = act >= 0 ? act : sel[0]; if (i !== undefined) { onPick(items[i]); close(); }
    } else if (e.key === 'Escape') close();
  });
}

function suiveUso() {
  const m = {}; S.consultas.forEach(c => { if (c.suive) m[c.suive] = (m[c.suive] || 0) + 1; }); return m;
}
function suiveItems(q) {
  const act = S.suive.filter(s => s.activo !== false);
  const n = norm(q);
  const toIt = s => ({ id: s.id, k: s.clave, label: s.nombre, fav: s.fav });
  if (n) {
    const hits = act.filter(s => norm(s.nombre).includes(n) || norm(s.clave).includes(n) || norm(s.grupo).includes(n));
    hits.sort((a, b) => (b.fav - a.fav) || (norm(a.nombre).indexOf(n) - norm(b.nombre).indexOf(n)));
    return hits.slice(0, 40).map(toIt);
  }
  const out = [];
  const favs = act.filter(s => s.fav);
  if (favs.length) { out.push({ group: 'Favoritos' }); favs.forEach(s => out.push(toIt(s))); }
  const uso = suiveUso();
  const top = act.filter(s => !s.fav && uso[s.id]).sort((a, b) => uso[b.id] - uso[a.id]).slice(0, 6);
  if (top.length) { out.push({ group: 'Más usados' }); top.forEach(s => out.push(toIt(s))); }
  let g = '';
  act.filter(s => !s.fav).forEach(s => { if (s.grupo !== g) { g = s.grupo; out.push({ group: g }); } out.push(toIt(s)); });
  return out;
}
function comboSuive(el, obj, key, onChange = () => { }) {
  const draw = () => {
    const s = obj[key] ? suiveById(obj[key]) : null;
    if (s) {
      el.innerHTML = `<div class="pick"><span class="k">${esc(s.clave)}</span><span class="n">${esc(s.nombre)}</span>
        <button type="button" class="iconbtn" data-fav title="${s.fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}" aria-label="Favorito">${s.fav ? IC.starF : IC.star}</button>
        <button type="button" class="iconbtn" data-clear aria-label="Quitar diagnóstico SUIVE">${IC.x}</button></div>`;
      $('[data-fav]', el).onclick = () => { s.fav = !s.fav; save(); draw(); };
      $('[data-clear]', el).onclick = () => { obj[key] = null; onChange(); draw(); setTimeout(() => $('input', el)?.focus(), 30); };
    } else {
      el.innerHTML = `<input type="search" placeholder="Busca por enfermedad o clave CIE-10 (opcional)" autocomplete="off">`;
      const inp = $('input', el);
      attachList(el, inp, suiveItems, it => { obj[key] = it.id; onChange(); draw(); });
    }
  };
  el.classList.add('combo'); draw();
}
const MUNICIPIOS = ['Abasolo', 'Acámbaro', 'Apaseo el Alto', 'Apaseo el Grande', 'Atarjea', 'Celaya', 'Comonfort', 'Coroneo', 'Cortazar', 'Cuerámaro', 'Doctor Mora',
  'Dolores Hidalgo', 'Guanajuato', 'Huanímaro', 'Irapuato', 'Jaral del Progreso', 'Jerécuaro', 'León', 'Manuel Doblado', 'Moroleón', 'Ocampo', 'Pénjamo', 'Pueblo Nuevo',
  'Purísima del Rincón', 'Romita', 'Salamanca', 'Salvatierra', 'San Diego de la Unión', 'San Felipe', 'San Francisco del Rincón', 'San José Iturbide', 'San Luis de la Paz',
  'San Miguel de Allende', 'Santa Catarina', 'Santa Cruz de Juventino Rosas', 'Santiago Maravatío', 'Silao', 'Tarandacuao', 'Tarimoro', 'Tierra Blanca', 'Uriangato',
  'Valle de Santiago', 'Victoria', 'Villagrán', 'Yuriria', 'Querétaro', 'Jalpan de Serra', 'Arroyo Seco', 'Pinal de Amoles', 'Peñamiller', 'Río Verde', 'San Luis Potosí'];
function procItems(q) {
  const m = new Map();
  [...S.consultas, ...S.patients].forEach(x => { const v = (x.procedencia || '').trim(); if (v) { const k = norm(v); const e = m.get(k) || { label: v, n: 0 }; e.n += 100; m.set(k, e); } });
  MUNICIPIOS.forEach(v => { const k = norm(v); if (!m.has(k)) m.set(k, { label: v, n: 0 }); });
  const n = norm(q);
  return [...m.values()].filter(e => !n || norm(e.label).includes(n)).filter(e => norm(e.label) !== n)
    .sort((a, b) => (b.n - a.n) || (norm(a.label).indexOf(n) - norm(b.label).indexOf(n)) || a.label.localeCompare(b.label, 'es')).slice(0, 10).map(e => ({ label: e.label }));
}
function dxItems(q) {
  const m = new Map();
  S.consultas.forEach(c => { const d = (c.dxIssste || '').trim(); if (d) { const k = norm(d); const e = m.get(k) || { label: d, n: 0 }; e.n += 3; m.set(k, e); } });
  (S.dxPrevios || []).forEach(x => { const k = norm(x.label); const e = m.get(k) || { label: x.label, n: 0 }; e.n += x.n; m.set(k, e); });
  const n = norm(q);
  return [...m.values()].filter(e => !n || norm(e.label).includes(n)).filter(e => norm(e.label) !== n)
    .sort((a, b) => b.n - a.n).slice(0, 12).map(e => ({ label: e.label }));
}

/* ---------------- router ---------------- */
const view = () => $('#view');
function go(h) { if (location.hash !== h) location.hash = h; else render(); }
function route() { const [, name = 'hoy', a, b] = location.hash.split('/'); return { name, a, b }; }
function render() {
  const r = route();
  $$('.navbtn').forEach(b => b.classList.toggle('on', b.dataset.nav === (r.name === 'paciente' || r.name === 'referencia' ? 'pacientes' : r.name)));
  const V = { hoy: viewHoy, pacientes: viewPacientes, paciente: viewPaciente, reportes: viewReportes, ajustes: viewAjustes, referencia: viewReferencia }[r.name] || viewHoy;
  V(r);
  $('#main').scrollTop = 0;
}
window.addEventListener('hashchange', render);
document.addEventListener('click', e => { const n = e.target.closest('[data-nav]'); if (n) go('#/' + n.dataset.nav); });

const vhead = (title, sub = '', acts = '') => `<div class="vhead"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="row wrap">${acts}</div></div>`;

/* =========================================================================
   VISTA: HOY
   ========================================================================= */
function viewHoy() {
  const now = new Date(), t = iso(now), ep = epiWeek(now), r = epiRange(ep.year, ep.week);
  const hoy = S.consultas.filter(c => c.fecha === t).sort((a, b) => a.hora.localeCompare(b.hora));
  const sem = S.consultas.filter(c => c.fecha >= iso(r.start) && c.fecha <= iso(r.end)).length;
  const mes = S.consultas.filter(c => c.fecha.startsWith(t.slice(0, 7))).length;
  const pct = Math.round(ep.week / weeksInYear(ep.year) * 100);
  const needBackup = S.patients.length && (!S.settings.lastBackup || (now - new Date(S.settings.lastBackup)) > 7 * 864e5);
  view().innerHTML = `
  <section class="hero">
    <div class="today glass">
      <div><div class="dow">${cap(DIAS[now.getDay()])}</div>
      <div class="date">${now.getDate()} de ${MESES[now.getMonth()]}</div></div>
      <div class="counts">
        <div><b class="num">${hoy.length}</b><span>consultas hoy</span></div>
        <div><b class="num">${sem}</b><span>en la semana</span></div>
        <div><b class="num">${mes}</b><span>en ${MESES[now.getMonth()]}</span></div>
        <div><b class="num">${S.patients.length}</b><span>pacientes registrados</span></div>
      </div>
    </div>
    <button class="weekdisc glass" id="goEpi" aria-label="Ver reporte de epidemiología de esta semana">
      <div class="ring" style="--p:${pct}%"><b class="num">${ep.week}</b></div>
      <div><div class="lbl">Semana epidemiológica</div><div class="rng">${rangeTxt(r)}</div></div>
    </button>
  </section>
  ${needBackup ? `<div class="glass card row between wrap" style="margin-bottom:20px"><div><b>Haz tu respaldo semanal</b><div class="small" style="opacity:.85">Los datos viven solo en este iPad. Un respaldo te protege si se borra el navegador.</div></div><button class="btn white" id="bk">${IC.down} Guardar respaldo</button></div>` : ''}
  <div class="grid2">
    <section class="card milk">
      <div class="row between" style="margin-bottom:14px"><h2>Agregar consulta</h2>
        <button class="btn soft" id="nuevoPac">${IC.plus} Paciente nuevo</button></div>
      <div class="searchbox">${IC.search}<input id="q" type="search" placeholder="Número de expediente o nombre" autocomplete="off" autocapitalize="characters"></div>
      <div class="results" id="res"></div>
      <p class="hint" id="qhint" style="margin-top:10px">Escribe al menos 2 letras o números. Si no existe, puedes registrarlo ahí mismo.</p>
    </section>
    <section class="card milk">
      <div class="row between" style="margin-bottom:6px"><h2>Consultas de hoy</h2><span class="tag">${hoy.length}</span></div>
      ${hoy.length ? hoy.map(c => { const p = pat(c.patientId); const s = c.suive && suiveById(c.suive); return `
        <div class="visit" data-consulta="${c.id}" tabindex="0">
          <div class="time num">${esc(c.hora)}</div>
          <div><b>${esc(p?.nombre)}</b><div class="dx">${esc(c.dxIssste || 'Sin diagnóstico')}${s ? ` · ${esc(s.nombre)}` : ''}</div></div>
          <div class="tags">${c.foraneo ? `<span class="tag">${esc(c.procedencia || 'Foráneo')}</span>` : ''}${c.incapacidad ? `<span class="tag o">Incap. ${c.incapDias} d</span>` : ''}${c.lab ? '<span class="tag o">Lab</span>' : ''}${c.img ? '<span class="tag o">Imagen</span>' : ''}${c.meds ? `<span class="tag">${c.meds} med.</span>` : ''}</div>
        </div>`; }).join('') : `<div class="empty"><b>Aún no hay consultas hoy</b>Busca al paciente a la izquierda para registrar la primera.</div>`}
    </section>
  </div>`;
  $('#goEpi').onclick = () => { R.tab = 'epi'; R.epiY = ep.year; R.epiW = ep.week; go('#/reportes'); };
  $('#nuevoPac').onclick = () => openPacienteForm({ thenConsulta: true });
  $('#bk') && ($('#bk').onclick = exportBackup);
  $$('[data-consulta]').forEach(v => { const f = () => openConsulta({ id: v.dataset.consulta }); v.onclick = f; v.onkeydown = e => e.key === 'Enter' && f(); });
  const q = $('#q'), res = $('#res');
  const draw = () => {
    const n = norm(q.value);
    if (n.length < 2) { res.innerHTML = ''; $('#qhint').classList.remove('hide'); return; }
    $('#qhint').classList.add('hide');
    const hits = S.patients.filter(p => norm(p.nombre).includes(n) || norm(p.expediente).includes(n)).slice(0, 8);
    const looksExp = /\d/.test(q.value);
    res.innerHTML = hits.map(p => resRow(p)).join('') +
      `<button class="res" data-new style="border-style:dashed"><span class="avatar" style="background:rgba(99,91,255,.12);color:var(--violeta)">${IC.plus}</span><span class="who"><b>Registrar paciente nuevo</b><span>${looksExp ? 'Expediente' : 'Nombre'}: ${esc(q.value.trim())}</span></span></button>`;
    $$('[data-pid]', res).forEach(b => b.onclick = () => openConsulta({ patientId: b.dataset.pid }));
    $('[data-new]', res).onclick = () => openPacienteForm({ thenConsulta: true, prefill: looksExp ? { expediente: q.value.trim() } : { nombre: q.value.trim() } });
  };
  q.addEventListener('input', draw);
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { const f = $('.res', res); f && f.click(); } });
}
const porRevisar = p => !!(p.fnacAprox || !p.fnac || !p.sexo || p.tipo === '' || p.tipo === undefined || !p.expediente);
function resRow(p) {
  const last = consultasDe(p.id)[0];
  return `<button class="res" data-pid="${p.id}"><span class="avatar ${p.sexo === 'F' ? 'f' : 'm'}">${esc(initials(p.nombre))}</span>
    <span class="who"><b>${esc(p.nombre)}${porRevisar(p) ? ' <span class="tag o" style="vertical-align:2px">Por revisar</span>' : ''}</b><span>Exp. ${esc(p.expediente || '—')} · ${p.fnac ? ageLabel(p.fnac) + (p.fnacAprox ? '≈' : '') : '¿?'} años · ${sexoTxt(p.sexo)}${p.tipo !== '' && p.tipo !== undefined ? ` · Tipo ${esc(p.tipo)}` : ''}${last ? ` · Última: ${fmtShort(last.fecha)}` : ''}</span></span></button>`;
}

/* =========================================================================
   VISTA: PACIENTES
   ========================================================================= */
let soloRevisar = false;
function viewPacientes() {
  const nRev = S.patients.filter(porRevisar).length;
  view().innerHTML = vhead('Pacientes', `${S.patients.length} registrados`, `${S.patients.length ? '' : `<label class="btn onglass" style="cursor:pointer">${IC.up} Importar pacientes<input type="file" id="impP" hidden></label>`}<button class="btn white" id="np">${IC.plus} Paciente nuevo</button>`) + `
  <section class="card milk">
    <div class="row wrap" style="gap:12px"><div class="searchbox" style="flex:1;min-width:240px">${IC.search}<input id="pq" type="search" placeholder="Filtrar por nombre o expediente" autocomplete="off"></div>
    ${nRev ? `<button class="chip ${soloRevisar ? 'on' : ''}" id="rev">Por revisar (${nRev})</button>` : ''}</div>
    ${soloRevisar ? '<p class="hint" style="margin-top:10px">Pacientes importados con fecha de nacimiento estimada o con datos faltantes. Ábrelos con «Editar» para confirmarlos.</p>' : ''}
    <div class="results" id="plist" style="max-height:none"></div>
  </section>`;
  $('#np').onclick = () => openPacienteForm({});
  const draw = () => {
    const n = norm($('#pq').value);
    const list = S.patients.filter(p => (!soloRevisar || porRevisar(p)) && (!n || norm(p.nombre).includes(n) || norm(p.expediente).includes(n))).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    $('#plist').innerHTML = list.length ? list.map(resRow).join('') : `<div class="empty"><b>${S.patients.length ? 'Sin coincidencias' : 'Todavía no hay pacientes'}</b>${S.patients.length ? 'Prueba con otra parte del nombre o del expediente.' : 'Registra al primero con el botón «Paciente nuevo».'}</div>`;
    $$('[data-pid]', $('#plist')).forEach(b => b.onclick = () => go('#/paciente/' + b.dataset.pid));
  };
  $('#pq').addEventListener('input', draw); draw();
  $('#rev') && ($('#rev').onclick = () => { soloRevisar = !soloRevisar; viewPacientes(); });
  $('#impP') && ($('#impP').onchange = e => { const f = e.target.files[0]; e.target.value = ''; importarArchivo(f); });
}

/* =========================================================================
   FORMULARIO DE PACIENTE
   ========================================================================= */
function openPacienteForm({ id, prefill = {}, thenConsulta = false }) {
  const orig = id ? pat(id) : null;
  const d = orig ? JSON.parse(JSON.stringify(orig)) : { id: uid(), nombre: '', expediente: '', fnac: '', sexo: '', tipo: '', tel: '', domicilio: '', antecedentes: {}, createdAt: new Date().toISOString(), ...prefill };
  const sh = openSheet(`
    <div class="shead"><h2>${orig ? 'Editar paciente' : 'Paciente nuevo'}</h2><button class="iconbtn" data-close aria-label="Cerrar">${IC.x}</button></div>
    <div class="form">
      <div class="f s8"><label for="pn">Nombre completo</label><input id="pn" type="text" data-b="nombre" autocapitalize="characters" placeholder="Apellidos y nombre(s)"></div>
      <div class="f s4"><label for="pe">No. de expediente / derechohabiente</label><input id="pe" type="text" data-b="expediente" autocapitalize="characters"></div>
      <div class="f s4"><label for="pf">Fecha de nacimiento</label><input id="pf" type="date" data-b="fnac" max="${iso(new Date())}"><p class="hint" id="fnacHint" style="color:var(--teal-ink)"></p></div>
      <div class="f s4"><span class="lbl">Sexo</span><div class="seg" data-seg="sexo"><button data-v="M">Masculino</button><button data-v="F">Femenino</button></div></div>
      <div class="f s4"><span class="lbl">Edad</span><div id="edadv" style="font-size:22px;font-weight:600;padding-top:6px">—</div></div>
      <div class="f"><span class="lbl">Tipo de derechohabiente</span>${segDigits('tipo')}<p class="hint" id="tipolbl"></p></div>
      <div class="f s4"><label for="pt">Teléfono</label><input id="pt" type="tel" data-b="tel" inputmode="tel"></div>
      <div class="f s8"><label for="pd">Domicilio</label><input id="pd" type="text" data-b="domicilio" autocapitalize="characters"></div>
    </div>
    <p class="hint" id="perr" style="color:#B4232F;margin-top:12px"></p>
    <div class="sticky-actions">
      ${orig ? `<button class="btn danger" data-del style="margin-right:auto">${IC.trash} Eliminar paciente</button>` : ''}
      <button class="btn ghost" data-close>Cancelar</button>
      <button class="btn primary" data-save>${thenConsulta ? 'Guardar y abrir consulta' : 'Guardar paciente'}</button>
    </div>`);
  const upd = (k) => {
    if (k === 'fnac') d.fnacAprox = false;
    $('#fnacHint', sh).textContent = d.fnacAprox ? 'Estimada con la edad registrada en el Excel. Corrígela cuando la confirmes.' : '';
    $('#edadv', sh).textContent = d.fnac ? `${ageLabel(d.fnac)} años` : '—';
    $('#tipolbl', sh).textContent = d.tipo !== '' && S.settings.tipos[d.tipo] ? `Tipo ${d.tipo}: ${S.settings.tipos[d.tipo]}` : 'Las etiquetas de cada tipo se configuran en Ajustes.';
  };
  bindForm(sh, d, upd); upd();
  $$('[data-close]', sh).forEach(b => b.onclick = closeSheet);
  setTimeout(() => (d.nombre ? $('#pe', sh) : $('#pn', sh)).focus(), 60);
  $('[data-save]', sh).onclick = () => {
    d.nombre = d.nombre.trim(); d.expediente = d.expediente.trim();
    const err = !d.nombre ? 'Escribe el nombre del paciente.' : !d.fnac ? 'Falta la fecha de nacimiento (se usa para calcular la edad en los reportes).' : !d.sexo ? 'Selecciona el sexo.' :
      S.patients.some(p => p.id !== d.id && norm(p.nombre) === norm(d.nombre) && norm(p.expediente) === norm(d.expediente)) ? 'Ya existe un paciente con ese nombre y expediente.' : '';
    if (err) { $('#perr', sh).textContent = err; return; }
    if (orig) Object.assign(orig, d); else S.patients.push(d);
    save(); closeSheet(); toast(orig ? 'Paciente actualizado' : 'Paciente registrado');
    if (thenConsulta) openConsulta({ patientId: d.id }); else if (!orig) go('#/paciente/' + d.id); else render();
  };
  $('[data-del]', sh) && ($('[data-del]', sh).onclick = async () => {
    const n = S.consultas.filter(c => c.patientId === d.id).length;
    if (!await confirmBox(`Se eliminará a ${d.nombre} junto con sus ${n} consulta(s) y referencias. No se puede deshacer.`, { ok: 'Eliminar', danger: true })) return;
    S.patients = S.patients.filter(p => p.id !== d.id);
    S.consultas = S.consultas.filter(c => c.patientId !== d.id);
    S.referencias = S.referencias.filter(r => r.patientId !== d.id);
    save(); closeSheet(); toast('Paciente eliminado'); go('#/pacientes');
  });
}

/* =========================================================================
   HOJA DE CONSULTA
   ========================================================================= */
function openConsulta({ id, patientId }) {
  const orig = id ? S.consultas.find(c => c.id === id) : null;
  const p = pat(orig ? orig.patientId : patientId);
  if (!p) return toast('No se encontró el paciente');
  const prev = consultasDe(p.id);
  const d = orig ? JSON.parse(JSON.stringify(orig)) : {
    id: uid(), patientId: p.id, fecha: iso(new Date()), hora: nowTime(), tipo: prev.length ? 'subsecuente' : 'primera',
    nota: '', sv: {}, exploracion: '', dxIssste: '', suive: null, lab: false, img: false, meds: 0, plan: '',
    foraneo: !!p.foraneo, procedencia: p.procedencia || '', incapacidad: false, incapDias: 0, createdAt: new Date().toISOString()
  };
  const sh = openSheet(`
    <div class="shead"><span class="avatar ${p.sexo === 'F' ? 'f' : 'm'}">${esc(initials(p.nombre))}</span>
      <div style="flex:1;min-width:0"><h2 style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.nombre)}</h2>
      <div class="small muted">Exp. ${esc(p.expediente || '—')} · ${ageLabel(p.fnac, d.fecha)} años · ${sexoTxt(p.sexo)} · Tipo ${esc(tipoTxt(p.tipo) || '—')}</div></div>
      <button class="iconbtn" data-close aria-label="Cerrar">${IC.x}</button></div>
    <div class="form">
      <div class="f s3"><label for="cf">Fecha</label><input id="cf" type="date" data-b="fecha"></div>
      <div class="f s3"><label for="ch">Hora</label><input id="ch" type="time" data-b="hora"></div>
      <div class="f s6"><span class="lbl">Tipo de consulta</span><div class="seg" data-seg="tipo"><button data-v="primera">Primera vez</button><button data-v="subsecuente">Subsecuente</button></div></div>
      <div class="f"><label for="cn">Motivo y padecimiento actual</label><textarea id="cn" data-b="nota" placeholder="Ej.: Acude por dolor de cuerpo y calambres en piernas de tres semanas de evolución, con sensación de fatiga."></textarea></div>
      <div class="section"><h3>Signos vitales</h3></div>
      <div class="f">${vitalsHTML('sv')}</div>
      <div class="section"><h3>Exploración física</h3><button type="button" class="btn soft" data-normal>Usar exploración normal</button></div>
      <div class="f"><textarea data-b="exploracion" aria-label="Exploración física" placeholder="Hallazgos de la exploración"></textarea></div>
      <div class="section"><h3>Diagnósticos</h3></div>
      <div class="f s6"><label for="dx1">Diagnóstico ISSSTE</label><div class="combo" id="dxwrap"><input id="dx1" type="text" data-b="dxIssste" autocomplete="off" placeholder="Escribe el diagnóstico"></div></div>
      <div class="f s6"><span class="lbl">Diagnóstico SUIVE (epidemiología)</span><div id="suivebox"></div></div>
      <div class="section"><h3>Estudios y medicamentos</h3></div>
      <div class="f s4">${toggle('lab', 'Laboratorio', 'Se solicitaron estudios')}</div>
      <div class="f s4">${toggle('img', 'Imagen', 'Se solicitaron estudios')}</div>
      <div class="f s4"><span class="lbl">Medicamentos proporcionados</span>${stepper('meds')}</div>
      <div class="section"><h3>Foráneo e incapacidad</h3></div>
      <div class="f s6">${toggle('foraneo', 'Paciente foráneo', 'Viene de otro municipio')}
        <div id="procWrap" class="${d.foraneo ? '' : 'hide'}" style="margin-top:10px"><label for="proc" class="lbl">¿De dónde viene?</label>
        <div class="combo" id="procCombo" style="margin-top:6px"><input id="proc" type="text" data-b="procedencia" autocomplete="off" placeholder="Ej.: Celaya, Irapuato, Salvatierra"></div></div></div>
      <div class="f s6">${toggle('incapacidad', 'Incapacidad', 'Se otorgó licencia médica en esta consulta')}
        <div id="incWrap" class="${d.incapacidad ? '' : 'hide'}" style="margin-top:10px"><span class="lbl">Días de incapacidad</span><div style="margin-top:6px">${stepper('incapDias')}</div></div></div>
      <div class="f"><label for="cp">Plan e indicaciones (opcional)</label><textarea id="cp" data-b="plan" style="min-height:70px"></textarea></div>
    </div>
    <div class="sticky-actions">
      ${orig ? `<button class="btn danger" data-del style="margin-right:auto">${IC.trash} Eliminar</button>` : ''}
      <button class="btn ghost" data-close>Cancelar</button>
      <button class="btn primary" data-save>Guardar consulta</button>
    </div>`);
  bindForm(sh, d, k => {
    if (k === 'foraneo') { $('#procWrap', sh).classList.toggle('hide', !d.foraneo); if (d.foraneo) setTimeout(() => $('#proc', sh).focus(), 50); }
    if (k === 'incapacidad') {
      $('#incWrap', sh).classList.toggle('hide', !d.incapacidad);
      if (d.incapacidad && !(+d.incapDias > 0)) { d.incapDias = 1; $('#incWrap output', sh).textContent = 1; }
    }
  });
  attachList($('#procCombo', sh), $('#proc', sh), procItems, it => { d.procedencia = it.label; $('#proc', sh).value = it.label; });
  comboSuive($('#suivebox', sh), d, 'suive');
  attachList($('#dxwrap', sh), $('#dx1', sh), dxItems, it => { d.dxIssste = it.label; $('#dx1', sh).value = it.label; });
  $('[data-normal]', sh).onclick = () => {
    const t = $('[data-b="exploracion"]', sh);
    t.value = S.settings.exploracionNormal.replace(/@/g, p.sexo === 'F' ? 'a' : 'o'); d.exploracion = t.value; t.focus();
  };
  $$('[data-close]', sh).forEach(b => b.onclick = closeSheet);
  $('[data-save]', sh).onclick = () => {
    if (!d.fecha) return toast('Falta la fecha de la consulta');
    d.procedencia = (d.procedencia || '').trim();
    if (d.foraneo && !d.procedencia) return toast('Escribe de dónde viene el paciente foráneo');
    if (!d.foraneo) d.procedencia = '';
    if (d.incapacidad && !(+d.incapDias > 0)) return toast('Indica cuántos días de incapacidad');
    if (!d.incapacidad) d.incapDias = 0;
    p.foraneo = d.foraneo; p.procedencia = d.procedencia;   // se recuerda para su siguiente consulta
    d.dxIssste = (d.dxIssste || '').trim();
    if (orig) Object.assign(orig, d); else S.consultas.push(d);
    save(); closeSheet(); toast('Consulta guardada'); render();
  };
  $('[data-del]', sh) && ($('[data-del]', sh).onclick = async () => {
    if (!await confirmBox('Se eliminará esta consulta de los registros y de los reportes.', { ok: 'Eliminar consulta', danger: true })) return;
    S.consultas = S.consultas.filter(c => c.id !== d.id); save(); closeSheet(); toast('Consulta eliminada'); render();
  });
}

/* =========================================================================
   VISTA: FICHA DE PACIENTE
   ========================================================================= */
function viewPaciente({ a: id, b: tab = 'consultas' }) {
  const p = pat(id);
  if (!p) { view().innerHTML = vhead('Paciente no encontrado') + `<button class="btn white" data-nav="pacientes">Ver pacientes</button>`; return; }
  p.antecedentes ??= {};
  const cs = consultasDe(p.id), refs = S.referencias.filter(r => r.patientId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  view().innerHTML = `
  <button class="btn onglass" data-nav="pacientes" style="margin-bottom:14px">${IC.back} Pacientes</button>
  <section class="phead glass">
    <span class="avatar ${p.sexo === 'F' ? 'f' : 'm'}">${esc(initials(p.nombre))}</span>
    <div><h1>${esc(p.nombre)}</h1>
      <div class="meta"><span>Exp. <b>${esc(p.expediente || '—')}</b></span><span><b>${p.fnac ? ageLabel(p.fnac) + (p.fnacAprox ? '≈' : '') : '¿?'}</b> años</span><span>${sexoTxt(p.sexo)}</span><span>Tipo <b>${esc(tipoTxt(p.tipo) || '—')}</b></span>${p.tel ? `<span>Tel. ${esc(p.tel)}</span>` : ''}${p.foraneo && p.procedencia ? `<span>Foráneo · <b>${esc(p.procedencia)}</b></span>` : ''}</div>
      ${p.origen ? `<div class="small" style="color:rgba(255,255,255,.85);margin-top:6px">Historial previo en Excel: ${p.origen.consultas} consulta(s) entre ${fmtShort(p.origen.primera)} y ${fmtShort(p.origen.ultima)}${p.origen.ultimoDx ? ` · último dx: ${esc(p.origen.ultimoDx)}` : ''}</div>` : ''}</div>
    <div class="acts">
      <button class="btn white" id="nc">${IC.plus} Nueva consulta</button>
      <button class="btn onglass" id="nr">${IC.doc} Solicitud de referencia</button>
      <button class="btn onglass" id="ep" aria-label="Editar datos">${IC.edit} Editar</button>
    </div>
  </section>
  <div class="tabs" role="tablist">
    ${[['consultas', `Consultas (${cs.length})`], ['antecedentes', 'Antecedentes'], ['referencias', `Referencias (${refs.length})`]].map(([k, l]) => `<button role="tab" class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
  </div>
  <div id="tabbody"></div>`;
  $('#nc').onclick = () => openConsulta({ patientId: p.id });
  $('#nr').onclick = () => nuevaReferencia(p.id);
  $('#ep').onclick = () => openPacienteForm({ id: p.id });
  $$('[data-tab]').forEach(b => b.onclick = () => { history.replaceState(null, '', `#/paciente/${p.id}/${b.dataset.tab}`); viewPaciente({ a: p.id, b: b.dataset.tab }); });
  const body = $('#tabbody');

  if (tab === 'consultas') {
    body.innerHTML = cs.length ? `<div class="timeline">${cs.map(c => { const s = c.suive && suiveById(c.suive); return `
      <div class="tl"><div class="card milk" data-c="${c.id}" tabindex="0">
        <div class="row between wrap"><span class="when">${cap(fmtLong(c.fecha))} · ${esc(c.hora)}</span>
          <div class="tags"><span class="tag">${c.tipo === 'primera' ? 'Primera vez' : 'Subsecuente'}</span>${c.foraneo ? `<span class="tag">Foráneo · ${esc(c.procedencia)}</span>` : ''}${c.incapacidad ? `<span class="tag o">Incapacidad ${c.incapDias} día(s)</span>` : ''}${c.lab ? '<span class="tag o">Laboratorio</span>' : ''}${c.img ? '<span class="tag o">Imagen</span>' : ''}<span class="tag">${c.meds || 0} medicamento(s)</span></div></div>
        <div style="margin-top:8px"><b>${esc(c.dxIssste || 'Sin diagnóstico ISSSTE')}</b>${s ? ` <span class="small muted">· SUIVE ${esc(s.clave)} ${esc(s.nombre)}</span>` : ''}</div>
        ${c.nota ? `<div class="txt">${esc(c.nota)}</div>` : ''}
        ${c.sv && (c.sv.ta || c.sv.fc) ? `<div class="small muted">${[c.sv.ta && 'TA ' + c.sv.ta, c.sv.fc && 'FC ' + c.sv.fc, c.sv.fr && 'FR ' + c.sv.fr, c.sv.temp && 'T ' + c.sv.temp + '°', c.sv.sat && 'Sat ' + c.sv.sat + '%'].filter(Boolean).join(' · ')}</div>` : ''}
      </div></div>`; }).join('')}</div>`
      : `<div class="card milk empty"><b>Sin consultas registradas</b>Usa «Nueva consulta» para abrir su primera hoja.</div>`;
    $$('[data-c]', body).forEach(c => { const f = () => openConsulta({ id: c.dataset.c }); c.onclick = f; c.onkeydown = e => e.key === 'Enter' && f(); });
  }

  if (tab === 'antecedentes') {
    body.innerHTML = `<section class="card milk">
      <div class="row between wrap" style="margin-bottom:12px"><div><h2>Antecedentes</h2><p class="hint">Se usan para redactar la presentación del caso. Se guardan solos. Deja vacío lo que el paciente niega.</p></div><span class="tag" id="sv-ind">Guardado</span></div>
      <div class="form">
        <div class="f s6"><label>Heredofamiliares</label><textarea data-b="ahf" placeholder="Ej.: madre y padre con HAS y DM2, un hermano con DM2"></textarea></div>
        <div class="f s6"><label>Enfermedades crónicas (patológicos)</label><textarea data-b="patologicos" placeholder="Ej.: hipertensión arterial de 5 años de evolución, dislipidemia"></textarea></div>
        <div class="f"><label>Tratamiento actual</label><input type="text" data-b="tratamiento" placeholder="Ej.: telmisartán 40 mg por las mañanas, amlodipino 1 c/12 hrs"></div>
        <div class="f s6"><label>Quirúrgicos</label><input type="text" data-b="quirurgicos" placeholder="Vacío = niega"></div>
        <div class="f s6"><label>Alérgicos</label><input type="text" data-b="alergicos" placeholder="Vacío = niega"></div>
        <div class="f s6"><label>Transfusionales</label><input type="text" data-b="transfusionales" placeholder="Vacío = niega"></div>
        <div class="f s6"><label>Traumáticos</label><input type="text" data-b="traumaticos" placeholder="Vacío = niega"></div>
        <div class="f s6"><span class="lbl">Hábitos higiénico-dietéticos</span><div class="seg" data-seg="habitos"><button data-v="Buenos">Buenos</button><button data-v="Regulares">Regulares</button><button data-v="Malos">Malos</button></div></div>
        <div class="f s6"><label>Convivencia con animales</label><input type="text" data-b="mascotas" placeholder="Ej.: dos perros (vacío = niega)"></div>
        <div class="f s6"><label>Actividad física</label><input type="text" data-b="deporte" placeholder="Ej.: camina 30 min diarios (vacío = niega)"></div>
        <div class="f s6"><label>Última inmunización</label><input type="text" data-b="inmunizaciones" placeholder="Ej.: enero 2022, tercera dosis AstraZeneca contra COVID-19"></div>
        ${p.sexo === 'F' ? `<div class="f"><label>Gineco-obstétricos</label><textarea data-b="gineco" placeholder="Ej.: menarca a los 11 años, ritmo 28/3, IVSA 21 años, G2 P2, menopausia hace 15 años"></textarea></div>` : ''}
        <div class="f"><label>Otros antecedentes relevantes</label><textarea data-b="otros" placeholder="Ej.: hospitalización por COVID hace seis meses" style="min-height:70px"></textarea></div>
      </div></section>`;
    let t;
    bindForm(body, p.antecedentes, () => { $('#sv-ind').textContent = 'Guardando…'; save(); clearTimeout(t); t = setTimeout(() => $('#sv-ind') && ($('#sv-ind').textContent = 'Guardado'), 500); });
  }

  if (tab === 'referencias') {
    body.innerHTML = `<section class="card milk">
      <div class="row between" style="margin-bottom:10px"><h2>Solicitudes de referencia</h2><button class="btn primary" id="nr2">${IC.plus} Nueva solicitud</button></div>
      ${refs.length ? refs.map(r => `<div class="visit" data-r="${r.id}" tabindex="0" style="grid-template-columns:110px 1fr auto">
        <div class="num" style="font-weight:600;color:var(--violeta)">${fmtShort(r.fecha)}</div>
        <div><b>${esc(r.servicio || 'Sin servicio')}</b><div class="dx">${esc(r.idx || 'Sin impresión diagnóstica')} · ${esc(r.unidadReceptora)}</div></div>
        <span class="tag">Abrir</span></div>`).join('')
      : `<div class="empty"><b>Sin solicitudes todavía</b>Crea una y se llenará con los datos del paciente y de su última consulta.</div>`}
    </section>`;
    $('#nr2').onclick = () => nuevaReferencia(p.id);
    $$('[data-r]', body).forEach(c => { const f = () => go('#/referencia/' + c.dataset.r); c.onclick = f; c.onkeydown = e => e.key === 'Enter' && f(); });
  }
}

/* =========================================================================
   SOLICITUD DE REFERENCIA
   ========================================================================= */
const dxDelPaciente = pid => [...new Set(consultasDe(pid).map(c => (c.dxIssste || '').trim()).filter(Boolean))];
const ultimoDx = pid => dxDelPaciente(pid)[0] || '';
function nuevaReferencia(pid) {
  const p = pat(pid), st = S.settings, cs = consultasDe(pid), now = new Date();
  const last = cs[0], lastNota = cs.find(c => (c.nota || '').trim()), lastEx = cs.find(c => (c.exploracion || '').trim()),
    lastSv = cs.find(c => c.sv && Object.values(c.sv).some(v => String(v || '').trim()));
  const r = {
    id: uid(), patientId: pid, createdAt: now.toISOString(),
    fecha: iso(now), hora: nowTime(), folio: '',
    unidadEmisora: st.unidadEmisora, claveEmisora: st.claveEmisora, motivo: st.motivo,
    nombre: (p.nombre || '').toUpperCase(), tel: p.tel || '', domicilio: (p.domicilio || '').toUpperCase(), expediente: p.expediente || '',
    unidadReceptora: st.unidadReceptora, claveReceptora: st.claveReceptora,
    refiereA: 'consulta', traslados: '', servicio: st.servicio, tipo: 'primera',
    cita: { fecha: '', hora: '' },
    presentacion: '', idx: ultimoDx(pid), resultados: 'Se anexan.',
    licDesde: '', licHasta: '', riesgo: '',
    medico: st.medico, cedula: st.cedula, jefe: st.jefe, director: st.director, directorCargo: st.directorCargo,
    gen: {
      padecimiento: lastNota?.nota || '',
      exploracion: lastEx?.exploracion || st.exploracionNormal.replace(/@/g, p.sexo === 'F' ? 'a' : 'o'),
      sv: { ...(lastSv?.sv || {}) }, incluirMotivo: true
    }
  };
  S.referencias.push(r); save();
  go('#/referencia/' + r.id);
}

function redactarPresentacion(r) {
  const p = pat(r.patientId), a = p.antecedentes || {}, g = r.gen, F = p.sexo === 'F';
  const edad = ageAt(p.fnac, r.fecha) ?? 0;
  const vacio = v => { const t = norm(v); return !t || ['niega', 'negado', 'negados', 'no', '-', 'ninguno', 'ninguna', 'n/a'].includes(t); };

  // Párrafo 1: ficha, antecedentes y hábitos
  const head = [];
  if (!vacio(a.ahf)) head.push(`con antecedentes heredofamiliares de ${lcFirst(noDot(a.ahf))}`);
  if (!vacio(a.patologicos)) head.push(`portador${F ? 'a' : ''} de ${lcFirst(noDot(a.patologicos))}${!vacio(a.tratamiento) ? ` con tratamiento a base de ${lcFirst(noDot(a.tratamiento))}` : ''}`);
  else if (!vacio(a.tratamiento)) head.push(`con tratamiento actual a base de ${lcFirst(noDot(a.tratamiento))}`);
  let p1 = `${F ? 'Femenino' : 'Masculino'} de la ${decada(edad)} década de la vida${head.length ? ', ' + head.join(', ') : ''}.`;

  const items = [['alergicos', 'alérgicos'], ['quirurgicos', 'quirúrgicos'], ['transfusionales', 'transfusionales'], ['traumaticos', 'traumáticos']];
  const neg = items.filter(([k]) => vacio(a[k])).map(([, l]) => l);
  const pos = items.filter(([k]) => !vacio(a[k])).map(([k, l]) => `${cap(l)}: ${lcFirst(noDot(a[k]))}.`);
  if (neg.length) p1 += ` Niega ${joinY(neg)}.`;
  if (pos.length) p1 += ' ' + pos.join(' ');
  if (!vacio(a.otros)) p1 += ' ' + endDot(cap(a.otros));

  const hab = [`${a.habitos || 'Buenos'} hábitos higiénico-dietéticos`];
  hab.push(vacio(a.mascotas) ? 'niega convivencia con animales' : `convivencia con ${lcFirst(noDot(a.mascotas)).replace(/^convivencia con\s+/i, '')}`);
  hab.push(vacio(a.deporte) ? 'niega práctica de deporte en la actualidad' : `actividad física: ${lcFirst(noDot(a.deporte))}`);
  if (!vacio(a.inmunizaciones)) hab.push(`última inmunización: ${lcFirst(noDot(a.inmunizaciones))}`);
  p1 += ' ' + hab.join(', ') + '.';
  if (F && !vacio(a.gineco)) p1 += ` Antecedentes gineco-obstétricos: ${lcFirst(noDot(a.gineco))}.`;

  // Párrafo 2: padecimiento actual
  let p2 = g.padecimiento ? endDot(cap(g.padecimiento)) : '';
  if (g.incluirMotivo && r.servicio) p2 += `${p2 ? ' ' : ''}Se refiere a segundo nivel de atención para valoración por ${titleCase(r.servicio)}.`;

  // Párrafo 3: exploración física
  const ex = (g.exploracion || '').replace(/@/g, F ? 'a' : 'o').trim().replace(/^exploraci[oó]n f[ií]sica:\s*/i, '');
  const p3 = ex ? `Exploración física: ${endDot(cap(ex))}` : '';

  // Párrafo 4: signos vitales
  const v = g.sv || {};
  const sv = [v.fc && `frecuencia cardíaca ${v.fc}x\``, v.fr && `frecuencia respiratoria ${v.fr}x\``, v.temp && `temperatura ${v.temp}º`,
    v.sat && `saturación de oxígeno ${v.sat}%`, v.ta && `TA ${v.ta}mmhg`, v.peso && `peso ${v.peso} kg`, v.talla && `talla ${v.talla} m`, v.gluc && `glucosa capilar ${v.gluc} mg/dl`].filter(Boolean);
  const p4 = sv.length ? `Signos vitales: ${sv.join(', ')}.` : '';
  return [p1, p2, p3, p4].filter(Boolean).join('\n');
}

function viewReferencia({ a: id }) {
  const r = S.referencias.find(x => x.id === id);
  const p = r && pat(r.patientId);
  if (!r || !p) { view().innerHTML = vhead('Solicitud no encontrada'); return; }
  r.gen ??= { sv: {} }; r.cita ??= {};
  const a = p.antecedentes || {};
  const antList = [['Heredofamiliares', a.ahf], ['Crónicos', a.patologicos], ['Tratamiento', a.tratamiento], ['Quirúrgicos', a.quirurgicos || 'Niega'], ['Alérgicos', a.alergicos || 'Niega'],
    ['Transfusionales', a.transfusionales || 'Niega'], ['Traumáticos', a.traumaticos || 'Niega'], ['Hábitos', a.habitos || 'Buenos'], ['Animales', a.mascotas || 'Niega'], ['Actividad física', a.deporte || 'Niega']];
  view().innerHTML = `
  <button class="btn onglass" id="back" style="margin-bottom:14px">${IC.back} ${esc(p.nombre)}</button>
  ${vhead('Solicitud de referencia', `Creada ${fmtLong(r.fecha)} · se guarda sola mientras escribes`)}
  <div class="refgrid">
    <section class="card milk">
      <h2 style="margin-bottom:14px">Datos del formato</h2>
      <div class="form">
        <div class="f s4"><label>Fecha</label><input type="date" data-b="fecha"></div>
        <div class="f s4"><label>Hora</label><input type="time" data-b="hora"></div>
        <div class="f s4"><label>Folio</label><input type="text" data-b="folio"></div>
        <div class="f s8"><label>Unidad médica emisora</label><input type="text" data-b="unidadEmisora"></div>
        <div class="f s4"><label>Clave</label><input type="text" data-b="claveEmisora"></div>
        <div class="f"><label>Motivos de la referencia</label><input type="text" data-b="motivo"></div>
        <div class="section"><h3>Paciente</h3></div>
        <div class="f s8"><label>Nombre</label><input type="text" data-b="nombre"></div>
        <div class="f s4"><label>Teléfono</label><input type="text" data-b="tel"></div>
        <div class="f s4"><label>Expediente</label><input type="text" data-b="expediente"></div>
        <div class="f s8"><label>Domicilio</label><input type="text" data-b="domicilio"></div>
        <div class="section"><h3>Envío</h3></div>
        <div class="f s8"><label>Unidad médica receptora</label><input type="text" data-b="unidadReceptora"></div>
        <div class="f s4"><label>Clave receptora</label><input type="text" data-b="claveReceptora"></div>
        <div class="f"><span class="lbl">El paciente se refiere a</span><div class="seg" data-seg="refiereA">
          <button data-v="consulta">Consulta externa</button><button data-v="hosp">Hospitalización</button><button data-v="estudios">Estudios auxiliares</button><button data-v="rehab">Rehabilitación</button></div></div>
        <div class="f s8"><label>Servicio</label><input type="text" data-b="servicio" id="servicio"></div>
        <div class="f s4"><label>Traslados en el año</label><input type="text" inputmode="numeric" data-b="traslados"></div>
        <div class="f s6"><span class="lbl">Tipo de servicio</span><div class="seg" data-seg="tipo"><button data-v="primera">Primera vez</button><button data-v="subsecuente">Subsecuente</button></div></div>
        <div class="f s3"><label>Fecha de cita</label><input type="date" data-b="cita.fecha"></div>
        <div class="f s3"><label>Hora de cita</label><input type="time" data-b="cita.hora"></div>
        <div class="section"><h3>Cierre</h3></div>
        <div class="f"><div class="row between"><label for="idx" class="lbl">Idx (diagnóstico ISSSTE)</label><button type="button" class="btn ghost" id="idxDx">Usar el de la última consulta</button></div>
          <div class="combo" id="idxCombo"><input id="idx" type="text" data-b="idx" autocomplete="off" placeholder="Diagnóstico ISSSTE"></div></div>
        <div class="f"><label>Resultados de laboratorio y gabinete</label><textarea data-b="resultados" style="min-height:60px"></textarea></div>
        <div class="f s6"><label>Licencia médica desde</label><input type="date" data-b="licDesde"></div>
        <div class="f s6"><label>Licencia médica hasta</label><input type="date" data-b="licHasta"></div>
        <div class="f"><span class="lbl">Referencia por</span><div class="seg" data-seg="riesgo"><button data-v="">Ninguno</button><button data-v="probable">Probable riesgo de trabajo</button><button data-v="riesgo">Riesgo de trabajo</button></div></div>
        <div class="f s6"><label>Médico tratante</label><input type="text" data-b="medico"></div>
        <div class="f s6"><label>Cédula profesional</label><input type="text" data-b="cedula"></div>
        <div class="f s6"><label>Vo. Bo. jefe inmediato</label><input type="text" data-b="jefe"></div>
        <div class="f s6"><label>Director o responsable</label><input type="text" data-b="director"></div>
      </div>
    </section>
    <div class="stack">
      <section class="genpanel">
        <div class="row between wrap" style="margin-bottom:10px"><h2>Redactar presentación del caso</h2></div>
        <p class="hint" style="margin-bottom:12px">Se arma con los antecedentes del paciente y lo que escribas aquí. Viene precargado con su última consulta.</p>
        <details style="margin-bottom:12px"><summary style="cursor:pointer;font-weight:600;color:var(--violeta)">Antecedentes que se usarán</summary>
          <dl class="kv" style="margin-top:10px">${antList.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v || '—')}</dd>`).join('')}</dl>
          <button class="btn soft" id="editAnt" style="margin-top:10px">${IC.edit} Editar antecedentes</button></details>
        <div class="form">
          <div class="f"><label>Padecimiento actual</label><textarea data-b="gen.padecimiento" placeholder="Inicia su padecimiento hace…"></textarea></div>
          <div class="f">${toggle('gen.incluirMotivo', 'Cerrar con «Se refiere a segundo nivel…»', 'Usa el servicio indicado en el formato')}</div>
          <div class="f"><div class="row between"><span class="lbl">Exploración física</span><button type="button" class="btn soft" id="exNormal">Usar normal</button></div><textarea data-b="gen.exploracion"></textarea></div>
          <div class="f"><span class="lbl">Signos vitales</span>${vitalsHTML('gen.sv')}</div>
        </div>
        <button class="btn primary" id="redactar" style="margin-top:16px;width:100%">${IC.wand} Redactar presentación</button>
      </section>
    </div>
  </div>
  <section class="card milk" style="margin-top:20px">
    <div class="row between wrap" style="margin-bottom:10px"><h2>Presentación del caso</h2><span class="small muted" id="pcount"></span></div>
    <textarea class="presentacion" data-b="presentacion" id="pres" placeholder="Pulsa «Redactar presentación» o escribe aquí directamente."></textarea>
    <div class="sticky-actions">
      <button class="btn danger" id="delRef" style="margin-right:auto">${IC.trash} Eliminar</button>
      <button class="btn soft" id="xWord">${IC.word} Exportar Word</button>
      <button class="btn primary" id="xPdf">${IC.pdf} Exportar PDF</button>
    </div>
  </section>`;
  if (!(r.idx || '').trim() && ultimoDx(p.id)) { r.idx = ultimoDx(p.id); save(); }
  const count = () => { const w = (r.presentacion || '').trim().split(/\s+/).filter(Boolean).length; $('#pcount').textContent = w ? `${w} palabras` : ''; };
  bindForm(view(), r, k => { save(); if (k === 'presentacion') count(); });
  count();
  attachList($('#idxCombo'), $('#idx'), q => dxDelPaciente(p.id).filter(d => !norm(q) || norm(d).includes(norm(q))).map(label => ({ label })), it => { r.idx = it.label; $('#idx').value = it.label; save(); });
  $('#idxDx').onclick = () => { const d = ultimoDx(p.id); if (!d) return toast('Este paciente no tiene diagnóstico ISSSTE registrado'); r.idx = d; $('#idx').value = d; save(); };
  $('#back').onclick = () => go(`#/paciente/${p.id}/referencias`);
  $('#editAnt').onclick = () => go(`#/paciente/${p.id}/antecedentes`);
  $('#exNormal').onclick = () => { const t = $('[data-b="gen.exploracion"]'); t.value = S.settings.exploracionNormal.replace(/@/g, p.sexo === 'F' ? 'a' : 'o'); r.gen.exploracion = t.value; save(); };
  $('#redactar').onclick = async () => {
    if ((r.presentacion || '').trim() && !await confirmBox('Se reemplazará el texto actual de la presentación del caso.', { ok: 'Reemplazar', title: 'Redactar de nuevo' })) return;
    r.presentacion = redactarPresentacion(r); $('#pres').value = r.presentacion; save(); count();
    $('#pres').scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('Presentación redactada, revísala y ajusta lo necesario');
  };
  $('#xPdf').onclick = () => runExport(() => pdfReferencia(r));
  $('#xWord').onclick = () => runExport(() => docxReferencia(r));
  $('#delRef').onclick = async () => {
    if (!await confirmBox('Se eliminará esta solicitud de referencia.', { ok: 'Eliminar', danger: true })) return;
    S.referencias = S.referencias.filter(x => x.id !== r.id); save(); go(`#/paciente/${p.id}/referencias`);
  };
}

/* =========================================================================
   VISTA: REPORTES
   ========================================================================= */
const R = { tab: 'mes', ym: iso(new Date()).slice(0, 7), epiY: null, epiW: null, solo: false };

function rowsMes(ym) {
  return S.consultas.filter(c => c.fecha.startsWith(ym)).sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora))
    .map(c => ({ c, p: pat(c.patientId) })).filter(x => x.p).map(x => ({ ...x, edad: ageLabel(x.p.fnac, x.c.fecha) }));
}
function dataEpi(y, w, solo) {
  const r = epiRange(y, w), a = iso(r.start), b = iso(r.end);
  const cs = S.consultas.filter(c => c.suive && c.fecha >= a && c.fecha <= b && (!solo || c.tipo === 'primera')).sort((x, z) => (x.fecha + x.hora).localeCompare(z.fecha + z.hora));
  const groups = [];
  S.suive.forEach(s => {
    const rows = cs.filter(c => c.suive === s.id).map(c => ({ c, p: pat(c.patientId) })).filter(x => x.p).map(x => ({ ...x, edad: ageLabel(x.p.fnac, x.c.fecha) }));
    if (rows.length) groups.push({ s, rows, m: rows.filter(x => x.p.sexo === 'M').length, f: rows.filter(x => x.p.sexo === 'F').length });
  });
  return { r, groups, total: groups.reduce((n, g) => n + g.rows.length, 0) };
}
const MES_COLS = ['Fecha', 'Paciente', 'Edad', 'Sexo', 'No. derechohabiente', 'Tipo', 'Foráneo', 'Laboratorio', 'Imagen', 'Medicamentos', 'Incapacidad (días)', 'Enfermedad ISSSTE'];
const MES_COLS_PDF = ['Fecha', 'Paciente', 'Edad', 'Sexo', 'No. derechohabiente', 'Tipo', 'Foráneo', 'Lab.', 'Imagen', 'Medica-\nmentos', 'Incap.\n(días)', 'Enfermedad ISSSTE'];
const MES_W = [8, 17, 4, 5, 11, 4, 9, 6, 6, 7, 7, 16];
const mesRow = x => [fmtShort(x.c.fecha), x.p.nombre, String(x.edad), sexoCorto(x.p.sexo), x.p.expediente || '', String(x.p.tipo ?? ''),
  x.c.foraneo ? `Sí, ${x.c.procedencia || ''}`.replace(/, $/, '') : 'No', x.c.lab ? 'Sí' : 'No', x.c.img ? 'Sí' : 'No', String(x.c.meds || 0),
  x.c.incapacidad ? String(x.c.incapDias || 0) : '—', x.c.dxIssste || ''];
const mesResumen = rows => {
  const proc = {}; rows.filter(x => x.c.foraneo).forEach(x => { const k = x.c.procedencia || 'Sin especificar'; proc[k] = (proc[k] || 0) + 1; });
  return [['Consultas', rows.length], ['Pacientes distintos', new Set(rows.map(x => x.p.id)).size], ['Con estudios de laboratorio', rows.filter(x => x.c.lab).length],
    ['Con estudios de imagen', rows.filter(x => x.c.img).length], ['Medicamentos proporcionados', rows.reduce((n, x) => n + (+x.c.meds || 0), 0)],
    ['Consultas a pacientes foráneos', rows.filter(x => x.c.foraneo).length],
    ...Object.entries(proc).sort((a, b) => b[1] - a[1]).map(([k, v]) => [`Foráneos de ${k}`, v]),
    ['Incapacidades otorgadas', rows.filter(x => x.c.incapacidad).length], ['Días de incapacidad', rows.reduce((n, x) => n + (x.c.incapacidad ? +x.c.incapDias || 0 : 0), 0)]];
};
const mesNombre = ym => { const [y, m] = ym.split('-').map(Number); return `${MESES[m - 1]} de ${y}`; };

function viewReportes() {
  const now = new Date(), ep = epiWeek(now);
  R.epiY ??= ep.year; R.epiW ??= ep.week;
  const years = [...new Set([now.getFullYear(), ...S.consultas.map(c => +c.fecha.slice(0, 4))])].sort((a, b) => b - a);
  view().innerHTML = vhead('Reportes', 'Vista previa y exportación a PDF o Word') + `
  <div class="tabs"><button data-rt="mes" class="${R.tab === 'mes' ? 'on' : ''}">Reporte del mes</button><button data-rt="epi" class="${R.tab === 'epi' ? 'on' : ''}">Reporte de epidemiología</button></div>
  <section class="card milk" id="rbody"></section>`;
  $$('[data-rt]').forEach(b => b.onclick = () => { R.tab = b.dataset.rt; viewReportes(); });
  const body = $('#rbody');

  if (R.tab === 'mes') {
    const [yy, mm] = R.ym.split('-').map(Number);
    const rows = rowsMes(R.ym);
    const pacientes = new Set(rows.map(x => x.p.id)).size;
    body.innerHTML = `
      <div class="row between wrap" style="margin-bottom:16px">
        <div class="row wrap"><select id="rm" aria-label="Mes" style="width:auto">${MESES.map((m, i) => `<option value="${i + 1}" ${i + 1 === mm ? 'selected' : ''}>${cap(m)}</option>`).join('')}</select>
        <select id="ry" aria-label="Año" style="width:auto">${years.map(y => `<option ${y === yy ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
        <div class="row wrap"><button class="btn soft" id="mw" ${rows.length ? '' : 'disabled'}>${IC.word} Word</button><button class="btn primary" id="mp" ${rows.length ? '' : 'disabled'}>${IC.pdf} PDF</button></div>
      </div>
      <div class="tags" style="margin-bottom:14px"><span class="tag">${rows.length} consultas</span><span class="tag">${pacientes} pacientes</span>
        <span class="tag o">${rows.filter(x => x.c.lab).length} con laboratorio</span><span class="tag o">${rows.filter(x => x.c.img).length} con imagen</span>
        <span class="tag">${rows.reduce((n, x) => n + (+x.c.meds || 0), 0)} medicamentos</span>
        <span class="tag">${rows.filter(x => x.c.foraneo).length} foráneos</span>
        <span class="tag o">${rows.filter(x => x.c.incapacidad).length} incapacidades · ${rows.reduce((n, x) => n + (x.c.incapacidad ? +x.c.incapDias || 0 : 0), 0)} días</span></div>
      ${rows.length ? `<div class="tablewrap"><table class="t"><thead><tr>${MES_COLS.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>
        ${(() => { let cur = '', h = ''; rows.forEach(x => { if (x.c.fecha !== cur) { cur = x.c.fecha; h += `<tr class="day"><td colspan="${MES_COLS.length}">${cap(fmtLong(cur))} · ${rows.filter(z => z.c.fecha === cur).length} paciente(s)</td></tr>`; }
          h += `<tr>${mesRow(x).map(v => `<td>${esc(v)}</td>`).join('')}</tr>`; }); return h; })()}
        </tbody></table></div>` : `<div class="empty"><b>No hay consultas en ${mesNombre(R.ym)}</b>Elige otro mes o registra consultas desde «Hoy».</div>`}`;
    const upd = () => { R.ym = `${$('#ry').value}-${pad($('#rm').value)}`; viewReportes(); };
    $('#rm').onchange = upd; $('#ry').onchange = upd;
    $('#mp').onclick = () => runExport(() => pdfMes(R.ym));
    $('#mw').onclick = () => runExport(() => docxMes(R.ym));
  } else {
    const nW = weeksInYear(R.epiY); if (R.epiW > nW) R.epiW = nW;
    const d = dataEpi(R.epiY, R.epiW, R.solo);
    const yrs = [...new Set([...years, ep.year])].sort((a, b) => b - a);
    body.innerHTML = `
      <div class="row between wrap" style="margin-bottom:16px">
        <div class="row wrap">
          <button class="iconbtn" id="wprev" aria-label="Semana anterior">${IC.back}</button>
          <select id="ew" aria-label="Semana epidemiológica" style="width:auto">${Array.from({ length: nW }, (_, i) => { const r = epiRange(R.epiY, i + 1); return `<option value="${i + 1}" ${i + 1 === R.epiW ? 'selected' : ''}>Semana ${i + 1} · ${rangeTxt(r)}</option>`; }).join('')}</select>
          <button class="iconbtn" id="wnext" aria-label="Semana siguiente" style="transform:scaleX(-1)">${IC.back}</button>
          <select id="ey" aria-label="Año epidemiológico" style="width:auto">${yrs.map(y => `<option ${y === R.epiY ? 'selected' : ''}>${y}</option>`).join('')}</select>
        </div>
        <div class="row wrap"><button class="btn soft" id="ewd" ${d.total ? '' : 'disabled'}>${IC.word} Word</button><button class="btn primary" id="epd" ${d.total ? '' : 'disabled'}>${IC.pdf} PDF</button></div>
      </div>
      <div class="row wrap between" style="margin-bottom:16px">
        <div class="tags"><span class="tag">${d.total} casos</span><span class="tag">${d.groups.length} diagnósticos</span><span class="tag o">${d.groups.reduce((n, g) => n + g.m, 0)} masc.</span><span class="tag o">${d.groups.reduce((n, g) => n + g.f, 0)} fem.</span></div>
        <div style="max-width:360px">${toggle('solo', 'Solo primera vez', 'Contar únicamente casos nuevos')}</div>
      </div>
      ${d.groups.length ? d.groups.map(g => `<div class="epigroup">
        <div class="gh"><span class="k">${esc(g.s.clave)}</span><h3>${esc(g.s.nombre)}</h3><span class="small muted">${g.rows.length} caso(s) · ${g.m} masc. · ${g.f} fem.</span></div>
        <div class="tablewrap"><table class="t" style="min-width:520px"><thead><tr><th>Paciente</th><th>Edad</th><th>Sexo</th><th>Fecha</th></tr></thead><tbody>
        ${g.rows.map(x => `<tr><td>${esc(x.p.nombre)}</td><td class="num">${x.edad}</td><td>${sexoCorto(x.p.sexo)}</td><td class="num">${fmtShort(x.c.fecha)}</td></tr>`).join('')}</tbody></table></div></div>`).join('')
        : `<div class="empty"><b>Sin diagnósticos SUIVE en la semana ${R.epiW}</b>Solo aparecen las consultas que tienen diagnóstico SUIVE.</div>`}`;
    bindForm(body, R, () => viewReportes());
    $('#ew').onchange = e => { R.epiW = +e.target.value; viewReportes(); };
    $('#ey').onchange = e => { R.epiY = +e.target.value; viewReportes(); };
    $('#wprev').onclick = () => { if (R.epiW > 1) R.epiW--; else { R.epiY--; R.epiW = weeksInYear(R.epiY); } viewReportes(); };
    $('#wnext').onclick = () => { if (R.epiW < nW) R.epiW++; else { R.epiY++; R.epiW = 1; } viewReportes(); };
    $('#epd').onclick = () => runExport(() => pdfEpi(R.epiY, R.epiW, R.solo));
    $('#ewd').onclick = () => runExport(() => docxEpi(R.epiY, R.epiW, R.solo));
  }
}

/* =========================================================================
   VISTA: AJUSTES
   ========================================================================= */
function viewAjustes() {
  const st = S.settings;
  view().innerHTML = vhead('Ajustes', 'Datos que se prellenan, catálogo SUIVE, seguridad y respaldos') + `
  <div class="stack">
  <section class="card milk"><h2 style="margin-bottom:6px">Datos para la solicitud de referencia</h2><p class="hint" style="margin-bottom:14px">Se copian a cada solicitud nueva. Puedes cambiarlos en cada solicitud sin afectar estos.</p>
    <div class="form">
      <div class="f s6"><label>Médico tratante</label><input type="text" data-b="medico"></div>
      <div class="f s6"><label>Cédula profesional</label><input type="text" data-b="cedula"></div>
      <div class="f s6"><label>Vo. Bo. jefe inmediato</label><input type="text" data-b="jefe"></div>
      <div class="f s6"><label>Director o responsable de la unidad</label><input type="text" data-b="director"></div>
      <div class="f s6"><label>Cargo del director</label><input type="text" data-b="directorCargo"></div>
      <div class="f s6"><label>Servicio por omisión</label><input type="text" data-b="servicio"></div>
      <div class="f s8"><label>Unidad médica emisora</label><input type="text" data-b="unidadEmisora"></div>
      <div class="f s4"><label>Clave emisora</label><input type="text" data-b="claveEmisora"></div>
      <div class="f s8"><label>Unidad médica receptora</label><input type="text" data-b="unidadReceptora"></div>
      <div class="f s4"><label>Clave receptora</label><input type="text" data-b="claveReceptora"></div>
      <div class="f"><label>Motivo de la referencia por omisión</label><input type="text" data-b="motivo"></div>
      <div class="f"><span class="lbl">Logotipo para el formato (opcional)</span>
        <div class="row wrap">${st.logo ? `<img src="${st.logo}" alt="Logotipo cargado" style="height:56px;border-radius:8px;background:#fff">` : '<span class="small muted">Sin logotipo: se imprime el nombre del Instituto en texto.</span>'}
        <label class="btn soft" style="cursor:pointer">${IC.up} Elegir imagen<input type="file" accept="image/*" id="logo" hidden></label>
        ${st.logo ? '<button class="btn ghost" id="nologo">Quitar</button>' : ''}</div></div>
    </div></section>

  <section class="card milk"><h2 style="margin-bottom:14px">Redacción de la presentación del caso</h2>
    <div class="form">
      <div class="f"><span class="lbl">Cómo nombrar la década de la vida</span><div class="seg" data-seg="decada"><button data-v="estandar">Estándar · 70 años = octava</button><button data-v="clinica">Como en mis notas · 70 años = séptima</button></div></div>
      <div class="f"><label>Exploración física normal</label><textarea data-b="exploracionNormal" style="min-height:120px"></textarea><p class="hint">Escribe @ donde cambie el género: «orientad@» se vuelve «orientado» u «orientada».</p></div>
    </div></section>

  <section class="card milk"><h2 style="margin-bottom:6px">Tipos de derechohabiente</h2><p class="hint" style="margin-bottom:14px">Etiqueta opcional para cada número. Se muestra junto al número en las fichas.</p>
    <div class="form">${st.tipos.map((t, i) => `<div class="f s6"><label>Tipo ${i}</label><input type="text" data-b="tipos.${i}" placeholder="Sin etiqueta"></div>`).join('')}</div></section>

  <section class="card milk"><div class="row between wrap" style="margin-bottom:6px"><h2>Catálogo SUIVE</h2><button class="btn soft" id="addS">${IC.plus} Agregar diagnóstico</button></div>
    <p class="hint" style="margin-bottom:12px">Basado en el formato SUIVE-1; compáralo con el formato vigente de tu jurisdicción y corrige lo necesario. Marca con estrella los que más usas para que salgan primero.</p>
    <div class="searchbox" style="margin-bottom:10px">${IC.search}<input id="sq" type="search" placeholder="Buscar en el catálogo"></div>
    <div id="slist" style="max-height:460px;overflow:auto"></div></section>

  <section class="card milk"><h2 style="margin-bottom:6px">Seguridad</h2><p class="hint" style="margin-bottom:14px">Un PIN de 4 dígitos protege los expedientes si alguien más toma el iPad. Se pide al abrir y tras 5 minutos fuera de la app.</p>
    <div class="row wrap">${st.pinHash ? `<button class="btn soft" id="pinSet">${IC.lock} Cambiar PIN</button><button class="btn ghost" id="pinOff">Quitar PIN</button><button class="btn primary" id="lockNow">${IC.lock} Bloquear ahora</button>` : `<button class="btn primary" id="pinSet">${IC.lock} Crear PIN</button>`}</div></section>

  <section class="card milk"><h2 style="margin-bottom:6px">Importar pacientes</h2><p class="hint" style="margin-bottom:14px">Agrega pacientes desde un archivo de pacientes (.json). No borra nada: los que ya existen solo se completan. Si eliges un respaldo por error, la app lo detecta y te pregunta.</p>
    <label class="btn primary" style="cursor:pointer">${IC.up} Elegir archivo de pacientes<input type="file" id="impP2" hidden></label></section>

  <section class="card milk"><h2 style="margin-bottom:6px">Respaldo</h2><p class="hint" style="margin-bottom:14px">Todo se guarda solo en este iPad. Guarda un respaldo en Archivos o iCloud Drive cada semana. ${st.lastBackup ? `Último respaldo: ${fmtLong(st.lastBackup.slice(0, 10))}.` : 'Aún no has hecho ningún respaldo.'}</p>
    <div class="row wrap"><button class="btn primary" id="bk">${IC.down} Guardar respaldo</button>
      <label class="btn soft" style="cursor:pointer">${IC.up} Restaurar respaldo<input type="file" id="restore" hidden></label></div>
    <p class="hint" id="persist" style="margin-top:10px"></p></section>
  </div>`;
  bindForm(view(), st, () => save());
  $('#logo').onchange = e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      try { st.logo = (await imagenAPNG(rd.result)).dataUrl; save(); viewAjustes(); toast('Logotipo guardado'); }
      catch (err) { avisoBox('No se pudo usar la imagen', 'Prueba con una imagen PNG o JPG (por ejemplo, una captura de pantalla del logotipo).'); }
    };
    rd.readAsDataURL(f);
  };
  $('#nologo') && ($('#nologo').onclick = () => { st.logo = ''; save(); viewAjustes(); });
  $('#bk').onclick = exportBackup;
  $('#restore').onchange = e => { const f = e.target.files[0]; e.target.value = ''; importarArchivo(f); };
  $('#impP2').onchange = e => { const f = e.target.files[0]; e.target.value = ''; importarArchivo(f); };
  $('#pinSet').onclick = setPin;
  $('#pinOff') && ($('#pinOff').onclick = async () => { if (await confirmBox('La app ya no pedirá PIN al abrirse.', { ok: 'Quitar PIN' })) { st.pinHash = ''; save(); viewAjustes(); toast('PIN quitado'); } });
  $('#lockNow') && ($('#lockNow').onclick = showLock);
  navigator.storage?.persisted?.().then(v => $('#persist') && ($('#persist').textContent = v ? 'El navegador marcó estos datos como persistentes.' : 'Consejo: instala la app en la pantalla de inicio para que Safari no borre los datos.'));
  const drawS = () => {
    const n = norm($('#sq').value);
    const list = S.suive.filter(s => !n || norm(s.nombre).includes(n) || norm(s.clave).includes(n) || norm(s.grupo).includes(n));
    $('#slist').innerHTML = list.map(s => `<div class="visit" style="grid-template-columns:44px 150px 1fr auto;cursor:default;${s.activo === false ? 'opacity:.45' : ''}">
      <button class="iconbtn" data-fav="${s.id}" aria-label="${s.fav ? 'Quitar de favoritos' : 'Marcar favorito'}" style="${s.fav ? 'color:var(--violeta)' : ''}">${s.fav ? IC.starF : IC.star}</button>
      <span class="small" style="font-weight:600;color:var(--violeta)">${esc(s.clave)}</span>
      <div><b>${esc(s.nombre)}</b><div class="dx">${esc(s.grupo)}${s.activo === false ? ' · oculto' : ''}</div></div>
      <button class="iconbtn" data-ed="${s.id}" aria-label="Editar">${IC.edit}</button></div>`).join('') || `<div class="empty"><b>Sin coincidencias</b></div>`;
    $$('[data-fav]', $('#slist')).forEach(b => b.onclick = () => { const s = suiveById(b.dataset.fav); s.fav = !s.fav; save(); drawS(); });
    $$('[data-ed]', $('#slist')).forEach(b => b.onclick = () => editSuive(b.dataset.ed, drawS));
  };
  $('#sq').addEventListener('input', drawS); drawS();
  $('#addS').onclick = () => editSuive(null, drawS);
}
function editSuive(id, after) {
  const orig = id ? suiveById(id) : null;
  const d = orig ? { ...orig } : { id: uid(), clave: '', nombre: '', grupo: 'Otros', fav: false, activo: true };
  const used = id ? S.consultas.filter(c => c.suive === id).length : 0;
  const sh = openSheet(`<div class="shead"><h2>${orig ? 'Editar diagnóstico' : 'Nuevo diagnóstico SUIVE'}</h2><button class="iconbtn" data-close aria-label="Cerrar">${IC.x}</button></div>
    <div class="form"><div class="f s4"><label>Clave CIE-10</label><input type="text" data-b="clave"></div><div class="f s8"><label>Nombre</label><input type="text" data-b="nombre"></div>
    <div class="f"><label>Grupo</label><input type="text" data-b="grupo"></div>
    <div class="f s6">${toggle('fav', 'Favorito')}</div><div class="f s6">${toggle('activo', 'Visible en la lista')}</div></div>
    <div class="sticky-actions">${orig && !used ? `<button class="btn danger" data-del style="margin-right:auto">${IC.trash} Eliminar</button>` : ''}<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-save>Guardar</button></div>`, { small: true });
  bindForm(sh, d);
  $$('[data-close]', sh).forEach(b => b.onclick = closeSheet);
  $('[data-save]', sh).onclick = () => { if (!d.nombre.trim()) return toast('Escribe el nombre del diagnóstico'); if (orig) Object.assign(orig, d); else S.suive.push(d); save(); closeSheet(); after(); };
  $('[data-del]', sh) && ($('[data-del]', sh).onclick = () => { S.suive = S.suive.filter(s => s.id !== id); save(); closeSheet(); after(); });
}

/* =========================================================================
   EXPORTACIÓN
   ========================================================================= */
/* imagen → PNG (máx. 800 px de ancho): evita formatos que Word, Pages o el PDF no reconocen */
async function imagenAPNG(src) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('imagen')); i.src = src; });
  const k = Math.min(1, 800 / img.naturalWidth), cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  const dataUrl = cv.toDataURL('image/png'), bin = atob(dataUrl.split(',')[1]), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { dataUrl, bytes, w: cv.width, h: cv.height };
}
async function logoInfo() { if (!S.settings.logo) return null; try { return await imagenAPNG(S.settings.logo); } catch (e) { console.error(e); return null; } }
const fitBox = (w, h, bw, bh) => { const k = Math.min(bw / w, bh / h); return [w * k, h * k]; };
const loaded = {};
function loadScript(src) {
  return loaded[src] ??= new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('No se pudo cargar ' + src)); }; document.head.appendChild(s); });
}
const libPDF = async () => { await loadScript('vendor/jspdf.js'); await loadScript('vendor/autotable.js'); return window.jspdf.jsPDF; };
const libDOCX = async () => { await loadScript('vendor/docx.js'); return window.docx; };
const isApple = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function runExport(fn) {
  toast('Preparando documento…');
  try { await fn(); } catch (e) { console.error(e); toast('No se pudo exportar: ' + e.message); }
}
async function deliver(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (isApple() && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Documento listo: ' + name);
}
const safeName = s => norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase();
const RGB_V = [99, 91, 255], RGB_O = [0, 229, 229], RGB_INK = [26, 22, 80];

/* --------- encabezado común de reportes PDF --------- */
function pdfHeader(doc, title, sub) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...RGB_O); doc.rect(0, 0, W / 2, 6, 'F'); doc.setFillColor(...RGB_V); doc.rect(W / 2, 0, W / 2, 6, 'F');
  doc.setTextColor(...RGB_INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(title, 40, 40);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(sub, 40, 56);
  doc.setFontSize(9); doc.setTextColor(90, 88, 128);
  doc.text(`${S.settings.medico}   |   Unidad: ${S.settings.unidadEmisora} (${S.settings.claveEmisora})`, 40, 70);
  doc.setTextColor(...RGB_INK);
  return 84;
}
function pdfFooter(doc) {
  const n = doc.getNumberOfPages(), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120, 118, 150); doc.text(`Página ${i} de ${n}   |   Generado el ${fmtShort(iso(new Date()))}`, W - 40, H - 20, { align: 'right' }); }
}
const autoTable = (doc, opts) => (typeof doc.autoTable === 'function' ? doc.autoTable(opts) : window.jspdf.autoTable?.(doc, opts));

/* --------- Reporte del mes --------- */
async function pdfMes(ym) {
  const jsPDF = await libPDF();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const rows = rowsMes(ym);
  let y = pdfHeader(doc, 'Reporte del mes', cap(mesNombre(ym)));
  const body = []; let cur = '';
  rows.forEach(x => {
    if (x.c.fecha !== cur) { cur = x.c.fecha; body.push([{ content: `${cap(fmtLong(cur))}  (${rows.filter(z => z.c.fecha === cur).length} paciente/s)`, colSpan: MES_COLS.length, styles: { fillColor: [224, 250, 250], textColor: [0, 110, 115], fontStyle: 'bold' } }]); }
    body.push(mesRow(x));
  });
  autoTable(doc, {
    startY: y, head: [MES_COLS_PDF], body,
    theme: 'grid', styles: { fontSize: 7.5, cellPadding: 3.5, textColor: RGB_INK, lineColor: [225, 224, 245], lineWidth: .5 },
    headStyles: { fillColor: RGB_V, textColor: 255, fontStyle: 'bold', valign: 'middle' },
    columnStyles: { 0: { cellWidth: 50 }, 2: { cellWidth: 28, halign: 'center' }, 3: { cellWidth: 30 }, 4: { cellWidth: 76 }, 5: { cellWidth: 26, halign: 'center' }, 6: { cellWidth: 66 }, 7: { cellWidth: 26, halign: 'center' }, 8: { cellWidth: 38, halign: 'center' }, 9: { cellWidth: 40, halign: 'center' }, 10: { cellWidth: 44, halign: 'center' } },
    margin: { left: 40, right: 40 }
  });
  y = (doc.lastAutoTable?.finalY || y) + 16;
  autoTable(doc, {
    startY: y, head: [['Resumen', '']], theme: 'plain', tableWidth: 260, margin: { left: 40 },
    body: mesResumen(rows).map(r => r.map(String)),
    styles: { fontSize: 9, textColor: RGB_INK }, headStyles: { textColor: RGB_V, fontStyle: 'bold' }, columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } }
  });
  pdfFooter(doc);
  await deliver(doc.output('blob'), `Reporte_del_mes_${ym}.pdf`);
}

/* --------- Reporte de epidemiología --------- */
async function pdfEpi(y, w, solo) {
  const jsPDF = await libPDF();
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const d = dataEpi(y, w, solo);
  let top = pdfHeader(doc, `Reporte de epidemiología · Semana ${w} de ${y}`, `${cap(rangeTxt(d.r))} de ${d.r.end.getFullYear()}${solo ? '   |   Solo casos de primera vez' : ''}`);
  autoTable(doc, {
    startY: top, head: [['Clave', 'Diagnóstico SUIVE', 'Masc.', 'Fem.', 'Total']],
    body: [...d.groups.map(g => [g.s.clave, g.s.nombre, g.m, g.f, g.rows.length].map(String)),
      [{ content: 'Total', colSpan: 2, styles: { fontStyle: 'bold' } }, ...[d.groups.reduce((n, g) => n + g.m, 0), d.groups.reduce((n, g) => n + g.f, 0), d.total].map(v => ({ content: String(v), styles: { fontStyle: 'bold' } }))]],
    theme: 'grid', styles: { fontSize: 8.5, cellPadding: 4, textColor: RGB_INK, lineColor: [225, 224, 245], lineWidth: .5 },
    headStyles: { fillColor: RGB_V, textColor: 255 }, columnStyles: { 0: { cellWidth: 110 }, 2: { halign: 'center', cellWidth: 44 }, 3: { halign: 'center', cellWidth: 44 }, 4: { halign: 'center', cellWidth: 44 } }, margin: { left: 40, right: 40 }
  });
  let yy = doc.lastAutoTable.finalY + 22;
  d.groups.forEach(g => {
    if (yy > doc.internal.pageSize.getHeight() - 110) { doc.addPage(); yy = 50; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...RGB_V);
    doc.text(`${g.s.clave}  ${g.s.nombre}`, 40, yy, { maxWidth: 530 });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90, 88, 128);
    doc.text(`${g.rows.length} caso(s): ${g.m} masculino, ${g.f} femenino`, 40, yy + 13);
    autoTable(doc, {
      startY: yy + 20, head: [['Paciente', 'Edad', 'Sexo', 'Fecha de consulta']], body: g.rows.map(x => [x.p.nombre, x.edad, sexoCorto(x.p.sexo), fmtShort(x.c.fecha)]),
      theme: 'striped', styles: { fontSize: 8.5, cellPadding: 3.5, textColor: RGB_INK }, headStyles: { fillColor: [224, 250, 250], textColor: [0, 110, 115] },
      alternateRowStyles: { fillColor: [243, 242, 255] }, columnStyles: { 1: { cellWidth: 50, halign: 'center' }, 2: { cellWidth: 50 }, 3: { cellWidth: 100 } }, margin: { left: 40, right: 40 }
    });
    yy = doc.lastAutoTable.finalY + 22;
  });
  pdfFooter(doc);
  await deliver(doc.output('blob'), `Reporte_epidemiologia_${y}_SE${pad(w)}.pdf`);
}

/* --------- utilidades Word --------- */
function W(docx) {
  const { Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType } = docx;
  const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const LINE = c => ({ style: BorderStyle.SINGLE, size: 4, color: c || 'B9B6E8' });
  const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
  const P = (text, o = {}) => new Paragraph({
    alignment: o.align, spacing: { after: o.after ?? 0, before: o.before ?? 0, line: o.line },
    children: String(text ?? '').split('\n').flatMap((t, i) => [new TextRun({ text: t, break: i ? 1 : 0, bold: o.bold, italics: o.italic, size: Math.round((o.size || 9) * 2), color: o.color || '1A1650', font: 'Arial' })])
  });
  const C = (content, o = {}) => new TableCell({
    children: Array.isArray(content) ? content : [P(content, o)], columnSpan: o.span, width: o.w ? { size: o.w, type: WidthType.PERCENTAGE } : undefined,
    borders: o.borders || { top: NONE, left: NONE, right: NONE, bottom: o.under ? LINE('1A1650') : NONE },
    shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    margins: { top: 40, bottom: 40, left: 60, right: 60 }, verticalAlign: o.valign
  });
  const T = (rows, o = {}) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: o.borders || noBorders, rows: rows.map(r => new TableRow({ children: r, tableHeader: false })) });
  const grid = { top: LINE(), bottom: LINE(), left: LINE(), right: LINE(), insideHorizontal: LINE(), insideVertical: LINE() };
  const box = { top: LINE('1A1650'), bottom: LINE('1A1650'), left: LINE('1A1650'), right: LINE('1A1650') };
  return { P, C, T, grid, box, LINE, NONE, AlignmentType, TableRow };
}
async function docxBlob(docx, children, landscape = false) {
  const { Document, Packer, PageOrientation } = docx;
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 18 } } } },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840, orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: 720, bottom: 720, left: 760, right: 760 } } }, children }]
  });
  return Packer.toBlob(doc);
}
function docxHeader(w, title, sub) {
  return [w.P(title, { bold: true, size: 16, color: '635BFF' }), w.P(sub, { size: 10, after: 40 }),
    w.P(`${S.settings.medico}   |   Unidad: ${S.settings.unidadEmisora} (${S.settings.claveEmisora})`, { size: 8.5, color: '5A5880', after: 200 })];
}
const hdrRow = (w, cols) => cols.map(c => w.C(c, { bold: true, color: 'FFFFFF', fill: '635BFF', size: 8.5 }));

async function docxMes(ym) {
  const docx = await libDOCX(), w = W(docx);
  const rows = rowsMes(ym), trs = [MES_COLS_PDF.map((c, i) => w.C(c, { bold: true, color: 'FFFFFF', fill: '635BFF', size: 8, w: MES_W[i] }))];
  let cur = '';
  rows.forEach(x => {
    if (x.c.fecha !== cur) { cur = x.c.fecha; trs.push([w.C(`${cap(fmtLong(cur))}  (${rows.filter(z => z.c.fecha === cur).length} paciente/s)`, { span: MES_COLS.length, bold: true, color: '006E73', fill: 'E0FAFA', size: 8.5 })]); }
    trs.push(mesRow(x).map((v, i) => w.C(v, { size: 8, w: MES_W[i] })));
  });
  const res = mesResumen(rows);
  const blob = await docxBlob(docx, [...docxHeader(w, 'Reporte del mes', cap(mesNombre(ym))), w.T(trs, { borders: w.grid }),
    w.P('Resumen', { bold: true, color: '635BFF', before: 240, after: 60, size: 10 }), w.T(res.map(([k, v]) => [w.C(k, { w: 70 }), w.C(String(v), { bold: true, w: 30, align: w.AlignmentType.RIGHT })]), { borders: w.grid })], true);
  await deliver(blob, `Reporte_del_mes_${ym}.docx`);
}

async function docxEpi(y, wk, solo) {
  const docx = await libDOCX(), w = W(docx);
  const d = dataEpi(y, wk, solo);
  const ch = [...docxHeader(w, `Reporte de epidemiología · Semana ${wk} de ${y}`, `${cap(rangeTxt(d.r))} de ${d.r.end.getFullYear()}${solo ? '   |   Solo casos de primera vez' : ''}`)];
  ch.push(w.T([hdrRow(w, ['Clave', 'Diagnóstico SUIVE', 'Masc.', 'Fem.', 'Total']), ...d.groups.map(g => [g.s.clave, g.s.nombre, g.m, g.f, g.rows.length].map(v => w.C(String(v), { size: 8.5 }))),
    [w.C('Total', { span: 2, bold: true }), ...[d.groups.reduce((n, g) => n + g.m, 0), d.groups.reduce((n, g) => n + g.f, 0), d.total].map(v => w.C(String(v), { bold: true }))]], { borders: w.grid }));
  d.groups.forEach(g => {
    ch.push(w.P(`${g.s.clave}  ${g.s.nombre}`, { bold: true, color: '635BFF', size: 10.5, before: 280 }));
    ch.push(w.P(`${g.rows.length} caso(s): ${g.m} masculino, ${g.f} femenino`, { size: 8.5, color: '5A5880', after: 80 }));
    ch.push(w.T([hdrRow(w, ['Paciente', 'Edad', 'Sexo', 'Fecha de consulta']), ...g.rows.map(x => [x.p.nombre, x.edad, sexoCorto(x.p.sexo), fmtShort(x.c.fecha)].map(v => w.C(String(v), { size: 8.5 })))], { borders: w.grid }));
  });
  await deliver(await docxBlob(docx, ch), `Reporte_epidemiologia_${y}_SE${pad(wk)}.docx`);
}

/* --------- Solicitud de referencia: PDF que replica el formato --------- */
function dateParts(isoStr) { if (!isoStr) return ['', '', '', '', '', '']; const [y, m, d] = isoStr.split('-'); return [...d, ...m, ...y.slice(2)]; }
function timeParts(t) { if (!t) return ['', '', '', '']; return [...t.replace(':', '')]; }

async function pdfReferencia(r) {
  const jsPDF = await libPDF();
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const L = 45, R_ = 575, st = S.settings, p = pat(r.patientId);
  const edad = ageAt(p.fnac, r.fecha);
  const B = (s) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(s); };
  const N = (s) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(s); };
  const line = (x1, y1, x2, y2, w = .6) => { doc.setLineWidth(w); doc.line(x1, y1, x2, y2); };
  const boxes = (x, y, vals, w = 12, h = 14, gap = 0) => { doc.setLineWidth(.6); vals.forEach((v, i) => { doc.rect(x + i * (w + gap), y, w, h); if (v) { B(8); doc.text(String(v), x + i * (w + gap) + w / 2, y + h / 2 + 3, { align: 'center' }); } }); };
  doc.setTextColor(0, 0, 0); doc.setDrawColor(0, 0, 0);

  // Encabezado
  doc.setLineWidth(.6); doc.rect(L + 5, 22, 130, 18); if (r.folio) { B(9); doc.text(r.folio, L + 10, 35); }
  N(10); doc.text('Folio No.', R_ - 10, 50, { align: 'right' });
  const lg = await logoInfo();
  if (lg) { const [lw, lh] = fitBox(lg.w, lg.h, 150, 50); doc.addImage(lg.dataUrl, 'PNG', L + 5, 52 + (50 - lh) / 2, lw, lh, undefined, 'FAST'); }
  else { B(8); doc.setTextColor(30, 70, 110); doc.text(['Instituto de Seguridad', 'y Servicios Sociales', 'de los Trabajadores', 'del Estado'], L + 8, 64); doc.setTextColor(0, 0, 0); }
  line(L + 5, 106, 210, 106, .4);
  N(8); doc.text('Fecha y hora', 500, 68);
  N(7); ['Día', 'Mes', 'Año'].forEach((t, i) => doc.text(t, 222 + i * 26, 76)); ['Hrs', 'Min.'].forEach((t, i) => doc.text(t, 300 + i * 26, 76));
  boxes(218, 80, dateParts(r.fecha)); boxes(296, 80, timeParts(r.hora));
  B(10.5); doc.text('SOLICITUD DE REFERENCIA', 340, 106, { align: 'center' });
  doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(9.5); doc.text('Subdirección General Médica', L, 120);

  // Unidad emisora
  line(L, 124, R_, 124, .5);
  B(9.5); doc.text('Unidad Medica Emisora:', L + 10, 140); doc.text(r.unidadEmisora || '', 195, 139); line(193, 142, 435, 142);
  doc.text('Clave:', 440, 140); doc.text(r.claveEmisora || '', 478, 139); line(475, 142, R_, 142);
  doc.text('Motivos de la referencia:', L + 10, 155); doc.text(doc.splitTextToSize(r.motivo || '', 240)[0] || '', 195, 154); line(193, 157, 435, 157);
  line(L, 166, R_, 166, 2.2);

  // Paciente
  B(7.5); doc.text('Nombre del Paciente:', L + 10, 182); B(10); doc.text(doc.splitTextToSize(r.nombre || '', 230)[0] || '', 195, 182);
  B(7.5); doc.text('TEL:', 420, 180); B(8); doc.text(r.tel || '', 450, 190);
  N(7.5); doc.text('Mas.', 112, 200); doc.text('Fem.', 148, 200);
  B(7.5); doc.text('Sexo:', L + 10, 214); doc.setLineWidth(.6); doc.rect(95, 204, 88, 15);
  B(10); if (p.sexo === 'M') doc.text('X', 116, 215); if (p.sexo === 'F') doc.text('X', 152, 215);
  B(7.5); doc.text('Edad:', 192, 214); B(9); doc.text(edad !== null ? String(edad) : '', 220, 214); N(7.5); doc.text('años', 238, 214);
  B(7.5); doc.text('Expediente', 265, 214); N(8); doc.text(r.expediente || '', 312, 213); line(310, 216, 395, 216);
  B(7.5); doc.text('DOMICILIO:', 405, 210); B(6.5); doc.text(doc.splitTextToSize(r.domicilio || '', 112).slice(0, 2), 455, 208);
  line(L, 228, R_, 228, 2.2);

  // Receptora
  N(10); doc.text('Unidad Medica Receptora:', L + 10, 245);
  B(9.5); doc.text(doc.splitTextToSize(r.unidadReceptora || '', 205).slice(0, 2), 195, 245);
  N(10); doc.text('Clave:', 420, 245); N(9); doc.text(r.claveReceptora || '', 465, 244); line(460, 248, R_, 248);
  N(9.5); doc.text('El paciente se refiere a:', L, 272);
  N(6); const opts = [['consulta', 'Consulta Externa Espec:', 50, 112], ['hosp', 'Hospitalización:', 140, 188], ['estudios', 'Estudios Auxiliares de Diagnostico y Tratamiento:', 210, 352], ['rehab', 'Rehabilitación Fis:', 380, 433]];
  opts.forEach(([k, t, x, mx]) => { doc.text(t, x, 280); line(mx, 281, mx + 16, 281); if (r.refiereA === k) { B(8); doc.text('X', mx + 5, 279); N(6); } });
  doc.text('No. Traslados en el año:', 470, 280); line(538, 281, 560, 281); if (r.traslados) { B(8); doc.text(String(r.traslados), 545, 279); N(6); }
  N(7.5); doc.text('Tipo de Servicio', 268, 296); ['Día', 'Mes', 'Año'].forEach((t, i) => doc.text(t, 452 + i * 24, 296)); ['Hrs.', 'Min.'].forEach((t, i) => doc.text(t, 526 + i * 24, 296));
  B(7.5); doc.text('Servicio', L + 10, 314); B(7); doc.text(doc.splitTextToSize(r.servicio || '', 80).slice(0, 2), 100, 310); line(98, 320, 182, 320);
  B(7.5); doc.text('Primera Vez', 205, 314); doc.text('Subsecuente', 268, 314); line(318, 320, 365, 320);
  B(9); if (r.tipo === 'primera') doc.text('X', 254, 314); if (r.tipo === 'subsecuente') doc.text('X', 335, 314);
  boxes(445, 302, dateParts(r.cita?.fecha), 12, 16); boxes(522, 302, timeParts(r.cita?.hora), 12, 16);
  line(L, 330, R_, 330, 2.2);

  // Presentación del caso con ajuste automático de tamaño
  B(8); doc.text('PRESENTACION DEL CASO', 310, 344, { align: 'center' });
  const textW = R_ - L - 30, top = 354, maxBottom = 520;
  const paras = (r.presentacion || '').split('\n').map(s => s.trim()).filter(Boolean);
  let fs = 7.6, lines;
  const build = f => { doc.setFont('helvetica', 'bold'); doc.setFontSize(f); const out = []; paras.forEach((pp, i) => { if (i) out.push(''); out.push(...doc.splitTextToSize(pp, textW)); }); return out; };
  while (true) { lines = build(fs); if (top + lines.length * fs * 1.22 <= maxBottom || fs <= 5.6) break; fs -= .2; }
  const lh = fs * 1.22, fitN = Math.floor((maxBottom - top) / lh), here = lines.slice(0, fitN), rest = lines.slice(fitN);
  B(fs); here.forEach((ln, i) => doc.text(ln, L + 15, top + i * lh + fs));
  let y0 = 532;

  // Idx y resultados
  B(8); doc.text(`Idx.- ${r.idx || ultimoDx(r.patientId)}`, L + 15, y0, { maxWidth: 510 });
  line(L, y0 + 4, R_, y0 + 4); B(8); doc.text('Resultados de Laboratorio y Gabinete', L, y0 + 13); line(L, y0 + 16, R_, y0 + 16);
  N(9); doc.text(doc.splitTextToSize(r.resultados || '', 520).slice(0, 2), L + 10, y0 + 27);
  line(L, y0 + 36, R_, y0 + 36);
  let y = y0 + 44;
  N(5.5); ['Día', 'Mes', 'Año'].forEach((t, i) => { doc.text(t, 188 + i * 22, y); doc.text(t, 333 + i * 22, y); });
  N(6); doc.text('Licencia médica otorgada', L + 5, y + 12); doc.text('Desde', 150, y + 12); doc.text('Hasta', 300, y + 12);
  boxes(180, y + 3, dateParts(r.licDesde), 11, 9); boxes(325, y + 3, dateParts(r.licHasta), 11, 9);
  N(6); doc.text('Referencia por', 420, y + 10); doc.text(['Probable riesgo', 'de trabajo'], 470, y + 3); doc.text(['Riesgo de', 'trabajo'], 536, y + 3);
  doc.rect(512, y + 5, 14, 8); doc.rect(560, y + 5, 14, 8);
  B(8); if (r.riesgo === 'probable') doc.text('X', 516, y + 12); if (r.riesgo === 'riesgo') doc.text('X', 564, y + 12);

  // Firmas
  y += 22; const c1 = L, c2 = 222, c3 = 398, mid = (a, b) => (a + b) / 2;
  doc.setLineWidth(.7); doc.rect(L, y, R_ - L, 74); line(c2, y, c2, y + 74, .7); line(c3, y, c3, y + 74, .7);
  B(8); doc.text('Medico Tratante', mid(c1, c2), y + 11, { align: 'center' }); doc.text('Vo. Bo. Jefe –Inmediato', mid(c2, c3), y + 11, { align: 'center' });
  B(8); doc.text(doc.splitTextToSize(r.medico || '', 160), mid(c1, c2), y + 30, { align: 'center' });
  if (r.cedula) { N(7); doc.text(`Céd. Prof. ${r.cedula}`, mid(c1, c2), y + 50, { align: 'center' }); }
  line(c1 + 15, y + 56, c2 - 15, y + 56); N(7.5); doc.text('Nombre, Cédula Profesional y Firma', mid(c1, c2), y + 66, { align: 'center' });
  line(c2 + 6, y + 30, c3 - 6, y + 30, 1.6); B(8); doc.text(doc.splitTextToSize(r.jefe || '', 160), mid(c2, c3), y + 40, { align: 'center' });
  N(7.5); doc.text('Nombre, Cédula Profesional y Firma', mid(c2, c3), y + 66, { align: 'center' });
  y += 74;
  N(5.5); doc.text('Datos de Autorización', mid(c2, c3), y + 6, { align: 'center' }); doc.text('(Para ser llenado Exclusivamente por Director de la Unidad)', mid(c2, c3), y + 12, { align: 'center' });
  y += 14; doc.setLineWidth(.7); doc.rect(L, y, R_ - L, 80); line(c2, y, c2, y + 80, .7); line(c3, y, c3, y + 80, .7);
  N(8); doc.text('Clave de Traslado', L + 6, y + 10);
  ['A=', 'B=', 'C=', 'D='].forEach((t, i) => { doc.text(t, L + 14, y + 22 + i * 15); doc.rect(L + 32, y + 13 + i * 15, 10, 13); });
  ['0=', '1='].forEach((t, i) => { doc.text(t, L + 82, y + 37 + i * 15); doc.rect(L + 98, y + 28 + i * 15, 14, 13); });
  B(8); doc.text(['Director o responsable de la Unidad', 'Médica Emisora'], mid(c2, c3), y + 10, { align: 'center' });
  doc.text(doc.splitTextToSize(`${r.director || ''}${r.directorCargo ? ' ' + r.directorCargo : ''}`, 160), mid(c2, c3), y + 44, { align: 'center' });
  line(c2 + 15, y + 66, c3 - 15, y + 66); N(7.5); doc.text('Nombre, Cédula Profesional y Firma', mid(c2, c3), y + 75, { align: 'center' });
  N(8); doc.text('Paciente y/o Familiar', mid(c3, R_), y + 10, { align: 'center' });
  line(c3 + 12, y + 62, R_ - 12, y + 62); N(7.5); doc.text('Nombre y Firma', mid(c3, R_), y + 72, { align: 'center' });
  B(5.5); doc.text('****TODO PACIENTE DERECHOHABIENTE REFERIDO, DEBERA PRESENTAR SU ULTIMO TALON DE PAGO Y CARNET DE CITAS DE SU UNIDAD DE ADSCRIPCIÓN', L, y + 88);

  // Continuación si el texto no cupo
  if (rest.length) {
    doc.addPage(); B(9); doc.text(`PRESENTACION DEL CASO (continuación) · ${r.nombre}`, L, 50);
    B(fs); rest.forEach((ln, i) => doc.text(ln, L + 15, 70 + i * lh));
  }
  await deliver(doc.output('blob'), `Referencia_${safeName(r.nombre)}_${r.fecha}.pdf`);
}

/* --------- Solicitud de referencia: Word editable --------- */
async function docxReferencia(r) {
  const docx = await libDOCX(), w = W(docx), p = pat(r.patientId), st = S.settings;
  const edad = ageAt(p.fnac, r.fecha);
  const [d1, d2, m1, m2, y1, y2] = dateParts(r.fecha);
  const mark = b => b ? '[ X ]' : '[   ]';
  const ch = [];
  let headLeft;
  const lg = await logoInfo();
  if (lg) {
    const [lw, lh] = fitBox(lg.w, lg.h, 200, 66);
    headLeft = [new docx.Paragraph({ children: [new docx.ImageRun({ type: 'png', data: lg.bytes, transformation: { width: Math.round(lw), height: Math.round(lh) } })] })];
  }
  headLeft ??= [w.P('Instituto de Seguridad y Servicios Sociales\nde los Trabajadores del Estado', { bold: true, size: 8.5, color: '1E466E' })];
  ch.push(w.T([[w.C(headLeft, { w: 45 }), w.C([w.P(`Folio No. ${r.folio || '________'}`, { align: w.AlignmentType.RIGHT, size: 10 }),
    w.P(`Fecha y hora:  ${d1}${d2} / ${m1}${m2} / ${y1}${y2}   ${r.hora || ''} hrs`, { align: w.AlignmentType.RIGHT, size: 9, before: 60 })], { w: 55 })]]));
  ch.push(w.P('SOLICITUD DE REFERENCIA', { bold: true, size: 12, align: w.AlignmentType.CENTER, before: 120 }));
  ch.push(w.P('Subdirección General Médica', { bold: true, italic: true, size: 10, after: 80 }));
  ch.push(w.T([
    [w.C('Unidad Médica Emisora:', { bold: true, w: 26, size: 9.5 }), w.C(r.unidadEmisora, { bold: true, under: true, w: 42, size: 9.5 }), w.C('Clave:', { bold: true, w: 10, size: 9.5 }), w.C(r.claveEmisora, { bold: true, under: true, w: 22, size: 9.5 })],
    [w.C('Motivos de la referencia:', { bold: true, size: 9.5 }), w.C(r.motivo, { bold: true, under: true, size: 9.5, span: 3 })]
  ], { borders: { top: w.LINE('1A1650'), bottom: w.LINE('1A1650'), left: w.NONE, right: w.NONE, insideHorizontal: w.NONE, insideVertical: w.NONE } }));
  ch.push(w.T([
    [w.C('Nombre del Paciente:', { bold: true, w: 22, size: 8 }), w.C(r.nombre, { bold: true, size: 10.5, span: 3, w: 50 }), w.C('TEL:', { bold: true, size: 8, w: 8 }), w.C(r.tel, { bold: true, size: 8.5, w: 20 })],
    [w.C(`Sexo:   Mas. ${mark(p.sexo === 'M')}   Fem. ${mark(p.sexo === 'F')}`, { bold: true, size: 8 }), w.C(`Edad: ${edad ?? ''} años`, { bold: true, size: 8.5 }), w.C(`Expediente: ${r.expediente || ''}`, { bold: true, size: 8.5, span: 2 }), w.C(`DOMICILIO: ${r.domicilio || ''}`, { bold: true, size: 7.5, span: 2 })]
  ], { borders: { top: w.NONE, bottom: w.LINE('1A1650'), left: w.NONE, right: w.NONE, insideHorizontal: w.NONE, insideVertical: w.NONE } }));
  ch.push(w.T([[w.C('Unidad Médica Receptora:', { size: 10, w: 26 }), w.C(r.unidadReceptora, { bold: true, size: 10, w: 44 }), w.C('Clave:', { size: 10, w: 10 }), w.C(r.claveReceptora, { under: true, size: 10, w: 20 })]]));
  ch.push(w.P('El paciente se refiere a:', { size: 10, before: 80 }));
  ch.push(w.P(`Consulta Externa Espec: ${mark(r.refiereA === 'consulta')}    Hospitalización: ${mark(r.refiereA === 'hosp')}    Estudios Auxiliares de Diagnóstico y Tratamiento: ${mark(r.refiereA === 'estudios')}    Rehabilitación Fís: ${mark(r.refiereA === 'rehab')}    No. Traslados en el año: ${r.traslados || '___'}`, { size: 7.5, after: 60 }));
  const [cd1, cd2, cm1, cm2, cy1, cy2] = dateParts(r.cita?.fecha);
  ch.push(w.T([[w.C(`Servicio:  ${r.servicio || ''}`, { bold: true, size: 8.5, w: 40 }), w.C(`Primera Vez ${mark(r.tipo === 'primera')}    Subsecuente ${mark(r.tipo === 'subsecuente')}`, { bold: true, size: 8.5, w: 35 }),
    w.C(`Cita: ${r.cita?.fecha ? `${cd1}${cd2}/${cm1}${cm2}/${cy1}${cy2}` : '__/__/__'}  ${r.cita?.hora || '__:__'}`, { size: 8.5, w: 25 })]],
    { borders: { top: w.NONE, bottom: w.LINE('1A1650'), left: w.NONE, right: w.NONE, insideHorizontal: w.NONE, insideVertical: w.NONE } }));
  ch.push(w.P('PRESENTACIÓN DEL CASO', { bold: true, size: 9, align: w.AlignmentType.CENTER, before: 140, after: 80 }));
  (r.presentacion || '').split('\n').filter(s => s.trim()).forEach(pp => ch.push(w.P(pp.trim(), { bold: true, size: 8.5, align: w.AlignmentType.JUSTIFIED, after: 80 })));
  ch.push(w.P(`Idx.- ${r.idx || ultimoDx(r.patientId)}`, { bold: true, size: 9, before: 60, after: 60 }));
  ch.push(w.T([[w.C('Resultados de Laboratorio y Gabinete', { bold: true, size: 8.5 })], [w.C(r.resultados || '', { size: 9 })]], { borders: { top: w.LINE('1A1650'), bottom: w.LINE('1A1650'), left: w.NONE, right: w.NONE, insideHorizontal: w.LINE('1A1650'), insideVertical: w.NONE } }));
  const fd = s => s ? fmtShort(s) : '__/__/__';
  ch.push(w.P(`Licencia médica otorgada   Desde: ${fd(r.licDesde)}   Hasta: ${fd(r.licHasta)}        Referencia por:  Probable riesgo de trabajo ${mark(r.riesgo === 'probable')}   Riesgo de trabajo ${mark(r.riesgo === 'riesgo')}`, { size: 7.5, before: 80, after: 100 }));
  const sig = (title, name, extra = '') => [w.P(title, { bold: true, size: 8.5, align: w.AlignmentType.CENTER }), w.P(name || '', { bold: true, size: 8.5, align: w.AlignmentType.CENTER, before: 160 }), ...(extra ? [w.P(extra, { size: 7.5, align: w.AlignmentType.CENTER })] : []),
    w.P('______________________________', { align: w.AlignmentType.CENTER, before: 200 }), w.P('Nombre, Cédula Profesional y Firma', { size: 7.5, align: w.AlignmentType.CENTER })];
  ch.push(w.T([[w.C(sig('Médico Tratante', r.medico, r.cedula ? `Céd. Prof. ${r.cedula}` : ''), { w: 33, borders: w.box }), w.C(sig('Vo. Bo. Jefe Inmediato', r.jefe), { w: 34, borders: w.box }), w.C([w.P('')], { w: 33, borders: w.box })]], { borders: w.grid }));
  ch.push(w.P('Datos de Autorización\n(Para ser llenado exclusivamente por Director de la Unidad)', { size: 6.5, align: w.AlignmentType.CENTER, before: 60, after: 40 }));
  ch.push(w.T([[
    w.C([w.P('Clave de Traslado', { size: 8.5 }), w.P('A= [  ]      0= [  ]', { size: 8.5, before: 60 }), w.P('B= [  ]      1= [  ]', { size: 8.5 }), w.P('C= [  ]', { size: 8.5 }), w.P('D= [  ]', { size: 8.5 })], { w: 33, borders: w.box }),
    w.C([w.P('Director o responsable de la Unidad Médica Emisora', { bold: true, size: 8.5, align: w.AlignmentType.CENTER }), w.P(`${r.director || ''}${r.directorCargo ? '\n' + r.directorCargo : ''}`, { bold: true, size: 8.5, align: w.AlignmentType.CENTER, before: 160 }),
      w.P('______________________________', { align: w.AlignmentType.CENTER, before: 160 }), w.P('Nombre, Cédula Profesional y Firma', { size: 7.5, align: w.AlignmentType.CENTER })], { w: 34, borders: w.box }),
    w.C([w.P('Paciente y/o Familiar', { size: 8.5, align: w.AlignmentType.CENTER }), w.P('______________________________', { align: w.AlignmentType.CENTER, before: 700 }), w.P('Nombre y Firma', { size: 7.5, align: w.AlignmentType.CENTER })], { w: 33, borders: w.box })
  ]], { borders: w.grid }));
  ch.push(w.P('****TODO PACIENTE DERECHOHABIENTE REFERIDO, DEBERÁ PRESENTAR SU ÚLTIMO TALÓN DE PAGO Y CARNET DE CITAS DE SU UNIDAD DE ADSCRIPCIÓN', { bold: true, size: 6, before: 60 }));
  await deliver(await docxBlob(docx, ch), `Referencia_${safeName(r.nombre)}_${r.fecha}.docx`);
}

/* --------- respaldo --------- */
async function exportBackup() {
  S.settings.lastBackup = new Date().toISOString(); await save(true);
  const blob = new Blob([JSON.stringify(S)], { type: 'application/json' });
  await deliver(blob, `Respaldo_consultorio_${iso(new Date())}.json`);
  render();
}
/* --------- importar: un solo flujo que reconoce el tipo de archivo --------- */
function avisoBox(title, msg) {
  const sh = openSheet(`<div class="shead"><h2>${esc(title)}</h2></div><p>${esc(msg)}</p>
    <div class="row" style="justify-content:flex-end;margin-top:18px"><button class="btn primary" data-ok>Entendido</button></div>`, { small: true });
  $('[data-ok]', sh).onclick = closeSheet;
}
async function leerArchivo(file) {
  let txt = await file.text();
  txt = txt.replace(/^\uFEFF/, '').trim();
  let data;
  try { data = JSON.parse(txt); }
  catch (e) { throw new Error(`«${file.name}» no se pudo leer como archivo de la app. Asegúrate de elegir el archivo .json original (sin abrirlo ni editarlo antes).`); }
  if (data && data.formato === 'consultorio-issste/pacientes' && Array.isArray(data.pacientes)) return { tipo: 'pacientes', data };
  if (data && Array.isArray(data.patients) && Array.isArray(data.consultas) && data.settings) return { tipo: 'respaldo', data };
  throw new Error(`«${file.name}» no es un respaldo ni un archivo de pacientes de esta app.`);
}
async function importarArchivo(file) {
  if (!file) return;
  try {
    const { tipo, data } = await leerArchivo(file);
    if (tipo === 'pacientes') await aplicarPacientes(data); else await aplicarRespaldo(data);
  } catch (e) { console.error(e); avisoBox('No se pudo abrir el archivo', e.message); }
}
const importPacientes = importarArchivo, importBackup = importarArchivo;

async function aplicarPacientes(data) {
  const base = e => norm(e).split('/')[0];
  let nuevos = 0, completados = 0;
  const plan = data.pacientes.map(x => {
    const ex = S.patients.find(p => norm(p.nombre) === norm(x.nombre) && (!p.expediente || !x.expediente || base(p.expediente) === base(x.expediente)));
    ex ? completados++ : nuevos++; return [x, ex];
  });
  if (!await confirmBox(`Es un archivo de pacientes. Se agregarán ${nuevos} pacientes nuevos y se completarán ${completados} que ya existen. No se borra nada.`, { ok: 'Importar', title: 'Importar pacientes' })) return;
  plan.forEach(([x, ex]) => {
    const tipo = (x.tipo === '' || x.tipo === null || x.tipo === undefined) ? '' : Number(x.tipo);
    if (ex) {
      if (!ex.expediente && x.expediente) ex.expediente = x.expediente;
      if ((ex.tipo === '' || ex.tipo === undefined) && tipo !== '') ex.tipo = tipo;
      if (!ex.sexo && x.sexo) ex.sexo = x.sexo;
      if (!ex.fnac && x.fnac) { ex.fnac = x.fnac; ex.fnacAprox = !!x.fnacAprox; }
      if (x.origen && !ex.origen) ex.origen = x.origen;
    } else {
      S.patients.push({ id: uid(), nombre: x.nombre, expediente: x.expediente || '', fnac: x.fnac || '', fnacAprox: !!x.fnacAprox, sexo: x.sexo || '', tipo,
        tel: '', domicilio: '', antecedentes: {}, origen: x.origen || null, createdAt: new Date().toISOString() });
    }
  });
  if (Array.isArray(data.diagnosticos)) {
    const m = new Map((S.dxPrevios || []).map(d => [norm(d.label), d]));
    data.diagnosticos.forEach(d => { const k = norm(d.label); if (m.has(k)) m.get(k).n = Math.max(m.get(k).n, d.n); else m.set(k, { label: d.label, n: d.n }); });
    S.dxPrevios = [...m.values()];
  }
  await save(true); toast(`Listo: ${nuevos} nuevos, ${completados} completados`); soloRevisar = false; go('#/pacientes');
}
async function aplicarRespaldo(data) {
  if (!await confirmBox(`Es un respaldo completo con ${data.patients.length} pacientes y ${data.consultas.length} consultas. Reemplazará todo lo que hay ahora en este iPad.`, { ok: 'Restaurar', danger: true, title: 'Restaurar respaldo' })) return;
  S = migrate(data); await save(true); toast('Respaldo restaurado'); go('#/hoy');
}

/* =========================================================================
   PIN
   ========================================================================= */
async function hashPin(pin) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('consultorio-issste:' + pin));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function pinPad(title, sub, onDone) {
  const host = $('#lock'); let v = '';
  host.innerHTML = `<div class="lock" style="background:linear-gradient(160deg,var(--violeta) 35%,var(--ocaso) 150%)"><div class="lockcard glass">
    <div style="color:#fff">${IC.lock.replace('<svg', '<svg width="34" height="34"')}</div><h2>${title}</h2><div class="small" style="color:rgba(255,255,255,.85)" id="lsub">${sub}</div>
    <div class="dots" id="dots">${'<i></i>'.repeat(4)}</div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(k => k === '' ? '<span></span>' : `<button data-k="${k}" aria-label="${k === '⌫' ? 'Borrar' : k}">${k}</button>`).join('')}</div>
    ${title !== 'Consultorio bloqueado' ? '<button class="btn onglass" id="pcancel" style="margin-top:18px">Cancelar</button>' : ''}</div></div>`;
  const dots = () => $$('#dots i').forEach((d, i) => d.classList.toggle('f', i < v.length));
  const press = async k => {
    if (k === '⌫') v = v.slice(0, -1); else if (v.length < 4) v += k;
    dots();
    if (v.length === 4) {
      const ok = await onDone(v);
      if (ok === false) { $('#dots').classList.add('shake'); setTimeout(() => { v = ''; dots(); $('#dots')?.classList.remove('shake'); }, 420); }
      else if (ok !== true) { v = ''; setTimeout(dots, 150); }
    }
  };
  $$('[data-k]', host).forEach(b => b.onclick = () => press(b.dataset.k));
  $('#pcancel') && ($('#pcancel').onclick = clearLock);
  host._key = e => { if (/^\d$/.test(e.key)) press(e.key); if (e.key === 'Backspace') press('⌫'); };
  document.addEventListener('keydown', host._key);
}
function clearLock() { const h = $('#lock'); document.removeEventListener('keydown', h._key); h.innerHTML = ''; }
function showLock() {
  pinPad('Consultorio bloqueado', 'Escribe tu PIN', async v => { if (await hashPin(v) === S.settings.pinHash) { clearLock(); return true; } return false; });
}
function setPin() {
  let first = '';
  pinPad('Nuevo PIN', 'Escribe 4 dígitos', async v => {
    if (!first) { first = v; $('#lsub').textContent = 'Confírmalo'; return 'next'; }
    if (v !== first) { first = ''; $('#lsub').textContent = 'No coincidió, empieza de nuevo'; return false; }
    S.settings.pinHash = await hashPin(v); save(); clearLock(); toast('PIN guardado'); render(); return true;
  });
}

/* =========================================================================
   ARRANQUE
   ========================================================================= */
function migrate(d) {
  const base = defaults();
  d.settings = { ...base.settings, ...(d.settings || {}) };
  if (!Array.isArray(d.settings.tipos) || d.settings.tipos.length !== 10) d.settings.tipos = Array(10).fill('');
  d.patients ??= []; d.consultas ??= []; d.referencias ??= []; d.dxPrevios ??= [];
  if (!Array.isArray(d.suive) || !d.suive.length) d.suive = base.suive;
  return d;
}
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); if (S) save(true); }
  else if (S?.settings.pinHash && hiddenAt && Date.now() - hiddenAt > 5 * 60e3 && !$('#lock').innerHTML) showLock();
});

(async function init() {
  try { S = await Store.get('db'); } catch (e) { console.error(e); }
  S = migrate(S || defaults());
  await save(true);
  navigator.storage?.persist?.();
  if (S.settings.pinHash) showLock();
  if (!location.hash) location.replace('#/hoy');
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
})();
