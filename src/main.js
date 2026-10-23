import './style.css';
import { api, chat, session, ApiError } from './api.js';

const TELEGRAM_BOT = import.meta.env.VITE_TELEGRAM_BOT || '';
const app = document.getElementById('app');

// ---------- utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

const CAT_ICON = { cultura: '🎭', tecnologia: '💻', educacion: '📚', comunidad: '🏘️', deportes: '🧟', networking: '🧛', emprendimiento: '🧪' };
const catIcon = (c) => CAT_ICON[slug(c)] || '🎃';
const fallbackImg = (c) => `/img/cat-${CAT_ICON[slug(c)] ? slug(c) : 'default'}.svg`;

function fechaLarga(fecha, hora) {
  const d = new Date(`${fecha}T${String(hora || '00:00').slice(0, 5)}:00-05:00`);
  if (isNaN(d)) return `${fecha} ${hora || ''}`;
  return d.toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
}
function diasPara(fecha, hora) {
  const d = new Date(`${fecha}T${String(hora || '00:00').slice(0, 5)}:00-05:00`);
  return (d - new Date()) / 86400000;
}

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = (type === 'ok' ? '🎃 ' : '💀 ') + msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

const loader = (txt = 'Removiendo el caldero…') => `<div class="loader"><div class="cauldron">🧙</div><p>${esc(txt)}</p></div>`;
const errorBox = (err, retry = true) => `
  <div class="error-box"><div class="big">💀</div>
    <p><strong>${esc(err.message || 'Algo salió mal')}</strong></p>
    ${retry ? '<button class="btn btn-sm" data-retry>Intentar de nuevo</button>' : ''}
  </div>`;

function bindRetry(fn) { app.querySelector('[data-retry]')?.addEventListener('click', fn); }

// Botón con estado de carga mientras se ejecuta la acción
async function withLoading(btn, fn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Conjurando…';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = original; }
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function confirmar(titulo, texto, okLabel = 'Sí, hazlo', danger = false) {
  return new Promise((resolve) => {
    const m = openModal(`<h2>${esc(titulo)}</h2><p>${esc(texto)}</p>
      <div class="actions"><button class="btn btn-ghost" data-close>Mejor no</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="mOk">${esc(okLabel)}</button></div>`);
    m.querySelector('#mOk').onclick = () => { closeModal(); resolve(true); };
    m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => resolve(false)));
  });
}

// ---------- navegación ----------
function renderNav() {
  const u = session.user;
  const nav = document.getElementById('nav');
  nav.innerHTML = u
    ? `<a href="#/">Catálogo</a><a href="#/mis-inscripciones">Mis inscripciones</a><a href="#/perfil">Perfil</a>
       <span class="who">🧙 ${esc(u.nombre?.split(' ')[0] || '')}</span><button id="logoutBtn">Salir</button>`
    : `<a href="#/">Catálogo</a><a href="#/login">Entrar</a><a href="#/registro" class="btn btn-primary btn-sm">Crear cuenta</a>`;
  const h = location.hash || '#/';
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === h));
  nav.querySelector('#logoutBtn')?.addEventListener('click', logout);
}
document.getElementById('menuToggle').addEventListener('click', () => document.getElementById('nav').classList.toggle('open'));

async function logout() {
  try { await api.logout(); } catch { /* aunque falle, cerramos localmente */ }
  session.clear();
  toast('Sesión cerrada. ¡Que los fantasmas te acompañen!');
  location.hash = '#/';
  renderNav();
}

function requireAuth() {
  if (session.token) return true;
  sessionStorage.setItem('ep_after_login', location.hash);
  toast('Primero inicia sesión', 'err');
  location.hash = '#/login';
  return false;
}

