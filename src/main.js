import './style.css';
import { api, chat, session, ApiError } from './api.js';

const TELEGRAM_BOT = import.meta.env.VITE_TELEGRAM_BOT || '';
const app = document.getElementById('app');

// ---------- utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

const CATEGORIAS_CON_IMAGEN = ['cultura', 'tecnologia', 'educacion', 'comunidad', 'deportes', 'networking', 'emprendimiento'];
const fallbackImg = (c) => `/img/cat-${CATEGORIAS_CON_IMAGEN.includes(slug(c)) ? slug(c) : 'default'}.svg`;

const svg = (d) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  reloj: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  lugar: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  atras: svg('<path d="M15 18l-6-6 6-6"/>'),
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaEvento = (fecha, hora) => new Date(`${fecha}T${String(hora || '00:00').slice(0, 5)}:00-05:00`);

function fechaLarga(fecha, hora) {
  const d = fechaEvento(fecha, hora);
  if (isNaN(d)) return `${fecha} ${hora || ''}`;
  return d.toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
}
function horaCorta(fecha, hora) {
  const d = fechaEvento(fecha, hora);
  return isNaN(d) ? String(hora || '') : d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
}
function diaSemana(fecha, hora) {
  const d = fechaEvento(fecha, hora);
  return isNaN(d) ? '' : d.toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'America/Bogota' });
}
function diasPara(fecha, hora) { return (fechaEvento(fecha, hora) - new Date()) / 86400000; }
function cuandoEs(e) {
  const d = diasPara(e.fecha, e.hora);
  if (d < 0 || d > 3) return '';
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  if (e.fecha === hoy) return 'Es hoy';
  return d < 1.5 ? 'Es mañana' : `Faltan ${Math.ceil(d)} días`;
}

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
};

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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

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
function renderNav() {
  const u = session.user;
  const nav = document.getElementById('nav');
  nav.innerHTML = u
    ? `<a href="#/">Eventos</a><a href="#/mis-inscripciones">Mis inscripciones</a><a href="#/perfil">Perfil</a>
       <span class="who">Hola, ${esc(u.nombre?.split(' ')[0] || '')}</span><button id="logoutBtn">Salir</button>`
    : `<a href="#/">Eventos</a><a href="#/login">Entrar</a><a href="#/registro" class="cta">Crear cuenta</a>`;
  const h = location.hash || '#/';
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === h && !a.classList.contains('cta')));
  nav.querySelector('#logoutBtn')?.addEventListener('click', logout);
}
menuToggle.addEventListener('click', () => {
  const open = document.getElementById('nav').classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(open));
});

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
    ? '<strong>Lleno</strong>, puedes entrar a la lista de espera'
    : `<strong>${e.cupos_disponibles} ${e.cupos_disponibles === 1 ? 'cupo libre' : 'cupos libres'}</strong> de ${e.capacidad}`;
  return `<div class="seats ${e.lleno ? 'full' : 'ok'}"><span>${texto}</span>
    <div class="meter" role="img" aria-label="${pct}% de los cupos ocupados"><span style="width:${pct}%"></span></div></div>`;
}

