# Self-hosted Sable server

Server mode runs Sable and its Matrix stores on your machine. The server holds
your encryption keys and can read plaintext while it is running. Protect the
host and the data directory.

## Run

Create an Argon2id password hash with the binary:

```sh
target/release/sable-server hash-password
```

Run the binary with a TOML file:

```toml
listen_addr = "127.0.0.1:18008"
public_url = "https://sable.example.org"
# Keep the default when the server receives client connections directly.
client_ip_source = "ConnectInfo"
data_dir = "./sable-server-data"
username = "sable"
password_hash = "$argon2id$v=19$m=19456,t=2,p=1$..."
frontend_dir = "./dist"
```

```sh
pnpm run build:server
CARGO_INCREMENTAL=0 cargo build --release -p sable-server
target/release/sable-server --config sable-server.toml
```

The same keys are available as `SABLE_SERVER_*` environment variables. The
configuration file is selected only with `--config`; the default is
`sable-server.toml`. The session cookie is always a secure `__Host-` cookie, so
use HTTPS outside local development. If a reverse proxy terminates TLS, set
`client_ip_source` to the header source that proxy controls, for example
`RightmostXForwardedFor`; the default `ConnectInfo` ignores forwarded headers.

Docker keeps the configuration and data in the mounted volume:

```sh
docker build -t sable-server .
docker run --rm -p 18008:18008 -v "$PWD/sable-server-data:/var/lib/sable" \
  -e SABLE_SERVER_PUBLIC_URL=https://sable.example.org \
  -e SABLE_SERVER_USERNAME=sable \
  -e SABLE_SERVER_PASSWORD_HASH='…' sable-server
```

## Reverse proxy

Caddy:

```caddyfile
sable.example.org {
    reverse_proxy 127.0.0.1:18008
}
```

Set `public_url` to the browser-visible HTTPS origin.

## OAuth

OAuth login is configured on the Matrix homeserver. The callback returns to the
server UI, so register the browser-visible Sable origin and use that same
origin in `public_url`.
