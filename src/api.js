// Cliente HTTP hacia n8n. El frontend nunca toca Google Sheets: todo pasa por los webhooks.
const BASE = (import.meta.env.VITE_N8N_BASE_URL || '').replace(/\/$/, '');
const CHAT_URL = import.meta.env.VITE_N8N_CHAT_URL || '';

const TOKEN_KEY = 'ep_token';
const USER_KEY = 'ep_user';
const VISITOR_KEY = 'ep_visitor';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin storage */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* sin storage */ } },
};

export const session = {
  get token() { return store.get(TOKEN_KEY); },
  get user() { try { return JSON.parse(store.get(USER_KEY) || 'null'); } catch { return null; } },
  save(token, user) { store.set(TOKEN_KEY, token); store.set(USER_KEY, JSON.stringify(user)); },
  setUser(user) { store.set(USER_KEY, JSON.stringify(user)); },
  clear() { store.del(TOKEN_KEY); store.del(USER_KEY); },
};

export function visitorId() {
  let v = store.get(VISITOR_KEY);
  if (!v) { v = 'v' + crypto.randomUUID().replace(/-/g, '').slice(0, 20); store.set(VISITOR_KEY, v); }
  return v;
}

export class ApiError extends Error {
  constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}

async function call(path, body, { auth = false } = {}) {
  if (!BASE) throw new ApiError('Falta configurar VITE_N8N_BASE_URL', 'CONFIG', 0);
  const headers = { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' };
  if (auth) {
    if (!session.token) throw new ApiError('Inicia sesión para continuar', 'SESION_INVALIDA', 401);
    headers.Authorization = 'Bearer ' + session.token;
  }
  let res;
  try {
    res = await fetch(`${BASE}/webhook/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new ApiError('No pudimos contactar al servidor. ¿Está n8n despierto?', 'RED', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* respuesta vacía */ }
  if (!res.ok || !data || data.ok === false) {
    const err = new ApiError(data?.message || `Error ${res.status}`, data?.error || 'ERROR', res.status);
    if (err.code === 'SESION_INVALIDA') session.clear();
    throw err;
  }
  return data;
}

export const api = {
  // WF05 — Catálogo público
  listado: () => call('catalogo', { accion: 'listado', visitor_id: visitorId() }),
  filtro: (categoria) => call('catalogo', { accion: 'filtro', categoria, visitor_id: visitorId() }),
  detalle: (evento_id) => call('catalogo', { accion: 'detalle', evento_id, visitor_id: visitorId() }),
  disponibilidad: (evento_id) => call('catalogo', { accion: 'disponibilidad', evento_id, visitor_id: visitorId() }),

  // WF01 — Usuarios
  registrar: (nombre, email, password) => call('usuarios', { accion: 'crear', nombre, email, password }),
  verificarEmail: (email, codigo) => call('usuarios', { accion: 'verificar', email, codigo }),
  reenviarCodigo: (email) => call('usuarios', { accion: 'reenviar', email }),
  recuperar: (email) => call('usuarios', { accion: 'recuperar', email }),
  restablecer: (email, codigo, password) => call('usuarios', { accion: 'restablecer', email, codigo, password }),
  perfil: () => call('usuarios', { accion: 'perfil' }, { auth: true }),
  actualizarPerfil: (cambios) => call('usuarios', { accion: 'actualizar', ...cambios }, { auth: true }),
  desactivar: () => call('usuarios', { accion: 'desactivar' }, { auth: true }),

  // WF02 — Sesiones
  login: (email, password) => call('auth', { accion: 'login', email, password }),
  logout: () => call('auth', { accion: 'logout' }, { auth: true }),
  validar: () => call('auth', { accion: 'validar' }, { auth: true }),

  // WF03 — Telegram
  telegramEstado: () => call('telegram', { accion: 'estado' }, { auth: true }),
  telegramCodigo: () => call('telegram', { accion: 'solicitar_codigo' }, { auth: true }),

  // WF06 — Inscripciones
  inscribir: (evento_id, extra = {}) => call('inscripciones', { accion: 'crear', evento_id, ...extra }, { auth: true }),
  misInscripciones: () => call('inscripciones', { accion: 'listar' }, { auth: true }),
  actualizarInscripcion: (inscripcion_id, cambios) => call('inscripciones', { accion: 'actualizar', inscripcion_id, ...cambios }, { auth: true }),
  cancelarInscripcion: (inscripcion_id) => call('inscripciones', { accion: 'cancelar', inscripcion_id }, { auth: true }),
};

// WF11 — Check-in digital. Devuelve el cuerpo también en rechazos y duplicados (409, 404, 422…),
// porque la portería necesita ver el motivo, no solo que falló.
export async function registrarCheckin(inscripcion_id, evento_id) {
  if (!BASE) throw new ApiError('Falta configurar VITE_N8N_BASE_URL', 'CONFIG', 0);
  let res;
  try {
    res = await fetch(`${BASE}/webhook/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify({ inscripcion_id, evento_id }),
    });
  } catch {
    throw new ApiError('No pudimos contactar al servidor. ¿Está n8n despierto?', 'RED', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* respuesta vacía */ }
  if (!data?.resultado) throw new ApiError(data?.message || `Error ${res.status}`, data?.error || 'ERROR', res.status);
  return data;
}

// WF10 — Chat Trigger (protocolo del chat de n8n)
export async function chat(chatId, texto) {
  if (!CHAT_URL) throw new ApiError('Falta configurar VITE_N8N_CHAT_URL', 'CONFIG', 0);
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
    body: JSON.stringify({
      action: 'sendMessage', sessionId: chatId, chatInput: texto,
      metadata: { usuario_id: session.user?.usuario_id || '', visitor_id: visitorId() },
    }),
  });
  if (!res.ok) throw new ApiError('El asistente no responde ahora mismo', 'CHAT', res.status);
  const data = await res.json();
  return String(data.output ?? data.text ?? '');
}
