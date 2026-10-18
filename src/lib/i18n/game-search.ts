/**
 * Chinese queries into the dataset's English search.
 *
 * The dataset is English and the server's tokenizer drops anything that is not
 * `[a-z0-9]`, so a Chinese query has to become an English one before it is
 * parsed. This module plans that, reusing the dictionaries the resolver ships:
 *
 *   1. a whole Chinese name maps to its canonical English name ("钢板" ->
 *      "Steel Plate"), which the existing exact-name ranking already rewards;
 *   2. otherwise the query is segmented longest-match and each Chinese word
 *      becomes the English word the dataset actually uses ("钢" -> "steel",
 *      "研磨机" -> "macerator"), joined by spaces - the server ANDs its words,
 *      which is exactly the intent;
 *   3. a name the dictionary knows several English names for, or a fragment it
 *      knows none for, offers the English names that answer it as candidates.
 *
 * Latin runs and digits pass through untouched, so a voltage abbreviation or a
 * unit ("HV 研磨机", "512 EU/t 钢板") keeps its meaning and the dataset's own
 * alias table handles it. `alternatives` are looser readings of the first one:
 * the Chinese-only core without a Latin modifier, and the phrase without its
 * generic head. Each is a strict token subset of the first reading, so a caller
 * that already falls back to partial word matching gains nothing from them;
 * they matter to callers that compare whole English forms.
 *
 * A query with Chinese that resolves to nothing is `unresolved`. Callers must
 * turn that into no results, never into a blank query: the blank query is the
 * "list everything" browse, and an unknown word must not show the whole item
 * list.
 *
 * Pure and dependency free beyond the dictionaries: no DOM, no fetch, no
 * patched globals.
 */
import {
  chineseNameCandidates,
  chineseNameToEnglish,
  englishNamesContaining,
  getChineseNameIndex,
  getChineseSearchWords,
  hasChinese,
  normalizeGameQueryText,
  splitGameEnglishTokens,
  stripGameFormatting,
} from "./game-names";

export type BilingualQueryKind = "exact" | "expanded" | "tokens" | "candidates" | "none";

export interface BilingualQueryPlan {
  kind: BilingualQueryKind;
  /** The query as normalized: full-width folded, CJK gaps dropped. */
  chinese: string;
  /** The English query to hand the dataset search; "" when unresolved. */
  english: string;
  /** Looser English readings to try when `english` finds nothing. */
  alternatives: string[];
  /** Whole English names the query might stand for. */
  candidates: string[];
  /** True when the query had Chinese but nothing could be resolved. */
  unresolved: boolean;
}

/** What a caller needs to run a search: the query, retries, and the guard. */
export interface BilingualSearch {
  text: string;
  alternatives: string[];
  unresolved: boolean;
}

const CJK = /[\u4e00-\u9fff]/;
/** Full-width to half-width, spaces between Chinese dropped, whitespace folded. */
export function normalizeGameQuery(raw: string): string {
  return normalizeGameQueryText(raw);
}

interface SegmentPart {
  chinese: string;
  englishTokens: string[];
  confidence: number;
}

interface SegmentResult {
  /** Every English token, Latin runs included. */
  tokens: string[];
  parts: SegmentPart[];
}

interface SegmentTables {
  names: Map<string, string>;
  words: Map<string, string>;
  maxKey: number;
}

let tables: SegmentTables | undefined;

function segmentTables(): SegmentTables {
  if (tables) {
    return tables;
  }
  const names = new Map<string, string>();
  const words = new Map<string, string>();
  let maxKey = 1;

  for (const [chinese, candidates] of getChineseNameIndex()) {
    maxKey = Math.max(maxKey, chinese.length);
    if (candidates.length === 1) {
      names.set(chinese, candidates[0]);
      continue;
    }
    // An ambiguous name is not trusted to one key: the words every candidate
    // shares are the honest reading of it ("ME 流体存储组件" -> "me fluid
    // storage component"), and a name with nothing shared is left out so it
    // segments through its words instead.
    const shared = commonEnglishTokens(candidates);
    if (shared) {
      names.set(chinese, shared);
    }
  }

  for (const [chinese, list] of Object.entries(getChineseSearchWords())) {
    maxKey = Math.max(maxKey, chinese.length);
    if (list.length && !names.has(chinese)) {
      words.set(chinese, list[0]);
    }
  }

  tables = { names, words, maxKey };
  return tables;
}

