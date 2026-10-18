/**
 * The game's own names, English and Chinese.
 *
 * Every item, fluid, machine and crop label in the planner comes from the
 * dataset in English. This module answers the same label in the player's
 * language, and answers it back the other way for search: an English name
 * becomes its Chinese name, a Chinese name becomes the canonical English one.
 *
 * Three qualities, cheapest first, and the caller can tell them apart:
 *
 *   1. `dictionary` - the name is in the aligned dictionary. Exact.
 *   2. `generated`  - the name was composed from words or a shape pattern
 *      ("Small Pile of Iron Dust" -> 小堆铁粉). Approximate by construction.
 *   3. `fallback`   - nothing matched, so the input is returned untouched.
 *      A miss is always the original string, never a half-translated one.
 *
 * The dictionaries are read-only assets copied from the community translation
 * project `gtnh-planner-zh`; their provenance and quality are recorded in
 * `game-data.meta.json` (`getGameDataMeta`). Nothing here mutates the dataset
 * or the assets: lookups are pure, and the derived indexes are cached lazily.
 */
import type { Locale } from "./locale";
import gameDataMeta from "./game-data.meta.json";
import gameNamesJson from "./game-names.zh-CN.json";
import gameSearchJson from "./game-search.zh-CN.json";
import gameWordsJson from "./game-words.zh-CN.json";

export type GameNameSource = "dictionary" | "generated" | "fallback";

export interface GameNameResolution {
  text: string;
  source: GameNameSource;
}

export interface GameShapePattern {
  prefix: string;
  suffix: string;
  zhPrefix: string;
  zhSuffix: string;
}

interface GameWordsAsset {
  words: Record<string, string>;
  materials: Record<string, string>;
  patterns: GameShapePattern[];
}

export interface GameDataAssetMeta {
  file: string;
  kind: string;
  quality: "exact" | "generated";
  entries: number;
  bytes: number;
  sha256: string;
  materials?: number;
  patterns?: number;
}

export interface GameDataMeta {
  schemaVersion: number;
  locale: string;
  generatedAt: string;
  source: {
    project: string;
    dictionaryDir: string;
    datasetVersion: string;
    gtnhVersion: string;
    datasetChecksumSha256: string | null;
    files: Record<string, string>;
  };
  target: { datasetLine: string; supportedGtnhVersions: string[] };
  assets: GameDataAssetMeta[];
  attribution: { dictionary: string; license: string; note: string };
}

const names: Record<string, string> = Object.assign(Object.create(null), gameNamesJson);
const wordsAsset = gameWordsJson as GameWordsAsset;
const words: Record<string, string> = Object.assign(Object.create(null), wordsAsset.words);
const materials: Record<string, string> = Object.assign(Object.create(null), wordsAsset.materials);
const patterns: GameShapePattern[] = wordsAsset.patterns;

const HAS_CJK = /[\u4e00-\u9fff]/;
const FULL_WIDTH = /[\uff01-\uff5e]/g;
const FORMATTING = /§[0-9a-zA-Z]/g;

/** The dictionaries and where they came from. */
export function getGameDataMeta(): GameDataMeta {
  return gameDataMeta as GameDataMeta;
}

/** True when the shipped dictionary was aligned against this GTNH version line. */
export function gameDataSupportsGtnhVersion(gtnhVersion: string): boolean {
  const meta = getGameDataMeta();
  if (meta.target.supportedGtnhVersions.includes(gtnhVersion)) {
    return true;
  }
  return gtnhVersion.startsWith("2.9.");
}

/** The dataset the dictionaries were built from, for attribution. */
export function gameDataSourceDatasetVersion(): string {
  return getGameDataMeta().source.datasetVersion;
}

export function hasChinese(value: string): boolean {
  return HAS_CJK.test(value);
}

export function getGameNames(): Record<string, string> {
  return names;
}

export function getGameWords(): Record<string, string> {
  return words;
}

export function getGameMaterials(): Record<string, string> {
  return materials;
}

export function getGamePatterns(): GameShapePattern[] {
  return patterns;
}

export function stripGameFormatting(value: string): string {
  return value.replace(FORMATTING, "").trim();
}

