import './style.css';
import { api, chat, session, ApiError, registrarCheckin } from './api.js';
import { escena, ICONOS_CATEGORIA } from './escena.js';

const TELEGRAM_BOT = import.meta.env.VITE_TELEGRAM_BOT || '';
const app = document.getElementById('app');

// ---------- utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

const fallbackImg = (c) => `/img/cat-${ICONOS_CATEGORIA[slug(c)] && slug(c) !== 'otra' ? slug(c) : 'default'}.svg`;
const iconoCat = (c) => ICONOS_CATEGORIA[slug(c)] || ICONOS_CATEGORIA.otra;

const svg = (d) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  reloj: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  lugar: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  atras: svg('<path d="M15 18l-6-6 6-6"/>'),
  correo: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  campana: svg('<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  fila: svg('<path d="M4 6h16M4 12h10M4 18h6"/>'),
  boleta: svg('<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 5v12" stroke-dasharray="2 2"/>'),
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const TZ = 'America/Bogota';
const fechaEvento = (fecha, hora) => new Date(`${fecha}T${String(hora || '00:00').slice(0, 5)}:00-05:00`);
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const manana = () => new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: TZ });

function fechaLarga(fecha, hora) {
  const d = fechaEvento(fecha, hora);
  if (isNaN(d)) return `${fecha} ${hora || ''}`;
  return d.toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: TZ });
}
function horaCorta(fecha, hora) {
  const d = fechaEvento(fecha, hora);
  return isNaN(d) ? String(hora || '') : d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
}
function diaSemana(fecha) {
  const d = fechaEvento(fecha, '12:00');
  return isNaN(d) ? '' : d.toLocaleDateString('es-CO', { weekday: 'long', timeZone: TZ });
}
function diaLargo(fecha) {
  const d = fechaEvento(fecha, '12:00');
  return isNaN(d) ? fecha : d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
}
function diasPara(fecha, hora) { return (fechaEvento(fecha, hora) - new Date()) / 86400000; }
function relativo(fecha) {
  if (fecha === hoyISO()) return 'Hoy';
  if (fecha === manana()) return 'Mañana';
  return '';
}
function cuandoEs(e) {
  const d = diasPara(e.fecha, e.hora);
  if (d < 0 || d > 3) return '';
  return relativo(e.fecha) ? `Es ${relativo(e.fecha).toLowerCase()}` : `Faltan ${Math.ceil(d)} días`;
}
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'err' ? 'alert' : 'status');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

const loader = (txt = 'Cargando…') => `<div class="loader"><span class="spinner"></span><p>${esc(txt)}</p></div>`;
const errorBox = (err, retry = true) => `
  <div class="error-box">
    <p><strong>${esc(err.message || 'Algo salió mal')}</strong></p>
    ${retry ? '<button class="btn btn-sm" data-retry>Intentar de nuevo</button>' : ''}
  </div>`;

function bindRetry(fn, root = app) { root.querySelector('[data-retry]')?.addEventListener('click', fn); }

// Botón con estado de carga mientras se ejecuta la acción
async function withLoading(btn, fn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Un momento…';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = original; }
}

// ---------- catálogo en caché (se muestra al instante y se refresca en segundo plano) ----------
const CACHE_KEY = 'ep_catalogo';
const cache = {
  get() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')?.data || null; } catch { return null; } },
  set(data) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data })); } catch { /* sin storage */ } },
  evento(id) { return this.get()?.find((e) => e.evento_id === id) || null; },
  // Refleja al instante una inscripción confirmada (+1) o cancelada (-1) mientras llega el dato real
  ajustarCupos(eventoId, cambio) {
    const eventos = this.get();
    const e = eventos?.find((x) => x.evento_id === eventoId);
    if (!e) return;
    e.inscritos_confirmados = Math.max(0, e.inscritos_confirmados + cambio);
    e.cupos_disponibles = Math.max(0, e.capacidad - e.inscritos_confirmados);
    e.lleno = e.cupos_disponibles === 0;
    this.set(eventos);
  },
};
// Una sola petición en vuelo: la portada y el arranque comparten la misma respuesta
let catalogoEnVuelo = null;
function pedirCatalogo() {
  catalogoEnVuelo ||= api.listado()
    .then((r) => { cache.set(r.data); return r.data; })
    .finally(() => { setTimeout(() => { catalogoEnVuelo = null; }, 0); });
  return catalogoEnVuelo;
}

// ---------- modal ----------
const modal = document.getElementById('modal');
function openModal(html) {
  modal.innerHTML = `<div class="card panel">${html}</div>`;
  modal.classList.remove('hidden');
  modal.querySelector('input, textarea, button')?.focus();
  return modal;
}
function closeModal() { modal.classList.add('hidden'); modal.innerHTML = ''; }
modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); cerrarChat(); } });

function confirmar(titulo, texto, okLabel = 'Sí, continuar', danger = false) {
  return new Promise((resolve) => {
    const m = openModal(`<h2>${esc(titulo)}</h2><p>${esc(texto)}</p>
      <div class="actions"><button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="mOk">${esc(okLabel)}</button></div>`);
    m.querySelector('#mOk').onclick = () => { closeModal(); resolve(true); };
    m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => resolve(false)));
  });
}

// ---------- navegación ----------
const menuToggle = document.getElementById('menuToggle');
const nav = document.getElementById('nav');
const inicial = (n) => esc((n || '?').trim().charAt(0).toUpperCase());
function renderNav() {
  const u = session.user;
  nav.innerHTML = u
    ? `<span class="who"><span class="avatar" aria-hidden="true">${inicial(u.nombre)}</span>Hola, ${esc(u.nombre?.split(' ')[0] || '')}</span>
       <a href="#/">Eventos</a><a href="#/mis-inscripciones">Mis inscripciones</a><a href="#/perfil">Perfil</a><a href="#/checkin">Check-in</a><button id="logoutBtn">Salir</button>`
    : `<a href="#/">Eventos</a><a href="#/checkin">Check-in</a><a href="#/login">Entrar</a><a href="#/registro" class="cta">Crear cuenta</a>`;
  const h = location.hash || '#/';
  nav.querySelectorAll('a').forEach((a) => {
    const activo = a.getAttribute('href') === h && !a.classList.contains('cta');
    a.classList.toggle('active', activo);
    if (activo) a.setAttribute('aria-current', 'page');
  });
  nav.querySelector('#logoutBtn')?.addEventListener('click', logout);
}
const cerrarMenu = () => { nav.classList.remove('open'); menuToggle.setAttribute('aria-expanded', 'false'); };
menuToggle.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => { if (nav.classList.contains('open') && !e.target.closest('.topbar')) cerrarMenu(); });

