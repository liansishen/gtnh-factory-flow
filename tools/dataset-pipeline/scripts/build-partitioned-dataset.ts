import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { polyphonic } from "pinyin-pro";
import type {
  DatasetManifest,
  DatasetResource,
  DatasetResourceIndexEntry,
  DatasetVersion,
  MachineHandlerIconEntry,
  RecipeMapIconEntry,
} from "../../../src/lib/datasets/types";
import type { Recipe, ResourceAlternative } from "../../../src/lib/model/types";
import {
  getFilledCellFluidEquivalent,
  isFluidEquivalentToFilledCell,
  isOreDictionaryResource,
  isVirtualChoiceResource,
} from "../../../src/lib/model";
import {
  buildSearchVocabulary,
  normalizeSearchText,
  splitSearchTokens,
} from "../../../src/lib/search";
import {
  getChineseSearchWords,
  stripGameFormatting,
  translateGameName,
} from "../../../src/lib/i18n/game-names";
import {
  getChoiceAlternativesByKey,
  getMachineConfigResources,
  getRecipeMapIcon,
  getResourceModId,
   getWildcardResource,
  withSynthesizedHandlerIcons,
  withTankMapFace,
} from "../../../src/lib/server/dataset-query";
import {
  encodeDeltaVarints,
  hashPartitionKey,
  packPostingsBuffer,
  packRecipeMetaArrays,
  packResourceSearchMeta,
  padBucketIndex,
  type FilledCellStub,
  type LookupBucketFile,
  type PartitionShardDescriptor,
  type PartitionedDatasetMeta,
  type PinyinBucketFile,
  type PinyinCoreFile,
  type RecipeIdBucketFile,
  type ResourceKeyBucketFile,
  type ResourceSearchStringsFile,
} from "../../../src/lib/server/dataset-partitions";

const gunzipAsync = promisify(gunzip);
const gzipAsync = promisify(gzip);

const RESOURCE_CHUNK_SIZE = 2000;
const KEY_BUCKET_COUNT = 8;
const LOOKUP_BUCKET_COUNT = 16;
const RECIPE_ID_BUCKET_COUNT = 16;
const PINYIN_BUCKET_COUNT = 16;
const RECIPE_TOKENS_PER_CHUNK = 20000;

const PLANT_RECIPE_MAPS = new Set(["Crop Farm", "IC2 Crop", "Tree Growth Simulator"]);
const BEE_RECIPE_MAPS = new Set(["Bee Produce"]);

interface RawResourceIndexFile {
  schemaVersion: 1;
  datasetVersionId: string;
  gtnhVersion: string;
  sourceInfo: DatasetVersion["sourceInfo"];
  resources: DatasetResource[];
  resourceIndex: DatasetResourceIndexEntry[];
  recipeMaps: string[];
  recipeMapIcons?: RecipeMapIconEntry[];
  machineHandlerIcons?: MachineHandlerIconEntry[];
  generatedAt: string;
  recipeCount: number;
  shards: PartitionShardDescriptor[];
}

interface RawRecipeLookupIndexFile {
  schemaVersion: 1;
  datasetVersionId: string;
  recipeCount: number;
  shards: PartitionShardDescriptor[];
  recipeMaps: string[];
  recipeIds?: string[];
  tierIndexes: number[];
  iconScores?: number[];
  searchText?: string[];
  entries: Array<[string, Array<[number, number[]]>]>;
}

async function readGzipJsonFile<T>(filePath: string): Promise<T> {
  const compressed = await fs.readFile(filePath);
  const unzipped = await gunzipAsync(compressed);
  return JSON.parse(unzipped.toString("utf8")) as T;
}

async function writeGzipJsonFile(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const compressed = await gzipAsync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 6 });
  await fs.writeFile(filePath, compressed);
}

async function writeGzipBinaryFile(filePath: string, payload: Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const compressed = await gzipAsync(Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength), {
    level: 6,
  });
  await fs.writeFile(filePath, compressed);
}

function mergeResourceAlternatives(
  left: DatasetResourceIndexEntry["alternatives"],
  right: DatasetResourceIndexEntry["alternatives"],
): DatasetResourceIndexEntry["alternatives"] {
  const merged = [...(left ?? [])];
  for (const alternative of right ?? []) {
    if (!merged.some((entry) => entry.kind === alternative.kind && entry.id === alternative.id)) {
      merged.push(alternative);
    }
  }
  return merged.length > 0 ? merged : undefined;
}

