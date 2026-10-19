/**
 * The power picker's search: a query matches a source by NAME, or by
 * anything the machine TAKES or MAKES under any single setting choice - so
 * "benzene" surfaces the Gas Turbine, the SOFCs and the XL Gas Turbine, and
 * picking one places the card with that setting already dialed in.
 *
 * The index is built once, lazily: every select option of every source is
 * computed with the other settings at their defaults, and each flow name it
 * introduces remembers the choice that produced it.
 */
import { hasChinese, translateGameName } from "@/lib/i18n/game-names";
import { translateGameLabel } from "@/lib/i18n/game-labels";
import { planBilingualQuery } from "@/lib/i18n/game-search";
import { buildPinyinSearchIndex, isReservedSearchToken, type PinyinSearchIndex } from "@/lib/i18n/pinyin-search";
import { resolvePowerResource } from "./planner-data";
import { POWER_SOURCES } from "./registry";
import {
  buildPowerSettingsReader,
  type PowerSelectSetting,
  type PowerSourceDefinition,
} from "./types";

export interface PowerFlowMatch {
  direction: "takes" | "makes";
  /** The flow's display name, resolved through the resource map when known. */
  name: string;
  /** The choice that produces this flow; absent when the defaults already do. */
  settingId?: string;
  optionKey?: string;
}

export interface PowerSearchHit {
  source: PowerSourceDefinition;
  /** Set when the query matched a flow rather than the machine itself. */
  via?: PowerFlowMatch;
}

/**
 * The id the recipe search's stencil uses for its "makes power" condition.
 * Not a dataset resource: no recipe map answers it, so the recipe side of
 * the search naturally comes back empty and only generators respond.
 */
export const POWER_EU_CLAUSE_ID = "gtnh-power:eu";

export interface PowerStencilClause {
  role: "takes" | "makes";
  kind: string;
  id: string;
}

export interface PowerStencilHit {
  source: PowerSourceDefinition;
  /** Every dialed choice the matched clauses need, merged. */
  settings?: Record<string, string>;
  /** One entry per matched clause, for captions. */
  matches: PowerFlowMatch[];
}

interface SourceIndex {
  source: PowerSourceDefinition;
  nameText: string;
  /** The Chinese labels the player sees, spaces removed: the machine and every flow it lists. */
  zhNames: string[];
  /** normalized Chinese flow label -> the first (most default) way to get it. */
  zhFlows: Map<string, PowerFlowMatch>;
  /** lowercased flow name -> the first (most default) way to get it. */
  flows: Map<string, PowerFlowMatch>;
  /** "direction:kind:id" (resolved resource) -> same, for exact clause hits. */
  flowsById: Map<string, PowerFlowMatch>;
  /**
   * The full flow-id set of each single-option sweep ("settingId optionKey";
   * "" is the defaults), so a permutation can be checked against the whole
   * stencil instead of guessed at.
   */
  optionFlowSets: Map<string, Set<string>>;
}

let indexCache: SourceIndex[] | undefined;

/** Lazily shared by generator-name and fuel searches. */
let pinyinIndexCache: PinyinSearchIndex | undefined;

function pinyinNames(index: SourceIndex[]): Iterable<string> {
  const names = new Set<string>();
  for (const entry of index) {
    names.add(entry.source.name);
    for (const match of entry.flows.values()) {
      names.add(match.name);
    }
  }
  return names;
}

function pinyinAliases(query: string, index: SourceIndex[]): string[] {
  if (!/[a-z]/i.test(query.normalize("NFKC"))) {
    return [];
  }
  pinyinIndexCache ??= buildPinyinSearchIndex(pinyinNames(index));
  return pinyinIndexCache.search(query).map((alias) => alias.name.toLowerCase());
}

function flowDisplayName(rawName: string): string {
  return resolvePowerResource(rawName)?.displayName ?? rawName;
}