async function logout() {
  try { await api.logout(); } catch { /* aunque falle, cerramos localmente */ }
  session.clear();
  toast('Cerraste sesión');
  location.hash = '#/';
  renderNav();
}

function requireAuth() {
  if (session.token) return true;
  sessionStorage.setItem('ep_after_login', location.hash);
  toast('Inicia sesión para continuar', 'err');
  location.hash = '#/login';
  return false;
}

// ---------- boletas de evento ----------
function cupos(e) {
  if (e.estado === 'CANCELADO') return '<div class="seats off"><strong>Evento cancelado</strong></div>';
  if (e.estado === 'CERRADO') return '<div class="seats off"><strong>Inscripciones cerradas</strong></div>';
  const pct = e.capacidad ? Math.min(100, Math.round((e.inscritos_confirmados / e.capacidad) * 100)) : 0;
  const texto = e.lleno
    ? '<strong>Lleno</strong>, hay lista de espera'
    : `<strong>${e.cupos_disponibles} ${e.cupos_disponibles === 1 ? 'cupo libre' : 'cupos libres'}</strong> de ${e.capacidad}`;
  return `<div class="seats ${e.lleno ? 'full' : 'ok'}"><span>${texto}</span>
    <div class="meter" role="img" aria-label="${pct}% de los cupos ocupados"><span style="width:${pct}%"></span></div></div>`;
}

function talon(fecha) {
  return `<div class="stub" aria-hidden="true">
      <span class="day">${Number(String(fecha).slice(8, 10)) || ''}</span>
      <span class="month">${MESES[Number(String(fecha).slice(5, 7)) - 1] || ''}</span>
      <span class="wd">${esc(diaSemana(fecha).slice(0, 3))}</span>
    </div>`;
}

function boleta(e, { big = false } = {}) {
  const off = e.estado !== 'PUBLICADO';
  const pronto = off ? '' : cuandoEs(e);
  return `<a class="ticket ${big ? 'big' : ''} ${off ? 'off' : ''}" href="#/evento/${encodeURIComponent(e.evento_id)}">
    ${talon(e.fecha)}
    <div class="ticket-body">
      <span class="cat">${iconoCat(e.categoria)}${esc(e.categoria)}${pronto ? `<span class="soon">${pronto}</span>` : ''}</span>
      <h3>${esc(e.nombre)}</h3>
      <div class="facts">
        <span class="sr-only">${esc(fechaLarga(e.fecha, e.hora))}</span>
        <span>${ICON.reloj}${esc(horaCorta(e.fecha, e.hora))}</span>
        <span>${ICON.lugar}${esc(e.lugar)}</span>
      </div>
      ${cupos(e)}
    </div>
  </a>`;
}

// El evento destacado es el próximo con inscripciones abiertas
function proximo(eventos) {
  return eventos.filter((e) => e.estado === 'PUBLICADO' && diasPara(e.fecha, e.hora) > 0)
    .sort((a, b) => fechaEvento(a.fecha, a.hora) - fechaEvento(b.fecha, b.hora))[0];
}

// Boleta a lo ancho para la agenda: el día ya está en el encabezado, así que el talón muestra la hora
function boletaAgenda(e) {
  const [hora, ...resto] = horaCorta(e.fecha, e.hora).replace(/\s+/g, ' ').split(' ');
  const ampm = resto.join(' ');
  return `<a class="ticket wide" href="#/evento/${encodeURIComponent(e.evento_id)}">
    <div class="stub" aria-hidden="true"><span class="hora">${esc(hora)}</span><span class="ampm">${esc(ampm || '')}</span></div>
    <div class="ticket-body">
      <div class="info">
        <span class="cat">${iconoCat(e.categoria)}${esc(e.categoria)}</span>
        <h3>${esc(e.nombre)}</h3>
        <div class="facts"><span class="sr-only">${esc(fechaLarga(e.fecha, e.hora))}</span><span>${ICON.lugar}${esc(e.lugar)}</span></div>
        <p class="resumen">${esc(e.descripcion)}</p>
      </div>
      <div class="lado">${cupos(e)}<span class="ver">Ver evento ${ICON.atras}</span></div>
    </div>
  </a>`;
}

// Agenda: eventos agrupados por día
function agenda(eventos) {
  const dias = new Map();
  for (const e of eventos) { if (!dias.has(e.fecha)) dias.set(e.fecha, []); dias.get(e.fecha).push(e); }
  return `<div class="agenda">${[...dias].map(([fecha, lista]) => {
    const rel = relativo(fecha);
    return `<section class="dia" aria-label="${esc(diaLargo(fecha))}">
      <h3 class="dia-head">${rel ? `<span class="rel">${rel}</span>` : ''}
        <span class="num">${Number(fecha.slice(8, 10))}</span>
        <span class="wd">${esc(capital(diaSemana(fecha)))}</span>
        <span class="mes">${esc(MESES_LARGOS[Number(fecha.slice(5, 7)) - 1])}</span></h3>
      <div class="dia-lista">${lista.map(boletaAgenda).join('')}</div>
    </section>`;
  }).join('')}</div>`;
}
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const skeletonAgenda = `<div class="agenda">${`<section class="dia"><div class="skeleton line" style="width:7rem;min-height:3rem"></div>
  <div class="dia-lista"><div class="skeleton" style="min-height:130px"></div></div></section>`.repeat(2)}</div>`;

// ---------- vistas ----------
let categoriaActiva = '';