function mergeCatalogResource(
  existing: DatasetResource | DatasetResourceIndexEntry,
  incoming: DatasetResource | DatasetResourceIndexEntry,
): DatasetResource | DatasetResourceIndexEntry {
  return {
    ...existing,
    ...incoming,
    displayName: incoming.displayName ?? existing.displayName ?? incoming.id ?? existing.id,
    iconPath: incoming.iconPath ?? existing.iconPath,
    iconAtlas: incoming.iconAtlas ?? existing.iconAtlas,
    dominantColor:
      incoming.dominantColor ??
      incoming.iconAtlas?.dominantColor ??
      existing.dominantColor ??
      existing.iconAtlas?.dominantColor,
    tooltip: incoming.tooltip ?? existing.tooltip,
    oreDictionary: incoming.oreDictionary ?? existing.oreDictionary,
    alternatives: mergeResourceAlternatives(existing.alternatives, incoming.alternatives),
  };
}

// ---------------------------------------------------------------------------
// Pinyin Partition Builder
// ---------------------------------------------------------------------------

const HAN = /\p{Script=Han}/u;
const WORD_CHAR = /[a-z0-9\p{Script=Han}\ue900-\ue90f]/u;
const EXTRA_READINGS: Record<string, readonly string[]> = {
  "\ue900": ["lu", "jinlu"],
  "𬬻": ["lu", "jinlu"],
  "\ue901": ["du", "jindu"],
  "𬭊": ["du", "jindu"],
  "\ue902": ["xi", "jinxi"],
  "𬭳": ["xi", "jinxi"],
  "\ue903": ["bo", "jinbo"],
  "𬭛": ["bo", "jinbo"],
  "\ue904": ["hei", "jinhei"],
  "𬭶": ["hei", "jinhei"],
  "鿏": ["mai", "jinmai"],
  "\ue906": ["da", "jinda"],
  "𫟼": ["da", "jinda"],
  "\ue907": ["lun", "jinlun"],
  "𬬭": ["lun", "jinlun"],
  "鿔": ["ge", "jinge"],
  "鿭": ["ni", "jiner"],
  "\ue90a": ["fu", "jinfu"],
  "𫓧": ["fu", "jinfu"],
  "\ue90c": ["li", "jinli"],
  "𫟷": ["li", "jinli"],
  "鿬": ["tian", "shitian"],
  "鿫": ["ao", "qiao", "aoqi"],
};

function normalizePinyin(value: string): string {
  return stripGameFormatting(value).normalize("NFKC").toLowerCase().replace(/ü/g, "v");
}

function compactPinyin(value: string): string {
  return Array.from(normalizePinyin(value))
    .filter((char) => WORD_CHAR.test(char))
    .join("");
}

