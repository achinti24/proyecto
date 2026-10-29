#!/usr/bin/env python3
"""Crea los 10 Google Sheets de EventPass (EP01..EP10) con sus hojas, encabezados y datos de prueba.

Usa un workflow auxiliar de n8n (webhook -> HTTP Request con la credencial OAuth de Google Sheets)
para no manejar tokens de Google fuera de n8n. Guarda los IDs creados en n8n/sheets_ids.json.

Uso: python3 scripts/setup_sheets.py [--seed-only]
"""
import hashlib
import json
import os
import secrets
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROXY = os.environ.get("SETUP_PROXY", "http://localhost:5678/webhook/ep-setup-7f3k")
IDS_FILE = os.path.join(ROOT, "n8n", "sheets_ids.json")
API = "https://sheets.googleapis.com/v4/spreadsheets"

ESTRUCTURA = {
    "EP01_Usuarios": {
        "Usuarios": ["usuario_id", "nombre", "email_normalizado", "password_hash", "password_salt", "estado", "fecha_registro", "fecha_actualizacion"],
        "Auditoria_Usuarios": ["auditoria_id", "usuario_id", "accion", "fecha", "resultado", "detalle"],
        "Codigos_Email": ["codigo_id", "usuario_id", "email_normalizado", "tipo", "codigo_hash", "creado_en", "expira_en", "estado", "intentos", "usado_en"],
    },
    "EP02_Sesiones": {
        "Sesiones": ["session_id", "usuario_id", "session_token", "creada_en", "expira_en", "estado", "cerrada_en", "ultima_validacion"],
    },
    "EP03_Telegram": {
        "Codigos_Vinculacion": ["codigo_id", "usuario_id", "codigo", "creado_en", "expira_en", "estado", "usado_en"],
        "Vinculaciones": ["vinculacion_id", "usuario_id", "chat_id", "telegram_username", "fecha_vinculacion", "estado"],
    },
    "EP04_Eventos": {
        "Eventos": ["evento_id", "nombre", "categoria", "descripcion", "fecha", "hora", "lugar", "capacidad", "imagen_url", "organizador", "estado", "fecha_creacion", "fecha_actualizacion"],
        "Auditoria_Eventos": ["auditoria_id", "evento_id", "accion", "fecha", "resultado", "detalle"],
    },
    "EP05_Catalogo_Log": {
        "Consultas_Catalogo": ["consulta_id", "fecha", "tipo", "evento_id", "categoria", "resultado_count", "visitor_id", "status_http"],
    },
    "EP06_Inscripciones": {
        "Inscripciones": ["inscripcion_id", "usuario_id", "evento_id", "estado", "fecha_inscripcion", "fecha_actualizacion", "nombre_acreditacion", "observaciones", "origen", "orden_espera"],
        "Auditoria_Inscripciones": ["auditoria_id", "inscripcion_id", "usuario_id", "evento_id", "accion", "estado_anterior", "estado_nuevo", "fecha", "resultado", "detalle"],
    },
    "EP07_Reasignaciones": {
        "Reasignaciones": ["reasignacion_id", "evento_id", "inscripcion_id", "usuario_id", "fecha", "orden_lista", "estado_anterior", "estado_nuevo", "resultado_notificacion"],
    },
    "EP08_Recordatorios": {
        "Recordatorios": ["recordatorio_id", "usuario_id", "evento_id", "inscripcion_id", "tipo_recordatorio", "fecha_programada", "fecha_envio", "estado", "clave_idempotencia"],
    },
    "EP09_Notificaciones": {
        "Notificaciones": ["notificacion_id", "usuario_id", "tipo", "titulo", "mensaje", "evento_id", "inscripcion_id", "fecha", "gmail_estado", "telegram_estado", "gmail_error", "telegram_error", "clave_idempotencia"],
    },
    "EP10_Soporte": {
        "Conversaciones": ["conversation_id", "usuario_id", "visitor_id", "fecha_inicio", "fecha_ultima_interaccion", "estado"],
        "Mensajes": ["message_id", "conversation_id", "usuario_id", "visitor_id", "rol", "mensaje", "timestamp"],
    },
    "EP11_Checkin": {
        "Checkins": ["checkin_id", "inscripcion_id", "evento_id", "usuario_id", "fecha_checkin", "resultado", "detalle"],
    },
}


