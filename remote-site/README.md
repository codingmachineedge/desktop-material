# Desktop Material Remote

Desktop Material Remote is a phone-first Material 3 web control surface for the
Desktop Material agent. It lists repositories, reads status, runs fetch/pull/
push, starts local clones, manages paired devices, and reveals SSH Host cloning
only when the connected agent advertises those commands.

The app keeps the hosting-compatible vinext/Cloudflare Worker architecture and
also ships a production Docker gateway for private LAN or tunnel deployments.

## Security model

The safest setup is one browser origin with a private gateway:

1. The browser loads this app over HTTPS.
2. Requests to the same-origin `/api/v1/*` path go to Caddy.
3. Caddy removes cookies and `Referer`, preserves `Origin` for the desktop's
   exact-origin check, rewrites the upstream `Host`, and forwards only to the
   configured Desktop Material agent.
4. Caddy access logging is intentionally not enabled, and agent responses are
   marked `no-store`.

Never expose the raw loopback agent directly to the public internet. Put the
gateway on a trusted private network, an authenticated private tunnel, or a VPN.
For a tunnel, restrict ingress to the intended devices or exact site origin and
terminate TLS before traffic reaches the gateway.

Credential handling is deliberately narrow:

| Value                                | Default                         | Optional persistence                                                                                  |
| ------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| One-time QR pairing secret           | Component memory until exchange | Never                                                                                                 |
| Paired device bearer                 | Component memory                | `localStorage` only after **Stay logged in**; stored with its non-secret endpoint and device label/id |
| Legacy agent bearer                  | Component memory                | `sessionStorage` only after **Remember until this tab closes**                                        |
| SSH keys, passwords, provider tokens | Never requested                 | Never                                                                                                 |

Tokens and pairing bodies must not be put in URLs, environment files, build
arguments, server output, analytics, or logs. The supplied app and gateway do
not log them.

### Pairing contract

Desktop Material publishes public LAN state at `GET /api/v1/remote/status` and
one-time QR links whose fragment has this shape:

```text
https://remote.example.com/connect#pair=<one-time-secret>&agent=<encoded-agent-base>
```

URL fragments are not sent to the web server. The client reads the fragment,
scrubs it from browser history immediately, normalizes the advertised agent to
`/api/v1`, and falls back to the same-origin Docker gateway if a direct LAN
connection is unavailable. It exchanges the secret through
`POST /api/v1/remote/pair` with `{ code, deviceName, stayLoggedIn? }`.

Authenticated device inventory and revocation use:

- `GET /api/v1/remote/devices`
- `DELETE /api/v1/remote/devices/:id`

Repository commands prefer `POST /api/v1/commands` with `{ name, args }` and
retain a compatibility fallback for the older `POST /api/v1/command/<name>`
route. Capabilities come from `GET /api/v1/info`; unsupported SSH controls stay
disabled instead of guessing at an unadvertised contract.

### SSH host clone workflow

SSH mode appears in the Clone surface only when the connected Desktop Material
agent advertises both `list-ssh-hosts` and `clone-to-ssh`. Define and test hosts
first in the desktop app under **Repository Settings → Remote → SSH Working
Copy**. The site can select a saved definition; it cannot create or edit one.

`list-ssh-hosts` takes no arguments and returns only a bounded host ID, display
name, display address, and availability flag. It never returns the SSH user,
identity-file path, saved destination, source remote, deployment settings,
password, passphrase, or key. Definitions are discovered from repositories
currently available to the desktop profile, and ambiguous duplicate IDs are
omitted.

`clone-to-ssh` sends the selected saved host ID, a credential-free Git URL, an
absolute or `~/` POSIX destination, and an optional branch. The desktop agent
revalidates the saved definition, URL, path, and branch, refuses an existing
destination, disables SSH agent forwarding, and quotes dynamic remote-shell
values. The remote host must already be able to authenticate to the Git source.
Desktop Material's operating-system credential flow handles any SSH secret;
the site never receives it. Credential-shaped failure output is redacted before
it crosses the agent boundary.

### Unsafe YOLO LAN mode

When public status says YOLO LAN mode is active, no bearer is required and every
advertised command has full rights. The UI blocks entry behind an explicit risk
acknowledgement and keeps a red warning visible for the entire session. This is
for short-lived, isolated-network diagnostics only. Turn it off and use paired
devices for normal operation.

## Docker deployment

Prerequisites:

- Docker Engine with Compose
- A Desktop Material remote/LAN agent endpoint reachable from the gateway
- A DNS name for automatic production HTTPS, or a private TLS terminator in
  front of the gateway

Copy the example settings and edit only non-secret network addresses:

```bash
cp .env.example .env
docker compose up --build -d
```

Important variables:

- `REMOTE_SITE_ADDRESS`: `:8080` for private development, or a DNS name such as
  `remote.example.com` for Caddy-managed HTTPS.
- `DESKTOP_MATERIAL_AGENT_URL`: the exact private LAN address shown by Desktop
  Material, reachable from the gateway container, for example
  `http://192.168.1.50:51000`. Do not use `host.docker.internal` (its Host name
  is intentionally rejected), and do not append a token.

The gateway rewrites `Host` to the exact upstream host and port from
`DESKTOP_MATERIAL_AGENT_URL`; it never forwards the public site Host.

The Compose file publishes 8080 for private HTTP setup and 80/443 for automatic
HTTPS. Restrict unused ports at the host firewall. On Linux, if the agent is
strictly loopback-only, use a host-local bridge or authenticated tunnel that can
reach it without opening a public listener. Do not switch to YOLO LAN mode just
to make container routing easier.

Health check:

```bash
curl -fsS http://localhost:8080/healthz
```

## Local development

Requires Node.js `>=22.13.0`.

```bash
npm ci
npm run dev
```

The default `/api/v1` route expects the same-origin gateway. To exercise only
the UI, open `/connect` and use a test agent endpoint with the matching remote
contract. Never use a production credential in browser developer tooling or
recorded test fixtures.

Validation:

```bash
npm run build
npm test
npm run lint
```

## Hosting architecture

The app preserves vinext, the `sites()` Vite plugin, the Cloudflare-compatible
worker entry, and `.openai/hosting.json`. It can therefore be built for the
existing Sites surface in addition to Docker. There is no database or object
storage requirement: all repository state remains owned by Desktop Material, and
browser persistence is limited to the explicit credential choices above.