// ---------- tarjetas de evento ----------
function estadoBadge(e) {
  if (e.estado === 'CANCELADO') return '<span class="badge off">⚰️ Cancelado</span>';
  if (e.estado === 'CERRADO') return '<span class="badge off">🔒 Cerrado</span>';
  if (e.lleno) return '<span class="badge full">🩸 Lleno</span>';
  const d = diasPara(e.fecha, e.hora);
  if (d >= 0 && d <= 3) return '<span class="badge soon">⏳ ¡Muy pronto!</span>';
  return `<span class="badge ok">🕯️ ${e.cupos_disponibles} cupos</span>`;
}
function cuposBar(e) {
  const pct = e.capacidad ? Math.min(100, Math.round((e.inscritos_confirmados / e.capacidad) * 100)) : 0;
  return `<div class="cupos"><div class="bar ${e.lleno ? 'full' : ''}"><span style="width:${pct}%"></span></div>
    <small>${e.inscritos_confirmados}/${e.capacidad} confirmados · ${e.lleno ? 'lista de espera abierta' : e.cupos_disponibles + ' cupos libres'}</small></div>`;
}
function media(e) {
  const src = e.imagen_url || fallbackImg(e.categoria);
  return `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${fallbackImg(e.categoria)}'">`;
}
function eventCard(e) {
  return `<article class="card event" data-id="${esc(e.evento_id)}" tabindex="0">
    <div class="event-media">${media(e)}
      <div class="tags"><span class="badge cat">${catIcon(e.categoria)} ${esc(e.categoria)}</span>${estadoBadge(e)}</div>
    </div>
    <div class="event-body">
      <h3>${esc(e.nombre)}</h3>
      <div class="meta"><span>🗓️ ${esc(fechaLarga(e.fecha, e.hora))}</span><span>📍 ${esc(e.lugar)}</span></div>
      ${cuposBar(e)}
    </div>
  </article>`;
}

// ---------- vistas ----------
let categoriaActiva = '';

async function viewHome() {
  app.innerHTML = `
    <section class="hero">
      <h1>Noche de Brujas en EventPass</h1>
      <p>Cine de terror, talleres de calabazas, hackatones embrujados y desfiles de disfraces. Reserva tu cupo antes de que se lo lleven los fantasmas.</p>
      <div class="actions">
        <a class="btn btn-primary" href="#eventos">Ver eventos 🕸️</a>
        ${session.user ? '<a class="btn" href="#/mis-inscripciones">Mis inscripciones</a>' : '<a class="btn" href="#/registro">Crear cuenta</a>'}
      </div>
    </section>
    <div class="section-title" id="eventos"><h2>Catálogo maldito</h2><div class="chips" id="chips"></div></div>
    <div id="lista"><div class="grid">${'<div class="skeleton"></div>'.repeat(3)}</div></div>`;

  const cargar = async () => {
    const lista = document.getElementById('lista');
    lista.innerHTML = `<div class="grid">${'<div class="skeleton"></div>'.repeat(3)}</div>`;
    try {
      const todos = (await api.listado()).data;
      const cats = [...new Set(todos.map((e) => e.categoria))].sort();
      const chips = document.getElementById('chips');
      chips.innerHTML = ['', ...cats].map((c) => `<button class="chip ${c === categoriaActiva ? 'active' : ''}" data-cat="${esc(c)}">${c ? catIcon(c) + ' ' + esc(c) : '🎃 Todas'}</button>`).join('');
      chips.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { categoriaActiva = b.dataset.cat; cargar(); }));

      const data = categoriaActiva ? (await api.filtro(categoriaActiva)).data : todos;
      if (!data.length) { lista.innerHTML = '<div class="empty"><div class="big">🦇</div><p>No hay eventos en esta categoría… todavía.</p></div>'; return; }
      lista.innerHTML = `<div class="grid">${data.map(eventCard).join('')}</div>`;
      lista.querySelectorAll('.event').forEach((c) => {
        const go = () => { location.hash = `#/evento/${c.dataset.id}`; };
        c.addEventListener('click', go);
        c.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
      });
    } catch (err) {
      lista.innerHTML = errorBox(err);
      bindRetry(cargar);
    }
  };
  cargar();
}