function buildPinyinBuckets(
  names: Iterable<string>,
  bucketCount: number,
): { core: PinyinCoreFile; buckets: PinyinBucketFile[] } {
  const uniqueNames = [...new Set(names)];
  const literalNames = new Set(
    uniqueNames.flatMap((name) => [
      compactPinyin(name),
      ...(normalizePinyin(name).match(/[a-z]{3,}/g) ?? []),
    ]),
  );

  const charCache = new Map<string, { literal: string; readings: string[] }>();
  const getPhoneticChar = (literal: string) => {
    let cached = charCache.get(literal);
    if (cached) {
      return cached;
    }
    const readings =
      EXTRA_READINGS[literal] ??
      (HAN.test(literal)
        ? polyphonic(literal, { type: "array", toneType: "none", v: true })[0].filter((val) =>
            /^[a-z]+$/.test(val),
          )
        : []);
    cached = { literal, readings: [...new Set(readings)] };
    charCache.set(literal, cached);
    return cached;
  };

  const chineseAliases = new Map<string, string[]>();
  for (const [chinese, english] of Object.entries(getChineseSearchWords())) {
    for (const value of english) {
      const key = value.toLowerCase();
      const aliases = chineseAliases.get(key);
      if (aliases) {
        aliases.push(chinese);
      } else {
        chineseAliases.set(key, [chinese]);
      }
    }
  }

  const getNameAliases = (name: string): string[] => {
    const label = name.replace(/(?:^|\s)[a-z0-9_.-]+:[a-z0-9_.@/-]+(?=\s|$)/gi, " ").trim();
    return [
      ...new Set([
        translateGameName(label, "zh-CN"),
        ...(chineseAliases.get(label.toLowerCase()) ?? []),
      ]),
    ];
  };

  const getPrefixKeys = (chars: Array<{ literal: string; readings: string[] }>): Set<string> => {
    const keys = new Set<string>();
    chars.forEach((char, index) => {
      const starts = [char.literal, ...char.readings];
      const next = chars[index + 1];
      for (const spelling of starts) {
        if (spelling.length >= 2) {
          keys.add(spelling.slice(0, 2));
        }
        if (next) {
          for (const after of [next.literal, ...next.readings]) {
            keys.add(spelling[0] + after[0]);
          }
        }
      }
    });
    return keys;
  };

  const coreChars: Array<[string, string[]]> = [];
  const coreCharMap = new Map<string, number>();
  const coreNames: string[] = [];
  const coreNameMap = new Map<string, number>();
  const coreEntries: Array<[number, number[]]> = [];
  const globalStarts = new Map<string, number[]>();

  for (const name of uniqueNames) {
    for (const alias of getNameAliases(name)) {
      const chars = Array.from(compactPinyin(alias)).map(getPhoneticChar);
      if (!chars.some((char) => char.readings.length > 0)) {
        continue;
      }
      let nameIdx = coreNameMap.get(name);
      if (nameIdx === undefined) {
        nameIdx = coreNames.push(name) - 1;
        coreNameMap.set(name, nameIdx);
      }
      const charIds = chars.map((ch) => {
        let cid = coreCharMap.get(ch.literal);
        if (cid === undefined) {
          cid = coreChars.push([ch.literal, ch.readings]) - 1;
          coreCharMap.set(ch.literal, cid);
        }
        return cid;
      });
      const entryIndex = coreEntries.push([nameIdx, charIds]) - 1;
      for (const prefix2 of getPrefixKeys(chars)) {
        const list = globalStarts.get(prefix2);
        if (list) {
          list.push(entryIndex);
        } else {
          globalStarts.set(prefix2, [entryIndex]);
        }
      }
    }
  }

  const buckets: PinyinBucketFile[] = Array.from({ length: bucketCount }, () => ({
    literals: [],
    starts: {},
  }));

  for (const literal of literalNames) {
    if (literal.length < 2) {
      continue;
    }
    const bIdx = hashPartitionKey(literal.slice(0, 2), bucketCount);
    buckets[bIdx].literals.push(literal);
  }

  for (const [prefix2, globalEntryIndexes] of globalStarts) {
    const bIdx = hashPartitionKey(prefix2, bucketCount);
    buckets[bIdx].starts[prefix2] = globalEntryIndexes;
  }

  return {
    core: {
      chars: coreChars,
      names: coreNames,
      entries: coreEntries,
    },
    buckets,
  };
}

