# Running GTNH Factory Flow locally

How to run the site on one machine: the app, the recipe dataset it cannot start
without, and what it keeps in the browser and in the cloud. Written for a
contributor (or an agent) picking this repo up on a fresh machine.

## What runs where

| Piece | What it is | Needs |
|---|---|---|
| Next.js app | The site itself: board, solver, recipe search | a recipe dataset |
| Recipe dataset | Normalized GTNH 2.9 recipes, icons and indexes | `public/datasets/gtnh/` or a proxy |
| Local database | PGlite behind a PostgREST stand-in (`npm run dev:local`), in place of Supabase | nothing |
| Live service | WebSocket plan editing (`npm run dev:local`) | nothing, for shared editing |
| Cloud data | Supabase project: account sync, the community hub, shared plans | `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` |

Two data modes share the same application and the same API routes:

- **Local** (`npm run dev:local`, `LOCAL_DB=1`): a real Postgres (PGlite) on this
  machine behind a PostgREST stand-in. Cloud plans, accounts and the community
  hub work against it with no Supabase credentials, and the same validation and
  limits apply. Sign-ins are valid only on this machine.
- **Server** (`npm run dev` or a deploy): Supabase. Without `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY`, the Community tab and account sync stay empty and
  the planner runs fully offline apart from dataset fetches; those features are
  unavailable, not degraded.

Node 20 or newer. `npm install` once.

## The recipe dataset

The app reads a normalized GTNH 2.9 dataset. There is no bundled copy: datasets
are large and are not in git. Two ways to give the app one.

### Proxy the live dataset

```bash
GTNH_DATASET_BACKEND_URL=https://gtnhplanner.com npm run dev
```

Next.js rewrites `/api/datasets/*` and `/datasets/gtnh/*` to the backend, so the
local app uses the live dataset as-is. Good for UI work; no dataset files land
on this machine.

The backend owns resource/recipe query behavior in this mode. Use a backend
running this fork for native Chinese search. The stock upstream backend's
English search remains available through the proxy; its Chinese behavior
depends on the backend's implementation. Installing data locally runs this
fork's bilingual query code.

### A dataset on disk

The quickest way to get one is the download script, which pulls the live manifest
and the chosen version's indexes (and icons) into `public/datasets/gtnh/`:

```bash
npm run datasets:download                              # the manifest's default version
npm run datasets:download -- --version local-2.9.0-rc-2
```

It writes a trimmed `datasets.manifest.json` holding just that version. A dataset
placed by hand uses the same layout (git-ignored):

```
public/datasets/gtnh/
  datasets.manifest.json
  <datasetId>/
    recipes.json.gz          # whole-corpus form (optional)
    shards/                  # sharded recipe bodies referenced by the indexes
    resource-index.json.gz
    recipe-index.json.gz
    recipe-lookup-index.json.gz
```

- `datasets.manifest.json` lists the versions and points at each one's files.
  Rebuild it after dropping a dataset in with `npm run datasets:manifest`
  (`GTNH_DATASETS_ROOT` overrides the default `public/datasets/gtnh`).
- Only GTNH 2.9 is supported. The current line is `local-2.9.0-rc-2` (2.9.0-RC-2);
  2.9.0-beta-2 is the previous supported export and `local-2.8.4` is retired
  (`HIDDEN_DATASET_VERSION_IDS`). Fetch the current export with
  `npm run datasets:download -- --version local-2.9.0-rc-2`.
- Dataset files other than textures may be replaced in place. Textures are
  cache-immutable, so a changed icon needs a new filename.
- Building a dataset from a raw export is the pipeline's job, documented in
  `tools/dataset-pipeline/CLAUDE.md`; a normal local run only consumes one.

Prewarm the dataset cache on start (the first API call is otherwise slow):

```bash
GTNH_PREWARM_ON_STARTUP=1 npm run build && GTNH_PREWARM_ON_STARTUP=1 npm run start
```

## Scripts

```bash
npm run dev          # http://localhost:3000, needs a dataset (above)
npm run dev:local    # the same with a local database and the live service
npm run typecheck    # tsc --noEmit
npm run test         # full vitest suite, must be green
npm run lint         # eslint
npm run build        # next build
npm run start        # serve a production build
npm run local-db     # just the PGlite database on 127.0.0.1:54329
npm run live         # just the live service on :3001
npm run datasets:download  # fetch a dataset into public/datasets/gtnh
npm run datasets:manifest  # rebuild the local datasets.manifest.json
npm run i18n:report        # write the i18n coverage report (docs/INTERNATIONALIZATION.md)
```

`npm run dev` runs `predev` first, which copies the HiGHS WASM the solver loads.
`npm run dev:local` does the same, then starts three things in order: the local
database, the live service and `next dev`, all with `LOCAL_DB=1` and a
development-only `COMMUNITY_HASH_SALT`. Ctrl+C stops all three. This path needs
no Supabase credentials at all.

## Browser regression test

With a production build running and the RC-2 dataset installed:

```bash
APP_URL=http://127.0.0.1:3000 \
I18N_EVIDENCE_DIR=/path/to/private/evidence \
CHROME_PATH=/path/to/chrome \
node tools/browser-tests/i18n.mjs
```

`CHROME_PATH` is optional when Playwright's matching Chromium is installed.
The test uses a fresh browser profile, blocks cross-origin browser requests,
checks English/Chinese search, language persistence, a real recipe and drawer,
plan export equality and import, settings, help, library and desktop/mobile
layouts. Cloud-account and live-collaboration flows need their own configured
backend and remain outside this signed-out test.

## What the app stores, and where

The plan of record is the browser's own IndexedDB, not the server.

- **Designs**: database `gtnh-factory-flow-designs` in IndexedDB holds the design
  library (metadata and plans in separate stores). Tabs, folders and the active
  design live there too. localStorage `gtnh-factory-flow.project.v2` is a
  one-shot seed read on first run and never cleared; after that it is ignored.
- **Device settings** (this browser only, never written to a plan): the locale
  (`gtnh-locale`), the app font, the UI scale, the power display unit and the
  active design id. These are preferences, so changing one cannot touch a plan.
- **Cloud plans and community posts** need Supabase, or the local database in
  `npm run dev:local`. Without either the Community tab and account sync stay
  empty; the planner works fully offline apart from dataset fetches.
- **Live editing** is off unless `NEXT_PUBLIC_LIVE_URL` is set and someone is
  signed in. `npm run dev:local` sets it to the local service
  (`ws://localhost:3001/live`) with no sign-in provider.

Sign-ins made against the local database use a development-only salt, so they
are valid only on that machine. Never copy `.env.local` into a worktree: local
work needs no Supabase credentials.

## Cloud accounts and their limits

Signing in is optional, and the limits below apply identically in local and
Supabase mode: `npm run dev:local` is not a relaxed mode. They are enforced by
the API routes, not the client:

- **Library**: 500 designs and 200 folders per account. A design name runs 1 to
  80 characters, a folder name 1 to 60, and a design body syncs at most 3 MB. A
  plan can be shared with 20 accounts at most.
- **Save rate**: 1200 design saves, 300 folder writes, 300 share changes and 30
  new share adds an hour per account; community uploads are 10 an hour per
  actor.
- **Community posts**: at most 3 MB of JSON, a name up to 80 characters and a
  description up to 2000. One vote per plan per actor. Preview images are capped
  at 4 MB.
- **Accounts**: usernames are 3 to 24 characters.

## Out of scope

Full offline installers (a packaged, no-network bundle of app and dataset) are
not part of this repo's local-running story. The app is a Next.js server plus a
dataset directory; run it with the scripts above.
