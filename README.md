# GTNH Factory Flow

This fork adds native Simplified Chinese / English selection, game-name presentation and Chinese, English and pinyin search. Choose **Language / 语言** in Settings; the preference stays on this device. Search supports full pinyin (`gangban`), initials (`gb`), mixed syllables (`gangb`) and Chinese/pinyin combinations (`钢ban`, `gang板`) in either interface language. Canonical recipes, plans and solver inputs retain their original identity.

- Fork: [liansishen/gtnh-factory-flow](https://github.com/liansishen/gtnh-factory-flow)
- Upstream baseline: `jackwrichards/gtnh-factory-flow@04fbd841540ec7a0c109623c04fba84e300cf217`
- [Internationalization and coverage](docs/INTERNATIONALIZATION.md)
- [Server and local-dataset operation](docs/LOCAL-RUNNING.md)

A production-chain planner for GregTech: New Horizons, live at
[gtnhplanner.com](https://gtnhplanner.com).

Search the real GTNH recipe set, place recipes as machine cards on a board, wire outputs
to inputs, and the solver works out rates, machine counts, power, bottlenecks and
surplus for the whole plan. Three modes hand the planner more of the work: **Build** (you
set machines and counts), **Solve** (you set target rates, it counts machines) and
**Pool** (it wires and imports too). Plans save in the browser, share as links, and can
be posted to the community hub.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run test
```

Install a dataset for native Chinese, English and pinyin server search:

```bash
npm run datasets:download -- --version local-2.9.0-rc-2
npm run dev
```

Datasets and their `datasets.manifest.json` live under the gitignored
`public/datasets/gtnh/`. A remote dataset backend can be selected with
`GTNH_DATASET_BACKEND_URL`; its query API must implement Chinese and pinyin search
for those queries to work. See [local-running instructions](docs/LOCAL-RUNNING.md).
Accounts and Community require Supabase or the optional local database.

## How it fits together

- `tools/dataset-pipeline/`: a Forge mod runs inside a real GTNH client and exports every
  recipe, NEI layout, machine and rendered icon; Node scripts normalize it into the
  dataset the app reads. Recipe data never comes from wikis or hand-written tables.
- `src/lib/`: the domain model, machine math (overclocks, parallels, curated per-machine
  behaviour checked against the mod source) and an LP-based solver.
- `src/components/`, `src/store/`: the Next.js + React Flow UI and Zustand stores.

Working notes for contributors and AI agents are in [AGENTS.md](AGENTS.md) and the
`CLAUDE.md` file in each area's folder.

## License and credits

Code is MIT licensed. GTNH, Minecraft, mod assets, generated datasets and icons are not
included and remain under their owners' licenses.

This project started as a fork of
[Samiracle64/gtnh-factory-flow](https://github.com/Samiracle64/gtnh-factory-flow) and has
since diverged into an independent codebase. The original work is MIT licensed and its
copyright is retained in `LICENSE`.