function recordFlows(
  entry: SourceIndex,
  model: { inputs: Array<{ name: string }>; outputs: Array<{ name: string }>; euPerTick: number },
  choice: { settingId?: string; optionKey?: string },
) {
  const setKey = choice.settingId ? `${choice.settingId} ${choice.optionKey}` : "";
  const flowSet = new Set<string>();
  entry.optionFlowSets.set(setKey, flowSet);
  const record = (direction: "takes" | "makes", rawName: string) => {
    const name = flowDisplayName(rawName);
    const key = `${direction}:${name.toLowerCase()}`;
    if (!entry.flows.has(key)) {
      entry.flows.set(key, { direction, name, ...choice });
    }
    const zh = normalizeChinese(translateGameLabel(name, "zh-CN"));
    if (zh && !entry.zhFlows.has(zh)) {
      entry.zhFlows.set(zh, { direction, name, ...choice });
    }
    const resource = resolvePowerResource(rawName);
    if (resource) {
      const idKey = `${direction}:${resource.kind}:${resource.id}`;
      flowSet.add(idKey);
      if (!entry.flowsById.has(idKey)) {
        entry.flowsById.set(idKey, { direction, name, ...choice });
      }
    }
  };
  for (const flow of model.inputs) {
    record("takes", flow.name);
  }
  for (const flow of model.outputs) {
    record("makes", flow.name);
  }
  if (model.euPerTick > 0) {
    const key = "makes:eu";
    flowSet.add("makes:power:eu");
    if (!entry.flows.has(key)) {
      entry.flows.set(key, { direction: "makes", name: "EU", ...choice });
    }
    if (!entry.flowsById.has("makes:power:eu")) {
      entry.flowsById.set("makes:power:eu", { direction: "makes", name: "EU", ...choice });
    }
  }
  // Parasitic draw is deliberately NOT recorded as a takes flow: nearly
  // every recipe takes power too, so "what takes EU" cannot be answered
  // from generators alone. The search says so instead.
}

function buildIndex(): SourceIndex[] {
  return POWER_SOURCES.map((source) => {
    const entry: SourceIndex = {
      source,
      // Name and tier only - the blurbs NAME fuels ("burns benzene..."),
      // and a blurb match would swallow the flow match that knows which
      // setting to dial in.
      nameText: `${source.name} ${source.unlock ?? ""}`.toLowerCase(),
      zhNames: [],
      zhFlows: new Map(),
      flows: new Map(),
      flowsById: new Map(),
      optionFlowSets: new Map(),
    };
    // Defaults first, so a fuel the card already burns wins over a dialed one.
    try {
      recordFlows(entry, source.compute(buildPowerSettingsReader(source, undefined)), {});
    } catch {
      // A source that cannot compute its defaults still lists by name.
    }
    for (const setting of source.settings) {
      if (setting.type !== "select") {
        continue;
      }
      for (const option of setting.options) {
        if (option.key === setting.defaultKey) {
          continue;
        }
        try {
          recordFlows(
            entry,
            source.compute(buildPowerSettingsReader(source, { [setting.id]: option.key })),
            { settingId: setting.id, optionKey: option.key },
          );
        } catch {
          // One bad option must not take the machine out of the index.
        }
      }
    }
    // The machine's own Chinese name only: a flow name is answered by zhFlows,
    // which knows the direction and the setting the card must be placed with.
    entry.zhNames = [
      ...new Set([
        normalizeChinese(translateGameLabel(source.name, "zh-CN")),
        normalizeChinese(translateGameName(source.name, "zh-CN")),
      ]),
    ].filter(Boolean);
    return entry;
  });
}

/**
 * The English words a query is searched by. A Chinese query is planned to
 * English first - the generators and their flows are named in English - and an
 * unknown Chinese word matches nothing rather than everything.
 */
function englishNeedles(query: string): string[] {
  if (!hasChinese(query)) {
    const trimmed = query.trim().toLowerCase();
    return trimmed === "" ? [] : [trimmed];
  }
  const plan = planBilingualQuery(query);
  if (!plan || plan.unresolved) {
    return [];
  }
  const normalized = query.normalize("NFKC");
  const latin = normalized.match(/[a-z][a-z0-9]*/gi) ?? [];
  const technical = latin.length > 0 && latin.every(isReservedSearchToken);
  if (!technical && /[\p{Script=Han}][a-z]|[a-z][\p{Script=Han}]/iu.test(normalized)) {
    return plan.english ? [plan.english.toLowerCase()] : [];
  }
  return [...new Set([plan.english, ...plan.alternatives, ...plan.candidates])]
    .map((form) => form.toLowerCase())
    .filter(Boolean);
}

