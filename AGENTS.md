# AGENTS.md

GTNH Factory Flow: a production-chain planner for GregTech: New Horizons, live at
https://gtnhplanner.com. Next.js App Router, TypeScript strict, Tailwind, React Flow,
Zustand, Zod, Vitest. The repo is public.

This file is the always-loaded core. Each area keeps its own rules in a `CLAUDE.md`
beside its code, which Claude Code loads when you open files there. Read the area file
before changing that area; it names the tests that pin its behaviour.

| Area | Notes |
|---|---|
| Board: cards, drawers, boards, wires, routing, arrange, board perf | `src/components/flow/CLAUDE.md` |
| App UI: interface scale, compact mode, recipe search, inspector, sounds | `src/components/CLAUDE.md` |
| Pool worksheet | `src/components/pool/CLAUDE.md` |
| Solver: LP books, Build/Solve/Pool, drawers, shared machines, verdicts | `src/lib/solver/CLAUDE.md` |
| Machine math: overclocks, parallels, curated machine table, special machines | `src/lib/machines/CLAUDE.md` |
| Domain model: resources, cells vs fluids, oredict context, sections, boards | `src/lib/model/CLAUDE.md` |
| Power generation | `src/lib/power/CLAUDE.md` |
| Designs, tabs, saving, account sync, plan import/export, public view | `src/store/CLAUDE.md` |
| Server, recipe API, Supabase, cloud plans, local database | `src/lib/server/CLAUDE.md` |
| Live service: live plan editing over WebSockets | `src/live/CLAUDE.md`, `docs/live.md` |
| Dataset pipeline: export, normalize, rebuild, publish | `tools/dataset-pipeline/CLAUDE.md` |

Longer references, read on demand: `docs/solver-equations.md` (solver doctrine),
`docs/power-planner-math.md` (the decoded power workbook), `docs/COMMUNITY.md`.

## Commands

```bash
npm run dev          # http://localhost:3000
npm run dev:local    # the same with a local database and the live service: no Supabase credentials
npm run typecheck
npm run test         # full vitest suite, must be green
```

Scratch harnesses are `*.local.test.ts` (excluded from the suite); run one with
`npx vitest run <file> --config vitest.local.config.ts`.

## Working rules

- `main` is the working branch. Preserve unrelated changes and commit verified work locally.
  Push or deploy only when explicitly authorized.
- `origin` is `liansishen/gtnh-factory-flow`. `upstream` is
  `jackwrichards/gtnh-factory-flow` and is read-only. The original Samiracle64 repository
  is a separate, long-diverged source, not this fork's synchronization target.
- CI runs typecheck, the full suite and a Chromium/Firefox icon-sizing check on every PR
  and push to main. No tolerated failures. A test that pins player-facing copy changes in
  the same commit as the copy.
- Nothing generated goes in the repo root. Screenshots, probe scripts, captures and logs go
  in the session scratchpad or `scratch/` (gitignored). Old Playwright probes live in
  `scratch/probes/`. Delete screenshots once you have looked at them.
- Check UI changes in the real app with Playwright; unit tests cannot see routing,
  layering or hover. Board performance changes need a before/after profile.
- Comments state the rule and why. No dates, names or "used to" stories; git has those.

## Player-facing copy

- Plain and short: the number, the rule, the consequence. No quips, no internal jargon,
  no em dashes.
- Recipes are read-only in the UI. No manual recipe editing unless asked.

## Releases and deploys

- Deploy only when explicitly told to, once per instruction. Pushing `main` deploys
  nothing. The GitHub deploy and dataset workflows are decoys (no runner); never dispatch
  them. The deploy command lives outside the repo (the origin IP is not public).
- `APP_VERSION` in `src/lib/version.ts` has four segments: `UPSTREAM_VERSION` supplies
  the first three and changes when incorporating an upstream release; `FORK_REVISION`
  is incremented once per fork deploy. First check https://plan.playgtnh.dpdns.org/api/version:
  an unshipped revision keeps its number and top changelog entry; a shipped revision
  starts the next fourth-segment number and a new entry.
- Every release has an entry in `src/lib/changelog.ts`: concrete bullets about what
  changed for players. Players open it from the header's version chip (unread dot, stamp
  `changelog-read.v1`); nothing opens by itself. Shift-click the chip for the dev menu.
- After a deploy, check `/api/version`; after a dataset publish, check the live manifest
  and the published gzip, not just local output.

## Production

The fork runs on DE behind DeVPS at `https://plan.playgtnh.dpdns.org`; see `docs/DE-DEPLOYMENT.md`. The removed TX setup is recorded in `docs/TX-DEPLOYMENT.md`. Further deploys require explicit authorization. The notes below describe the upstream service.

- One DigitalOcean droplet: Caddy -> Next.js :3000, systemd unit `gtnh-flow`, releases in
  `/opt/releases`, datasets in `/opt/shared/gtnh-datasets`, behind Cloudflare. Diagnose with
  `journalctl -u gtnh-flow` and Caddy's JSON log `/var/lib/caddy/access.log`.
- The server prewarms datasets on start when `GTNH_PREWARM_ON_STARTUP=1`
  (`src/instrumentation.ts`). A slow first API call means prewarm or deploy regressed;
  don't make the client wait longer.
- Only GTNH 2.9 datasets are supported.

## Invariants across the app

- Raw exporter data is normalized by the pipeline before UI or solver code sees it.
  Prefer exported NEI/runtime data over hand-written tables and broad fallbacks.
- Board performance is a requirement: no DOM measurement per edge or per frame, nothing
  O(nodes x edges) per frame, hover never rebuilds the board.
- Every plan that arrives (import, paste, link, community copy) opens as a NEW design.
  Nothing overwrites the open design; no app path calls `setProject`.
- Display dials (rate units, power display) repaint numbers only. They never re-solve.
- A setting with no visible control must never be persisted: players get stuck in it,
  and a `finally` that restores it is not a durable undo.

## Probing the real app

- Playwright (`playwright-core` is a devDependency), always headless: a headed run takes
  over the owner's screen. Use `waitUntil: "load"`. Write probes into `scratch/probes/`.
- A hidden browser pane never fires `requestAnimationFrame`; shim it. A fresh profile
  lands on the Welcome tab. Production has no `window.__gtnhFlow`.
- The board pane is a million px square under the scroll camera: aim at the `.react-flow`
  wrapper's box. Tooltips move `title` to `data-tip-title`.
- Compare against old behaviour with `git worktree add` at that commit. A worktree needs
  its own `npm install`: never junction `node_modules` into one (Turbopack crashes, and
  `git worktree remove --force` follows the junction and empties the main repo's
  `node_modules`). Diff exported plans rather than trusting "same board" by eye.
- Measure performance on `next start` with `GTNH_PREWARM_ON_STARTUP=1`, after prewarm,
  not on the dev server.

## Native internationalization

- `src/lib/i18n/` owns device locale, UI messages, canonical-name display and bilingual query planning.
  Keep locale out of plan state, IDs, machine rules, solving and live edits.
- Use `useT` / `I18nText` for application copy and `useGameName` / `I18nText game`
  for canonical game labels. User-authored names, notes, task text and comments stay verbatim.
- Run `npm run i18n:report`, locale/plan-invariant tests and the real browser test
  `node tools/browser-tests/i18n.mjs` when changing localization. Coverage reports measure
  static message lookup separately from approximate name generation.
- Server and local-data modes share the application; `npm run datasets:download` installs
  a supported dataset under the gitignored `public/datasets/gtnh/` tree.
