# DE application with DeVPS ingress

The hosted fork is https://plan.playgtnh.dpdns.org. Cloudflare provides the
DNS-only A record pointing to DeVPS. HTTPS terminates at DeVPS and application
requests reach DE through a dedicated encrypted SSH tunnel:

```text
Browser -> DeVPS nginx :443 -> 127.0.0.1:13180
        -> SSH to DE :22 -> DE 127.0.0.1:3180 -> Next.js
```

DE runs the app and the RC-2 query dataset. DeVPS runs nginx, the tunnel and
certificate renewal. Installed textures are served through DE. Missing textures
are fetched from `gtnhplanner.com` and cached on DeVPS, capped at 512 MB;
uncached missing textures need that upstream site.

The bundled power-source icon map still references `local-2.9.0-beta-2`.
Keep both the RC-2 and beta-2 texture paths enabled in nginx while that map is
shipped; the query dataset remains RC-2.

Resource and recipe searches use this fork's Chinese, English and pinyin code
on DE. Keep `GTNH_DATASET_BACKEND_URL` unset.

## DE files and service

- `/opt/gtnh-factory-flow/releases/<revision>/`: standalone runtime, static
  assets, notices and public `deployment.json`.
- `/opt/gtnh-factory-flow/current`: active release symlink.
- `/opt/gtnh-factory-flow/node/`: isolated Node.js v24.19.0 runtime, verified
  against the official distribution's SHA-256 manifest.
- `/opt/gtnh-factory-flow/shared/public/datasets/gtnh/`: manifest, indexes,
  recipe shards and locally installed textures for `local-2.9.0-rc-2`.
- `/opt/gtnh-factory-flow/shared/dataset-SHA256SUMS`: verified dataset inventory.
- `/opt/gtnh-factory-flow/shared/cache/`: writable Next.js cache.
- `/etc/gtnh-factory-flow/environment`: root-only runtime environment with a
  random `COMMUNITY_HASH_SALT` and the public site URL. Retain the salt on updates.
- `/etc/systemd/system/gtnh-factory-flow.service`: based on
  `deploy/de/gtnh-factory-flow.service`.

The app runs as `gtnh-flow`, binds only to loopback and has a 2 GB Node heap
limit and a 2.5 GB service memory limit. DE has no swap; the app's swap allowance
is zero. Systemd runs resource and recipe warm-up HTTP requests before reporting
the service started. `GTNH_PREWARM_ON_STARTUP=0` prevents a second copy of the
dataset in Next.js's separately bundled instrumentation module.
The management-only `/api/datasets/<version>/prewarm` endpoint is blocked at the
public ingress. Systemd warms the ordinary resource and recipe query endpoints.

## Account backend (PostgreSQL + PostgREST)

- PostgreSQL 15 from Debian listens only on `127.0.0.1:5432`; database `gtnh`
  holds the account, library and community tables. Memory settings live in
  `/etc/postgresql/15/main/conf.d/gtnh-backend.conf`.
- PostgREST 16.5 listens only on `127.0.0.1:3000` as
  `gtnh-factory-rest.service`. Its config is
  `/etc/gtnh-factory-backend/postgrest.conf`; the database password and service
  JWT are in `/etc/gtnh-factory-backend/secrets.env` (root:gtnh-backend, 0640).
  Rotating either means updating that file and the app environment together.
- The app reaches it through its own loopback: `SUPABASE_URL` is
  `http://127.0.0.1:3180` and `SUPABASE_SERVICE_ROLE_KEY` is in
  `/etc/gtnh-factory-flow/environment`. `next.config.ts` rewrites `/rest/v1/*`
  to PostgREST, so no database port is public. Anonymous requests have no table
  privileges; only the service JWT can read or write.
- `COMMUNITY_HASH_SALT` signs account sessions and must never change; changing
  it signs everyone out and breaks existing votes.
- Backups: `gtnh-backend-backup.timer` writes a compressed `pg_dump` to
  `/opt/gtnh-factory-backend/backups` daily and keeps 14 days. Restore with
  `pg_restore` into a new database, then point `db-uri` at it.
- Storage is not part of this backend yet. Account and library sync work;
  community posts fall back when a preview upload is unavailable, and board
  images are unavailable.

## DeVPS files and service

- `/etc/nginx/conf.d/plan.playgtnh.dpdns.org.conf`: based on the matching file in
  `deploy/devps/`. Unknown hosts are rejected; HTTP redirects to HTTPS except
  the ACME HTTP-01 challenge path. JSON, JavaScript, CSS and WASM are compressed.
- `/var/cache/nginx/gtnh-planner/`: bounded texture cache.
- `/var/log/nginx/gtnh-planner.{access,error}.log`: site logs.
- `/etc/systemd/system/gtnh-planner-tunnel.service`: `gtnh-tunnel` user, pinned
  DE host key, loopback listener `127.0.0.1:13180`, restart on disconnect.
