# Internationalization

The planner's interface is written in English in the source. A player can switch
the interface to Simplified Chinese; the switch is a device preference and can
never change a plan. This document is the map: the design, the shipped
dictionaries and where they came from, how coverage is measured honestly, and
how to maintain it.

## Fork baseline

This fork's upstream baseline is commit
`04fbd841540ec7a0c109623c04fba84e300cf217` of
[jackwrichards/gtnh-factory-flow](https://github.com/jackwrichards/gtnh-factory-flow).
The fork's own `origin` is `liansishen/gtnh-factory-flow`; the merge base with
upstream is exactly that commit, so the internationalization work is the first
change on top of it. The upstream project itself began as a fork of
`Samiracle64/gtnh-factory-flow` (see `README.md`).

## The design

English source strings are the keys. Nothing is extracted to message ids.

- `src/lib/i18n/locale.ts` - the preference: `Locale = "en" | "zh-CN"`,
  `getLocale`, `setLocale`, `subscribeLocale`, `LOCALE_STORAGE_KEY`
  (`gtnh-locale`). `setLocale` touches localStorage and its subscribers and
  nothing else: no plan, no store, no network. English is the default and
  carries no stored entry, so a fresh profile and a reset one are the same
  state.
- `src/lib/i18n/messages.ts` - `translateMessage(source, locale)`. It answers an
  exact dictionary entry first (the merge of `messages-zh.json`,
  `messages-planner-zh.json`, `messages-secondary-zh.json`,
  `messages-inventory-zh.json` and `messages-runtime-zh.json`), then a dynamic
  rule from the three `rules-*.json` files, and otherwise returns the English source unchanged. A
  miss is always the source text, never a half-substituted string. Lookup
  normalizes whitespace; the translated core keeps the surrounding spacing the
  source had.
- `src/lib/i18n/game-names.ts` - `translateGameName(name, locale)` and
  `resolveGameName`, which answers item, fluid, machine and crop labels from the
  game's own name dictionary. `resolveGameName` reports its quality:
  `dictionary` (exact), `generated` (composed from words or a shape pattern,
  approximate by construction) or `fallback` (the input returned untouched). A
  registry id (`minecraft:stone`) is never composed: it falls back untouched.
- `src/lib/i18n/react.tsx` - the React side: `useLocale`, `useT` for attributes,
  placeholders and option arrays, `I18nText` for text written in JSX, and
  `LocaleRestore`, which puts the saved choice on `<html lang>` after load (the
  server always renders English, so hydration matches).

The settings control is `src/components/i18n/LanguageSelect.tsx`; its label is
deliberately bilingual so a player who cannot read the current language can
still find it.

### Preferences are not plans

The locale is stored in localStorage under `gtnh-locale` and is never written
into a project. `src/lib/i18n/plan-invariants.test.ts` pins this with the real
store, import/export and solver paths: a locale change leaves the project
object, its graph, the solved books (`lastResult`) and the serialized plan
byte-for-byte identical, and a plan parsed under either language yields the same
canonical ids.

### Bilingual search

`game-search.ts` prepares Chinese aliases for the shipped English search.
Full-width punctuation and letters are normalized on both dictionary keys and
queries. Unique names resolve exactly; ambiguous names retain their candidate
forms. Unknown Chinese queries return no results. Server queries keep the
existing ranking, filters and pagination. In-page substring filters use the
same alias planner while retaining their narrower matching behavior.

Game-name labels are presentation only. Search and export retain the canonical
resource IDs and English source labels. Tests sweep the dictionary's reverse
index for unique-name round trips and exercise real server query functions
against compressed dataset-shaped fixtures.

## The dictionaries

Read-only assets under `src/lib/i18n/`:

| File | Kind | Entries | Quality |
|---|---|---|---|
| `messages-zh.json` | community UI strings | 2864 | community source |
| `messages-planner-zh.json` | planner-specific strings | 240 | authored here |
| `messages-secondary-zh.json` | per-area additions | 169 | authored here |
| `messages-inventory-zh.json` | inventory additions | 190 | authored here |
| `messages-runtime-zh.json` | settings, controls, current release notes | 112 | authored here |
| `rules-zh.json` | community dynamic rules | 127 | community source |
| `rules-planner-zh.json` | planner dynamic rules | 17 | authored here |
| `rules-runtime-zh.json` | release history count | 1 | authored here |
| `game-names.zh-CN.json` | game names | 33265 | dictionary lookup |
| `game-words.zh-CN.json` | words, materials, patterns | 8974 (1268 materials, 131 patterns) | generated |
| `game-search.zh-CN.json` | search candidates | 4560 | generated |
| `game-data.meta.json` | provenance | - | - |

Entry counts are a snapshot; the coverage report reads the files themselves.

`game-data.meta.json` is the machine-readable record of where the game data
came from and how good it is. It is generated by the community translation
project `gtnh-planner-zh` (`dict/`), which aligned the game's own `en_US.lang`
against the GTNH 2.9 line. The assets are copied verbatim and are not edited by
hand.

### Attribution and license

From `game-data.meta.json`:

- Dictionary source: GT5-Unofficial `en_US.lang`, Kiwi233/Translation-of-GTNH
  (MIT), and a hand-aligned crop table.
- License: the translation pack is MIT; the source language templates from
  GT5-Unofficial are LGPL-3.0. Full notices are in `THIRD_PARTY_NOTICES.md` and
  `docs/licenses/`.
- Note: dictionary lookup is exact by key and includes previously generated
  translations. Runtime composed names are approximate, and neither category is
  a manual certification.

The assets were adapted from the `gtnh-planner-zh` dictionaries aligned against
dataset `local-2.9.0-beta-2` (GTNH 2.9.0-beta-2). `game-data.meta.json` targets
dataset line `gtnh-2.9` and lists `2.9.0-beta-2` and `2.9.0-RC-2` as supported;
`gameDataSupportsGtnhVersion` also accepts any `2.9.*` version. That is a
version-line compatibility claim, not a measurement: the name-engine figure in
the report is measured against whichever dataset is installed locally, and the
last run used `local-2.9.0-rc-2` (2.9.0-RC-2).

This version-line helper is maintenance metadata. Name lookup remains a pure
English-label resolver; it does not gate the active dataset. A new dataset
requires remeasuring coverage before claiming support. The 2.9 line is the
application's existing supported line.

## Coverage, honestly

`tools/i18n-report.ts` is the coverage tool. It walks the app's own TypeScript
with the compiler API and inventories the strings written in UI-facing positions:

- **verified inventory**: JSX text and the user-facing attributes (`title`,
  `aria-label`, `aria-description`, `aria-placeholder`, `placeholder`, `alt`,
  `label`). These are strings in UI-facing syntax; the report does not say that
  the component rendering one actually calls the translator.
- **candidates**: strings passed to a translate-named call (`t`, `_i18nT`,
  `translate`, `translateMessage`, `tr`). `translatorBacked` records whether the
  file imports the i18n module.
- **data messages**: literal settings labels/descriptions, control instructions
  and changelog headlines/notes. These are rendered through dynamic fields and
  are counted separately so historical release notes remain visible in the gap list.

The report measures message lookup: whether the shipped translator can answer a
string, not whether a mounted component translates it. Runtime wiring is checked
by the real browser test `node tools/browser-tests/i18n.mjs` (see AGENTS.md),
which switches language on the running app and asserts the exported plan is
unchanged.

For each string it runs the shipped `translateMessage` and counts the result as
covered (an exact entry or a dynamic rule) or fallback (the English source came
back). Excluded, each with a counted reason: identifiers, CSS class names,
resource ids, paths, URLs, file names, tests, fixtures, examples, dev-only
screens and the language control. The denominator is the UI-facing source, not
every string in the repo.

Run it from the repo root:

```bash
npm run i18n:report        # or: npx tsx tools/i18n-report.ts
```

It writes two deliverables:

- `docs/i18n-coverage.json` - totals, coverage per bucket, the excluded reasons,
  the missing list, and the name-engine measurement.
- `docs/i18n-missing.json` - every untranslated string with its locations.

The report also measures the **name engine** over every `displayName` in the
supported dataset's resource index, split by resolution quality and resource
kind.

### Reading the number honestly

A snapshot from the last run (regenerate for current numbers):

- verified inventory: 509 of 509 (100%), 0 fallback
- translation-call candidates: 386 of 386 (100%), 0 fallback
- data messages: 191 of 1055 (18.1%), 864 fallback
- all distinct inventoried strings: 1006 of 1870 (53.8%)
- name engine: 98.5% of 67,824 dataset display names (48,154 dictionary, 18,685
  generated, 985 fallback)

The JSX/attribute and translation-call buckets measure lookup for the static
strings they contain. The data bucket includes the full changelog history;
its remaining English entries keep the overall figure below full coverage.
These numbers do not certify runtime wiring or translation quality. The
generated share of the name engine (18,685 names) is approximate and is
reported separately; 985 dataset names still fall back to English.

### Known gaps

- Missing UI messages return the English source. The missing JSON lists their
  locations, including historical changelog entries. The newest three release
  entries (4.2.0, 4.1.0, 4.0.0), settings and the controls list have Chinese copy;
  the older release history keeps English fallback.
- Composed names are approximate: the engine matches words and shape patterns,
  not grammar. It refuses registry ids, so a canonical id (`minecraft:stick`,
  `gregtech:gt.metaitem.01@17305`) comes back unchanged with quality `fallback`
  rather than half-translated. Callers pass display names; the stored id is never
  rewritten.
- The name engine leaves 985 of the installed dataset's 67,824 display names in
  English, and it was measured on `local-2.9.0-rc-2`; a different 2.9 export can
  shift those counts.

## Maintenance

1. Community UI strings and rules come from `gtnh-planner-zh`: copy `dict/ui.json`
   to `messages-zh.json` and `dict/rules.json` to `rules-zh.json`. Planner-specific
   strings and per-area additions live in `messages-planner-zh.json`,
   `messages-secondary-zh.json`, `messages-inventory-zh.json`,
   `messages-runtime-zh.json`, `rules-planner-zh.json` and
   `rules-runtime-zh.json`; strings the report finds missing go there. The
   game-data files and `game-data.meta.json` are copied the same way (the adapter
   is `tools/i18n-game-data.mjs`). Do not hand-edit the community assets here.
2. When the pack line moves, regenerate the game data against the new dataset so
   the names still line up, and confirm `game-data.meta.json`'s
   `target.supportedGtnhVersions`.
3. Run `npm run i18n:report` and review `docs/i18n-missing.json`. The list is the
   work queue. A clean list means static lookup is complete, not that the app is
   translated at runtime.
4. Run `npm run test` and the browser test
   `node tools/browser-tests/i18n.mjs`. `plan-invariants.test.ts` fails if a
   locale change ever touches a plan, its ids, its numbers or a player's own
   text; the browser test switches language on the running app and pins the same
   invariant end to end.