function viewHome() {
  app.innerHTML = `
    <section class="hero">
      ${escena}
      <div class="hero-inner">
        <div>
          <h1>Noche de Brujas en <span>San Gil</span></h1>
          <p class="lead">Cine de terror, talleres de calabazas, leyendas del Fonce y el desfile de disfraces. Reserva tu cupo y te avisamos por Gmail y Telegram.</p>
          <div class="actions">
            <a class="btn btn-primary" href="#eventos">Ver la agenda</a>
            ${session.user ? '<a class="btn" href="#/mis-inscripciones">Mis inscripciones</a>' : '<a class="btn" href="#/registro">Crear cuenta</a>'}
          </div>
        </div>
        <div id="destacado"><p class="featured-label">El próximo evento</p><div class="skeleton big"></div></div>
      </div>
    </section>
    <div class="section-head with-filters" id="eventos">
      <h2>Agenda</h2>
      <div class="filters scroll" id="chips" role="group" aria-label="Filtrar por categoría"></div>
    </div>
    <div id="lista" aria-live="polite">${skeletonAgenda}</div>
    <ol class="pasos" aria-label="Cómo reservar">
      <li><strong>Crea tu cuenta</strong><p>Confirma tu correo con el código de 6 dígitos que te enviamos.</p></li>
      <li><strong>Vincula Telegram</strong><p>Desde tu perfil, con un código para el bot. Así te llegan los avisos al instante.</p></li>
      <li><strong>Reserva tu cupo</strong><p>Si el evento está lleno, entras a la lista de espera y te avisamos cuando se libere un cupo.</p></li>
    </ol>`;

  let todos = cache.get();

  const pintar = (data) => {
    const lista = document.getElementById('lista');
    if (!lista) return; // el usuario ya cambió de vista
    const cuenta = {};
    for (const e of todos) cuenta[e.categoria] = (cuenta[e.categoria] || 0) + 1;
    const chips = document.getElementById('chips');
    chips.innerHTML = [['', todos.length], ...Object.entries(cuenta).sort()].map(([c, n]) =>
      `<button class="chip" data-cat="${esc(c)}" aria-pressed="${c === categoriaActiva}">${c ? iconoCat(c) + esc(c) : 'Todas'}<span class="n">${n}</span></button>`).join('');
    chips.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => filtrar(b.dataset.cat)));

    const prox = proximo(todos);
    document.getElementById('destacado').innerHTML = prox ? `<p class="featured-label">El próximo evento</p>${boleta(prox, { big: true })}` : '';

    lista.innerHTML = data.length
      ? agenda(data)
      : '<div class="empty"><p>No hay eventos de esta categoría por ahora.</p><button class="btn btn-sm" data-cat-reset>Ver toda la agenda</button></div>';
    lista.querySelector('[data-cat-reset]')?.addEventListener('click', () => filtrar(''));
  };
  const local = (cat) => (cat ? todos.filter((e) => slug(e.categoria) === slug(cat)) : todos);

  // El filtro responde al instante con los datos que ya tenemos y luego confirma con n8n
  const filtrar = async (cat) => {
    categoriaActiva = cat;
    pintar(local(cat));
    if (!cat) return;
    try {
      const r = (await api.filtro(cat)).data;
      if (categoriaActiva === cat) pintar(r);
    } catch { /* se queda con el filtro local */ }
  };

  const cargar = async () => {
    try {
      todos = await pedirCatalogo();
      filtrar(categoriaActiva);
    } catch (err) {
      if (todos) return toast('No pudimos actualizar la agenda; mostramos la última que vimos.', 'err');
      const lista = document.getElementById('lista');
      if (!lista) return;
      document.getElementById('destacado').innerHTML = '';
      lista.innerHTML = errorBox(err);
      bindRetry(() => { lista.innerHTML = skeletonAgenda; cargar(); }, lista);
    }
  };

  if (todos) pintar(local(categoriaActiva));
  cargar();
}

async function viewEvento(id) {
  const pintar = (e) => {
    const abierto = e.estado === 'PUBLICADO' && diasPara(e.fecha, e.hora) > 0;
    const textoBoton = e.lleno ? 'Entrar a la lista de espera' : 'Reservar mi cupo';
    app.innerHTML = `
      <a href="#/" class="back">${ICON.atras}Agenda</a>
      <div class="detail-banner"><img src="${esc(e.imagen_url || fallbackImg(e.categoria))}" alt="" decoding="async" fetchpriority="high" onerror="this.onerror=null;this.src='${fallbackImg(e.categoria)}'"></div>
      <div class="detail">
        <article>
          <span class="cat">${iconoCat(e.categoria)}${esc(e.categoria)}</span>
          <h1>${esc(e.nombre)}</h1>
          <p class="organiza">Organiza ${esc(e.organizador)}</p>
          <p class="desc">${esc(e.descripcion)}</p>
        </article>
        <aside class="card panel">
          <div class="facts">
            <span>${ICON.reloj}<span>${esc(capital(fechaLarga(e.fecha, e.hora)))}${cuandoEs(e) ? `<span class="soon">${cuandoEs(e)}</span>` : ''}</span></span>
            <span>${ICON.lugar}${esc(e.lugar)}</span>
          </div>
          ${cupos(e)}
          ${abierto
            ? `<button class="btn btn-primary btn-block btn-reservar" data-reservar>${textoBoton}</button>
               <p class="hint">Necesitas una cuenta con Telegram vinculado. La confirmación te llega por Gmail y Telegram.</p>`
            : '<p class="hint">Este evento ya no recibe inscripciones.</p>'}
        </aside>
      </div>
      ${abierto ? `<div class="reserve-bar">${cupos(e)}<button class="btn btn-primary" data-reservar>${e.lleno ? 'Lista de espera' : 'Reservar'}</button></div>` : ''}`;
    document.body.classList.toggle('has-bar', abierto);
    app.querySelectorAll('[data-reservar]').forEach((b) => b.addEventListener('click', () => inscribir(e)));
  };

  const previo = cache.evento(id);
  if (previo) pintar(previo); else app.innerHTML = loader('Cargando el evento…');
  try {
    const e = (await api.detalle(id)).data;
    if (location.hash === `#/evento/${encodeURIComponent(id)}` || location.hash === `#/evento/${id}`) pintar(e);
  } catch (err) {
    if (previo && err.code !== 'NO_ENCONTRADO') return;
    document.body.classList.remove('has-bar');
    app.innerHTML = `<a href="#/" class="back">${ICON.atras}Agenda</a>${errorBox(err)}`;
    bindRetry(() => viewEvento(id));
  }
}