/** Canonical aliases preserve the fuel keys used by placement settings. */
function searchNeedles(query: string, index: SourceIndex[]): string[] {
  const needles = englishNeedles(query);
  const aliases = pinyinAliases(query, index);
  return aliases.length === 0 ? needles : [...new Set([...needles, ...aliases])];
}
/** Chinese labels are matched with spaces removed, so "XL涡轮" finds "XL 涡轮燃气轮机". */
function normalizeChinese(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/** The Chinese query as one needle, or nothing when the query has no Chinese. */
function chineseNeedle(query: string): string | undefined {
  if (!hasChinese(query)) {
    return undefined;
  }
  const normalized = normalizeChinese(query);
  return normalized === "" ? undefined : normalized;
}

/**
 * Whether a query names the machine. A Chinese query also answers the Chinese
 * label the player reads: planning cannot always spell that label back into
 * English (a machine name the dictionary only knows whole), so the label itself
 * is matched too.
 */
function matchesName(entry: SourceIndex, needles: string[], zhNeedle: string | undefined): boolean {
  return (
    needles.some((needle) => entry.nameText.includes(needle)) ||
    (zhNeedle !== undefined && entry.zhNames.some((name) => name.includes(zhNeedle)))
  );
}

export function searchPowerSources(query: string): PowerSearchHit[] {
  const index = (indexCache ??= buildIndex());
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") {
    return index.map((entry) => ({ source: entry.source }));
  }
  const needles = searchNeedles(query, index);
  const zhNeedle = chineseNeedle(query);

  const nameHits: PowerSearchHit[] = [];
  const flowHits: PowerSearchHit[] = [];
  for (const entry of index) {
    if (matchesName(entry, needles, zhNeedle)) {
      nameHits.push({ source: entry.source });
      continue;
    }
    // The best flow match: a default-settings flow beats a dialed one, and
    // makes beats takes when both answer (players search for products).
    let best: PowerFlowMatch | undefined;
    const consider = (match: PowerFlowMatch) => {
      if (
        !best ||
        (best.settingId !== undefined && match.settingId === undefined) ||
        (best.direction === "takes" &&
          match.direction === "makes" &&
          (best.settingId === undefined) === (match.settingId === undefined))
      ) {
        best = match;
      }
    };
    for (const [key, match] of entry.flows) {
      const flowName = key.slice(key.indexOf(":") + 1);
      if (needles.some((needle) => flowName.includes(needle))) {
        consider(match);
      }
    }
    if (zhNeedle !== undefined) {
      for (const [flowName, match] of entry.zhFlows) {
        if (flowName.includes(zhNeedle)) {
          consider(match);
        }
      }
    }
    if (best) {
      flowHits.push({ source: entry.source, via: best });
    }
  }
  return [...nameHits, ...flowHits];
}

/** The settings a hit should be placed with: the dialed choice, if any. */
export function hitPlacementSettings(hit: PowerSearchHit): Record<string, string> | undefined {
  if (hit.via?.settingId && hit.via.optionKey) {
    return { [hit.via.settingId]: hit.via.optionKey };
  }
  return undefined;
}

function clauseKey(clause: PowerStencilClause): string {
  if (clause.id === POWER_EU_CLAUSE_ID) {
    return `${clause.role}:power:eu`;
  }
  return `${clause.role}:${clause.kind}:${clause.id}`;
}

/**
 * The recipe search's view of the generators: a source answers the stencil
 * when its flows - under ANY single setting choice - satisfy each side's
 * conditions under that side's op (only reads as all; a generator's
 * housekeeping flows are not what "nothing else" is policing). The dialed
 * choices merge into the settings the card should be placed with; two
 * conditions that need the same knob at different positions cannot both be
 * true, so that source drops out. A name query narrows by machine name,
 * exactly as it narrows the recipes.
 */