async function viewEvento(id) {
  app.innerHTML = loader('Abriendo la cripta del evento…');
  let e;
  try { e = (await api.detalle(id)).data; } catch (err) {
    app.innerHTML = `<a href="#/" class="btn btn-ghost btn-sm">← Volver</a>${errorBox(err)}`;
    bindRetry(() => viewEvento(id));
    return;
  }
  const abierto = e.estado === 'PUBLICADO' && diasPara(e.fecha, e.hora) > 0;
  app.innerHTML = `
    <a href="#/" class="btn btn-ghost btn-sm">← Volver al catálogo</a>
    <div class="detail" style="margin-top:1rem">
      <div class="event-media">${media(e)}</div>
      <div class="card panel">
        <div class="chips" style="margin-bottom:.75rem"><span class="badge cat">${catIcon(e.categoria)} ${esc(e.categoria)}</span>${estadoBadge(e)}</div>
        <h1>${esc(e.nombre)}</h1>
        <div class="meta" style="margin-bottom:1rem">
          <span>🗓️ ${esc(fechaLarga(e.fecha, e.hora))}</span><span>📍 ${esc(e.lugar)}</span><span>🧙 Organiza: ${esc(e.organizador)}</span>
        </div>
        <p class="desc">${esc(e.descripcion)}</p>
        ${cuposBar(e)}
        <div style="margin-top:1.25rem">
          ${abierto
            ? `<button class="btn btn-primary btn-block" id="inscribir">${e.lleno ? 'Unirme a la lista de espera 🕯️' : 'Reservar mi cupo 🎟️'}</button>
               <p class="hint" style="margin-top:.5rem">Necesitas sesión iniciada y Telegram vinculado. Te avisaremos por Gmail y Telegram.</p>`
            : '<p class="hint">Este evento no recibe inscripciones.</p>'}
        </div>
      </div>
    </div>`;
  document.getElementById('inscribir')?.addEventListener('click', () => {
    if (!requireAuth()) return;
    const m = openModal(`<h2>Reservar cupo</h2><p class="hint">${esc(e.nombre)}</p>
      <form class="form" id="fIns" style="margin-top:1rem">
        <div class="field"><label for="na">Nombre para la acreditación</label><input id="na" maxlength="80" value="${esc(session.user?.nombre || '')}"></div>
        <div class="field"><label for="ob">Observaciones (disfraz, alergias…)</label><textarea id="ob" maxlength="200" rows="3"></textarea></div>
        <div class="actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" id="okIns">Confirmar</button></div>
      </form>`);
    m.querySelector('#fIns').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        const r = await withLoading(m.querySelector('#okIns'), () => api.inscribir(e.evento_id, {
          nombre_acreditacion: m.querySelector('#na').value.trim(), observaciones: m.querySelector('#ob').value.trim(),
        }));
        closeModal();
        toast(r.data.estado === 'CONFIRMADA' ? '¡Cupo confirmado! Revisa tu Gmail y Telegram.' : `Evento lleno: quedaste en lista de espera (#${r.data.orden_espera}).`);
        location.hash = '#/mis-inscripciones';
      } catch (err) {
        if (err.code === 'TELEGRAM_NO_VINCULADO') {
          closeModal();
          if (await confirmar('Falta Telegram', 'Para inscribirte debes vincular tu Telegram. ¿Vamos a tu perfil a hacerlo?', 'Ir a vincular')) location.hash = '#/perfil';
        } else toast(err.message, 'err');
      }
    });
  });
}

function viewLogin() {
  app.innerHTML = `<div class="auth-wrap card panel">
    <h1>Entrar</h1><p class="sub">Vuelve a la casa embrujada</p>
    <form class="form" id="f">
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="pw">Contraseña</label><input id="pw" type="password" autocomplete="current-password" required></div>
      <button class="btn btn-primary btn-block" id="ok">Iniciar sesión</button>
      <p class="hint" style="text-align:center">¿No tienes cuenta? <a href="#/registro">Regístrate</a></p>
    </form></div>`;
  document.getElementById('f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await withLoading(document.getElementById('ok'), () => doLogin(document.getElementById('email').value, document.getElementById('pw').value));
    } catch (err) { toast(err.message, 'err'); }
  });
}

async function doLogin(email, password) {
  const r = await api.login(email, password);
  session.save(r.data.session_token, r.data.usuario);
  toast(`¡Bienvenid@, ${r.data.usuario.nombre.split(' ')[0]}!`);
  renderNav();
  const next = sessionStorage.getItem('ep_after_login');
  sessionStorage.removeItem('ep_after_login');
  location.hash = next || '#/';
}

function viewRegistro() {
  app.innerHTML = `<div class="auth-wrap card panel">
    <h1>Crear cuenta</h1><p class="sub">Únete al aquelarre de EventPass</p>
    <form class="form" id="f">
      <div class="field"><label for="nombre">Nombre</label><input id="nombre" minlength="2" maxlength="80" autocomplete="name" required></div>
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="pw">Contraseña</label><input id="pw" type="password" minlength="8" maxlength="128" autocomplete="new-password" required>
        <p class="hint">Mínimo 8 caracteres. Se guarda como hash PBKDF2 + salt, nunca en texto plano.</p></div>
      <button class="btn btn-primary btn-block" id="ok">Crear cuenta 🎃</button>
      <p class="hint" style="text-align:center">¿Ya tienes cuenta? <a href="#/login">Entra</a></p>
    </form></div>`;
  document.getElementById('f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nombre = document.getElementById('nombre').value.trim();
    const email = document.getElementById('email').value.trim();
    const pw = document.getElementById('pw').value;
    try {
      await withLoading(document.getElementById('ok'), async () => {
        await api.registrar(nombre, email, pw);
        toast('Cuenta creada');
        await doLogin(email, pw);
      });
    } catch (err) { toast(err.message, 'err'); }
  });
}

