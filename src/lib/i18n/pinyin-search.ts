import { polyphonic } from "pinyin-pro";
import { parseSearchQuery, type SearchQuery, type SearchTermVariant } from "@/lib/search";
import { getChineseSearchWords, stripGameFormatting, translateGameName } from "./game-names";

interface PhoneticChar {
  literal: string;
  readings: readonly string[];
}
interface PinyinEntry {
  name: string;
  chars: readonly PhoneticChar[];
}
export interface PinyinAlias {
  name: string;
  weight: number;
}
export interface PinyinSearchIndex {
  search: (query: string) => readonly PinyinAlias[];
}

const HAN = /\p{Script=Han}/u;
const WORD_CHAR = /[a-z0-9\p{Script=Han}\ue900-\ue90f]/u;
const RESERVED = new Set([
  "ulv", "lv", "mv", "hv", "ev", "iv", "luv", "zpm", "uv", "uhv", "uev", "uiv", "umv", "uxv", "max",
  "eu", "eut", "rf", "fe", "gt", "bw", "tc", "tf", "nc", "ae", "ic2", "ae2",
  "ebf", "bbf", "lcr", "cal", "tgs", "eig", "qft", "eoh", "dtpf", "pcb", "lpf", "ia",
]);
const EXTRA_READINGS: Record<string, readonly string[]> = {
  "\ue900": ["lu", "jinlu"], "𬬻": ["lu", "jinlu"],
  "\ue901": ["du", "jindu"], "𬭊": ["du", "jindu"],
  "\ue902": ["xi", "jinxi"], "𬭳": ["xi", "jinxi"],
  "\ue903": ["bo", "jinbo"], "𬭛": ["bo", "jinbo"],
  "\ue904": ["hei", "jinhei"], "𬭶": ["hei", "jinhei"],
  "鿏": ["mai", "jinmai"], "\ue906": ["da", "jinda"], "𫟼": ["da", "jinda"],
  "\ue907": ["lun", "jinlun"], "𬬭": ["lun", "jinlun"],
  "鿔": ["ge", "jinge"], "鿭": ["ni", "jiner"],
  "\ue90a": ["fu", "jinfu"], "𫓧": ["fu", "jinfu"],
  "\ue90c": ["li", "jinli"], "𫟷": ["li", "jinli"],
  "鿬": ["tian", "shitian"], "鿫": ["ao", "qiao", "aoqi"],
};
const characterCache = new Map<string, PhoneticChar>();
const localNameCache = new Map<string, readonly (readonly PhoneticChar[])[]>();
const MAX_LOCAL_NAMES = 2048;
const MAX_QUERIES = 64;