export function searchPowerSourcesForStencil(
  clauses: PowerStencilClause[],
  takesOp: "any" | "all" | "only",
  makesOp: "any" | "all" | "only",
  query: string,
): PowerStencilHit[] {
  const index = (indexCache ??= buildIndex());
  const trimmed = query.trim().toLowerCase();
  const needles = searchNeedles(query, index);
  const zhNeedle = chineseNeedle(query);

  if (clauses.length === 0) {
    // No conditions: only a typed name (or the power keyword) brings
    // generators into the recipe search.
    if (trimmed === "") {
      return [];
    }
    const wantsPower =
      trimmed.length >= 2 && ("power".startsWith(trimmed) || "energy".startsWith(trimmed));
    const hits: PowerStencilHit[] = [];
    for (const entry of index) {
      if (matchesName(entry, needles, zhNeedle)) {
        hits.push({ source: entry.source, matches: [] });
      } else if ((wantsPower || trimmed === "eu") && entry.flowsById.has("makes:power:eu")) {
        hits.push({ source: entry.source, matches: [entry.flowsById.get("makes:power:eu")!] });
      }
    }
    return hits;
  }

  const sideOp = (role: "takes" | "makes") => (role === "takes" ? takesOp : makesOp);
  const hits: PowerStencilHit[] = [];
  for (const entry of index) {
    if (trimmed !== "" && !matchesName(entry, needles, zhNeedle)) {
      continue;
    }
    const matches: PowerFlowMatch[] = [];
    const settings: Record<string, string> = {};
    let rejected = false;
    let matchedAny = false;
    for (const role of ["takes", "makes"] as const) {
      const side = clauses.filter((clause) => clause.role === role);
      if (side.length === 0) {
        continue;
      }
      const sideMatches = side.map((clause) => {
        const key = clauseKey(clause);
        return key ? entry.flowsById.get(key) : undefined;
      });
      const apply = (match: PowerFlowMatch): boolean => {
        if (match.settingId && match.optionKey) {
          const standing = settings[match.settingId];
          if (standing !== undefined && standing !== match.optionKey) {
            return false;
          }
          settings[match.settingId] = match.optionKey;
        }
        matches.push(match);
        return true;
      };
      if (sideOp(role) === "any") {
        // One condition is enough: take the best non-conflicting match,
        // an undialed flow before a dialed one.
        const candidates = sideMatches
          .filter((match): match is PowerFlowMatch => match !== undefined)
          .sort((a, b) => (a.settingId ? 1 : 0) - (b.settingId ? 1 : 0));
        const picked = candidates.find((match) => apply(match));
        if (!picked) {
          rejected = true;
          break;
        }
      } else {
        // all (and only, read as all): every condition must hold at once.
        if (sideMatches.some((match) => match === undefined)) {
          rejected = true;
          break;
        }
        for (const match of sideMatches) {
          if (!apply(match!)) {
            rejected = true;
            break;
          }
        }
        if (rejected) {
          break;
        }
      }
      matchedAny = true;
    }
    if (rejected || !matchedAny) {
      continue;
    }
    hits.push({
      source: entry.source,
      settings: Object.keys(settings).length > 0 ? settings : undefined,
      matches,
    });
  }
  // Ready-as-is machines first: a card that needs no dialing is the closer fit.
  hits.sort((a, b) => (a.settings ? 1 : 0) - (b.settings ? 1 : 0));

  // PERMUTATIONS: a machine whose fuel knob the search did not pin is one
  // recipe per fuel (a Large Steel Boiler making steam burns any of its
  // fuels; showing only the first implies it needs that one). Each such hit
  // expands into one card per option of its fuel-like select, NEI-style.
  // The pure makes-power catalog query stays one card per machine.
  const asksAboutResources = clauses.some((clause) => clause.id !== POWER_EU_CLAUSE_ID);
  if (!asksAboutResources) {
    return hits;
  }
  // Which side ops each side needs, restated over a plain flow set.
  const sideSatisfied = (flowSet: Set<string>, role: "takes" | "makes"): boolean => {
    const side = clauses.filter((clause) => clause.role === role);
    if (side.length === 0) {
      return true;
    }
    const matched = side.filter((clause) => flowSet.has(clauseKey(clause))).length;
    return matched >= (sideOp(role) === "any" ? 1 : side.length);
  };
  const expanded: PowerStencilHit[] = [];
  for (const hit of hits) {
    const entry = index.find((candidate) => candidate.source === hit.source);
    const fuelSelect = entry ? fuelSelectFor(entry) : undefined;
    if (!entry || !fuelSelect) {
      expanded.push(hit);
      continue;
    }
    // Every option of the fuel knob that satisfies the WHOLE stencil gets
    // its own card. Benzene pinned by a clause keeps exactly the benzene
    // option; steam asked of a boiler keeps them all.
    let any = false;
    for (const option of fuelSelect.options) {
      if (option.key === "None") {
        continue;
      }
      const isDefault = option.key === fuelSelect.defaultKey;
      const flowSet = entry.optionFlowSets.get(isDefault ? "" : `${fuelSelect.id} ${option.key}`);
      if (!flowSet || !sideSatisfied(flowSet, "takes") || !sideSatisfied(flowSet, "makes")) {
        continue;
      }
      any = true;
      expanded.push({
        ...hit,
        settings: isDefault ? hit.settings : { ...(hit.settings ?? {}), [fuelSelect.id]: option.key },
      });
    }
    if (!any) {
      expanded.push(hit);
    }
  }
  return expanded;
}

/**
 * The select that decides WHAT the machine eats - the one whose options each
 * introduced their own takes-flow in the index. Rotors, sizes and boosts
 * scale numbers without renaming an ingredient, so they never qualify.
 */
function fuelSelectFor(entry: SourceIndex): PowerSelectSetting | undefined {
  let best: PowerSelectSetting | undefined;
  let bestCount = 1;
  for (const setting of entry.source.settings) {
    if (setting.type !== "select") {
      continue;
    }
    let count = 0;
    for (const match of entry.flows.values()) {
      if (match.settingId === setting.id && match.direction === "takes") {
        count += 1;
      }
    }
    if (count > bestCount) {
      best = setting;
      bestCount = count;
    }
  }
  return best;
}