function inscribir(e) {
  if (!requireAuth()) return;
  const m = openModal(`<h2>${e.lleno ? 'Entrar a la lista de espera' : 'Reservar cupo'}</h2><p class="hint">${esc(e.nombre)}</p>
    <form class="form" id="fIns" style="margin-top:1rem">
      <div class="field"><label for="na">Nombre en la acreditación</label><input id="na" maxlength="80" autocomplete="name" value="${esc(session.user?.nombre || '')}"></div>
      <div class="field"><label for="ob">Observaciones (opcional)</label><textarea id="ob" maxlength="200" rows="3" placeholder="Disfraz, alergias, acompañantes…"></textarea></div>
      <div class="actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="okIns">Confirmar</button></div>
    </form>`);
  m.querySelector('#fIns').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const r = await withLoading(m.querySelector('#okIns'), () => api.inscribir(e.evento_id, {
        nombre_acreditacion: m.querySelector('#na').value.trim(), observaciones: m.querySelector('#ob').value.trim(),
      }));
      closeModal();
      if (r.data.estado === 'CONFIRMADA') cache.ajustarCupos(e.evento_id, 1);
      pedirCatalogo().catch(() => { /* la agenda lo reintenta al abrirse */ });
      toast(r.data.estado === 'CONFIRMADA' ? 'Cupo confirmado. Te llegó el aviso por Gmail y Telegram.' : `El evento está lleno: quedaste en la lista de espera (puesto ${r.data.orden_espera}).`);
      location.hash = '#/mis-inscripciones';
    } catch (err) {
      if (err.code === 'TELEGRAM_NO_VINCULADO') {
        closeModal();
        if (await confirmar('Falta vincular Telegram', 'Para inscribirte necesitas vincular tu Telegram. Se hace en tu perfil y toma un minuto.', 'Ir a mi perfil')) location.hash = '#/perfil';
      } else toast(err.message, 'err');
    }
  });
}

// Panel lateral de las pantallas de cuenta (solo en pantallas anchas)
const PERKS = `<ul class="perks">
  <li><span class="icon-wrap">${ICON.boleta}</span><div><strong>Reserva en segundos</strong><span>Tu cupo queda confirmado al instante si hay disponibilidad.</span></div></li>
  <li><span class="icon-wrap">${ICON.fila}</span><div><strong>Lista de espera automática</strong><span>Si se libera un cupo, pasa a la siguiente persona por orden de llegada.</span></div></li>
  <li><span class="icon-wrap">${ICON.campana}</span><div><strong>Avisos por Gmail y Telegram</strong><span>Confirmaciones y recordatorios un día y una hora antes.</span></div></li>
</ul>`;
const authLayout = (lado, form) => `<div class="auth">
  <div class="auth-side">${lado}</div>
  <div class="auth-form card panel">${form}</div></div>`;

function viewLogin() {
  app.innerHTML = authLayout(
    `<h1>Tus eventos de Halloween, en un solo lugar</h1><p class="lead">Entra para reservar, revisar tus inscripciones y vincular Telegram.</p>${PERKS}`,
    `<h2>Entrar</h2><p class="sub">Con el email y la contraseña de tu cuenta.</p>
    <form class="form" id="f">
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" inputmode="email" required></div>
      <div class="field"><label for="pw">Contraseña</label><input id="pw" type="password" autocomplete="current-password" required></div>
      <button class="btn btn-primary btn-block" id="ok">Entrar</button>
      <p class="hint center"><a href="#/recuperar">¿Olvidaste tu contraseña?</a></p>
      <p class="hint center">¿No tienes cuenta? <a href="#/registro">Créala aquí</a></p>
    </form>`);
  document.getElementById('f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = document.getElementById('email').value.trim();
    const pw = document.getElementById('pw').value;
    try {
      await withLoading(document.getElementById('ok'), () => doLogin(email, pw));
    } catch (err) {
      if (err.code === 'CUENTA_NO_VERIFICADA') return irAVerificar(email, pw, err.message);
      toast(err.message, 'err');
    }
  });
}

// ---------- verificación de email y recuperación de cuenta ----------
// Credenciales del registro en memoria (nunca en storage) para entrar solo al verificar
let pendiente = null;

function irAVerificar(email, password, aviso) {
  pendiente = { email, password };
  try { sessionStorage.setItem('ep_verificar', email); } catch { /* sin storage */ }
  if (aviso) toast(aviso, 'err');
  location.hash = '#/verificar';
}

// Botón "Reenviar código" con espera de 60 s entre envíos
function botonReenviar(btn, enviar) {
  let timer;
  const esperar = (s) => {
    clearInterval(timer);
    btn.disabled = true;
    const tick = () => {
      btn.textContent = s > 0 ? `Reenviar en ${s} s` : 'Reenviar código';
      if (s-- <= 0) { clearInterval(timer); btn.disabled = false; }
    };
    tick(); timer = setInterval(tick, 1000);
  };
  btn.addEventListener('click', async () => {
    try {
      const r = await withLoading(btn, enviar);
      toast(r.message);
      esperar(60);
    } catch (err) {
      const s = Number((err.message.match(/(\d+) segundos/) || [])[1]);
      toast(err.message, 'err');
      if (s) esperar(s);
    }
  });
  return esperar;
}

const campoCodigo = `<div class="field"><label for="codigo">Código de 6 dígitos</label>
  <input id="codigo" class="code" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" required></div>`;

function viewVerificar() {
  let email = pendiente?.email || '';
  try { email = email || sessionStorage.getItem('ep_verificar') || ''; } catch { /* sin storage */ }
  app.innerHTML = `<div class="auth solo"><div class="auth-form card panel">
    <h2>Revisa tu correo</h2><p class="sub">Te enviamos un código de 6 dígitos. Vence en 15 minutos.</p>
    <form class="form" id="f">
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" inputmode="email" value="${esc(email)}" required></div>
      ${campoCodigo}
      <button class="btn btn-primary btn-block" id="ok">Activar mi cuenta</button>
      <button type="button" class="btn btn-ghost btn-block" id="reenviar">Reenviar código</button>
      <p class="hint center">¿No llega? Mira en la carpeta de spam.</p>
    </form></div></div>`;
  const leerEmail = () => document.getElementById('email').value.trim();
  const esperar = botonReenviar(document.getElementById('reenviar'), () => api.reenviarCodigo(leerEmail()));
  if (pendiente) esperar(60);
  const codigo = document.getElementById('codigo');
  (email ? codigo : document.getElementById('email')).focus();
  // Al completar los 6 dígitos se envía solo
  codigo.addEventListener('input', () => { if (/^\d{6}$/.test(codigo.value)) document.getElementById('f').requestSubmit(); });
  document.getElementById('f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const correo = leerEmail();
    try {
      await withLoading(document.getElementById('ok'), async () => {
        const r = await api.verificarEmail(correo, codigo.value);
        toast(r.message);
        try { sessionStorage.removeItem('ep_verificar'); } catch { /* sin storage */ }
        const cred = pendiente?.email === correo ? pendiente : null;
        pendiente = null;
        if (cred) await doLogin(cred.email, cred.password);
        else location.hash = '#/login';
      });
    } catch (err) {
      if (err.code === 'YA_VERIFICADA') { pendiente = null; location.hash = '#/login'; }
      toast(err.message, 'err');
    }
  });
}