def google(method, url, payload=None):
    body = json.dumps({"method": method, "url": url, "payload": payload}).encode()
    req = urllib.request.Request(PROXY, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read() or b"{}")
    if isinstance(data, dict) and data.get("error"):
        raise SystemExit(f"Error de Google en {method} {url}: {json.dumps(data['error'])[:500]}")
    return data


def crear_archivos():
    ids = {}
    for archivo, hojas in ESTRUCTURA.items():
        payload = {
            "properties": {"title": archivo, "locale": "es_CO", "timeZone": "America/Bogota"},
            "sheets": [
                {
                    "properties": {"title": hoja, "gridProperties": {"frozenRowCount": 1}, "tabColor": {"red": 1, "green": 0.48, "blue": 0.09}},
                    "data": [{"startRow": 0, "startColumn": 0, "rowData": [{"values": [
                        {"userEnteredValue": {"stringValue": c}, "userEnteredFormat": {
                            "textFormat": {"bold": True, "foregroundColor": {"red": 1, "green": 1, "blue": 1}},
                            "backgroundColor": {"red": 0.17, "green": 0.09, "blue": 0.27}}}
                        for c in columnas]}]}],
                }
                for hoja, columnas in hojas.items()
            ],
        }
        r = google("POST", API, payload)
        ids[archivo[:4]] = r["spreadsheetId"]
        print(f"  ✔ {archivo}: {r['spreadsheetId']}")
    return ids


def append(spreadsheet_id, hoja, columnas, filas):
    valores = [[f.get(c, "") for c in columnas] for f in filas]
    url = f"{API}/{spreadsheet_id}/values/{hoja}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS"
    google("POST", url, {"values": valores})
    print(f"  ✔ {hoja}: {len(filas)} filas")


def hash_password(password):
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha512", password.encode(), salt.encode(), 100000, 64).hex()
    return h, salt