/** The words every English name in a group shares, or undefined when none. */
function commonEnglishTokens(candidates: string[]): string | undefined {
  let shared: Set<string> | undefined;
  for (const candidate of candidates) {
    const tokens = new Set(splitGameEnglishTokens(candidate));
    if (!shared) {
      shared = tokens;
      continue;
    }
    for (const token of [...shared]) {
      if (!tokens.has(token)) {
        shared.delete(token);
      }
    }
  }
  if (!shared || shared.size === 0) {
    return undefined;
  }
  return [...shared].join(" ");
}

/**
 * Longest-match segmentation. Latin runs and digits pass through as tokens;
 * every Chinese word becomes the English words the dataset uses.
 */
function segment(query: string): SegmentResult {
  const { names, words, maxKey } = segmentTables();
  const tokens: string[] = [];
  const parts: SegmentPart[] = [];
  let index = 0;

  while (index < query.length) {
    const character = query.charAt(index);
    if (!CJK.test(character)) {
      const latin = /^[A-Za-z0-9#@:._-]+/.exec(query.slice(index));
      if (latin) {
        tokens.push(latin[0]);
        index += latin[0].length;
        continue;
      }
      index += 1;
      continue;
    }

    let hit: string | null = null;
    const limit = Math.min(maxKey, query.length - index);
    for (let size = limit; size >= 1; size -= 1) {
      const candidate = query.slice(index, index + size);
      if (names.has(candidate) || words.has(candidate)) {
        hit = candidate;
        break;
      }
    }
    if (!hit) {
      index += 1;
      continue;
    }

    let english: string | undefined;
    let confidence = 0;
    if (hit.length > 1 && names.has(hit)) {
      english = names.get(hit);
      confidence = 1;
    } else if (words.has(hit)) {
      english = words.get(hit);
      const candidates = getChineseSearchWords()[hit] ?? [];
      confidence = candidates.length === 1 ? 0.8 : 0.5;
    } else if (names.has(hit)) {
      english = names.get(hit);
      confidence = 0.4;
    }

    const englishTokens = english ? splitGameEnglishTokens(english) : [];
    if (englishTokens.length) {
      tokens.push(...englishTokens);
    }
    parts.push({ chinese: hit, englishTokens, confidence });
    index += hit.length;
  }

  return { tokens, parts };
}

function dedupe(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (value && !out.includes(value)) {
      out.push(value);
    }
  }
  return out;
}

/**
 * Plan a query. Returns undefined when the query has no Chinese at all, so an
 * English search is left exactly as it was.
 */
export function planBilingualQuery(raw: string): BilingualQueryPlan | undefined {
  const chinese = normalizeGameQuery(raw);
  if (!chinese || !hasChinese(chinese)) {
    return undefined;
  }

  const exact = chineseNameToEnglish(chinese);
  if (exact) {
    return { kind: "exact", chinese, english: exact, alternatives: [], candidates: [], unresolved: false };
  }

  const segmented = segment(chinese);
  if (segmented.tokens.length > 0) {
    const english = segmented.tokens.join(" ");
    return {
      kind: "tokens",
      chinese,
      english,
      alternatives: alternativesFor(segmented, english),
      candidates: [],
      unresolved: false,
    };
  }

  // The query is not a unique name and did not segment into known words. It can
  // still be a name the dictionary knows several English names for ("甜菜" is
  // Beet, Beetroot and Sugar Beet): every one is a real answer, so all are
  // offered rather than guessing one key from an inverse map. A fragment no name
  // contains falls through to the English names that contain it.
  const known = orderedCandidates(chineseNameCandidates(chinese));
  const candidates = known.length > 0 ? known : englishNamesContaining(chinese, 3);
  if (candidates.length > 0) {
    return {
      kind: "candidates",
      chinese,
      english: candidates[0],
      alternatives: candidates.slice(1),
      candidates,
      unresolved: false,
    };
  }

  return { kind: "none", chinese, english: "", alternatives: [], candidates: [], unresolved: true };
}

/** Shortest first, so the plainest name is the primary reading; ties alphabetical. */
function orderedCandidates(candidates: string[]): string[] {
  return [...new Set(candidates)].sort(
    (left, right) => left.length - right.length || left.localeCompare(right),
  );
}