- `/etc/gtnh-planner-tunnel/id_ed25519`: dedicated tunnel private key, mode 0600;
  `known_hosts` pins DE's existing Ed25519 host key.
- `/usr/local/sbin/gtnh-planner-firewall` and
  `gtnh-planner-firewall.service`: add only TCP 80/443 INPUT rules after the
  existing `fw-base.service`. Existing SSH and Minecraft relay rules are retained.

On DE, `/etc/ssh/sshd_config.d/90-gtnh-planner-tunnel.conf` restricts the tunnel
account to local forwarding into `127.0.0.1:3180` and disables session channels.
Its authorized key in `/var/lib/gtnh-planner-tunnel/.ssh/authorized_keys` is
restricted to the DeVPS source address and the same destination. The tunnel and
app have separate accounts. DE's application port stays closed to public traffic.

## DNS and HTTPS

The Cloudflare zone is `playgtnh.dpdns.org`. Only
`plan.playgtnh.dpdns.org A 213.145.72.207` is needed, with proxying disabled.
DNS-only keeps the requested DeVPS route as the public entrance. Other zone
records and Cloudflare settings are independent of this deployment.

Certbot obtains the public Let's Encrypt certificate on DeVPS using HTTP-01:

- Webroot: `/var/lib/letsencrypt/gtnh-planner/`.
- Certificate/key: `/etc/letsencrypt/live/plan.playgtnh.dpdns.org/`.
- Renewal: the enabled `certbot.timer`.
- Deploy hook: `/etc/letsencrypt/renewal-hooks/deploy/20-gtnh-planner-nginx`,
  which tests and reloads nginx for this certificate.

The Cloudflare DNS API credential stays on its existing management host; the
app and DeVPS do not need it for certificate renewal. Preserve public TCP 80 and
the ACME location so renewals continue working. Exercise renewal with:

```bash
certbot renew --dry-run --cert-name plan.playgtnh.dpdns.org --run-deploy-hooks
```

## Build and update

The displayed fork version is `<upstream version>.<fork revision>`. Keep the first
three segments pinned to the incorporated upstream release and increment the fourth
once per deployed release. Check the hosted `/api/version` before preparing the next
revision, and add its player-facing notes to `src/lib/changelog.ts`.

Build locally; this machine's SSH alias `DE` uses `ProxyJump DeVPS`, so uploads
and management commands also traverse DeVPS.

```bash
npm ci
npm run typecheck
npm test -- --maxWorkers=2
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SITE_URL=https://plan.playgtnh.dpdns.org npm run build
```

Assemble `.next/standalone/`, `.next/static/` and `public/`, with static files in
the runtime's `.next/static/`. Exclude `public/datasets/` and `.next/cache/` from
the runtime archive: Next.js traces the dataset through instrumentation even
though data is installed separately. Include `LICENSE`, `THIRD_PARTY_NOTICES.md`
and `docs/licenses/`, and record the clean source revision in `deployment.json`.
Verify the transferred archive's SHA-256 before extracting a new release.
For configuration-only updates, record `configurationRevision` separately from
the runtime source revision so both deployed versions remain traceable.

Install datasets separately from a checksum-verified archive. Link the new
release's `public/datasets/gtnh` and `.next/cache` to the shared locations above.
Keep release files root-owned and readable by `gtnh-flow`. Switch `current` to
the new release, restart the app, and retain the previous release for rollback.
Change both warm-up URLs and the nginx texture version path when the dataset
version changes. Configuration changes require `sshd -t` or `nginx -t` before
reloading the respective service.

## Verification

```bash
# DE
systemctl status gtnh-factory-flow
journalctl -u gtnh-factory-flow -n 50 --no-pager
curl -fsS http://127.0.0.1:3180/api/version

# DeVPS
systemctl status nginx gtnh-planner-tunnel gtnh-planner-firewall certbot.timer
curl -fsS http://127.0.0.1:13180/api/version
nginx -t

# Public
curl -fsS https://plan.playgtnh.dpdns.org/api/version
curl -fsS https://plan.playgtnh.dpdns.org/deployment.json
APP_URL=https://plan.playgtnh.dpdns.org I18N_EVIDENCE_DIR=/tmp/gtnh-browser-check \
  CHROME_PATH=/path/to/chrome node tools/browser-tests/i18n.mjs
APP_URL=https://plan.playgtnh.dpdns.org I18N_EVIDENCE_DIR=/tmp/gtnh-tooltip-check \
  CHROME_PATH=/path/to/chrome node tools/browser-tests/tooltips.mjs
```

Verify DNS, redirect, certificate trust, both desktop/mobile browser flows,
texture cache hits, compression and service memory/restart counts. Check the
existing `mcspr.service` and Minecraft access through DeVPS after infrastructure
changes. The game server, worlds and Minecraft relay are separate services.

Plans and language preferences belong to the browser's origin. Use plan export
and import to move between domains. Supabase accounts, Community and live
collaboration require separate backend configuration; this deployment runs the
signed-out planner. The previous TX deployment remains removed.