export async function buildPartitionedDatasetForVersion(
  datasetRoot: string,
  version: DatasetVersion,
): Promise<void> {
  const versionId = version.id;
  const versionDir = path.join(datasetRoot, versionId);
  const partitionsDir = path.join(versionDir, "partitions");
  console.info(`Building partitioned dataset for ${versionId}...`);
  await fs.rm(partitionsDir, { recursive: true, force: true });

  const resourceIndexFile = await readGzipJsonFile<RawResourceIndexFile>(
    path.join(versionDir, "resource-index.json.gz"),
  );
  const lookupIndexFile = await readGzipJsonFile<RawRecipeLookupIndexFile>(
    path.join(versionDir, "recipe-lookup-index.json.gz"),
  );

  const catalogLike = {
    ...resourceIndexFile,
    version,
    recipeMapIcons: withTankMapFace(resourceIndexFile),
  };

  const machineHandlerIcons = withSynthesizedHandlerIcons(catalogLike as never);
  const machineConfigResources = getMachineConfigResources(catalogLike as never);
  const choiceAlternatives = getChoiceAlternativesByKey(catalogLike as never);

  const allRecipeMaps = [
    ...new Set([...resourceIndexFile.recipeMaps, ...lookupIndexFile.recipeMaps]),
  ];
  const resolvedRecipeMapIcons: Record<string, DatasetResourceIndexEntry> = {};
  for (const recipeMap of allRecipeMaps) {
    const icon = getRecipeMapIcon(catalogLike as never, recipeMap);
    if (icon) {
      resolvedRecipeMapIcons[recipeMap] = icon;
    }
  }

  const resourcesByKey = new Map<string, DatasetResource | DatasetResourceIndexEntry>();
  for (const resource of [...resourceIndexFile.resources, ...resourceIndexFile.resourceIndex]) {
    const key = `${resource.kind}:${resource.id}`;
    const existing = resourcesByKey.get(key);
    resourcesByKey.set(key, existing ? mergeCatalogResource(existing, resource) : resource);
  }

  const filledCells: FilledCellStub[] = [];
  const nonOredictAltKeys: string[] = [];
  for (const [key, candidate] of resourcesByKey) {
    if (!isOreDictionaryResource(candidate) && candidate.alternatives?.length) {
      nonOredictAltKeys.push(key);
    }
    if (
      candidate.kind === "item" &&
      !isOreDictionaryResource(candidate) &&
      getFilledCellFluidEquivalent(candidate)
    ) {
      filledCells.push({
        id: candidate.id,
        displayName: candidate.displayName,
        alternatives: candidate.alternatives,
      });
    }
  }

  const resourceCount = resourceIndexFile.resourceIndex.length;
  const resourceChunkCount = Math.ceil(resourceCount / RESOURCE_CHUNK_SIZE);

  // Build recipe-meta-arrays.bin.gz
  const recipeCount = lookupIndexFile.recipeCount;
  const recipeMapIdsByRecipeIndex = new Int16Array(recipeCount);
  recipeMapIdsByRecipeIndex.fill(-1);
  const directionCounts = new Map<string, { madeBy: number; usedBy: number }>();
  const plantMapIds = new Set<number>();
  const beeMapIds = new Set<number>();
  lookupIndexFile.recipeMaps.forEach((mapName, idx) => {
    if (PLANT_RECIPE_MAPS.has(mapName)) plantMapIds.add(idx);
    if (BEE_RECIPE_MAPS.has(mapName)) beeMapIds.add(idx);
  });
  const plantKeys = new Set<string>();
  const beeKeys = new Set<string>();

  for (const [modeKey, recipesByMap] of lookupIndexFile.entries) {
    const colon = modeKey.indexOf(":");
    const mode = modeKey.slice(0, colon);
    const resourceKey = modeKey.slice(colon + 1);
    let total = 0;
    for (const [recipeMapId, recipeIndexes] of recipesByMap) {
      total += recipeIndexes.length;
      if (mode === "recipes") {
        if (plantMapIds.has(recipeMapId)) plantKeys.add(resourceKey);
        if (beeMapIds.has(recipeMapId)) beeKeys.add(resourceKey);
      }
      for (const recipeIndex of recipeIndexes) {
        if (
          recipeIndex >= 0 &&
          recipeIndex < recipeCount &&
          recipeMapIdsByRecipeIndex[recipeIndex] === -1
        ) {
          recipeMapIdsByRecipeIndex[recipeIndex] = recipeMapId;
        }
      }
    }
    const dirEntry = directionCounts.get(resourceKey) ?? { madeBy: 0, usedBy: 0 };
    if (mode === "recipes") {
      dirEntry.madeBy += total;
    } else if (mode === "uses") {
      dirEntry.usedBy += total;
    }
    directionCounts.set(resourceKey, dirEntry);
  }

  const tierIndexes = new Uint8Array(recipeCount);
  for (let i = 0; i < recipeCount; i += 1) {
    tierIndexes[i] = lookupIndexFile.tierIndexes[i] ?? 0;
  }
  const iconScores = new Uint8Array(recipeCount);
  for (let i = 0; i < recipeCount; i += 1) {
    iconScores[i] = Math.min(255, lookupIndexFile.iconScores?.[i] ?? 0);
  }

  await writeGzipBinaryFile(
    path.join(partitionsDir, "recipe-meta-arrays.bin.gz"),
    packRecipeMetaArrays(recipeCount, recipeMapIdsByRecipeIndex, tierIndexes, iconScores),
  );

  // Build resource search meta, strings, and postings
  const modNames: string[] = [];
  const modIndexByName = new Map<string, number>();
  const flags = new Uint8Array(resourceCount);
  const modIds = new Uint16Array(resourceCount);
  const recipeCounts = new Uint32Array(resourceCount);
  const madeByCounts = new Uint32Array(resourceCount);
  const usedByCounts = new Uint32Array(resourceCount);
  const displayNames: string[] = new Array(resourceCount);
  const ids: string[] = new Array(resourceCount);
  const tokenPostingsMap = new Map<string, number[]>();

  for (let index = 0; index < resourceCount; index += 1) {
    const resource = resourceIndexFile.resourceIndex[index];
    const key = `${resource.kind}:${resource.id}`;
    const isVirtual = isVirtualChoiceResource(resource);
    const hasIcon = Boolean(resource.iconPath || resource.iconAtlas);
    const isSearchable = !isVirtual && hasIcon;
    const isOreDict = isOreDictionaryResource(resource);
    let flagByte = 0;
    if (isSearchable) flagByte |= 1;
    if (resource.kind === "fluid") flagByte |= 2;
    if (plantKeys.has(key)) flagByte |= 4;
    if (beeKeys.has(key)) flagByte |= 8;
    if (isOreDict) flagByte |= 16;
    if (isVirtual) flagByte |= 32;
    flags[index] = flagByte;

    const modName = getResourceModId(resource);
    let mId = modIndexByName.get(modName);
    if (mId === undefined) {
      mId = modNames.push(modName) - 1;
      modIndexByName.set(modName, mId);
    }
    modIds[index] = mId;

    const dir = directionCounts.get(key);
    recipeCounts[index] = resource.recipeCount ?? 0;
    madeByCounts[index] = dir?.madeBy ?? 0;
    usedByCounts[index] = dir?.usedBy ?? 0;
    displayNames[index] = resource.displayName ?? resource.id;
    ids[index] = resource.id;

    // Collect highest-weight field code for each token in this resource
    const bestField = new Map<string, number>();
    for (const tok of splitSearchTokens((resource.tooltip ?? []).join(" "))) {
      bestField.set(tok, 0);
    }
    for (const tok of splitSearchTokens(
      `${resource.id} ${(resource.oreDictionary ?? []).join(" ")}`,
    )) {
      bestField.set(tok, 1);
    }
    for (const tok of splitSearchTokens(resource.displayName ?? "")) {
      bestField.set(tok, 2);
    }
    for (const [tok, fieldCode] of bestField) {
      const packed = (index << 2) | fieldCode;
      const list = tokenPostingsMap.get(tok);
      if (list) {
        list.push(packed);
      } else {
        tokenPostingsMap.set(tok, [packed]);
      }
    }
  }

  const sortedResourceIndexesArr = resourceIndexFile.resourceIndex
    .map((_, index) => index)
    .filter((index) => (flags[index] & 32) === 0)
    .sort((leftIndex, rightIndex) => {
      return (
        recipeCounts[rightIndex] - recipeCounts[leftIndex] ||
        displayNames[leftIndex].localeCompare(displayNames[rightIndex])
      );
    });
  const sortedResourceIndexes = new Uint32Array(sortedResourceIndexesArr);

  const vocabulary = buildSearchVocabulary(
    sortedResourceIndexesArr
      .map((index) => resourceIndexFile.resourceIndex[index])
      .filter((resource) => resource && !isOreDictionaryResource(resource))
      .map((resource) => resource.displayName ?? ""),
  );

  const allResourceTokens = [...tokenPostingsMap.keys()].sort();
  const resourcePostingLists = allResourceTokens.map((tok) => tokenPostingsMap.get(tok)!);
  const encodedResourcePostings = encodeDeltaVarints(resourcePostingLists);

  await Promise.all([
    writeGzipBinaryFile(
      path.join(partitionsDir, "resource-search-meta.bin.gz"),
      packResourceSearchMeta({
        resourceCount,
        flags,
        modIds,
        recipeCounts,
        madeByCounts,
        usedByCounts,
        sortedResourceIndexes,
      }),
    ),
    writeGzipJsonFile(path.join(partitionsDir, "resource-search-strings.json.gz"), {
      modNames,
      displayNames,
      ids,
      vocabTokens: vocabulary.tokens,
      vocabWeights: vocabulary.weights,
      allResourceTokens,
    } satisfies ResourceSearchStringsFile),
    writeGzipBinaryFile(
      path.join(partitionsDir, "resource-postings.bin.gz"),
      packPostingsBuffer(encodedResourcePostings.offsets, encodedResourcePostings.data),
    ),
  ]);

  // Write binary-indexed resource entries parts (2 parts of up to 34,000 entries)
  const RESOURCE_ENTRIES_PART_SIZE = 34000;
  const textEncoder = new TextEncoder();
  for (
    let partIdx = 0;
    partIdx * RESOURCE_ENTRIES_PART_SIZE < resourceCount;
    partIdx += 1
  ) {
    const slice = resourceIndexFile.resourceIndex.slice(
      partIdx * RESOURCE_ENTRIES_PART_SIZE,
      (partIdx + 1) * RESOURCE_ENTRIES_PART_SIZE,
    );
    const bufs = slice.map((entry) => textEncoder.encode(JSON.stringify(entry)));
    const offsets = new Uint32Array(bufs.length + 1);
    let totalBytes = 0;
    for (let i = 0; i < bufs.length; i += 1) {
      offsets[i] = totalBytes;
      totalBytes += bufs[i].byteLength;
    }
    offsets[bufs.length] = totalBytes;
    const data = new Uint8Array(totalBytes);
    for (let i = 0; i < bufs.length; i += 1) {
      data.set(bufs[i], offsets[i]);
    }
    await writeGzipBinaryFile(
      path.join(partitionsDir, `resource-entries-${padBucketIndex(partIdx)}.bin.gz`),
      packPostingsBuffer(offsets, data),
    );
  }

  // Precompute oredict memberships for fast scope resolution
  const exactItemToOredicts = new Map<string, Set<string>>();
  const wildcardBaseToOredicts = new Map<string, Set<string>>();
  for (const candidate of resourcesByKey.values()) {
    if (candidate.kind !== "item" || !isOreDictionaryResource(candidate)) {
      continue;
    }
    const oredictName = candidate.id.slice("oredict:".length);
    for (const alt of candidate.alternatives ?? []) {
      let s = exactItemToOredicts.get(alt.id);
      if (!s) {
        s = new Set();
        exactItemToOredicts.set(alt.id, s);
      }
      s.add(oredictName);
      if (alt.id.endsWith("@32767")) {
        const baseId = alt.id.slice(0, -"@32767".length);
        let ws = wildcardBaseToOredicts.get(baseId);
        if (!ws) {
          ws = new Set();
          wildcardBaseToOredicts.set(baseId, ws);
        }
        ws.add(oredictName);
      }
    }
  }

  const computePrecomputedScope = (
    resource: DatasetResource | DatasetResourceIndexEntry,
    mode: "recipes" | "uses",
  ): string[] => {
    const list: Array<{ kind: string; id: string }> = [
      { kind: resource.kind, id: resource.id },
    ];
    const add = (cand: { kind: string; id: string }) => {
      if (!list.some((e) => e.kind === cand.kind && e.id === cand.id)) {
        list.push(cand);
      }
    };
    for (const alt of resource.alternatives ?? []) {
      if (alt.kind === "item" || alt.kind === "fluid") {
        add({ kind: alt.kind, id: alt.id });
      }
    }
    if (resource.kind === "item") {
      const fluid = getFilledCellFluidEquivalent(resource);
      if (fluid) {
        const indexedFluid = resourcesByKey.get(`fluid:${fluid.id}`);
        add({ kind: "fluid", id: indexedFluid?.id ?? fluid.id });
      }
    } else if (resource.kind === "fluid") {
      for (const cell of filledCells) {
        if (isFluidEquivalentToFilledCell(resource, { kind: "item", ...cell })) {
          add({ kind: "item", id: cell.id });
        }
      }
    }

    if (mode === "uses" && resource.kind === "item" && !isOreDictionaryResource(resource)) {
      const wildcard = getWildcardResource(resource);
      if (wildcard) {
        add({ kind: "item", id: wildcard.id });
      }
      const oreDictNames = new Set(resource.oreDictionary ?? []);
      for (const name of exactItemToOredicts.get(resource.id) ?? []) {
        oreDictNames.add(name);
      }
      const sep = resource.id.lastIndexOf("@");
      const baseId = sep === -1 ? resource.id : resource.id.slice(0, sep);
      for (const name of wildcardBaseToOredicts.get(baseId) ?? []) {
        oreDictNames.add(name);
      }
      for (const name of oreDictNames) {
        add({ kind: "item", id: `oredict:${name}` });
      }
    }
    return list.map((entry) => `${entry.kind}:${entry.id}`);
  };

  const keyBuckets: ResourceKeyBucketFile[] = Array.from({ length: KEY_BUCKET_COUNT }, () => ({
    entries: {},
    wildcardOredicts: {},
  }));

  for (const [key, resource] of resourcesByKey) {
    const bIdx = hashPartitionKey(key, KEY_BUCKET_COUNT);
    const usesScope = computePrecomputedScope(resource, "uses");
    const recipesScope = computePrecomputedScope(resource, "recipes");
    keyBuckets[bIdx].entries[key] = {
      resource,
      ...(usesScope.length > 1 ? { usesScopeKeys: usesScope } : {}),
      ...(recipesScope.length > 1 ? { recipesScopeKeys: recipesScope } : {}),
    };
  }
  for (const [baseId, oredictSet] of wildcardBaseToOredicts) {
    const wildcardId = `${baseId}@32767`;
    const wildcardKey = `item:${wildcardId}`;
    const bIdx = hashPartitionKey(wildcardKey, KEY_BUCKET_COUNT);
    keyBuckets[bIdx].wildcardOredicts[wildcardId] = [...oredictSet];
  }

  await Promise.all(
    keyBuckets.map((bucket, idx) =>
      writeGzipJsonFile(
        path.join(
          partitionsDir,
          "resource-key-buckets",
          `bucket-${padBucketIndex(idx)}.json.gz`,
        ),
        bucket,
      ),
    ),
  );

  // Write lookup buckets
  const lookupBuckets: LookupBucketFile[] = Array.from({ length: LOOKUP_BUCKET_COUNT }, () => ({
    entries: {},
  }));
  for (const [modeKey, recipesByMap] of lookupIndexFile.entries) {
    const colon = modeKey.indexOf(":");
    const resourceKey = modeKey.slice(colon + 1);
    const bIdx = hashPartitionKey(resourceKey, LOOKUP_BUCKET_COUNT);
    lookupBuckets[bIdx].entries[modeKey] = recipesByMap;
  }
  await Promise.all(
    lookupBuckets.map((bucket, idx) =>
      writeGzipJsonFile(
        path.join(partitionsDir, "lookup-buckets", `bucket-${padBucketIndex(idx)}.json.gz`),
        bucket,
      ),
    ),
  );

  // Build recipe-id-buckets (recipeId -> recipeIndex, rawRecipeId -> recipeIndexes[]) and recipe-ids.json.gz
  const recipeIdBuckets: RecipeIdBucketFile[] = Array.from(
    { length: RECIPE_ID_BUCKET_COUNT },
    () => ({
      recipeIds: {},
      rawRecipeIds: {},
    }),
  );
  const recipeIds = lookupIndexFile.recipeIds ?? [];
  for (let index = 0; index < recipeIds.length; index += 1) {
    const id = recipeIds[index];
    const bIdx = hashPartitionKey(id, RECIPE_ID_BUCKET_COUNT);
    recipeIdBuckets[bIdx].recipeIds[id] = index;
  }

  const shardConcurrency = 8;
  for (let i = 0; i < lookupIndexFile.shards.length; i += shardConcurrency) {
    const batch = lookupIndexFile.shards.slice(i, i + shardConcurrency);
    const payloads = await Promise.all(
      batch.map((shard) =>
        readGzipJsonFile<{ recipes: Recipe[] }>(
          path.join(
            datasetRoot,
            shard.path.replace(/^\/+/, "").replace(/^datasets\/gtnh\/+/, ""),
          ),
        ),
      ),
    );
    payloads.forEach((payload, batchIndex) => {
      const shard = batch[batchIndex];
      payload.recipes.forEach((recipe, offset) => {
        const rawId = recipe.source?.rawRecipeId;
        if (!rawId) return;
        const bIdx = hashPartitionKey(rawId, RECIPE_ID_BUCKET_COUNT);
        const list = recipeIdBuckets[bIdx].rawRecipeIds[rawId];
        if (list) {
          list.push(shard.start + offset);
        } else {
          recipeIdBuckets[bIdx].rawRecipeIds[rawId] = [shard.start + offset];
        }
      });
    });
  }

  await Promise.all([
    writeGzipJsonFile(path.join(partitionsDir, "recipe-ids.json.gz"), recipeIds),
    ...recipeIdBuckets.map((bucket, idx) =>
      writeGzipJsonFile(
        path.join(partitionsDir, "recipe-id-buckets", `bucket-${padBucketIndex(idx)}.json.gz`),
        bucket,
      ),
    ),
  ]);

  // Build pinyin buckets
  console.info(`Compiling pinyin buckets for ${versionId}...`);
  const pinyinBuilt = buildPinyinBuckets(
    [
      ...resourceIndexFile.resourceIndex.map((r) => r.displayName ?? ""),
      ...resourceIndexFile.recipeMaps,
    ],
    PINYIN_BUCKET_COUNT,
  );
  await Promise.all([
    writeGzipJsonFile(path.join(partitionsDir, "pinyin-core.json.gz"), pinyinBuilt.core),
    ...pinyinBuilt.buckets.map((bucket, idx) =>
      writeGzipJsonFile(
        path.join(partitionsDir, "pinyin-buckets", `bucket-${padBucketIndex(idx)}.json.gz`),
        bucket,
      ),
    ),
  ]);

  // Build recipe search vocab and token buckets
  console.info(`Building recipe search token buckets for ${versionId}...`);
  const recipeTokenPostings = new Map<string, number[]>();
  const searchTextList = lookupIndexFile.searchText ?? [];
  for (let recipeIndex = 0; recipeIndex < searchTextList.length; recipeIndex += 1) {
    const words = new Set(splitSearchTokens(normalizeSearchText(searchTextList[recipeIndex] ?? "")));
    for (const word of words) {
      const list = recipeTokenPostings.get(word);
      if (list) {
        list.push(recipeIndex);
      } else {
        recipeTokenPostings.set(word, [recipeIndex]);
      }
    }
  }

  // Sort tokens by document frequency descending so top tokens sit in chunk 0
  const sortedRecipeTokens = [...recipeTokenPostings.keys()].sort(
    (a, b) =>
      (recipeTokenPostings.get(b)?.length ?? 0) - (recipeTokenPostings.get(a)?.length ?? 0) ||
      a.localeCompare(b),
  );
  const recipeTokenChunkCount = Math.ceil(sortedRecipeTokens.length / RECIPE_TOKENS_PER_CHUNK);

  await writeGzipJsonFile(path.join(partitionsDir, "recipe-search-vocab.json.gz"), {
    tokens: sortedRecipeTokens,
  });

  for (let chunkIdx = 0; chunkIdx < recipeTokenChunkCount; chunkIdx += 1) {
    const chunkTokens = sortedRecipeTokens.slice(
      chunkIdx * RECIPE_TOKENS_PER_CHUNK,
      (chunkIdx + 1) * RECIPE_TOKENS_PER_CHUNK,
    );
    const lists = chunkTokens.map((tok) => recipeTokenPostings.get(tok)!);
    const encoded = encodeDeltaVarints(lists);
    await writeGzipBinaryFile(
      path.join(
        partitionsDir,
        "recipe-token-buckets",
        `bucket-${padBucketIndex(chunkIdx)}.bin.gz`,
      ),
      packPostingsBuffer(encoded.offsets, encoded.data),
    );
  }

  // Write choice-alternatives.json.gz and meta.json.gz
  const meta: PartitionedDatasetMeta = {
    schemaVersion: 1,
    datasetVersionId: version.id,
    gtnhVersion: version.gtnhVersion,
    sourceInfo: version.sourceInfo,
    generatedAt: version.publishedAt,
    recipeCount,
    resourceCount,
    resourceChunkSize: RESOURCE_CHUNK_SIZE,
    resourceChunkCount,
    keyBucketCount: KEY_BUCKET_COUNT,
    lookupBucketCount: LOOKUP_BUCKET_COUNT,
    recipeIdBucketCount: RECIPE_ID_BUCKET_COUNT,
    pinyinBucketCount: PINYIN_BUCKET_COUNT,
    recipeTokenChunkCount,
    recipeTokensPerChunk: RECIPE_TOKENS_PER_CHUNK,
    recipeMaps: resourceIndexFile.recipeMaps,
    lookupRecipeMaps: lookupIndexFile.recipeMaps,
    recipeMapIcons: catalogLike.recipeMapIcons,
    resolvedRecipeMapIcons,
    machineHandlerIcons,
    machineConfigResources,
    shards: lookupIndexFile.shards,
    filledCells,
    nonOredictAltKeys,
  };

  await Promise.all([
    writeGzipJsonFile(path.join(partitionsDir, "choice-alternatives.json.gz"), [
      ...choiceAlternatives.entries(),
    ]),
    writeGzipJsonFile(path.join(partitionsDir, "meta.json.gz"), meta),
  ]);

  console.info(`Partitioned dataset built at ${partitionsDir}.`);
}

async function main() {
  const datasetRoot = path.join(process.cwd(), "public", "datasets", "gtnh");
  const manifest = JSON.parse(
    await fs.readFile(path.join(datasetRoot, "datasets.manifest.json"), "utf8"),
  ) as DatasetManifest;
  const requestedVersion = process.argv[2];
  const versions = requestedVersion
    ? manifest.versions.filter((v) => v.id === requestedVersion)
    : manifest.versions;

  for (const version of versions) {
    await buildPartitionedDatasetForVersion(datasetRoot, version);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
