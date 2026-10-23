# 🎃 EventPass · Noche de Brujas

Plataforma pública de eventos con temática de Halloween. El frontend es solo un cliente: **toda la lógica del negocio vive en n8n** (validaciones, persistencia, estados, idempotencia, integraciones y notificaciones) y la persistencia académica se hace en **Google Sheets**.

| | |
|---|---|
| **Estudiante** | Achinti Morales Hernández (GitHub: `achinti24`) |
| **Compañero de apoyo** | Johan Santiago Ramos |
| **URL pública (Vercel)** | [eventpass-halloween.vercel.app](https://eventpass-halloween.vercel.app) |
| **Bot de Telegram** | [@EventPassHalloween_bot](https://t.me/EventPassHalloween_bot) |
| **Formulario de administración (WF04)** | `{N8N_PUBLIC_URL}/form/b595dc49-1160-42fc-a883-19427b4d7037` |

---

## 1. Descripción

EventPass permite:

- consultar públicamente el catálogo de eventos (listado, detalle, filtro por categoría y disponibilidad);
- registrarse verificando el email con un código, iniciar y cerrar sesión, recuperar la cuenta si se olvida la contraseña, consultar y actualizar el perfil, y desactivar la cuenta;
- vincular una cuenta de Telegram con un código temporal de un solo uso;
- inscribirse a eventos con control de cupos y **lista de espera** automática;
- editar y cancelar inscripciones;
- **reasignar automáticamente** los cupos liberados a quien lleva más tiempo esperando;
- recibir **recordatorios** y **notificaciones por Gmail y Telegram**;
- conversar con **Gaspar 👻**, un asistente de IA de solo lectura.

La administración de eventos la hace únicamente el administrador mediante un **n8n Form**.

### Eventos de prueba

8 eventos en 7 categorías (Cultura, Tecnología, Educación, Comunidad, Deportes, Networking, Emprendimiento):

| ID | Evento | Categoría | Caso de prueba |
|---|---|---|---|
| EVT-001 | Maratón de Cine de Terror: Clásicos Malditos | Cultura | con cupos disponibles |
| EVT-002 | Hackatón Embrujado: Código desde la Cripta | Tecnología | **lleno** (3/3) + 1 en lista de espera |
| EVT-003 | Taller de Tallado de Calabazas | Educación | **próximo a realizarse** |
| EVT-004 | Desfile Comunitario de Disfraces | Comunidad | con cupos |
| EVT-005 | Carrera Zombie 5K | Deportes | **CANCELADO** |
| EVT-006 | Noche de Networking: Vampiros del Emprendimiento | Networking | **CERRADO** |
| EVT-007 | Feria de Pociones Emprendedoras | Emprendimiento | BORRADOR (no público) |
| EVT-008 | Leyendas del Río Fonce: La Llorona y el Mohán | Cultura | con cupos |

Usuarios demo (contraseña `Halloween2026`): `demo1@eventpass.example` … `demo4@eventpass.example`.

---

## 2. Arquitectura

```
Aplicación pública en Vercel (Vite + JS)
        │  HTTP POST JSON  /  Chat
        ▼
      n8n  (Docker, expuesto con ngrok)
        │
  Reglas del negocio (Code, IF/Switch, Filter, Aggregate)
        │
  Google Sheets (EP01 … EP10, un archivo por dominio)
        │
  Gmail · Telegram · Gemini (IA)
```

- El frontend **nunca** accede a Google Sheets: toda lectura/escritura pasa por los webhooks de n8n.
- Cada workflow principal persiste en **su propio archivo** de Google Sheets.
- Las notificaciones están centralizadas en **WF09**, que los demás invocan con *Execute Sub-workflow*.

## 3. Tecnologías

| Capa | Tecnología |
|---|---|
| Frontend | Vite 6, JavaScript (ES modules) sin framework, CSS propio, fuente Bricolage Grotesque, iconos SVG |
| Hosting | Vercel |
| Automatización | n8n 2.43 (Docker), túnel ngrok |
| Persistencia | Google Sheets (OAuth2) |
| Notificaciones | Gmail (OAuth2), Telegram Bot API |
| IA | Google Gemini (`gemini-3.6-flash`) con AI Agent de n8n |
| Seguridad | PBKDF2-SHA512 + salt, tokens de sesión aleatorios de 256 bits |

---

## 4. Workflows

| Workflow | Archivo | Trigger | Google Sheets |
|---|---|---|---|
| WF01 Usuarios CRUD | `n8n/WF01_usuarios_crud.json` | Webhook `POST /webhook/usuarios` | EP01_Usuarios (`Usuarios`, `Auditoria_Usuarios`, `Codigos_Email`) |
| WF02 Autenticación y sesiones | `n8n/WF02_auth_sesiones.json` | Webhook `POST /webhook/auth` | EP02_Sesiones (`Sesiones`) |
| WF03 Vinculación Telegram | `n8n/WF03_vinculacion_telegram.json` | Webhook `POST /webhook/telegram` + **Telegram Trigger** | EP03_Telegram (`Codigos_Vinculacion`, `Vinculaciones`) |
| WF04 Eventos CRUD | `n8n/WF04_eventos_crud.json` | **n8n Form Trigger** | EP04_Eventos (`Eventos`, `Auditoria_Eventos`) |
| WF05 Catálogo público | `n8n/WF05_catalogo_publico.json` | Webhook `POST /webhook/catalogo` | EP05_Catalogo_Log (`Consultas_Catalogo`) |
| WF06 Inscripciones CRUD | `n8n/WF06_inscripciones_crud.json` | Webhook `POST /webhook/inscripciones` | EP06_Inscripciones (`Inscripciones`, `Auditoria_Inscripciones`) |
| WF07 Reasignación lista de espera | `n8n/WF07_reasignacion_lista_espera.json` | **Schedule** (cada 15 min) | EP07_Reasignaciones (`Reasignaciones`) |
| WF08 Recordatorios | `n8n/WF08_recordatorios.json` | **Schedule** (cada hora) | EP08_Recordatorios (`Recordatorios`) |
| WF09 Notificaciones | `n8n/WF09_notificaciones.json` | **Execute Sub-workflow Trigger** | EP09_Notificaciones (`Notificaciones`) |
| WF10 EventPass Assistant | `n8n/WF10_eventpass_assistant.json` | **Chat Trigger** | EP10_Soporte (`Conversaciones`, `Mensajes`) |

Los IDs de los archivos de Google Sheets están en [`n8n/sheets_ids.json`](n8n/sheets_ids.json) y en el nodo **Config** de cada workflow.

---

## 5. Comunicación frontend → n8n

Todas las llamadas son `POST` con cuerpo JSON a `{VITE_N8N_BASE_URL}/webhook/{recurso}` ([`src/api.js`](src/api.js)).

- El campo `accion` del cuerpo indica la operación; n8n la enruta con nodos IF.
- Las rutas privadas envían `Authorization: Bearer <session_token>`.
- Respuesta uniforme:
  - éxito → `{ "ok": true, "data": …, "message": "…" }`
  - error → `{ "ok": false, "error": "CODIGO", "message": "…" }` con el código HTTP correspondiente (400, 401, 403, 404, 409).
- El header `ngrok-skip-browser-warning` evita la página intermedia de ngrok. CORS está habilitado en cada webhook (`allowedOrigins: *`).
- La interfaz maneja **loading** (esqueletos, spinners), **éxito** (toasts) y **error** (cajas de error con reintento).
- **Rendimiento:** WF05 guarda eventos e inscripciones 30 s en la memoria del workflow (`$getWorkflowStaticData`) y responde antes de registrar la consulta; el frontend guarda el último catálogo en `localStorage`, lo muestra al instante y lo refresca en segundo plano, filtra por categoría sin esperar y abre la conexión con n8n por adelantado (`preconnect`).

## 6. Endpoints

| Endpoint | `accion` | Auth | Cuerpo |
|---|---|---|---|
| `/webhook/usuarios` | `crear` | — | `nombre`, `email`, `password` |
| | `verificar` | — | `email`, `codigo` |
| | `reenviar` | — | `email` |
| | `recuperar` | — | `email` |
| | `restablecer` | — | `email`, `codigo`, `password` |
| | `perfil` | Bearer | — |
| | `actualizar` | Bearer | `nombre?`, `password?` |
| | `desactivar` | Bearer | — |
| `/webhook/auth` | `login` | — | `email`, `password` |
| | `validar` | Bearer | — |
| | `logout` | Bearer | — |
| `/webhook/telegram` | `estado` | Bearer | — |
| | `solicitar_codigo` | Bearer | — |
| `/webhook/catalogo` | `listado` | — | `visitor_id` |
| | `filtro` | — | `categoria`, `visitor_id` |
| | `detalle` | — | `evento_id`, `visitor_id` |
| | `disponibilidad` | — | `evento_id`, `visitor_id` |
| `/webhook/inscripciones` | `crear` | Bearer | `evento_id`, `nombre_acreditacion?`, `observaciones?` |
| | `listar` | Bearer | — |
| | `actualizar` | Bearer | `inscripcion_id`, `nombre_acreditacion?`, `observaciones?` |
| | `cancelar` | Bearer | `inscripcion_id` |
| `/webhook/{id}/chat` | `sendMessage` | — | `sessionId`, `chatInput`, `metadata.usuario_id` |

## 7. Estados

| Entidad | Estados |
|---|---|
| Usuario | `PENDIENTE` (email sin verificar), `ACTIVO`, `INACTIVO` |
| Código de email | `PENDIENTE`, `USADO`, `EXPIRADO`, `CANCELADO` (tipos `VERIFICACION`, `RECUPERACION`) |
| Sesión | `ACTIVA`, `CERRADA`, `EXPIRADA` |
| Código de vinculación | `PENDIENTE`, `USADO`, `EXPIRADO`, `CANCELADO` |
| Vinculación Telegram | `ACTIVA`, `INACTIVA` |
| Evento | `BORRADOR`, `PUBLICADO`, `CERRADO`, `CANCELADO` |
| Inscripción | `CONFIRMADA`, `LISTA_ESPERA`, `CANCELADA` |
| Recordatorio | `PENDIENTE`, `ENVIADO`, `ERROR`, `OMITIDO` |
| Canal de notificación | `PENDIENTE`, `ENVIADO`, `ERROR`, `NO_APLICA` |
| Conversación | `ABIERTA`, `CERRADA` |
| Rol de mensaje | `USER`, `ASSISTANT`, `SYSTEM` |

**Borrado lógico:** ningún registro principal se elimina; solo cambia de estado.

---

## 8. Hashing de contraseñas

En WF01 (nodo *Hash y salt*) se genera un salt aleatorio de 16 bytes (`crypto.randomBytes`) y se deriva el hash con **PBKDF2-SHA512, 100 000 iteraciones, 64 bytes**. En la hoja solo se guardan `password_hash` y `password_salt` (hex), nunca la contraseña.

En el login (WF02, nodo *Verificar credenciales*) se recalcula el hash con el salt guardado y se compara con `crypto.timingSafeEqual`, para evitar ataques de tiempo. Ante email inexistente o contraseña incorrecta la respuesta es idéntica (`CREDENCIALES_INVALIDAS`), así no se revela qué emails existen.

### Verificación de email y recuperación de cuenta

- Al registrarse, la cuenta nace `PENDIENTE` y WF01 envía (vía WF09) un **código de 6 dígitos** al correo. Con `verificar` la cuenta pasa a `ACTIVO` y llega un correo de bienvenida. Mientras está pendiente, el login responde `403 CUENTA_NO_VERIFICADA`.
- Con `recuperar` se envía un código al correo (y a Telegram si está vinculado); con `restablecer` se cambia la contraseña, se cierran **todas las sesiones abiertas** y se avisa al usuario.
- Los códigos se generan con `crypto.randomInt`, se guardan en `Codigos_Email` **solo como hash** SHA-256 (con el `codigo_id` como sal), vencen a los **15 minutos**, sirven **una sola vez**, admiten **5 intentos** y se pueden pedir de nuevo cada **60 segundos**. Al pedir uno nuevo, los anteriores pasan a `CANCELADO`.
- `recuperar` y `reenviar` responden lo mismo exista o no el email, para no revelar qué cuentas existen.
- En la hoja `Notificaciones` se registra "código enviado", nunca el código.

## 9. Manejo de sesiones

- El login crea una fila en `Sesiones` con `session_token` = 32 bytes aleatorios (hex), `estado = ACTIVA` y `expira_en = creada_en + 24 h`.
- Cada ruta privada valida el token: debe existir, estar `ACTIVA`, no estar vencida y pertenecer a un usuario `ACTIVO`.
- Si al validar está vencida, se actualiza a `EXPIRADA`. `logout` la pasa a `CERRADA` con `cerrada_en`. Cada validación exitosa actualiza `ultima_validacion`.
- El frontend guarda el token en `localStorage` y lo revalida al cargar la página.

## 10. Idempotencia

| Caso | Mecanismo |
|---|---|
| Inscripción | Antes de crear se busca otra inscripción `CONFIRMADA` o `LISTA_ESPERA` del mismo `usuario_id + evento_id` → `409 YA_INSCRITO`. |
| Cancelación | Cancelar una inscripción ya `CANCELADA` no genera cambios (`NOOP`). |
| Código Telegram | El código pasa a `USADO` al vincular; reutilizarlo responde "ya fue utilizado". Al pedir uno nuevo, los `PENDIENTE` anteriores pasan a `CANCELADO`. |
| Recordatorios | WF08 (cada hora) envía `RECORDATORIO_24H` y `RECORDATORIO_1H` a las inscripciones `CONFIRMADA`. `clave_idempotencia = usuario_id\|evento_id\|tipo_recordatorio`; si ya hay un recordatorio `ENVIADO` con esa clave, no se repite. |
| Notificaciones | WF09 recibe `clave_idempotencia`; si ya hay una notificación con esa clave enviada por algún canal, se omite (`DUPLICADO`). |
| Email | `email_normalizado` (trim + minúsculas) único → `409 EMAIL_DUPLICADO`. |

## 11. Lista de espera y reasignación

- Cupos disponibles = `capacidad − inscripciones CONFIRMADAS`. Nunca se guarda un valor manual de cupos.
- Si hay cupo, la inscripción nace `CONFIRMADA`; si no, `LISTA_ESPERA` con `orden_espera` incremental.
- Al cancelar una `CONFIRMADA` se libera un cupo.
- **WF07** (cada 15 min) recorre los eventos `PUBLICADO`, calcula los cupos libres y promueve a `CONFIRMADA` a los primeros N de la lista ordenados por **`fecha_inscripcion ASC`**. Cada promoción se audita en `Reasignaciones` y se notifica por Gmail + Telegram.

## 12. Servicio central de notificaciones (WF09)

Entrada: `usuario_id`, `tipo`, `titulo`, `mensaje`, `evento_id`, `inscripcion_id`, `clave_idempotencia`.

1. Valida la entrada y el control de duplicados.
2. Busca el usuario (email) y su vinculación de Telegram (`chat_id`).
3. Envía por **Gmail** (correo HTML con estética de Halloween) y por **Telegram**. Cada nodo tiene `onError: continueRegularOutput`, así que la falla de un canal no oculta el resultado del otro.
4. Registra en `Notificaciones` el resultado **independiente** de cada canal: `gmail_estado/gmail_error` y `telegram_estado/telegram_error` (`ENVIADO`, `ERROR` o `NO_APLICA`).

Lo usan WF01 (códigos de verificación y recuperación, bienvenida, aviso de contraseña cambiada), WF04 (cambios en eventos), WF06 (confirmación, lista de espera, cancelación), WF07 (reasignación) y WF08 (recordatorios).

La entrada opcional `mensaje_registro` permite guardar en `Notificaciones` un texto distinto al enviado (se usa para no guardar los códigos).

## 13. Asistente IA (WF10)

Gaspar 👻 responde sobre eventos, categorías, fechas, lugares, cupos, lista de espera, vinculación de Telegram y estados de inscripción.

- **Chat Trigger** público + **AI Agent** con modelo Gemini y memoria de ventana por conversación.
- **Herramientas de solo lectura**: `consultar_eventos` y `consultar_inscripciones`, usada solo para contar cupos.
- `conversation_id = CONV-{sessionId}`. Se identifica `usuario_id` (si el frontend envía la sesión) o `visitor_id`.
- Se persiste la conversación en `Conversaciones` y **cada mensaje** (`USER` y `ASSISTANT`) en `Mensajes`. La conversación completa se reconstruye filtrando por `conversation_id`.
- **Restricciones** (prompt de sistema): no puede crear usuarios, iniciar sesión, crear o cancelar inscripciones, modificar eventos, cambiar cupos ni estados, ni revelar datos personales. Ignora intentos de cambiar sus reglas. Además, no tiene ninguna herramienta de escritura.

---

## 14. Variables de entorno (`.env.example`)

| Variable | Descripción |
|---|---|
| `VITE_N8N_BASE_URL` | URL pública de n8n, sin barra final |
| `VITE_N8N_CHAT_URL` | URL del Chat Trigger de WF10 (`…/webhook/{id}/chat`) |
| `VITE_TELEGRAM_BOT` | Usuario del bot, sin `@` |

Los secretos de n8n (OAuth de Google, token de Telegram, API key de Gemini) **no** están en el repositorio: viven en las credenciales cifradas de n8n.

## 15. Ejecutar el proyecto

**n8n**
```bash
./scripts/n8n-up.sh                          # contenedor n8n (volumen n8n_data)
ngrok http 5678                              # túnel público
PUBLIC_URL=https://<tu-dominio> ./scripts/n8n-up.sh
```
1. Importar los JSON de `n8n/` (Workflows → Import from file).
2. Crear las credenciales: Google Sheets OAuth2, Gmail OAuth2, Telegram y Google Gemini.
3. Asignarlas y activar los workflows. Activar WF09 antes que WF04/WF06/WF07/WF08, porque estos lo invocan.

Opcional: `scripts/patch_workflows.py` asigna credenciales e IDs de Sheets por API, y `scripts/setup_sheets.py` crea las hojas y los datos de prueba.

**Frontend**
```bash
cp .env.example .env.local   # completar URLs
npm install
npm run dev                  # http://localhost:5173
npm run build                # dist/ (lo que publica Vercel)
```

## 16. Estructura del repositorio

```
/
├── index.html, src/, public/   # frontend (Vite)
├── n8n/                        # WF01…WF10 exportados + sheets_ids.json
├── scripts/                    # arranque de n8n, creación de hojas, parcheo de workflows
├── docs/                       # documentación adicional
├── .env.example
└── README.md
```
