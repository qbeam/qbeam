#!/usr/bin/env python3
"""Serve the speed spike: http://localhost:8000 for this machine, https://<LAN IP>:8443 for phones.

Phones only allow camera access on secure pages, so the LAN address uses a self-signed certificate
(created in .cert/ on first run; the phone shows a warning once, accept it). Nothing leaves your network.

    python3 bench/spike/serve.py
"""
import functools
import http.server
import pathlib
import socket
import ssl
import subprocess
import threading

HERE = pathlib.Path(__file__).resolve().parent
CERT = HERE / ".cert"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".cjs": "text/javascript", ".mjs": "text/javascript",
                      ".wasm": "application/wasm"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packet is sent; this just picks the outgoing interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def ensure_cert(ip):
    CERT.mkdir(exist_ok=True)
    key, crt = CERT / "key.pem", CERT / "cert.pem"
    marker = CERT / "ip.txt"
    if crt.exists() and marker.exists() and marker.read_text() == ip:
        return crt, key
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",
                    "-keyout", str(key), "-out", str(crt), "-subj", "/CN=qbeam-spike",
                    "-addext", f"subjectAltName=IP:{ip},DNS:localhost"],
                   check=True, capture_output=True)
    marker.write_text(ip)
    return crt, key


def main():
    ip = lan_ip()
    handler = functools.partial(Handler, directory=str(HERE))
    local = http.server.ThreadingHTTPServer(("127.0.0.1", 8000), handler)
    lan = http.server.ThreadingHTTPServer(("0.0.0.0", 8443), handler)
    crt, key = ensure_cert(ip)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(crt, key)
    lan.socket = ctx.wrap_socket(lan.socket, server_side=True)
    threading.Thread(target=local.serve_forever, daemon=True).start()
    print(f"Sender (this Mac):  http://localhost:8000/sender.html")
    print(f"Receiver (phone):   https://{ip}:8443/receiver.html   (accept the certificate warning once)")
    print(f"Loopback self-test: http://localhost:8000/receiver.html?loopback=2x2,30,L,15")
    print("Ctrl-C to stop.")
    try:
        lan.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
