# Pruebas realizadas

Pruebas manuales contra los webhooks reales de n8n (curl), 2026-10-22/23.

## WF05 — Catálogo
| Caso | Resultado |
|---|---|
| `listado` | 5 eventos `PUBLICADO`; se ocultan CANCELADO, CERRADO y BORRADOR |
| Cupos de EVT-002 (capacidad 3, 3 confirmadas) | `cupos_disponibles: 0`, `lleno: true` |
| `filtro` categoría `cultura` (sin tilde/mayúscula) | coincide con "Cultura" |
| `detalle` de EVT-005 (cancelado) | `404 NO_ENCONTRADO` |
| Registro en `Consultas_Catalogo` | una fila por consulta con `tipo` y `status_http` |

## WF01 / WF02 — Usuarios y sesiones
| Caso | Resultado |
|---|---|
| Registro válido | `201`, usuario `ACTIVO`, email normalizado a minúsculas |
| Mismo email con otra capitalización | `409 EMAIL_DUPLICADO` |
| Login con contraseña incorrecta | `401 CREDENCIALES_INVALIDAS` |
| Login correcto | token de 64 hex, expira en 24 h |
| `validar`, `perfil`, `actualizar` | `200` |
| Uso del token después de `logout` | `401 SESION_INVALIDA` |

## WF06 — Inscripciones
| Caso | Resultado |
|---|---|
| `crear` sin Telegram vinculado | `403 TELEGRAM_NO_VINCULADO` |
| `listar` sin inscripciones | `200`, lista vacía |
| Sin header Authorization | `401 SESION_INVALIDA` |

## Infraestructura
| Caso | Resultado |
|---|---|
| Preflight CORS desde otro origen con `authorization`, `ngrok-skip-browser-warning` | `204` con headers permitidos |
| Webhook de Telegram registrado | `getWebhookInfo` apunta a `/webhook/{id}/webhook` del túnel ngrok |
| Credencial Gmail | lectura de perfil OK (sin enviar correos) |