function boleta(e, { big = false } = {}) {
  const off = e.estado !== 'PUBLICADO';
  const pronto = off ? '' : cuandoEs(e);
  return `<a class="ticket ${big ? 'big' : ''} ${off ? 'off' : ''}" href="#/evento/${encodeURIComponent(e.evento_id)}">
    <div class="stub" aria-hidden="true">
      <span class="day">${Number(String(e.fecha).slice(8, 10)) || ''}</span>
      <span class="month">${MESES[Number(String(e.fecha).slice(5, 7)) - 1] || ''}</span>
      <span class="wd">${esc(diaSemana(e.fecha, e.hora).slice(0, 3))}</span>
    </div>
    <div class="ticket-body">
      <span class="cat">${esc(e.categoria)}${pronto ? ` <span class="soon">${pronto}</span>` : ''}</span>
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

// ---------- vistas ----------
let categoriaActiva = '';

function viewHome() {
  app.innerHTML = `
    <section class="hero">
      <div>
        <h1>Noche de Brujas en San Gil</h1>
        <p>Cine de terror, talleres de calabazas, leyendas del Fonce y el desfile de disfraces. Reserva tu cupo y te avisamos por Gmail y Telegram.</p>
        <div class="actions">
          <a class="btn btn-primary" href="#eventos">Ver todos los eventos</a>
          ${session.user ? '<a class="btn" href="#/mis-inscripciones">Mis inscripciones</a>' : '<a class="btn" href="#/registro">Crear cuenta</a>'}
        </div>
      </div>
      <div id="destacado"><p class="featured-label">El próximo</p><div class="skeleton big"></div></div>
    </section>
    <div class="section-head" id="eventos">
      <h2>Eventos</h2>
      <div class="filters" id="chips" role="group" aria-label="Filtrar por categoría"></div>
    </div>
    <div id="lista" aria-live="polite"><div class="tickets">${'<div class="skeleton"></div>'.repeat(4)}</div></div>`;

  let todos = cache.get();

  const pintar = (data) => {
    const lista = document.getElementById('lista');
    const destacado = document.getElementById('destacado');
    if (!lista) return; // el usuario ya cambió de vista
    const cats = [...new Set(todos.map((e) => e.categoria))].sort();
    const chips = document.getElementById('chips');
    chips.innerHTML = ['', ...cats].map((c) =>
      `<button class="chip" data-cat="${esc(c)}" aria-pressed="${c === categoriaActiva}">${c ? esc(c) : 'Todas'}</button>`).join('');
    chips.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => filtrar(b.dataset.cat)));

    const prox = proximo(todos);
    destacado.innerHTML = prox ? `<p class="featured-label">El próximo</p>${boleta(prox, { big: true })}` : '';

    lista.innerHTML = data.length
      ? `<div class="tickets">${data.map((e) => boleta(e)).join('')}</div>`
      : '<div class="empty"><p>No hay eventos en esta categoría por ahora.</p><button class="btn btn-sm" data-cat-reset>Ver todas</button></div>';
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
      todos = (await api.listado()).data;
      cache.set(todos);
      filtrar(categoriaActiva);
    } catch (err) {
      if (todos) return toast('No pudimos actualizar los eventos; mostramos los últimos que vimos.', 'err');
      const lista = document.getElementById('lista');
      if (!lista) return;
      document.getElementById('destacado').innerHTML = '';
      lista.innerHTML = errorBox(err);
      bindRetry(() => { lista.innerHTML = `<div class="tickets">${'<div class="skeleton"></div>'.repeat(4)}</div>`; cargar(); }, lista);
    }
  };

  if (todos) pintar(local(categoriaActiva));
  cargar();
}

async function viewEvento(id) {
  const pintar = (e) => {
    const abierto = e.estado === 'PUBLICADO' && diasPara(e.fecha, e.hora) > 0;
    app.innerHTML = `
      <a href="#/" class="back">${ICON.atras}Todos los eventos</a>
      <div class="detail">
        <article>
          <span class="cat">${esc(e.categoria)}</span>
          <h1>${esc(e.nombre)}</h1>
          <p class="organiza">Organiza ${esc(e.organizador)}</p>
          <div class="detail-img"><img src="${esc(e.imagen_url || fallbackImg(e.categoria))}" alt="" onerror="this.onerror=null;this.src='${fallbackImg(e.categoria)}'"></div>
          <p class="desc">${esc(e.descripcion)}</p>
        </article>
        <aside class="card panel">
          <div class="facts">
            <span>${ICON.reloj}<span>${esc(fechaLarga(e.fecha, e.hora))}${cuandoEs(e) ? ` <span class="soon">${cuandoEs(e)}</span>` : ''}</span></span>
            <span>${ICON.lugar}${esc(e.lugar)}</span>
          </div>
          ${cupos(e)}
          ${abierto
            ? `<button class="btn btn-primary btn-block" id="inscribir">${e.lleno ? 'Entrar a la lista de espera' : 'Reservar mi cupo'}</button>
               <p class="hint">Necesitas una cuenta con Telegram vinculado. La confirmación te llega por Gmail y Telegram.</p>`
            : '<p class="hint">Este evento ya no recibe inscripciones.</p>'}
        </aside>
      </div>`;
    document.getElementById('inscribir')?.addEventListener('click', () => inscribir(e));
  };

  const previo = cache.evento(id);
  if (previo) pintar(previo); else app.innerHTML = loader('Cargando el evento…');
  try {
    const e = (await api.detalle(id)).data;
    if (location.hash.startsWith('#/evento/')) pintar(e);
  } catch (err) {
    if (previo && err.code !== 'NO_ENCONTRADO') return;
    app.innerHTML = `<a href="#/" class="back">${ICON.atras}Todos los eventos</a>${errorBox(err)}`;
    bindRetry(() => viewEvento(id));
  }
}

function inscribir(e) {
  if (!requireAuth()) return;
  const m = openModal(`<h2>Reservar cupo</h2><p class="hint">${esc(e.nombre)}</p>
    <form class="form" id="fIns" style="margin-top:1rem">
      <div class="field"><label for="na">Nombre en la acreditación</label><input id="na" maxlength="80" value="${esc(session.user?.nombre || '')}"></div>
      <div class="field"><label for="ob">Observaciones (opcional)</label><textarea id="ob" maxlength="200" rows="3" placeholder="Disfraz, alergias, acompañantes…"></textarea></div>
      <div class="actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="okIns">Confirmar reserva</button></div>
    </form>`);
  m.querySelector('#fIns').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const r = await withLoading(m.querySelector('#okIns'), () => api.inscribir(e.evento_id, {
        nombre_acreditacion: m.querySelector('#na').value.trim(), observaciones: m.querySelector('#ob').value.trim(),
      }));
      closeModal();
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

function viewLogin() {
  app.innerHTML = `<div class="auth-wrap card panel">
    <h1>Entrar</h1><p class="sub">Con el email y la contraseña de tu cuenta.</p>
    <form class="form" id="f">
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="pw">Contraseña</label><input id="pw" type="password" autocomplete="current-password" required></div>
      <button class="btn btn-primary btn-block" id="ok">Entrar</button>
      <p class="hint center"><a href="#/recuperar">¿Olvidaste tu contraseña?</a></p>
      <p class="hint center">¿No tienes cuenta? <a href="#/registro">Créala aquí</a></p>
    </form></div>`;
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
  app.innerHTML = `<div class="auth-wrap card panel">
    <h1>Revisa tu correo</h1><p class="sub">Te enviamos un código de 6 dígitos. Vence en 15 minutos.</p>
    <form class="form" id="f">
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" value="${esc(email)}" required></div>
      ${campoCodigo}
      <button class="btn btn-primary btn-block" id="ok">Activar mi cuenta</button>
      <button type="button" class="btn btn-ghost btn-block" id="reenviar">Reenviar código</button>
      <p class="hint center">¿No llega? Mira en la carpeta de spam.</p>
    </form></div>`;
  const leerEmail = () => document.getElementById('email').value.trim();
  const esperar = botonReenviar(document.getElementById('reenviar'), () => api.reenviarCodigo(leerEmail()));
  if (pendiente) esperar(60);
  document.getElementById(email ? 'codigo' : 'email').focus();
  document.getElementById('f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const correo = leerEmail();
    try {
      await withLoading(document.getElementById('ok'), async () => {
        const r = await api.verificarEmail(correo, document.getElementById('codigo').value);
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
  app.innerHTML = `<div class="auth-wrap card panel">
    <h1>Recuperar cuenta</h1><p class="sub">Te enviamos un código para que crees una contraseña nueva.</p>
    <form class="form" id="f1">
      <div class="field"><label for="email">Email de tu cuenta</label><input id="email" type="email" autocomplete="email" required></div>
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
    </form></div>`;
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
  app.innerHTML = `<div class="auth-wrap card panel">
    <h1>Crear cuenta</h1><p class="sub">Para reservar cupos y recibir avisos de tus eventos.</p>
    <form class="form" id="f">
      <div class="field"><label for="nombre">Nombre</label><input id="nombre" minlength="2" maxlength="80" autocomplete="name" required></div>
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required>
        <p class="hint">Te enviaremos un código para confirmarlo.</p></div>
      <div class="field"><label for="pw">Contraseña</label><input id="pw" type="password" minlength="8" maxlength="128" autocomplete="new-password" required>
        <p class="hint">Mínimo 8 caracteres.</p></div>
      <button class="btn btn-primary btn-block" id="ok">Crear cuenta</button>
      <p class="hint center">¿Ya tienes cuenta? <a href="#/login">Entra</a></p>
    </form></div>`;
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
    <div class="section-head"><h2>Mi perfil</h2></div>
    <div class="two-col">
      <section class="card panel">
        <h3>Tu cuenta</h3>
        <p class="hint">${esc(perfil.email)}</p>
        <p class="hint">Miembro desde el ${esc(new Date(perfil.fecha_registro).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>
        <form class="form" id="fPerfil" style="margin-top:1.25rem">
          <div class="field"><label for="nombre">Nombre</label><input id="nombre" minlength="2" maxlength="80" value="${esc(perfil.nombre)}" required></div>
          <div class="field"><label for="pw">Contraseña nueva (opcional)</label><input id="pw" type="password" minlength="8" maxlength="128" autocomplete="new-password"></div>
          <button class="btn btn-primary" id="okPerfil">Guardar cambios</button>
        </form>
        <hr class="divider">
        <button class="btn btn-danger" id="desactivar">Desactivar mi cuenta</button>
        <p class="hint" style="margin-top:.5rem">Tus datos no se borran; la cuenta queda inactiva.</p>
      </section>
      <section class="card panel" id="tgPanel"></section>
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
  panel.innerHTML = `<h3>Telegram</h3>
    <p class="hint">Necesitas vincularlo para inscribirte. Genera un código y envíaselo al bot.</p>
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

const EST_INS = {
  CONFIRMADA: '<span class="status ok">Confirmada</span>',
  LISTA_ESPERA: '<span class="status wait">En lista de espera</span>',
  CANCELADA: '<span class="status off">Cancelada</span>',
};

async function viewMisInscripciones() {
  if (!requireAuth()) return;
  app.innerHTML = `<div class="section-head"><h2>Mis inscripciones</h2></div><div id="lista">${loader('Cargando tus inscripciones…')}</div>`;
  const lista = document.getElementById('lista');
  let data;
  try { data = (await api.misInscripciones()).data; } catch (err) {
    if (err.status === 401) { renderNav(); location.hash = '#/login'; return; }
    lista.innerHTML = errorBox(err); bindRetry(viewMisInscripciones); return;
  }
  if (!data.length) {
    lista.innerHTML = '<div class="empty"><p>Todavía no tienes inscripciones. Elige un evento y reserva tu cupo.</p><a class="btn btn-primary" href="#/">Ver eventos</a></div>';
    return;
  }
  lista.innerHTML = `<div class="list">${data.map((i) => `
    <article class="card row">
      <div>
        <h3><a href="#/evento/${esc(i.evento_id)}">${esc(i.evento_nombre || i.evento_id)}</a></h3>
        <p style="margin:.2rem 0 .4rem">${EST_INS[i.estado] || esc(i.estado)}
          ${i.estado === 'LISTA_ESPERA' && i.orden_espera ? `<span class="hint">Puesto ${esc(i.orden_espera)} en la fila</span>` : ''}
          ${i.evento_estado && i.evento_estado !== 'PUBLICADO' ? `<span class="hint">El evento está ${esc(i.evento_estado.toLowerCase())}</span>` : ''}</p>
        <div class="facts"><span>${ICON.reloj}${esc(fechaLarga(i.evento_fecha, i.evento_hora))}</span><span>${ICON.lugar}${esc(i.evento_lugar)}</span>
          <span>A nombre de ${esc(i.nombre_acreditacion)}${i.observaciones ? `. ${esc(i.observaciones)}` : ''}</span></div>
      </div>
      <div class="actions">${i.estado !== 'CANCELADA' ? `
        <button class="btn btn-sm" data-edit="${esc(i.inscripcion_id)}">Editar</button>
        <button class="btn btn-sm btn-danger" data-cancel="${esc(i.inscripcion_id)}">Cancelar</button>` : ''}</div>
    </article>`).join('')}</div>`;

  lista.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!await confirmar('¿Cancelar la inscripción?', 'Si tenías cupo confirmado, pasará a la siguiente persona de la lista de espera.', 'Cancelar inscripción', true)) return;
    try { await api.cancelarInscripcion(b.dataset.cancel); toast('Cancelamos tu inscripción. Te avisamos por Gmail y Telegram.'); viewMisInscripciones(); } catch (err) { toast(err.message, 'err'); }
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
  document.getElementById('nav').classList.remove('open');
  menuToggle.setAttribute('aria-expanded', 'false');
  closeModal();
  const hash = location.hash || '#/';
  if (hash === '#eventos') return document.getElementById('eventos')?.scrollIntoView({ behavior: 'smooth' });
  const [, ruta, param] = hash.replace(/^#\/?/, '/').split('/');
  renderNav();
  window.scrollTo(0, 0);
  switch (ruta) {
    case '': return viewHome();
    case 'evento': return viewEvento(decodeURIComponent(param || ''));
    case 'login': return session.token ? (location.hash = '#/') : viewLogin();
    case 'registro': return session.token ? (location.hash = '#/') : viewRegistro();
    case 'verificar': return session.token ? (location.hash = '#/') : viewVerificar();
    case 'recuperar': return viewRecuperar();
    case 'perfil': return viewPerfil();
    case 'mis-inscripciones': return viewMisInscripciones();
    default: app.innerHTML = '<div class="empty"><p>Esta página no existe.</p><a class="btn" href="#/">Ver eventos</a></div>';
  }
}
window.addEventListener('hashchange', router);

// ---------- chat (WF10) ----------
const chatBox = document.getElementById('chat');
const chatLog = document.getElementById('chatLog');
const chatFab = document.getElementById('chatFab');
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
chatFab.addEventListener('click', () => {
  const open = chatBox.classList.toggle('hidden') === false;
  chatFab.setAttribute('aria-expanded', String(open));
  if (!chatLog.children.length) addMsg('Hola, soy Gaspar. Pregúntame por eventos, cupos, la lista de espera o cómo vincular Telegram.', 'bot');
  if (open) document.getElementById('chatInput').focus();
});
document.getElementById('chatClose').addEventListener('click', () => { chatBox.classList.add('hidden'); chatFab.setAttribute('aria-expanded', 'false'); chatFab.focus(); });
document.getElementById('chatForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = document.getElementById('chatInput');
  const texto = input.value.trim();
  if (!texto) return;
  input.value = '';
  addMsg(texto, 'user');
  const pending = addMsg('Gaspar está escribiendo…', 'bot');
  try { pending.textContent = await chat(chatId, texto); } catch (err) {
    pending.textContent = err instanceof ApiError ? err.message : 'No pude responder ahora. Intenta de nuevo en un momento.';
    pending.classList.add('err');
  }
});

// ---------- arranque ----------
async function boot() {
  router();
  if (session.token) {
    try { const r = await api.validar(); session.setUser({ usuario_id: r.data.usuario_id, nombre: r.data.nombre, email: r.data.email }); } catch (err) {
      if (err.status === 401 || err.status === 403) { session.clear(); toast('Tu sesión venció. Entra de nuevo.', 'err'); }
    }
    renderNav();
  }
}
boot();