/**
 * Looser readings of one query. Each is a strict subset of `english`'s tokens,
 * so a caller that already falls back to partial word matching gains nothing
 * from them; they matter to callers comparing whole English forms.
 */
function alternativesFor(segmented: SegmentResult, english: string): string[] {
  const alternatives: string[] = [];

  // Drop a Latin modifier the dataset may not carry in a name ("HV 研磨机"):
  // the Chinese core is what names the resource.
  const chineseTokens = segmented.parts.flatMap((part) => part.englishTokens);
  if (chineseTokens.length && chineseTokens.join(" ") !== english) {
    alternatives.push(chineseTokens.join(" "));
  }

  if (segmented.parts.length > 1) {
    // Chinese phrases are modifier + head and the head is the generic part
    // (线, 场, 机), so searching the modifiers alone often lands.
    const withoutHead = segmented.parts
      .slice(0, -1)
      .flatMap((part) => part.englishTokens)
      .join(" ");
    if (withoutHead) {
      alternatives.push(withoutHead);
    }

    // Also drop the weakest word, when it is not the head already dropped.
    let weakest = 0;
    for (let index = 1; index < segmented.parts.length; index += 1) {
      if (segmented.parts[index].confidence < segmented.parts[weakest].confidence) {
        weakest = index;
      }
    }
    if (weakest !== segmented.parts.length - 1) {
      const withoutWeakest = segmented.parts
        .filter((_part, index) => index !== weakest)
        .flatMap((part) => part.englishTokens)
        .join(" ");
      if (withoutWeakest) {
        alternatives.push(withoutWeakest);
      }
    }
  }

  return dedupe(alternatives).filter((value) => value !== english);
}

/** The planned English query, or undefined for English and unresolved queries. */
export function bilingualQuery(raw: string): string | undefined {
  const plan = planBilingualQuery(raw);
  return plan && !plan.unresolved ? plan.english : undefined;
}

/**
 * The query a search should run: the English text, the retries, and whether the
 * Chinese resolved at all. Undefined for a query with no Chinese.
 */
export function bilingualSearch(raw: string): BilingualSearch | undefined {
  const plan = planBilingualQuery(raw);
  if (!plan) {
    return undefined;
  }
  return {
    text: plan.english,
    alternatives: dedupe([...plan.alternatives, ...plan.candidates.slice(1)]),
    unresolved: plan.unresolved,
  };
}

/**
 * Does an English display name answer a Chinese (or English) filter query?
 *
 * For the in-page filter boxes, which compare against English names directly
 * and never reach the server. An unresolved Chinese query matches nothing, so
 * an unknown word does not turn the filter into "show everything".
 * A whole English form has to appear in the name, so a compound Chinese query
 * the server answers through partial word matching can match nothing here.
 */
export function matchesGameNameFilter(query: string, englishName: string): boolean {
  const { needle, forms } = filterNeedles(query);
  if (!needle) {
    return true;
  }
  const haystack = englishName.toLowerCase();
  if (haystack.includes(needle)) {
    return true;
  }
  return forms.some((form) => haystack.includes(form));
}

interface FilterNeedles {
  /** The query as typed, lowercased; "" means "no filter". */
  needle: string;
  /** Lowercased English forms to try; empty when nothing resolved. */
  forms: string[];
}

// A filter box plans once per keystroke but compares once per row, so the plan
// is kept per query. Bounded: a box only ever holds one query at a time.
const filterNeedleCache = new Map<string, FilterNeedles>();
const MAX_CACHED_FILTER_NEEDLES = 128;

function filterNeedles(query: string): FilterNeedles {
  const cached = filterNeedleCache.get(query);
  if (cached) {
    return cached;
  }
  const needle = stripGameFormatting(query).trim().toLowerCase();
  const plan = needle ? planBilingualQuery(query) : undefined;
  const forms =
    plan && !plan.unresolved
      ? [plan.english, ...plan.alternatives, ...plan.candidates]
          .map((form) => form.toLowerCase())
          .filter(Boolean)
      : [];
  const entry = { needle, forms };
  if (filterNeedleCache.size >= MAX_CACHED_FILTER_NEEDLES) {
    filterNeedleCache.clear();
  }
  filterNeedleCache.set(query, entry);
  return entry;
}