export function isReservedSearchToken(token: string): boolean {
  return RESERVED.has(normalize(token));
}
function normalize(value: string): string {
  return stripGameFormatting(value).normalize("NFKC").toLowerCase().replace(/ü/g, "v");
}
function compact(value: string): string {
  return Array.from(normalize(value)).filter(char => WORD_CHAR.test(char)).join("");
}
function phoneticChar(literal: string): PhoneticChar {
  const cached = characterCache.get(literal);
  if (cached) return cached;
  const readings = EXTRA_READINGS[literal] ?? (HAN.test(literal)
    ? polyphonic(literal, { type: "array", toneType: "none", v: true })[0].filter(value => /^[a-z]+$/.test(value))
    : []);
  const value = { literal, readings: [...new Set(readings)] };
  characterCache.set(literal, value);
  return value;
}
let chineseAliases: Map<string, string[]> | undefined;
function nameAliases(name: string): string[] {
  if (!chineseAliases) {
    chineseAliases = new Map();
    for (const [chinese, english] of Object.entries(getChineseSearchWords())) {
      for (const value of english) {
        const key = value.toLowerCase();
        const aliases = chineseAliases.get(key);
        if (aliases) aliases.push(chinese);
        else chineseAliases.set(key, [chinese]);
      }
    }
  }
  const label = name.replace(/(?:^|\s)[a-z0-9_.-]+:[a-z0-9_.@/-]+(?=\s|$)/gi, " ").trim();
  return [...new Set([translateGameName(label, "zh-CN"), ...(chineseAliases.get(label.toLowerCase()) ?? [])])];
}
function compile(name: string): readonly (readonly PhoneticChar[])[] {
  return nameAliases(name).map(alias => Array.from(compact(alias)).map(phoneticChar));
}
function queryNeedle(query: string): string | undefined {
  const normalized = normalize(query).trim();
  if (normalized.length > 128 || /[^a-z0-9\p{Script=Han}\ue900-\ue90f\s'’-]/u.test(normalized)) return undefined;
  const needle = compact(normalized);
  if (needle.length < 2 || !/[a-z]/.test(needle) || RESERVED.has(needle)) return undefined;
  return needle;
}

/** Match literal characters, complete syllables and initials without expanding every spelling. */
function match(chars: readonly PhoneticChar[], needle: string): number {
  let best = 0;
  for (let start = 0; start < chars.length; start += 1) {
    const first = chars[start];
    if (!needle.startsWith(first.literal) && !first.readings.some(reading => reading[0] === needle[0])) continue;
    const memo = new Map<number, number>();
    const walk = (position: number, offset: number, abbreviated: boolean, phonetic: boolean): number => {
      if (offset === needle.length) {
        if (!phonetic) return 0;
        return (start === 0 ? (position === chars.length ? 0.9 : 0.78) : 0.68) * (abbreviated ? 0.85 : 1);
      }
      if (position === chars.length) return 0;
      const key = ((position * (needle.length + 1) + offset) * 2 + Number(abbreviated)) * 2 + Number(phonetic);
      const cached = memo.get(key);
      if (cached !== undefined) return cached;
      const char = chars[position];
      let score = needle.startsWith(char.literal, offset)
        ? walk(position + 1, offset + char.literal.length, abbreviated, phonetic) : 0;
      for (const reading of char.readings) {
        if (needle.startsWith(reading, offset)) {
          score = Math.max(score, walk(position + 1, offset + reading.length, abbreviated, true));
        }
        const initial = reading.slice(0, 1);
        if (needle.startsWith(initial, offset)) {
          score = Math.max(score, walk(position + 1, offset + 1, true, true));
        }
        if (/^(zh|ch|sh)/.test(reading) && needle.startsWith(reading.slice(0, 2), offset)) {
          score = Math.max(score, walk(position + 1, offset + 2, true, true));
        }
        const remaining = needle.slice(offset);
        if (reading.startsWith(remaining) && remaining.length < reading.length) {
          score = Math.max(score, walk(position + 1, needle.length, true, true));
        }
      }
      memo.set(key, score);
      return score;
    };
    best = Math.max(best, walk(start, 0, false, false));
    if (best === 0.9) break;
  }
  return best;
}

/** Two-character prefixes narrow all full-pinyin, initial and literal/phonetic paths. */
function prefixKeys(chars: readonly PhoneticChar[]): Set<string> {
  const keys = new Set<string>();
  chars.forEach((char, index) => {
    const starts = [char.literal, ...char.readings];
    const next = chars[index + 1];
    for (const spelling of starts) {
      if (spelling.length >= 2) keys.add(spelling.slice(0, 2));
      if (next) {
        for (const after of [next.literal, ...next.readings]) keys.add(spelling[0] + after[0]);
      }
    }
  });
  return keys;
}

/** Index lifetime follows its dataset or board; query caches stay bounded. */
export function buildPinyinSearchIndex(names: Iterable<string>): PinyinSearchIndex {
  const entries: PinyinEntry[] = [];
  const starts = new Map<string, number[]>();
  const cache = new Map<string, readonly PinyinAlias[]>();
  const uniqueNames = new Set(names);
  const literalNames = new Set([...uniqueNames].flatMap(name => [compact(name), ...(normalize(name).match(/[a-z]{3,}/g) ?? [])]));
  for (const name of uniqueNames) {
    for (const chars of compile(name)) {
      if (!chars.some(char => char.readings.length > 0)) continue;
      const index = entries.push({ name, chars }) - 1;
      for (const key of prefixKeys(chars)) {
        const values = starts.get(key);
        if (values) values.push(index);
        else starts.set(key, [index]);
      }
    }
  }
  return {
    search(query) {
      const needle = queryNeedle(query);
      if (!needle || literalNames.has(needle)) return [];
      const cached = cache.get(needle);
      if (cached) return cached;
      const weights = new Map<string, number>();
      for (const index of starts.get(needle.slice(0, 2)) ?? []) {
        const entry = entries[index];
        const weight = match(entry.chars, needle);
        if (weight > 0) weights.set(entry.name, Math.max(weights.get(entry.name) ?? 0, weight));
      }
      const hits = [...weights].map(([name, weight]) => ({ name, weight }));
      hits.sort((left, right) => right.weight - left.weight || left.name.length - right.name.length || left.name.localeCompare(right.name));
      if (cache.size >= MAX_QUERIES) cache.delete(cache.keys().next().value!);
      cache.set(needle, hits);
      return hits;
    },
  };
}

const variantCache = new WeakMap<readonly PinyinAlias[], SearchTermVariant[]>();
function aliasVariants(aliases: readonly PinyinAlias[]): SearchTermVariant[] {
  const cached = variantCache.get(aliases);
  if (cached) return cached;
  const byPhrase = new Map<string, SearchTermVariant>();
  for (const alias of aliases) {
    const parsed = parseSearchQuery(alias.name);
    const tokens = parsed.terms.map(term => term.raw);
    const key = tokens.join(" ");
    if (key && !byPhrase.has(key)) byPhrase.set(key, { tokens, weight: alias.weight * 0.5 });
  }
  const candidates = [...byPhrase.values()].sort((left, right) => left.tokens.length - right.tokens.length || right.weight - left.weight);
  const variants: SearchTermVariant[] = [];
  for (const candidate of candidates) {
    if (!variants.some(old => old.weight >= candidate.weight && old.tokens.every(token => candidate.tokens.includes(token)))) variants.push(candidate);
  }
  variantCache.set(aliases, variants);
  return variants;
}
function mergeVariants(original: SearchTermVariant[], extra: SearchTermVariant[]): SearchTermVariant[] {
  const keys = new Set(original.map(variant => variant.tokens.join(" ")));
  return [...original, ...extra.filter(variant => !keys.has(variant.tokens.join(" ")))];
}
function recordNames(target: Map<string, number>, aliases: readonly PinyinAlias[]) {
  for (const alias of aliases) {
    const key = parseSearchQuery(alias.name).text;
    target.set(key, Math.max(target.get(key) ?? 0, alias.weight * 0.5));
  }
}
/** English spellings retain weight 1; pinyin adds lower-weight OR variants within each AND term. */
export function withPinyinSearch(query: SearchQuery, getIndex: () => PinyinSearchIndex, raw = query.text): SearchQuery {
  if ((!query.terms.length && !queryNeedle(raw)) || /^[a-z0-9_.-]+:[a-z0-9_.@-]+$/i.test(raw.trim())) return query;
  const rawWords = normalize(raw).trim().split(/\s+/);
  const canGroup = rawWords.every(word => !RESERVED.has(word)) && queryNeedle(raw);
  let index: PinyinSearchIndex | undefined;
  const search = (value: string) => {
    if (!queryNeedle(value)) return [];
    index ??= getIndex();
    return index.search(value);
  };
  const aliases = canGroup ? search(raw) : [];
  const nameAliases = new Map<string, number>();
  if (aliases.length && (query.terms.length !== 1 || HAN.test(raw))) {
    const variants: SearchTermVariant[] = query.terms.length
      ? [{ tokens: query.terms.map(term => term.raw), weight: 1 }] : [];
    recordNames(nameAliases, aliases);
    return { ...query, nameAliases, terms: [{ raw: query.text, variants: mergeVariants(variants, aliasVariants(aliases)), correctable: false }] };
  }
  let changed = false;
  const terms = query.terms.map(term => {
    const matches = search(term.raw);
    if (!matches.length) return term;
    recordNames(nameAliases, matches);
    const variants = mergeVariants(term.variants, aliasVariants(matches));
    if (variants.length === term.variants.length) return term;
    changed = true;
    return { ...term, variants, correctable: false };
  });
  return changed ? { ...query, terms, nameAliases } : query;
}

export function matchesPinyinNameFilter(query: string, englishName: string): boolean {
  const needle = queryNeedle(query);
  const words = normalize(query).trim().split(/\s+/);
  if (!needle && words.length <= 1) return false;
  const english = normalize(englishName);
  const englishWords = new Set(english.match(/[a-z]+/g) ?? []);
  if (words.every(word => englishWords.has(word))) return false;
  let chars = localNameCache.get(englishName);
  if (!chars) {
    chars = compile(englishName);
    if (localNameCache.size >= MAX_LOCAL_NAMES) localNameCache.delete(localNameCache.keys().next().value!);
    localNameCache.set(englishName, chars);
  }
  if (needle && chars.some(alias => match(alias, needle) > 0)) return true;
  let phonetic = false;
  const all = words.length > 1 && words.every(word => {
    if (english.includes(word)) return true;
    const part = queryNeedle(word);
    const hit = part && chars!.some(alias => match(alias, part) > 0);
    if (hit) phonetic = true;
    return Boolean(hit);
  });
  return all && phonetic;
}