function viewRecuperar() {
  app.innerHTML = `<div class="auth solo"><div class="auth-form card panel">
    <h2>Recuperar cuenta</h2><p class="sub">Te enviamos un código para que crees una contraseña nueva.</p>
    <form class="form" id="f1">
      <div class="field"><label for="email">Email de tu cuenta</label><input id="email" type="email" autocomplete="email" inputmode="email" required></div>
      <button class="btn btn-primary btn-block" id="ok1">Enviarme el código</button>
      <p class="hint center"><a href="#/login">Volver a entrar</a></p>
    </form>
    <form class="form hidden" id="f2">
      ${campoCodigo}
      <div class="field"><label for="pw">Contraseña nueva</label><input id="pw" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div>
      <div class="field"><label for="pw2">Repite la contraseña</label><input id="pw2" type="password" minlength="8" maxlength="128" autocomplete="new-password" required>
        <p class="hint">Al cambiarla cerramos tus sesiones abiertas en otros dispositivos.</p></div>
      <button class="btn btn-primary btn-block" id="ok2">Cambiar contraseña</button>
      <button type="button" class="btn btn-ghost btn-block" id="reenviar">Reenviar código</button>
    </form></div></div>`;
  const f1 = document.getElementById('f1');
  const f2 = document.getElementById('f2');
  const email = () => document.getElementById('email').value.trim();
  const esperar = botonReenviar(document.getElementById('reenviar'), () => api.recuperar(email()));

  f1.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const r = await withLoading(document.getElementById('ok1'), () => api.recuperar(email()));
      toast(r.message);
      document.getElementById('email').readOnly = true;
      document.getElementById('ok1').classList.add('hidden');
      f2.classList.remove('hidden');
      document.getElementById('codigo').focus();
      esperar(60);
    } catch (err) { toast(err.message, 'err'); }
  });
  f2.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pw = document.getElementById('pw').value;
    if (pw !== document.getElementById('pw2').value) return toast('Las contraseñas no coinciden', 'err');
    try {
      const r = await withLoading(document.getElementById('ok2'), () => api.restablecer(email(), document.getElementById('codigo').value, pw));
      session.clear();
      renderNav();
      toast(r.message);
      location.hash = '#/login';
    } catch (err) { toast(err.message, 'err'); }
  });
}

async function doLogin(email, password) {
  const r = await api.login(email, password);
  session.save(r.data.session_token, r.data.usuario);
  toast(`Hola, ${r.data.usuario.nombre.split(' ')[0]}`);
  renderNav();
  const next = sessionStorage.getItem('ep_after_login');
  sessionStorage.removeItem('ep_after_login');
  location.hash = next || '#/';
}

function viewRegistro() {
  app.innerHTML = authLayout(
    `<h1>Reserva tu lugar en la noche más larga del año</h1><p class="lead">Con una cuenta reservas cupos, entras a listas de espera y recibes los avisos de tus eventos.</p>${PERKS}`,
    `<h2>Crear cuenta</h2><p class="sub">Te pediremos confirmar tu correo con un código.</p>
    <form class="form" id="f">
      <div class="field"><label for="nombre">Nombre</label><input id="nombre" minlength="2" maxlength="80" autocomplete="name" required></div>
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" inputmode="email" required></div>
      <div class="field"><label for="pw">Contraseña</label><input id="pw" type="password" minlength="8" maxlength="128" autocomplete="new-password" required>
        <p class="hint">Mínimo 8 caracteres.</p></div>
      <button class="btn btn-primary btn-block" id="ok">Crear cuenta</button>
      <p class="hint center">¿Ya tienes cuenta? <a href="#/login">Entra</a></p>
    </form>`);
  document.getElementById('f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nombre = document.getElementById('nombre').value.trim();
    const email = document.getElementById('email').value.trim();
    const pw = document.getElementById('pw').value;
    try {
      const r = await withLoading(document.getElementById('ok'), () => api.registrar(nombre, email, pw));
      toast(r.message);
      irAVerificar(email, pw);
    } catch (err) {
      if (err.code === 'PENDIENTE_VERIFICACION') return irAVerificar(email, pw, err.message);
      toast(err.message, 'err');
    }
  });
}