async function viewPerfil() {
  if (!requireAuth()) return;
  app.innerHTML = loader('Consultando el libro de hechizos…');
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
    <div class="section-title"><h2>Mi perfil</h2><span class="badge ok">${esc(perfil.estado)}</span></div>
    <div class="two-col">
      <section class="card panel">
        <h3>Datos de la cuenta</h3>
        <p class="hint">${esc(perfil.email)} · ID ${esc(perfil.usuario_id)} · desde ${esc(new Date(perfil.fecha_registro).toLocaleDateString('es-CO'))}</p>
        <form class="form" id="fPerfil" style="margin-top:1rem">
          <div class="field"><label for="nombre">Nombre</label><input id="nombre" minlength="2" maxlength="80" value="${esc(perfil.nombre)}" required></div>
          <div class="field"><label for="pw">Nueva contraseña (opcional)</label><input id="pw" type="password" minlength="8" maxlength="128" autocomplete="new-password"></div>
          <button class="btn btn-primary" id="okPerfil">Guardar cambios</button>
        </form>
        <hr style="border-color:var(--border);margin:1.5rem 0">
        <button class="btn btn-danger" id="desactivar">Desactivar mi cuenta</button>
        <p class="hint" style="margin-top:.5rem">Es un borrado lógico: tu cuenta pasa a INACTIVO.</p>
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
      toast('Perfil actualizado');
    } catch (err) { toast(err.message, 'err'); }
  });

  document.getElementById('desactivar').addEventListener('click', async () => {
    if (!await confirmar('¿Desactivar cuenta?', 'Tu cuenta quedará INACTIVA y se cerrará la sesión. Esta acción no borra tus datos.', 'Desactivar', true)) return;
    try { await api.desactivar(); session.clear(); renderNav(); toast('Cuenta desactivada'); location.hash = '#/'; } catch (err) { toast(err.message, 'err'); }
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
    panel.innerHTML = `<h3>Telegram 🦉</h3><p><span class="badge ok">Vinculado</span> ${tg.telegram_username ? '@' + esc(tg.telegram_username) : ''}</p>
      <p class="hint">Recibirás confirmaciones, avisos de lista de espera y recordatorios por Telegram y Gmail.</p>`;
    return;
  }
  panel.innerHTML = `<h3>Telegram 🦉</h3>
    <p class="hint">Vincular Telegram es obligatorio para inscribirte. Genera un código y envíalo al bot.</p>
    ${codigo ? `
      <div class="code-box" style="margin:1rem 0">${esc(codigo.codigo)}</div>
      <p>Envía al bot: <strong><code>${esc(codigo.instruccion)}</code></strong></p>
      <p class="hint">Vence en <strong id="cd">--:--</strong>. Solo se puede usar una vez.</p>` : ''}
    <div class="chips" style="margin-top:1rem">
      <button class="btn btn-primary btn-sm" id="genCode">${codigo ? 'Generar otro código' : 'Generar código'}</button>
      ${codigo ? '<button class="btn btn-sm" id="checkTg">Ya lo envié ✔</button>' : ''}
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
      if (r.data.vinculado) { toast('¡Telegram vinculado!'); renderTelegram(r.data); } else toast('Aún no recibimos tu código en el bot', 'err');
    } catch (err) { toast(err.message, 'err'); }
  });
}

const EST_INS = {
  CONFIRMADA: '<span class="badge ok">✅ Confirmada</span>',
  LISTA_ESPERA: '<span class="badge wait">🕯️ Lista de espera</span>',
  CANCELADA: '<span class="badge off">⚰️ Cancelada</span>',
};

async function viewMisInscripciones() {
  if (!requireAuth()) return;
  app.innerHTML = `<div class="section-title"><h2>Mis inscripciones</h2></div><div id="lista">${loader('Contando calaveras…')}</div>`;
  const lista = document.getElementById('lista');
  let data;
  try { data = (await api.misInscripciones()).data; } catch (err) {
    if (err.status === 401) { renderNav(); location.hash = '#/login'; return; }
    lista.innerHTML = errorBox(err); bindRetry(viewMisInscripciones); return;
  }
  if (!data.length) {
    lista.innerHTML = '<div class="empty"><div class="big">🪦</div><p>Aún no tienes inscripciones.</p><a class="btn btn-primary" href="#/">Explorar eventos</a></div>';
    return;
  }
  lista.innerHTML = `<div class="list">${data.map((i) => `
    <article class="card row">
      <div>
        <h3><a href="#/evento/${esc(i.evento_id)}">${esc(i.evento_nombre || i.evento_id)}</a></h3>
        <div class="chips" style="margin:.35rem 0">${EST_INS[i.estado] || esc(i.estado)}
          ${i.estado === 'LISTA_ESPERA' && i.orden_espera ? `<span class="badge">Posición #${esc(i.orden_espera)}</span>` : ''}
          ${i.evento_estado && i.evento_estado !== 'PUBLICADO' ? `<span class="badge off">Evento ${esc(i.evento_estado.toLowerCase())}</span>` : ''}</div>
        <div class="meta"><span>🗓️ ${esc(fechaLarga(i.evento_fecha, i.evento_hora))} · 📍 ${esc(i.evento_lugar)}</span>
          <span>🎫 ${esc(i.nombre_acreditacion)}${i.observaciones ? ' · ' + esc(i.observaciones) : ''}</span></div>
      </div>
      <div class="actions">${i.estado !== 'CANCELADA' ? `
        <button class="btn btn-sm" data-edit="${esc(i.inscripcion_id)}">Editar</button>
        <button class="btn btn-sm btn-danger" data-cancel="${esc(i.inscripcion_id)}">Cancelar</button>` : ''}</div>
    </article>`).join('')}</div>`;

  lista.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!await confirmar('¿Cancelar inscripción?', 'Si estabas confirmad@, tu cupo pasará a la siguiente persona de la lista de espera.', 'Cancelar inscripción', true)) return;
    try { await api.cancelarInscripcion(b.dataset.cancel); toast('Inscripción cancelada. Te avisamos por Gmail y Telegram.'); viewMisInscripciones(); } catch (err) { toast(err.message, 'err'); }
  }));
  lista.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const i = data.find((x) => x.inscripcion_id === b.dataset.edit);
    const m = openModal(`<h2>Editar inscripción</h2>
      <form class="form" id="fEd">
        <div class="field"><label for="na">Nombre para la acreditación</label><input id="na" maxlength="80" value="${esc(i.nombre_acreditacion)}"></div>
        <div class="field"><label for="ob">Observaciones</label><textarea id="ob" maxlength="200" rows="3">${esc(i.observaciones)}</textarea></div>
        <div class="actions"><button type="button" class="btn btn-ghost" data-close>Cerrar</button><button class="btn btn-primary" id="okEd">Guardar</button></div>
      </form>`);
    m.querySelector('#fEd').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await withLoading(m.querySelector('#okEd'), () => api.actualizarInscripcion(i.inscripcion_id, {
          nombre_acreditacion: m.querySelector('#na').value.trim(), observaciones: m.querySelector('#ob').value.trim(),
        }));
        closeModal(); toast('Inscripción actualizada'); viewMisInscripciones();
      } catch (err) { toast(err.message, 'err'); }
    });
  }));
}

