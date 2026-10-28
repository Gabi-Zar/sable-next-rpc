"""Exercise server OIDC login against a local, signing test provider."""

import base64
import hashlib
import json
import os
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa


def encode_bytes(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def encode_json(value):
    return encode_bytes(json.dumps(value, separators=(",", ":")).encode())


def encode_integer(value):
    return encode_bytes(value.to_bytes((value.bit_length() + 7) // 8, "big"))


def unused_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
public_key = key.public_key().public_numbers()
issuer = f"http://127.0.0.1:{unused_port()}"
state = {"codes": {}}


class Provider(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def send_json(self, value):
        data = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/.well-known/openid-configuration":
            self.send_json({
                "issuer": issuer,
                "authorization_endpoint": issuer + "/authorize",
                "token_endpoint": state.get("token_endpoint", issuer + "/token"),
                "jwks_uri": issuer + "/jwks",
                "response_types_supported": ["code"],
                "subject_types_supported": ["public"],
                "id_token_signing_alg_values_supported": ["RS256"],
            })
        elif self.path == "/jwks":
            self.send_json({"keys": [{
                "kty": "RSA", "kid": "test", "alg": "RS256", "use": "sig",
                "n": encode_integer(public_key.n), "e": encode_integer(public_key.e),
            }]})
        else:
            self.send_error(404)

    def do_POST(self):
        body = urllib.parse.parse_qs(self.rfile.read(int(self.headers["Content-Length"])).decode())
        transaction = state["codes"].pop(body["code"][0])
        assert encode_bytes(hashlib.sha256(body["code_verifier"][0].encode()).digest()) == transaction["challenge"]
        now = int(time.time())
        mode = transaction["mode"]
        claims = {
            "iss": issuer + "/wrong" if mode == "issuer" else issuer,
            "sub": transaction["subject"],
            "aud": "wrong" if mode == "audience" else "client",
            "exp": now - 300 if mode == "expired" else now + 300,
            "iat": now - 600 if mode == "expired" else now,
            "nonce": "wrong" if mode == "nonce" else transaction["nonce"],
        }
        payload = encode_json({"alg": "RS256", "kid": "test"}) + "." + encode_json(claims)
        signature = key.sign(payload.encode(), padding.PKCS1v15(), hashes.SHA256())
        if mode == "signature":
            signature = bytes([signature[0] ^ 1]) + signature[1:]
        self.send_json({
            "access_token": "test", "token_type": "Bearer",
            "id_token": payload + "." + encode_bytes(signature),
        })


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


client = urllib.request.build_opener(NoRedirect())


def request(url, headers=None):
    try:
        return client.open(urllib.request.Request(url, headers=headers or {}))
    except urllib.error.HTTPError as error:
        return error


def start(base, mode="valid"):
    state["next_ip"] = state.get("next_ip", 0) + 1
    response = request(base + "/_sable/oidc/start", {"X-Forwarded-For": f"192.0.2.{state['next_ip']}"})
    assert response.status == 307
    query = urllib.parse.parse_qs(urllib.parse.urlparse(response.headers["Location"]).query)
    assert query["code_challenge_method"] == ["S256"]
    code = os.urandom(16).hex()
    state["codes"][code] = {
        "nonce": query["nonce"][0], "challenge": query["code_challenge"][0],
        "subject": state.get("subject", "test-subject"), "mode": mode,
    }
    return {
        "state": query["state"][0], "code": code,
        "cookie": response.headers["Set-Cookie"].split(";")[0],
    }


def finish(base, transaction, *, cookie=None, callback_state=None):
    params = urllib.parse.urlencode({
        "state": callback_state or transaction["state"], "code": transaction["code"],
    })
    return request(base + "/_sable/oidc/callback?" + params, {"Cookie": cookie or transaction["cookie"]})


def login(base, mode):
    return finish(base, start(base, mode))


def main():
    provider = HTTPServer(("127.0.0.1", int(issuer.rsplit(":", 1)[1])), Provider)
    threading.Thread(target=provider.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory() as data:
            base = f"http://127.0.0.1:{unused_port()}"
            env = os.environ.copy()
            env.update({
                "SABLE_SERVER_LISTEN_ADDR": base.removeprefix("http://"),
                "SABLE_SERVER_PUBLIC_URL": base,
                "SABLE_SERVER_DATA_DIR": data,
                "SABLE_SERVER_OIDC_ISSUER": issuer,
                "SABLE_SERVER_OIDC_CLIENT_ID": "client",
                "SABLE_SERVER_OIDC_CLIENT_SECRET": "secret",
                "SABLE_SERVER_OIDC_AUTO_PROVISION": "true",
                "SABLE_SERVER_CLIENT_IP_SOURCE": "RightmostXForwardedFor",
            })
            process = subprocess.Popen([os.environ["SABLE_TEST_BIN"]], env=env)
            try:
                for _ in range(100):
                    try:
                        request(base + "/healthz")
                        break
                    except OSError:
                        time.sleep(0.1)
                callback = login(base, "valid")
                assert callback.status == 303, (callback.status, callback.read())
                cookies = callback.headers.get_all("Set-Cookie")
                auth = next(cookie.split(";")[0] for cookie in cookies if cookie.startswith("__Host-sable_auth="))
                identity = request(base + "/_sable/identity", {"Cookie": auth})
                assert identity.status == 200
                first_id = json.load(identity)["id"]
                state["subject"] = "another-subject"
                other = login(base, "valid")
                assert other.status == 303
                other_cookie = next(cookie.split(";")[0] for cookie in other.headers.get_all("Set-Cookie") if cookie.startswith("__Host-sable_auth="))
                other_identity = request(base + "/_sable/identity", {"Cookie": other_cookie})
                assert other_identity.status == 200
                other_id = json.load(other_identity)["id"]
                assert other_id != first_id
                # Two browser transactions must not be interchangeable or replayable.
                state["subject"] = "test-subject"
                first = start(base)
                state["subject"] = "another-subject"
                second = start(base)
                assert finish(base, first, callback_state=second["state"]).status == 400
                assert finish(base, first).status == 400
                assert finish(base, second).status == 303
                assert finish(base, second).status == 400
                state["subject"] = "test-subject"
                first = start(base)
                state["subject"] = "another-subject"
                second = start(base)
                for transaction, expected_id in [(second, other_id), (first, first_id)]:
                    callback = finish(base, transaction)
                    assert callback.status == 303
                    cookie = next(value.split(";")[0] for value in callback.headers.get_all("Set-Cookie") if value.startswith("__Host-sable_auth="))
                    identity = request(base + "/_sable/identity", {"Cookie": cookie})
                    assert identity.status == 200 and json.load(identity)["id"] == expected_id
                state["subject"] = "test-subject"
                for mode in ["nonce", "issuer", "audience", "expired", "signature"]:
                    callback = login(base, mode)
                    assert callback.status == 401, (mode, callback.status, callback.read())
                state["token_endpoint"] = "http://example.com/token"
                assert request(base + "/_sable/oidc/start", {"X-Forwarded-For": "192.0.2.240"}).status == 502
                del state["token_endpoint"]
                for _ in range(5):
                    assert request(base + "/_sable/oidc/start", {"X-Forwarded-For": "192.0.2.241"}).status == 307
                assert request(base + "/_sable/oidc/start", {"X-Forwarded-For": "192.0.2.241"}).status == 429
                time.sleep(1.1)
                assert request(base + "/_sable/oidc/start", {"X-Forwarded-For": "192.0.2.241"}).status == 503
                assert request(base + "/_sable/oidc/start", {"X-Forwarded-For": "192.0.2.242"}).status == 307
                print("OIDC login passed; invalid tokens rejected")
            finally:
                process.terminate()
                process.wait(timeout=10)
            env["SABLE_SERVER_OIDC_AUTO_PROVISION"] = "false"
            process = subprocess.Popen([os.environ["SABLE_TEST_BIN"]], env=env)
            try:
                for _ in range(100):
                    try:
                        request(base + "/healthz")
                        break
                    except OSError:
                        time.sleep(0.1)
                state["subject"] = "unapproved-subject"
                denied = login(base, "valid")
                assert denied.status == 403
            finally:
                process.terminate()
                process.wait(timeout=10)
    finally:
        provider.shutdown()


if __name__ == "__main__":
    main()