async function viewPerfil() {
  if (!requireAuth()) return;
  app.innerHTML = loader('Cargando tu perfil…');
  let perfil, tg;
  try {
    [perfil, tg] = await Promise.all([api.perfil(), api.telegramEstado()]);
    perfil = perfil.data; tg = tg.data;
    session.setUser({ usuario_id: perfil.usuario_id, nombre: perfil.nombre, email: perfil.email });
    renderNav();
  } catch (err) {
    if (err.status === 401) { renderNav(); location.hash = '#/login'; return; }
    app.innerHTML = errorBox(err); bindRetry(viewPerfil); return;
  }

  app.innerHTML = `
    <div class="profile-head"><span class="avatar" aria-hidden="true">${inicial(perfil.nombre)}</span>
      <div><h2>${esc(perfil.nombre)}</h2><p>${esc(perfil.email)} · desde el ${esc(new Date(perfil.fecha_registro).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }))}</p></div></div>
    <div class="two-col">
      <section class="card panel" id="tgPanel"></section>
      <section class="card panel">
        <h3>Datos de la cuenta</h3>
        <form class="form" id="fPerfil" style="margin-top:1rem">
          <div class="field"><label for="nombre">Nombre</label><input id="nombre" minlength="2" maxlength="80" autocomplete="name" value="${esc(perfil.nombre)}" required></div>
          <div class="field"><label for="pw">Contraseña nueva (opcional)</label><input id="pw" type="password" minlength="8" maxlength="128" autocomplete="new-password"></div>
          <button class="btn btn-primary" id="okPerfil">Guardar cambios</button>
        </form>
        <hr class="divider">
        <button class="btn btn-danger" id="desactivar">Desactivar mi cuenta</button>
        <p class="hint" style="margin-top:.5rem">Tus datos no se borran; la cuenta queda inactiva.</p>
      </section>
    </div>`;

  document.getElementById('fPerfil').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const cambios = { nombre: document.getElementById('nombre').value.trim() };
    const pw = document.getElementById('pw').value;
    if (pw) cambios.password = pw;
    try {
      const r = await withLoading(document.getElementById('okPerfil'), () => api.actualizarPerfil(cambios));
      session.setUser({ ...session.user, nombre: r.data.nombre });
      renderNav();
      document.getElementById('pw').value = '';
      toast('Guardamos tus cambios');
    } catch (err) { toast(err.message, 'err'); }
  });

  document.getElementById('desactivar').addEventListener('click', async () => {
    if (!await confirmar('¿Desactivar tu cuenta?', 'Se cerrará tu sesión y no podrás inscribirte a eventos. Tus datos no se borran.', 'Desactivar cuenta', true)) return;
    try { await api.desactivar(); session.clear(); renderNav(); toast('Desactivamos tu cuenta'); location.hash = '#/'; } catch (err) { toast(err.message, 'err'); }
  });

  renderTelegram(tg);
}

let countdown;
function renderTelegram(tg, codigo) {
  const panel = document.getElementById('tgPanel');
  if (!panel) return;
  clearInterval(countdown);
  const botLink = TELEGRAM_BOT ? `<a class="btn btn-sm" href="https://t.me/${esc(TELEGRAM_BOT)}" target="_blank" rel="noopener">Abrir @${esc(TELEGRAM_BOT)}</a>` : '';
  if (tg.vinculado) {
    panel.innerHTML = `<h3>Telegram</h3><p><span class="status ok">Vinculado</span> ${tg.telegram_username ? '@' + esc(tg.telegram_username) : ''}</p>
      <p class="hint">Te llegan por Telegram y Gmail las confirmaciones, los avisos de lista de espera y los recordatorios.</p>`;
    return;
  }
  panel.innerHTML = `<h3>Vincula Telegram</h3>
    <p class="hint">Lo necesitas para inscribirte. Genera un código y envíaselo al bot.</p>
    ${codigo ? `
      <div class="code-box" style="margin:1rem 0">${esc(codigo.codigo)}</div>
      <p>Envía al bot: <strong><code>${esc(codigo.instruccion)}</code></strong></p>
      <p class="hint">Vence en <strong id="cd">--:--</strong> y solo sirve una vez.</p>` : ''}
    <div class="filters" style="margin-top:1rem">
      <button class="btn btn-primary btn-sm" id="genCode">${codigo ? 'Generar otro código' : 'Generar código'}</button>
      ${codigo ? '<button class="btn btn-sm" id="checkTg">Ya lo envié</button>' : ''}
      ${botLink}
    </div>`;
  if (codigo) {
    const fin = new Date(codigo.expira_en).getTime();
    const tick = () => {
      const s = Math.max(0, Math.round((fin - Date.now()) / 1000));
      const el = document.getElementById('cd');
      if (el) el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      if (!s) clearInterval(countdown);
    };
    tick(); countdown = setInterval(tick, 1000);
  }
  panel.querySelector('#genCode').addEventListener('click', async (ev) => {
    try {
      const r = await withLoading(ev.currentTarget, () => api.telegramCodigo());
      renderTelegram(tg, r.data);
    } catch (err) { toast(err.message, 'err'); }
  });
  panel.querySelector('#checkTg')?.addEventListener('click', async (ev) => {
    try {
      const r = await withLoading(ev.currentTarget, () => api.telegramEstado());
      if (r.data.vinculado) { toast('Telegram vinculado'); renderTelegram(r.data); } else toast('El bot aún no recibe tu código', 'err');
    } catch (err) { toast(err.message, 'err'); }
  });
}

const SELLO = {
  CONFIRMADA: '<span class="stamp ok">Confirmada</span>',
  ASISTIO: '<span class="stamp ok">Asistió</span>',
  LISTA_ESPERA: '<span class="stamp wait">En espera</span>',
  CANCELADA: '<span class="stamp off">Cancelada</span>',
};

// ---------------------------------------------------------- check-in en la puerta (WF11)
const RESULTADO_CHECKIN = {
  EXITOSO: { clase: 'ok', titulo: 'Ingreso registrado' },
  DUPLICADO: { clase: 'wait', titulo: 'Este ingreso ya estaba registrado' },
  RECHAZADO: { clase: 'bad', titulo: 'No puede ingresar' },
};
const intentosCheckin = []; // historial de esta pantalla, el más reciente primero

function tarjetaCheckin(r) {
  const vista = RESULTADO_CHECKIN[r.resultado] || RESULTADO_CHECKIN.RECHAZADO;
  const d = r.data || {};
  const fecha = d.fecha_checkin || d.checkin_previo?.fecha_checkin;
  const filas = [
    ['Asistente', d.nombre_acreditacion], ['Evento', d.evento_nombre ? `${d.evento_nombre} (${d.evento_id})` : d.evento_id],
    ['Inscripción', d.inscripcion_id], ['Estado de la inscripción', d.estado_inscripcion],
    ['Hora del ingreso', fecha ? new Date(fecha).toLocaleString('es-CO', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }) : ''],
    ['Registro', d.checkin_previo?.checkin_id || d.checkin_id],
  ].filter(([, v]) => v);
  return `<div class="checkin-res ${vista.clase}" role="status">
    <p class="checkin-titulo">${esc(vista.titulo)}</p>
    <p>${esc(r.message)}</p>
    <dl>${filas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
  </div>`;
}