// ---------- router ----------
function router() {
  document.getElementById('nav').classList.remove('open');
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
    case 'perfil': return viewPerfil();
    case 'mis-inscripciones': return viewMisInscripciones();
    default: app.innerHTML = '<div class="empty"><div class="big">👻</div><p>Esta página se desvaneció.</p><a class="btn" href="#/">Volver</a></div>';
  }
}
window.addEventListener('hashchange', router);

// ---------- chat (WF10) ----------
const chatBox = document.getElementById('chat');
const chatLog = document.getElementById('chatLog');
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
document.getElementById('chatFab').addEventListener('click', () => {
  chatBox.classList.toggle('hidden');
  if (!chatLog.children.length) addMsg('¡Buuu! Soy Gaspar 👻. Pregúntame por eventos, cupos, lista de espera o cómo vincular Telegram.', 'bot');
  document.getElementById('chatInput').focus();
});
document.getElementById('chatClose').addEventListener('click', () => chatBox.classList.add('hidden'));
document.getElementById('chatForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = document.getElementById('chatInput');
  const texto = input.value.trim();
  if (!texto) return;
  input.value = '';
  addMsg(texto, 'user');
  const pending = addMsg('Gaspar está pensando… 🕯️', 'bot');
  try { pending.textContent = await chat(chatId, texto); } catch (err) {
    pending.textContent = err instanceof ApiError ? err.message : 'No pude responder ahora mismo.';
    pending.classList.add('err');
  }
});

// ---------- arranque ----------
async function boot() {
  router();
  if (session.token) {
    try { const r = await api.validar(); session.setUser({ usuario_id: r.data.usuario_id, nombre: r.data.nombre, email: r.data.email }); } catch (err) {
      if (err.status === 401 || err.status === 403) { session.clear(); toast('Tu sesión expiró, vuelve a entrar', 'err'); }
    }
    renderNav();
  }
}
boot();