/** Case, whitespace and punctuation insensitive, for near-miss keys. */
export function normalizeGameName(value: string): string {
  return stripGameFormatting(value)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim();
}

/**
 * The key shape shared by queries and every dictionary index: full-width folded
 * to half-width, spaces between Chinese dropped, whitespace folded. Dictionary
 * keys pass through it too, so the full-width punctuation the assets carry
 * ("提示方块：1号") still matches the half-width a query may use.
 */
export function normalizeGameQueryText(value: string): string {
  if (!value) {
    return "";
  }
  let text = value
    .replace(FULL_WIDTH, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ")
    .trim();
  text = dropCjkGaps(text);
  return text.replace(/\s+/g, " ");
}

function dropCjkGaps(value: string): string {
  let previous: string;
  do {
    previous = value;
    value = value.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2");
  } while (value !== previous);
  return value;
}

/**
 * A dataset registry id ("minecraft:stone", "gregtech:gt.metaitem.01@17305").
 * Lowercase, colon-separated, no spaces; display names with a colon carry one.
 */
const REGISTRY_ID = /^[a-z0-9_.-]+:[a-z0-9_.@/:-]+$/;

function looksLikeRegistryId(value: string): boolean {
  return REGISTRY_ID.test(value);
}

/** English -> Chinese, exactly as typed. */
export function translateGameName(name: string, locale: Locale): string {
  return resolveGameName(name, locale).text;
}

const resolutionCache = new Map<string, GameNameResolution>();
const MAX_CACHED_RESOLUTIONS = 4096;

/** The translated name and which of the three qualities answered it. */
export function resolveGameName(name: string, locale: Locale): GameNameResolution {
  const cacheKey = `${locale}\u0000${name}`;
  const cached = resolutionCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const resolution = resolveUncached(name, locale);
  if (resolutionCache.size >= MAX_CACHED_RESOLUTIONS) {
    resolutionCache.clear();
  }
  resolutionCache.set(cacheKey, resolution);
  return resolution;
}

function resolveUncached(name: string, locale: Locale): GameNameResolution {
  const cleaned = stripGameFormatting(name);
  if (!cleaned) {
    return { text: name, source: "fallback" };
  }

  if (locale === "en") {
    if (HAS_CJK.test(cleaned)) {
      const english = chineseNameToEnglish(cleaned);
      return english ? { text: english, source: "dictionary" } : { text: name, source: "fallback" };
    }
    return { text: name, source: names[cleaned] ? "dictionary" : "fallback" };
  }

  if (HAS_CJK.test(cleaned)) {
    // Already Chinese: the dictionary confirms it, otherwise it is left alone.
    return { text: name, source: chineseNameCandidates(cleaned).length ? "dictionary" : "fallback" };
  }

  const exact = names[cleaned];
  if (exact !== undefined) {
    return { text: exact, source: "dictionary" };
  }
  const byNorm = normalizedNames().get(normalizeGameName(cleaned));
  if (byNorm !== undefined) {
    return { text: byNorm, source: "dictionary" };
  }
  // A registry id is not a display name. With no label supplied it must stay
  // the id, not compose a half-translated key ("minecraft:stone" -> "minecraft:石头").
  if (looksLikeRegistryId(cleaned)) {
    return { text: name, source: "fallback" };
  }
  const patterned = applyShapePattern(cleaned);
  if (patterned) {
    return { text: patterned, source: "generated" };
  }
  const composed = composeWords(cleaned, 0.5);
  if (composed) {
    return { text: composed, source: "generated" };
  }
  return { text: name, source: "fallback" };
}

let normalizedByName: Map<string, string> | undefined;

function normalizedNames(): Map<string, string> {
  if (normalizedByName) {
    return normalizedByName;
  }
  const index = new Map<string, string>();
  for (const [english, chinese] of Object.entries(names)) {
    const key = normalizeGameName(english);
    if (key && !index.has(key)) {
      index.set(key, chinese);
    }
  }
  normalizedByName = index;
  return index;
}

let reverseByName: Map<string, string[]> | undefined;

/**
 * Chinese name -> every English name the dictionary gives it.
 *
 * The reverse of an ambiguous name is not trusted to a single key: 水果 stands
 * for seventy-odd nuts and berries, and picking one would answer a name query
 * with a name the player never typed. Callers that need one string use
 * `chineseNameToEnglish`, which only answers unambiguous names.
 */
function reverseNames(): Map<string, string[]> {
  if (reverseByName) {
    return reverseByName;
  }
  const index = new Map<string, string[]>();
  for (const [english, chinese] of Object.entries(names)) {
    const key = normalizeGameQueryText(chinese);
    // A single Chinese character is a word, not a name: "钢" must segment to
    // "steel" rather than pretend to be some item called 钢.
    if (key.length < 2) {
      continue;
    }
    const existing = index.get(key);
    if (existing) {
      if (!existing.includes(english)) {
        existing.push(english);
      }
    } else {
      index.set(key, [english]);
    }
  }
  reverseByName = index;
  return index;
}

export function chineseNameCandidates(chinese: string): string[] {
  return reverseNames().get(normalizeGameQueryText(chinese)) ?? [];
}

/** The English name for a Chinese one, only when the dictionary is unambiguous. */
export function chineseNameToEnglish(chinese: string): string | undefined {
  const candidates = chineseNameCandidates(chinese);
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** English names whose Chinese name contains the query, shortest first. */
export function englishNamesContaining(chinese: string, limit = 3): string[] {
  const query = normalizeGameQueryText(chinese);
  if (!query) {
    return [];
  }
  const out: string[] = [];
  for (const [name, candidates] of reverseNames()) {
    if (name.includes(query)) {
      out.push(...candidates);
    }
  }
  out.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return [...new Set(out)].slice(0, limit);
}

/** A Chinese word's English candidates, highest frequency first. */
export function chineseWordEnglish(chinese: string): string[] | undefined {
  const list = searchWords[normalizeGameQueryText(chinese)];
  return list && list.length ? list : undefined;
}

/** Every Chinese name the dictionary knows, with its English candidates. */
export function getChineseNameIndex(): ReadonlyMap<string, string[]> {
  return reverseNames();
}

/** The Chinese word -> English candidates table the search planner segments with. */
export function getChineseSearchWords(): Record<string, string[]> {
  return searchWords;
}

// Keys are normalized the same way queries are, so a word written with
// full-width punctuation is still found by the query the planner hands over.
const searchWords: Record<string, string[]> = (() => {
  const table: Record<string, string[]> = Object.create(null);
  for (const [word, candidates] of Object.entries(
    (gameSearchJson as { zhWords: Record<string, string[]> }).zhWords,
  )) {
    const key = normalizeGameQueryText(word);
    if (!key) {
      continue;
    }
    const existing = table[key];
    if (!existing) {
      table[key] = [...candidates];
      continue;
    }
    for (const candidate of candidates) {
      if (!existing.includes(candidate)) {
        existing.push(candidate);
      }
    }
  }
  return table;
})();

function applyShapePattern(text: string): string | undefined {
  for (const pattern of patterns) {
    if (text.length <= pattern.prefix.length + pattern.suffix.length) {
      continue;
    }
    if (!text.startsWith(pattern.prefix) || !text.endsWith(pattern.suffix)) {
      continue;
    }
    const middle = text.slice(pattern.prefix.length, text.length - pattern.suffix.length);
    if (!middle) {
      continue;
    }
    const material = materials[middle];
    if (!material) {
      continue;
    }
    return pattern.zhPrefix + material + pattern.zhSuffix;
  }
  return undefined;
}

/** Lower-case function words mark a string as UI copy, not a name. */
const SENTENCE_MARKERS = [
  " the ",
  " is ",
  " are ",
  " was ",
  " will ",
  " can ",
  " you ",
  " your ",
  " not ",
  " and ",
  " or ",
  " if ",
  " when ",
  " then ",
  " than ",
  " with ",
  " without ",
  " from ",
  " into ",
  " over ",
  " under ",
  " per ",
  " on ",
  " for ",
  " it ",
  " its ",
  " this ",
  " that ",
  " these ",
  " those ",
  " of ",
  " to ",
  " in ",
  " at ",
  " by ",
  " as ",
  " no ",
  " own ",
  " one ",
  " still ",
  " how ",
  " many ",
  " what ",
  " which ",
  " who ",
  " up ",
  " down ",
  " here ",
  " there ",
  " we ",
  " they ",
  " our ",
  " their ",
  " us ",
  " me ",
  " my ",
  " he ",
  " she ",
  " him ",
  " her ",
  " do ",
  " does ",
  " did ",
  " so ",
];

const MAX_COMPOSED_WORDS = 6;
const MAX_COMPOSED_PHRASE = 5;

function tokenizeEnglish(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Compose a Chinese name word by word, longest phrase first, refusing
 * sentences. `minRatio` is how much of the name has to be covered by known
 * words before the composition is worth showing.
 */
function composeWords(text: string, minRatio: number): string | undefined {
  if (/[.!?]$/.test(text)) {
    return undefined;
  }
  if (text.split(/\s+/).length > MAX_COMPOSED_WORDS) {
    return undefined;
  }
  const padded = ` ${text} `;
  if (SENTENCE_MARKERS.some((marker) => padded.includes(marker))) {
    return undefined;
  }

  const tokens = text.split(/([^A-Za-z0-9'\u00c0-\u024f]+)/);
  const out: string[] = [];
  let matched = 0;
  let total = 0;
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (!token) {
      index += 1;
      continue;
    }
    if (/^(the|a|an)$/i.test(token) && countLetterTokens(tokens) > 1) {
      index += 1;
      while (index < tokens.length && /^\s+$/.test(tokens[index] ?? "")) {
        index += 1;
      }
      continue;
    }
    if (!/[A-Za-z0-9]/.test(token)) {
      out.push(token.replace(/ +/g, " "));
      index += 1;
      continue;
    }
    total += 1;

    let hit: { value: string; consumed: number; end: number } | undefined;
    for (let size = MAX_COMPOSED_PHRASE; size >= 1; size -= 1) {
      const parts: string[] = [];
      let cursor = index;
      while (parts.length < size && cursor < tokens.length) {
        const candidate = tokens[cursor] ?? "";
        if (!candidate || /^\s+$/.test(candidate) || candidate === "-") {
          cursor += 1;
          continue;
        }
        if (/[A-Za-z0-9]/.test(candidate)) {
          parts.push(candidate);
          cursor += 1;
          continue;
        }
        break;
      }
      if (parts.length !== size) {
        continue;
      }
      const joined = parts.join(" ");
      const value =
        words[joined.toLowerCase()] ??
        words[joined.toLowerCase().replace(/ /g, "-")] ??
        materials[joined] ??
        names[joined] ??
        normalizedNames().get(normalizeGameName(joined));
      if (!value) {
        continue;
      }
      hit = { value, consumed: parts.length, end: cursor };
      break;
    }

    if (hit) {
      matched += hit.consumed;
      out.push(hit.value);
      total += hit.consumed - 1;
      index = hit.end;
      continue;
    }

    const singular = token.toLowerCase().replace(/s$/, "");
    const singularValue =
      singular !== token.toLowerCase()
        ? (words[singular] ?? normalizedNames().get(normalizeGameName(singular)))
        : undefined;
    if (singularValue) {
      out.push(singularValue);
      matched += 1;
    } else {
      out.push(token);
    }
    index += 1;
  }

  if (matched === 0 || matched / total < minRatio) {
    return undefined;
  }
  return dropCjkSpaces(out.join("").replace(/\s+/g, " ").trim());
}

function countLetterTokens(tokens: string[]): number {
  let total = 0;
  for (const token of tokens) {
    if (/[A-Za-z]{2,}/.test(token)) {
      total += 1;
    }
  }
  return total;
}

function dropCjkSpaces(value: string): string {
  let previous: string;
  do {
    previous = value;
    value = value.replace(
      /([\u4e00-\u9fff\uff0c\u3002\uff1a\uff08\uff09])\s+([\u4e00-\u9fff\uff0c\u3002\uff1a\uff08\uff09])/g,
      "$1$2",
    );
  } while (value !== previous);
  return value;
}

// tokenizeEnglish is exported through the search module, which needs the same
// token shape the dataset index uses.
export { tokenizeEnglish as splitGameEnglishTokens };