async function viewCheckin() {
  let eventos = cache.get() || [];
  app.innerHTML = `
    <div class="section-head"><h2>Check-in en la puerta</h2></div>
    <div class="checkin-grid">
      <section class="card panel">
        <p class="hint" style="margin-bottom:1rem">Registra el ingreso de una persona con el código de su inscripción. Solo entran inscripciones CONFIRMADAS, una sola vez; la persona recibe el aviso por Gmail y Telegram.</p>
        <form class="form" id="fCheckin">
          <div class="field"><label for="ckEvento">Evento</label>
            <input id="ckEvento" list="ckEventos" autocomplete="off" required placeholder="EVT-001">
            <datalist id="ckEventos"></datalist>
            <p class="hint" id="ckEventoNombre"></p></div>
          <div class="field"><label for="ckInscripcion">Código de inscripción</label>
            <input id="ckInscripcion" autocomplete="off" required placeholder="INS-…" spellcheck="false">
            <p class="hint">Está en «Mis inscripciones» de la persona.</p></div>
          <button class="btn btn-primary btn-block" id="ckOk">Registrar ingreso</button>
        </form>
      </section>
      <section aria-live="polite">
        <div id="ckResultado"><div class="empty"><p>El resultado del check-in aparecerá aquí.</p></div></div>
        <div id="ckHistorial"></div>
      </section>
    </div>`;
  const inputEvento = document.getElementById('ckEvento');
  const nombreEvento = () => {
    const ev = eventos.find((e) => e.evento_id === inputEvento.value.trim().toUpperCase());
    document.getElementById('ckEventoNombre').textContent = ev ? `${ev.nombre} · ${fechaLarga(ev.fecha, ev.hora)}` : '';
  };
  const llenarEventos = () => {
    document.getElementById('ckEventos').innerHTML = eventos.map((e) => `<option value="${esc(e.evento_id)}">${esc(e.nombre)}</option>`).join('');
    nombreEvento();
  };
  llenarEventos();
  pedirCatalogo().then((r) => { eventos = r; if (document.getElementById('ckEventos')) llenarEventos(); }).catch(() => { /* se escribe a mano */ });
  inputEvento.addEventListener('input', nombreEvento);

  const pintarHistorial = () => {
    const h = document.getElementById('ckHistorial');
    if (!h || intentosCheckin.length < 2) return;
    h.innerHTML = `<h3 style="margin:1.5rem 0 .5rem">Intentos anteriores</h3><ul class="checkin-hist">${intentosCheckin.slice(1).map((r) =>
      `<li><span class="status ${(RESULTADO_CHECKIN[r.resultado] || {}).clase}">${esc(r.resultado)}</span> ${esc(r.data?.inscripcion_id || '')} · ${esc(r.message)}</li>`).join('')}</ul>`;
  };
  pintarHistorial();

  document.getElementById('fCheckin').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const inscripcion = document.getElementById('ckInscripcion').value.trim();
    const evento = inputEvento.value.trim().toUpperCase();
    try {
      const r = await withLoading(document.getElementById('ckOk'), () => registrarCheckin(inscripcion, evento));
      intentosCheckin.unshift(r);
      document.getElementById('ckResultado').innerHTML = tarjetaCheckin(r);
      pintarHistorial();
      if (r.resultado === 'EXITOSO') { document.getElementById('ckInscripcion').value = ''; document.getElementById('ckInscripcion').focus(); }
    } catch (err) {
      document.getElementById('ckResultado').innerHTML = errorBox(err, false);
    }
  });
}

async function viewMisInscripciones() {
  if (!requireAuth()) return;
  app.innerHTML = `<div class="section-head"><h2>Mis inscripciones</h2></div><div id="lista"><div class="list">${'<div class="skeleton"></div>'.repeat(2)}</div></div>`;
  const lista = document.getElementById('lista');
  let data;
  try { data = (await api.misInscripciones()).data; } catch (err) {
    if (err.status === 401) { renderNav(); location.hash = '#/login'; return; }
    lista.innerHTML = errorBox(err); bindRetry(viewMisInscripciones); return;
  }
  if (!data.length) {
    lista.innerHTML = `<div class="empty"><div class="art">${ICON.boleta.replace('class="icon"', 'class="icon" style="width:100%;height:auto"')}</div>
      <p>Todavía no tienes inscripciones. Elige un evento de la agenda y reserva tu cupo.</p><a class="btn btn-primary" href="#/">Ver la agenda</a></div>`;
    return;
  }
  const orden = { CONFIRMADA: 0, ASISTIO: 1, LISTA_ESPERA: 2, CANCELADA: 3 };
  data.sort((a, b) => (orden[a.estado] ?? 3) - (orden[b.estado] ?? 3) || String(a.evento_fecha).localeCompare(String(b.evento_fecha)));
  lista.innerHTML = `<div class="list">${data.map((i) => `
    <article class="ticket mine ${i.estado === 'CANCELADA' ? 'off' : ''}">
      ${talon(i.evento_fecha)}
      <div class="ticket-body">
        ${SELLO[i.estado] || ''}
        <h3><a href="#/evento/${esc(i.evento_id)}" style="color:inherit;text-decoration:none">${esc(i.evento_nombre || i.evento_id)}</a></h3>
        <div class="facts">
          <span>${ICON.reloj}${esc(capital(fechaLarga(i.evento_fecha, i.evento_hora)))}</span>
          <span>${ICON.lugar}${esc(i.evento_lugar)}</span>
          <span>${ICON.boleta}A nombre de ${esc(i.nombre_acreditacion)}${i.observaciones ? `. ${esc(i.observaciones)}` : ''}</span>
          ${i.estado === 'LISTA_ESPERA' && i.orden_espera ? `<span class="soon" style="margin:0">Puesto ${esc(i.orden_espera)} en la lista de espera</span>` : ''}
          ${i.evento_estado && i.evento_estado !== 'PUBLICADO' ? `<span>El evento está ${esc(i.evento_estado.toLowerCase())}</span>` : ''}
        </div>
        ${i.estado === 'CONFIRMADA' ? `<p class="codigo-ingreso">Código de ingreso: <code>${esc(i.inscripcion_id)}</code>
          <button class="btn btn-sm btn-ghost" data-copiar="${esc(i.inscripcion_id)}">Copiar</button></p>` : ''}
        ${i.estado === 'CONFIRMADA' || i.estado === 'LISTA_ESPERA' ? `<div class="actions">
          <button class="btn btn-sm" data-edit="${esc(i.inscripcion_id)}">Editar</button>
          <button class="btn btn-sm btn-danger" data-cancel="${esc(i.inscripcion_id)}">Cancelar</button></div>` : ''}
      </div>
    </article>`).join('')}</div>`;

  lista.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copiar); toast('Código copiado'); } catch { toast('Selecciona el código y cópialo a mano', 'err'); }
  }));
  lista.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!await confirmar('¿Cancelar la inscripción?', 'Si tenías cupo confirmado, pasará a la siguiente persona de la lista de espera.', 'Cancelar inscripción', true)) return;
    const inscripcion = data.find((x) => x.inscripcion_id === b.dataset.cancel);
    try {
      await api.cancelarInscripcion(b.dataset.cancel);
      if (inscripcion?.estado === 'CONFIRMADA') cache.ajustarCupos(inscripcion.evento_id, -1);
      pedirCatalogo().catch(() => { /* la agenda lo reintenta al abrirse */ });
      toast('Cancelamos tu inscripción. Te avisamos por Gmail y Telegram.');
      viewMisInscripciones();
    } catch (err) { toast(err.message, 'err'); }
  }));
  lista.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const i = data.find((x) => x.inscripcion_id === b.dataset.edit);
    const m = openModal(`<h2>Editar inscripción</h2>
      <form class="form" id="fEd">
        <div class="field"><label for="na">Nombre en la acreditación</label><input id="na" maxlength="80" value="${esc(i.nombre_acreditacion)}"></div>
        <div class="field"><label for="ob">Observaciones</label><textarea id="ob" maxlength="200" rows="3">${esc(i.observaciones)}</textarea></div>
        <div class="actions"><button type="button" class="btn btn-ghost" data-close>Cerrar</button><button class="btn btn-primary" id="okEd">Guardar cambios</button></div>
      </form>`);
    m.querySelector('#fEd').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await withLoading(m.querySelector('#okEd'), () => api.actualizarInscripcion(i.inscripcion_id, {
          nombre_acreditacion: m.querySelector('#na').value.trim(), observaciones: m.querySelector('#ob').value.trim(),
        }));
        closeModal(); toast('Guardamos los cambios'); viewMisInscripciones();
      } catch (err) { toast(err.message, 'err'); }
    });
  }));
}