def sembrar(ids):
    tz = timezone(timedelta(hours=-5))
    ahora = datetime.now(tz)
    iso = lambda d: d.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    dia = lambda n: (ahora + timedelta(days=n)).strftime("%Y-%m-%d")

    eventos = [
        ("EVT-001", "Maratón de Cine de Terror: Clásicos Malditos", "Cultura",
         "Cuatro clásicos del cine de terror en pantalla gigante, con crispetas sangrientas y concurso de gritos entre función y función. Se recomienda venir disfrazado.",
         dia(9), "19:00", "Teatro Municipal de San Gil", 60, "/img/cat-cultura.svg", "Cineclub La Cripta", "PUBLICADO"),
        ("EVT-002", "Hackatón Embrujado: Código desde la Cripta", "Tecnología",
         "Doce horas para construir la app más terrorífica. Equipos de 3, mentores vampiro y café de pócima ilimitado. Cupos muy limitados.",
         dia(8), "18:00", "Laboratorio TIC, Campus Unisangil", 3, "/img/cat-tecnologia.svg", "Comunidad Dev Santander", "PUBLICADO"),
        ("EVT-003", "Taller de Tallado de Calabazas", "Educación",
         "Aprende técnicas de tallado, vaciado y luces para tu calabaza. Incluye calabaza, herramientas y velas LED.",
         dia(1), "16:00", "Casa de la Cultura de San Gil", 20, "/img/cat-educacion.svg", "Escuela de Artes y Oficios", "PUBLICADO"),
        ("EVT-004", "Desfile Comunitario de Disfraces", "Comunidad",
         "Recorrido familiar por el centro con comparsas, banda de música y premiación al disfraz más aterrador, más creativo y más tierno.",
         dia(9), "15:00", "Parque Principal de San Gil", 150, "/img/cat-comunidad.svg", "Junta de Acción Comunal Centro", "PUBLICADO"),
        ("EVT-005", "Carrera Zombie 5K", "Deportes",
         "Corre 5 km escapando de zombies que intentan quitarte tus banderas de vida. Evento cancelado por el pronóstico de lluvias.",
         dia(3), "07:00", "Malecón del Río Fonce", 100, "/img/cat-deportes.svg", "Club de Atletismo Fonce", "CANCELADO"),
        ("EVT-006", "Noche de Networking: Vampiros del Emprendimiento", "Networking",
         "Encuentro para conectar con emprendedores y mentores a la luz de las velas. Inscripciones cerradas.",
         dia(-1), "19:00", "Hotel Colonial, salón principal", 40, "/img/cat-networking.svg", "Cámara de Comercio de San Gil", "CERRADO"),
        ("EVT-007", "Feria de Pociones Emprendedoras", "Emprendimiento",
         "Feria de productos artesanales con temática de brujería: velas, jabones, dulces y cosmética natural. En preparación.",
         dia(16), "10:00", "Plaza de mercado de San Gil", 80, "/img/cat-emprendimiento.svg", "Red de Emprendedoras de Santander", "BORRADOR"),
        ("EVT-008", "Leyendas del Río Fonce: La Llorona y el Mohán", "Cultura",
         "Recorrido nocturno de narración oral por la ribera del río con las leyendas más escalofriantes de Santander.",
         dia(7), "20:00", "Parque El Gallineral", 40, "/img/cat-cultura.svg", "Colectivo Cuenteros del Fonce", "PUBLICADO"),
    ]
    cols_ev = ESTRUCTURA["EP04_Eventos"]["Eventos"]
    filas_ev = [dict(zip(cols_ev[:11], e), fecha_creacion=iso(ahora), fecha_actualizacion=iso(ahora)) for e in eventos]
    append(ids["EP04"], "Eventos", cols_ev, filas_ev)
    append(ids["EP04"], "Auditoria_Eventos", ESTRUCTURA["EP04_Eventos"]["Auditoria_Eventos"], [
        {"auditoria_id": f"AUD-SEED-{i:02d}", "evento_id": e[0], "accion": "CREAR", "fecha": iso(ahora), "resultado": "OK", "detalle": "Dato de prueba inicial (" + e[10] + ")"}
        for i, e in enumerate(eventos, 1)
    ])

    # Usuarios demo para dejar EVT-002 lleno y con lista de espera (contraseña: Halloween2026)
    demo = [("USR-DEMO-01", "Morticia Demo"), ("USR-DEMO-02", "Drácula Demo"), ("USR-DEMO-03", "Frankie Demo"), ("USR-DEMO-04", "Casper Demo")]
    usuarios = []
    for i, (uid, nombre) in enumerate(demo, 1):
        h, s = hash_password("Halloween2026")
        usuarios.append({"usuario_id": uid, "nombre": nombre, "email_normalizado": f"demo{i}@eventpass.example",
                         "password_hash": h, "password_salt": s, "estado": "ACTIVO",
                         "fecha_registro": iso(ahora - timedelta(days=5)), "fecha_actualizacion": iso(ahora - timedelta(days=5))})
    append(ids["EP01"], "Usuarios", ESTRUCTURA["EP01_Usuarios"]["Usuarios"], usuarios)

    ins = []
    for i, (uid, nombre) in enumerate(demo, 1):
        f = iso(ahora - timedelta(days=4, hours=-i))
        ins.append({"inscripcion_id": f"INS-DEMO-{i:02d}", "usuario_id": uid, "evento_id": "EVT-002",
                    "estado": "CONFIRMADA" if i <= 3 else "LISTA_ESPERA", "fecha_inscripcion": f, "fecha_actualizacion": f,
                    "nombre_acreditacion": nombre, "observaciones": "Dato de prueba", "origen": "SEED",
                    "orden_espera": "" if i <= 3 else 1})
    append(ids["EP06"], "Inscripciones", ESTRUCTURA["EP06_Inscripciones"]["Inscripciones"], ins)


def main():
    if "--seed-only" in sys.argv:
        ids = json.load(open(IDS_FILE))
    else:
        print("Creando archivos de Google Sheets…")
        ids = crear_archivos()
        with open(IDS_FILE, "w") as f:
            json.dump(ids, f, indent=2)
    print("Sembrando datos de prueba…")
    sembrar(ids)
    print("Listo. IDs en", IDS_FILE)


if __name__ == "__main__":
    main()
