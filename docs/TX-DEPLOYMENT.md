# TX deployment

The fork is served at https://gtnhplanner.hepdd.com. The application runs on TX as
`gtnh-factory-flow.service`, listening on `127.0.0.1:3180`; nginx terminates TLS
with the existing `*.hepdd.com` certificate.

## Files

- `/opt/gtnh-factory-flow/releases/<commit>/`: Next.js standalone runtime, static
  assets, third-party notices and `deployment.json` with the deployed revision.
- `/opt/gtnh-factory-flow/current`: symlink to the active release.
- `/opt/gtnh-factory-flow/shared/public/datasets/gtnh/`: RC-2 manifest, resource and
  recipe indexes, all recipe shards and locally installed textures.
- `/opt/gtnh-factory-flow/shared/cache/`: writable Next.js cache.
- `/etc/gtnh-factory-flow/environment`: root-owned environment file containing a
  randomly generated `COMMUNITY_HASH_SALT`. Keep it private and retain it on updates.
- `/etc/systemd/system/gtnh-factory-flow.service`: service definition, based on
  `deploy/tx/gtnh-factory-flow.service`.
- `/etc/nginx/conf.d/gtnhplanner.hepdd.com.conf`: site configuration, based on
  `deploy/tx/gtnhplanner.hepdd.com.conf`.

## Build and update

Build on the development machine to keep compilation off the shared server:

```bash
npm ci
npm run typecheck
npm test
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SITE_URL=https://gtnhplanner.hepdd.com npm run build
```

Package `.next/standalone/`, copy `.next/static/` into its `.next/static/`, and
copy `public/` without datasets into its `public/`. Dataset files are excluded
from Next.js output tracing and installed separately. Transfer the archive with
its SHA-256 and verify it before extracting into a new release directory.
Keep release files root-owned and readable by the `gtnh-flow` service user.

Link the release's `public/datasets/gtnh` to the shared dataset directory and its
`.next/cache` to the shared writable cache. Update `current` to the new release
and restart `gtnh-factory-flow`. Retain the previous release so switching `current`
back and restarting restores it.

Chinese, English and pinyin resource/recipe queries run on TX. Keep
`GTNH_DATASET_BACKEND_URL` unset. Missing hashed textures are fetched from
`gtnhplanner.com` by nginx and cached under
`/var/cache/nginx/gtnhplanner-assets/`, capped at 2 GB. A first request for an
uncached texture needs the upstream site; recipe queries and local dataset
files remain on TX.

The service runs as an unprivileged user with a 1.5 GB Node heap limit, a 2 GB
service memory limit and write access to its cache directory. Supabase account
sync, Community and live collaboration require separate backend configuration.
Plans and language preferences are stored in the visitor's browser.

## Checks

```bash
systemctl status gtnh-factory-flow
journalctl -u gtnh-factory-flow -n 50 --no-pager
nginx -t
curl -fsS https://gtnhplanner.hepdd.com/api/version
curl -fsS https://gtnhplanner.hepdd.com/deployment.json
curl -fsSG https://gtnhplanner.hepdd.com/api/datasets/local-2.9.0-rc-2/resources --data-urlencode query=gangban
```

Run the desktop/mobile regression test against the deployed site:

```bash
APP_URL=https://gtnhplanner.hepdd.com I18N_EVIDENCE_DIR=/tmp/gtnh-browser-check \
  CHROME_PATH=/path/to/chrome node tools/browser-tests/i18n.mjs
```

Changing nginx configuration requires `nginx -t` before reloading its service.
The wildcard certificate is maintained by TX's existing acme.sh renewal job.