// ---------- router ----------
function router() {
  cerrarMenu();
  closeModal();
  const hash = location.hash || '#/';
  if (hash === '#eventos') return document.getElementById('eventos')?.scrollIntoView({ behavior: 'smooth' });
  const [, ruta, param] = hash.replace(/^#\/?/, '/').split('/');
  document.body.classList.remove('has-bar');
  renderNav();
  window.scrollTo(0, 0);
  // Pequeña transición entre vistas
  app.classList.remove('view'); void app.offsetWidth; app.classList.add('view');
  switch (ruta) {
    case '': return viewHome();
    case 'evento': return viewEvento(decodeURIComponent(param || ''));
    case 'login': return session.token ? (location.hash = '#/') : viewLogin();
    case 'registro': return session.token ? (location.hash = '#/') : viewRegistro();
    case 'verificar': return session.token ? (location.hash = '#/') : viewVerificar();
    case 'recuperar': return viewRecuperar();
    case 'perfil': return viewPerfil();
    case 'mis-inscripciones': return viewMisInscripciones();
    case 'checkin': return viewCheckin();
    default: app.innerHTML = '<div class="empty"><p>Esta página no existe.</p><a class="btn" href="#/">Ver la agenda</a></div>';
  }
}
window.addEventListener('hashchange', router);

// ---------- chat (WF10) ----------
const chatBox = document.getElementById('chat');
const chatLog = document.getElementById('chatLog');
const chatFab = document.getElementById('chatFab');
const chatInput = document.getElementById('chatInput');
const chatSugs = document.getElementById('chatSugs');
const chatId = (() => {
  let id = null;
  try { id = sessionStorage.getItem('ep_chat'); } catch { /* sin storage */ }
  if (!id) { id = 'c' + crypto.randomUUID().replace(/-/g, ''); try { sessionStorage.setItem('ep_chat', id); } catch { /* sin storage */ } }
  return id;
})();
function addMsg(text, who) {
  const el = document.createElement('div');
  el.className = `msg ${who}`;
  el.textContent = text;
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}
function cerrarChat() {
  if (chatBox.classList.contains('hidden')) return;
  chatBox.classList.add('hidden');
  chatFab.setAttribute('aria-expanded', 'false');
}
chatFab.addEventListener('click', () => {
  const open = chatBox.classList.toggle('hidden') === false;
  chatFab.setAttribute('aria-expanded', String(open));
  if (!chatLog.children.length) addMsg('Hola, soy Gaspar. Pregúntame por eventos, cupos, la lista de espera o cómo vincular Telegram.', 'bot');
  if (open && matchMedia('(pointer: fine)').matches) chatInput.focus();
});
document.getElementById('chatClose').addEventListener('click', () => { cerrarChat(); chatFab.focus(); });
async function preguntar(texto) {
  chatSugs.classList.add('hidden');
  addMsg(texto, 'user');
  const pending = addMsg('', 'bot typing');
  pending.innerHTML = '<i></i><i></i><i></i>';
  pending.setAttribute('aria-label', 'Gaspar está escribiendo');
  try {
    const r = await chat(chatId, texto);
    pending.className = 'msg bot'; pending.textContent = r;
  } catch (err) {
    pending.className = 'msg bot err';
    pending.textContent = err instanceof ApiError ? err.message : 'No pude responder ahora. Intenta de nuevo en un momento.';
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}
chatSugs.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => preguntar(b.textContent)));
document.getElementById('chatForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const texto = chatInput.value.trim();
  if (!texto) return;
  chatInput.value = '';
  preguntar(texto);
});

// ---------- arranque ----------
async function boot() {
  // El catálogo se pide de inmediato, en paralelo con el resto del arranque
  pedirCatalogo().catch(() => { /* la vista muestra el error */ });
  router();
  if (session.token) {
    try { const r = await api.validar(); session.setUser({ usuario_id: r.data.usuario_id, nombre: r.data.nombre, email: r.data.email }); } catch (err) {
      if (err.status === 401 || err.status === 403) { session.clear(); toast('Tu sesión venció. Entra de nuevo.', 'err'); }
    }
    renderNav();
  }
}
boot();
