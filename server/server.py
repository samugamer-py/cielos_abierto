#!/usr/bin/env python3
"""
Cielos Abiertos · servidor de juego y multijugador.

Sirve los archivos estáticos del proyecto y mantiene un canal WebSocket en /ws
para sincronizar las aeronaves entre pilotos. Usa sólo la biblioteca estándar.

    python server/server.py [--port 8000] [--host 0.0.0.0] [--no-open]

El juego queda disponible en http://localhost:8000
En una LAN, comparte http://<tu-ip>:8000 y el cliente usará /ws automáticamente.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import secrets
import socket
import struct
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_MESSAGE = 64 * 1024
COLORS = [0x7EE0F2, 0xFFC46B, 0xFF6B5E, 0x9BE564, 0xC792EA, 0x4FC3F7, 0xFF9F43, 0xF4A7C3]

CLIENTS: dict[socket.socket, dict] = {}
CLIENTS_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# Utilidades WebSocket
# ---------------------------------------------------------------------------


class WebSocketClosed(Exception):
    pass


def recv_exact(connection: socket.socket, length: int) -> bytes:
    buffer = b""
    while len(buffer) < length:
        chunk = connection.recv(length - len(buffer))
        if not chunk:
            raise WebSocketClosed("socket cerrado")
        buffer += chunk
    return buffer


def read_frame(connection: socket.socket) -> tuple[bool, int, bytes]:
    header = recv_exact(connection, 2)
    first, second = header
    final = bool(first & 0x80)
    opcode = first & 0x0F
    masked = bool(second & 0x80)
    length = second & 0x7F

    if length == 126:
        length = struct.unpack("!H", recv_exact(connection, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", recv_exact(connection, 8))[0]

    if length > MAX_MESSAGE:
        raise WebSocketClosed("mensaje demasiado grande")

    mask = recv_exact(connection, 4) if masked else b""
    payload = recv_exact(connection, length)
    if masked:
        payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
    return final, opcode, payload


def send_frame(connection: socket.socket, payload: bytes, opcode: int = 0x1) -> None:
    length = len(payload)
    header = bytearray([0x80 | opcode])
    if length < 126:
        header.append(length)
    elif length < 65536:
        header.append(126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(127)
        header.extend(struct.pack("!Q", length))
    connection.sendall(bytes(header) + payload)


def send_json(connection: socket.socket, payload: dict) -> None:
    send_frame(connection, json.dumps(payload, separators=(",", ":")).encode("utf-8"))


def send_json_to(client: dict, payload: dict) -> None:
    data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    with client["lock"]:
        send_frame(client["connection"], data)


def sanitize_name(name: str, fallback: str = "PILOTO") -> str:
    cleaned = "".join(char for char in name if char.isprintable()).strip()
    return cleaned[:16] or fallback


def sanitize_text(text: str) -> str:
    cleaned = "".join(char for char in text if char.isprintable()).strip()
    return cleaned[:140]


def broadcast(payload: dict, exclude: socket.socket | None = None) -> None:
    data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    with CLIENTS_LOCK:
        targets = [
            client for client in CLIENTS.values() if client["connection"] is not exclude
        ]
    for client in targets:
        try:
            with client["lock"]:
                send_frame(client["connection"], data)
        except OSError:
            remove_client(client["connection"])


def remove_client(connection: socket.socket) -> dict | None:
    with CLIENTS_LOCK:
        client = CLIENTS.pop(connection, None)
    if client:
        broadcast({"type": "leave", "id": client["id"], "name": client["name"]})
    return client


# ---------------------------------------------------------------------------
# HTTP + WebSocket
# ---------------------------------------------------------------------------


class GameHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        # Silenciamos el ruido de cada petición; los eventos importantes se
        # imprimen desde handle_websocket.
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if urlparse(self.path).path == "/ws":
            self.handle_websocket()
            return
        super().do_GET()

    def handle_websocket(self) -> None:
        upgrade = self.headers.get("Upgrade", "").lower()
        key = self.headers.get("Sec-WebSocket-Key")
        if upgrade != "websocket" or not key:
            self.send_error(400, "Se esperaba una conexión WebSocket")
            return

        accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.wfile.flush()
        self.close_connection = True

        connection = self.connection
        try:
            connection.settimeout(180)
        except OSError:
            pass

        query = parse_qs(urlparse(self.path).query)
        requested_name = query.get("name", ["PILOTO"])[0]
        name = sanitize_name(requested_name)

        with CLIENTS_LOCK:
            identifier = secrets.token_hex(3)
            while identifier in {client["id"] for client in CLIENTS.values()}:
                identifier = secrets.token_hex(3)
            color = COLORS[len(CLIENTS) % len(COLORS)]
            client = {
                "id": identifier,
                "name": name,
                "color": color,
                "connection": connection,
                "state": None,
                "lock": threading.Lock(),
            }
            CLIENTS[connection] = client
            players = [
                {
                    "id": other["id"],
                    "name": other["name"],
                    "color": other["color"],
                    "state": other["state"],
                }
                for other in CLIENTS.values()
                if other is not client
            ]

        print(f"[+] {name} conectado ({identifier}) · {len(CLIENTS)} piloto(s)")

        try:
            send_json_to(
                client,
                {
                    "type": "welcome",
                    "id": identifier,
                    "name": name,
                    "color": color,
                    "players": players,
                },
            )
            broadcast({"type": "join", "id": identifier, "name": name, "color": color}, exclude=connection)

            fragments = bytearray()
            fragmented = False

            while True:
                final, opcode, payload = read_frame(connection)

                if opcode == 0x8:  # close
                    try:
                        with client["lock"]:
                            send_frame(connection, payload[:125], opcode=0x8)
                    except OSError:
                        pass
                    break
                if opcode == 0x9:  # ping
                    with client["lock"]:
                        send_frame(connection, payload[:125], opcode=0xA)
                    continue
                if opcode == 0xA:  # pong
                    continue

                if opcode == 0x0:  # continuación de un mensaje fragmentado
                    if not fragmented:
                        break
                    fragments.extend(payload)
                    if len(fragments) > MAX_MESSAGE:
                        break
                    if not final:
                        continue
                    complete = bytes(fragments)
                    fragments.clear()
                    fragmented = False
                elif opcode == 0x1:  # texto
                    if fragmented:
                        break
                    if not final:
                        fragmented = True
                        fragments.extend(payload)
                        continue
                    complete = payload
                else:
                    break

                try:
                    message = json.loads(complete.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    continue

                if isinstance(message, dict):
                    handle_message(client, message)

        except (WebSocketClosed, ConnectionError, OSError, ValueError):
            pass
        finally:
            remove_client(connection)
            try:
                connection.close()
            except OSError:
                pass
            print(f"[-] {name} desconectado · {len(CLIENTS)} piloto(s)")


def _finite_number(value, default=0.0) -> float:
    if isinstance(value, (int, float)) and value == value and abs(value) < 1e9:
        return float(value)
    return default


def handle_message(client: dict, message: dict) -> None:
    message_type = message.get("type")

    if message_type == "ping":
        send_json_to(
            client,
            {"type": "pong", "t": message.get("t", 0)},
        )
        return

    if message_type == "state":
        position = message.get("p")
        quaternion = message.get("q")
        if not (isinstance(position, list) and len(position) == 3):
            return
        if not (isinstance(quaternion, list) and len(quaternion) == 4):
            return
        state = {
            "p": [round(_finite_number(value), 2) for value in position],
            "q": [round(_finite_number(value, 1.0 if index == 3 else 0.0), 4) for index, value in enumerate(quaternion)],
            "s": round(_finite_number(message.get("s")), 1),
            "t": round(_finite_number(message.get("t")), 2),
        }
        client["state"] = state
        broadcast(
            {
                "type": "state",
                "id": client["id"],
                "name": client["name"],
                "color": client["color"],
                **state,
            },
            exclude=client["connection"],
        )
        return

    if message_type == "chat":
        text = sanitize_text(str(message.get("text", "")))
        if not text:
            return
        broadcast(
            {
                "type": "chat",
                "id": client["id"],
                "name": client["name"],
                "color": client["color"],
                "text": text,
            }
        )


class GameServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            return probe.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"


def main() -> None:
    parser = argparse.ArgumentParser(description="Servidor de Cielos Abiertos")
    parser.add_argument("--host", default="0.0.0.0", help="Interfaz de escucha (por defecto 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Puerto HTTP/WebSocket (por defecto 8000)")
    parser.add_argument("--no-open", action="store_true", help="No abrir el navegador automáticamente")
    args = parser.parse_args()

    try:
        server = GameServer((args.host, args.port), GameHandler)
    except OSError as error:
        print(f"No se pudo abrir el puerto {args.port}: {error}")
        print("Prueba con otro puerto: python server/server.py --port 8080")
        sys.exit(1)

    url = f"http://localhost:{args.port}/"
    print()
    print("  CIELOS ABIERTOS · servidor listo")
    print(f"  Local:    {url}")
    print(f"  LAN:      http://{local_ip()}:{args.port}/")
    print(f"  WebSocket: ws://{local_ip()}:{args.port}/ws")
    print("  Ctrl+C para detener")
    print()

    if not args.no_open:
        threading.Timer(0.9, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nCerrando servidor…")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
