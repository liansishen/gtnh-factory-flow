import type {
  DatasetManifest,
  DatasetResource,
  DatasetResourceIndexEntry,
  DatasetVersion,
  MachineHandlerIconEntry,
  RecipeMapIconEntry,
  RecipeSummary,
} from "@/lib/datasets/types";
import type {
  MachineTier,
  Recipe,
  ResourceAlternative,
  ResourceAmount,
} from "@/lib/model/types";
import {
  EEC_MACHINE_TYPE,
} from "@/lib/machines/extreme-entity-crusher";
import {
  enrichPassiveProductionRecipe,
  getFilledCellFluidEquivalent,
  GT_VOLTAGE_TIERS,
  isFluidEquivalentToFilledCell,
  isOreDictionaryResource,
  isRecipeInputConsumed,
  isVirtualChoiceResource,
  resourceMatchesInput,
} from "@/lib/model";
import { pickRecipeRefMatch, type RecipeContentRef } from "@/lib/import-export/recipe-ref-match";
import {
  MAX_RECIPE_QUERY_CLAUSES,
  recipeQueryClauseMode,
  type RecipeQueryClause,
  type RecipeQuerySideOp,
} from "@/lib/datasets/recipe-query";
import {
  getTokenTrigrams,
  MIN_INDEXABLE_LENGTH,
  parseSearchQuery,
  resolveSearchPhases,
  searchCorrector,
  withSearchCorrections,
  type SearchCorrection,
  type SearchPhase,
  type SearchQuery,
  type SearchVocabulary,
} from "@/lib/search";
import { bilingualSearch } from "@/lib/i18n/game-search";
import { stripGameFormatting } from "@/lib/i18n/game-names";
import {
  isReservedSearchToken,
  withPinyinSearch,
  type PinyinAlias,
  type PinyinSearchIndex,
} from "@/lib/i18n/pinyin-search";
import {
  datasetFileExists,
  readDatasetGzipBytes,
  readDatasetGzipJson,
  readDatasetJson,
} from "./dataset-storage";
import type {
  DatasetRecipeQueryRequest,
  RecipeMapSelection,
  ResourceQuerySort,
  ResourceSourceFilter,
} from "./dataset-query";

type TierFilter = "all" | Exclude<MachineTier, "DEMO">;

export interface PartitionShardDescriptor {
  id: string;
  path: string;
  start: number;
  end: number;
}

export interface FilledCellStub {
  id: string;
  displayName?: string;
  alternatives?: ResourceAmount["alternatives"];
}

export interface PartitionedDatasetMeta {
  schemaVersion: 1;
  datasetVersionId: string;
  gtnhVersion: string;
  sourceInfo: DatasetVersion["sourceInfo"];
  generatedAt: string;
  recipeCount: number;
  resourceCount: number;
  resourceChunkSize: number;
  resourceChunkCount: number;
  keyBucketCount: number;
  lookupBucketCount: number;
  recipeIdBucketCount: number;
  pinyinBucketCount: number;
  recipeTokenChunkCount: number;
  recipeTokensPerChunk: number;
  recipeMaps: string[];
  lookupRecipeMaps: string[];
  recipeMapIcons?: RecipeMapIconEntry[];
  resolvedRecipeMapIcons: Record<string, DatasetResourceIndexEntry>;
  machineHandlerIcons: MachineHandlerIconEntry[];
  machineConfigResources: DatasetResourceIndexEntry[];
  shards: PartitionShardDescriptor[];
  filledCells: FilledCellStub[];
  nonOredictAltKeys?: string[];
}

export interface ResourceSearchStringsFile {
  modNames: string[];
  displayNames: string[];
  ids: string[];
  vocabTokens: string[];
  vocabWeights: number[];
  allResourceTokens: string[];
}

export interface ResourceKeyBucketEntry {
  resource?: DatasetResource | DatasetResourceIndexEntry;
  usesScopeKeys?: string[];
  recipesScopeKeys?: string[];
}

export interface ResourceKeyBucketFile {
  entries: Record<string, ResourceKeyBucketEntry>;
  wildcardOredicts: Record<string, string[]>;
}

export interface LookupBucketFile {
  entries: Record<string, Array<[number, number[]]>>;
}

export interface RecipeIdBucketFile {
  recipeIds: Record<string, number>;
  rawRecipeIds: Record<string, number[]>;
}

export interface PinyinCoreFile {
  chars: Array<[string, string[]]>;
  names: string[];
  entries: Array<[number, number[]]>;
}

export interface PinyinBucketFile {
  literals: string[];
  starts: Record<string, number[]>;
}

export interface RecipeSearchVocabFile {
  tokens: string[];
}

export function hashPartitionKey(key: string, bucketCount: number): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % bucketCount;
}

export function padBucketIndex(index: number, digits = 2): string {
  return String(index).padStart(digits, "0");
}

export function encodeDeltaVarints(lists: number[][]): {
  offsets: Uint32Array;
  data: Uint8Array;
} {
  const offsets = new Uint32Array(lists.length + 1);
  let totalBytes = 0;
  for (const list of lists) {
    let prev = 0;
    for (const value of list) {
      let delta = (value - prev) >>> 0;
      prev = value;
      do {
        totalBytes += 1;
        delta >>>= 7;
      } while (delta > 0);
    }
  }

  const data = new Uint8Array(totalBytes);
  let writePos = 0;
  for (let listIndex = 0; listIndex < lists.length; listIndex += 1) {
    offsets[listIndex] = writePos;
    const list = lists[listIndex];
    let prev = 0;
    for (let i = 0; i < list.length; i += 1) {
      let delta = (list[i] - prev) >>> 0;
      prev = list[i];
      while (delta >= 0x80) {
        data[writePos++] = (delta & 0x7f) | 0x80;
        delta >>>= 7;
      }
      data[writePos++] = delta;
    }
  }
  offsets[lists.length] = writePos;
  return { offsets, data };
}

export function packPostingsBuffer(offsets: Uint32Array, data: Uint8Array): Uint8Array {
  const tokenCount = offsets.length - 1;
  const headerBytes = 8;
  const offsetsBytes = offsets.byteLength;
  const total = headerBytes + offsetsBytes + data.byteLength;
  const buffer = new ArrayBuffer(total);
  const header = new Uint32Array(buffer, 0, 2);
  header[0] = tokenCount;
  header[1] = data.byteLength;
  new Uint32Array(buffer, headerBytes, offsets.length).set(offsets);
  new Uint8Array(buffer, headerBytes + offsetsBytes, data.byteLength).set(data);
  return new Uint8Array(buffer);
}

export function unpackPostingsBuffer(bytes: Uint8Array): {
  tokenCount: number;
  offsets: Uint32Array;
  data: Uint8Array;
} {
  const aligned = bytes.byteOffset % 4 === 0
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : new Uint8Array(bytes).buffer;
  const header = new Uint32Array(aligned, 0, 2);
  const tokenCount = header[0] ?? 0;
  const dataByteLength = header[1] ?? 0;
  const offsets = new Uint32Array(aligned, 8, tokenCount + 1);
  const data = new Uint8Array(aligned, 8 + (tokenCount + 1) * 4, dataByteLength);
  return { tokenCount, offsets, data };
}

export function decodeDeltaVarintSlice(
  data: Uint8Array,
  startOffset: number,
  endOffset: number,
): Int32Array {
  let count = 0;
  for (let pos = startOffset; pos < endOffset; pos += 1) {
    if ((data[pos] & 0x80) === 0) {
      count += 1;
    }
  }
  const out = new Int32Array(count);
  let outIndex = 0;
  let prev = 0;
  let pos = startOffset;
  while (pos < endOffset) {
    let shift = 0;
    let delta = 0;
    while (pos < endOffset) {
      const byte = data[pos++];
      delta |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        break;
      }
      shift += 7;
    }
    prev = (prev + delta) | 0;
    out[outIndex++] = prev;
  }
  return out;
}

export function packRecipeMetaArrays(
  recipeCount: number,
  recipeMapIdsByRecipeIndex: Int16Array,
  tierIndexes: Uint8Array,
  iconScores: Uint8Array,
): Uint8Array {
  const headerBytes = 4;
  const mapBytes = recipeCount * 2;
  const mapBytesAligned = (mapBytes + 3) & ~3;
  const tierBytesAligned = (recipeCount + 3) & ~3;
  const iconBytesAligned = (recipeCount + 3) & ~3;
  const totalBytes = headerBytes + mapBytesAligned + tierBytesAligned + iconBytesAligned;
  const buffer = new ArrayBuffer(totalBytes);
  new Uint32Array(buffer, 0, 1)[0] = recipeCount;
  new Int16Array(buffer, headerBytes, recipeCount).set(recipeMapIdsByRecipeIndex);
  new Uint8Array(buffer, headerBytes + mapBytesAligned, recipeCount).set(tierIndexes);
  new Uint8Array(buffer, headerBytes + mapBytesAligned + tierBytesAligned, recipeCount).set(
    iconScores,
  );
  return new Uint8Array(buffer);
}

export function unpackRecipeMetaArrays(bytes: Uint8Array): {
  recipeCount: number;
  recipeMapIdsByRecipeIndex: Int16Array;
  tierIndexes: Uint8Array;
  iconScores: Uint8Array;
} {
  const aligned = bytes.byteOffset % 4 === 0
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : new Uint8Array(bytes).buffer;
  const recipeCount = new Uint32Array(aligned, 0, 1)[0] ?? 0;
  const headerBytes = 4;
  const mapBytesAligned = (recipeCount * 2 + 3) & ~3;
  const tierBytesAligned = (recipeCount + 3) & ~3;
  const recipeMapIdsByRecipeIndex = new Int16Array(aligned, headerBytes, recipeCount);
  const tierIndexes = new Uint8Array(aligned, headerBytes + mapBytesAligned, recipeCount);
  const iconScores = new Uint8Array(
    aligned,
    headerBytes + mapBytesAligned + tierBytesAligned,
    recipeCount,
  );
  return { recipeCount, recipeMapIdsByRecipeIndex, tierIndexes, iconScores };
}

export function packResourceSearchMeta(input: {
  resourceCount: number;
  flags: Uint8Array;
  modIds: Uint16Array;
  recipeCounts: Uint32Array;
  madeByCounts: Uint32Array;
  usedByCounts: Uint32Array;
  sortedResourceIndexes: Uint32Array;
}): Uint8Array {
  const {
    resourceCount,
    flags,
    modIds,
    recipeCounts,
    madeByCounts,
    usedByCounts,
    sortedResourceIndexes,
  } = input;
  const sortedCount = sortedResourceIndexes.length;
  const headerBytes = 8;
  const flagsAligned = (resourceCount + 3) & ~3;
  const modIdsAligned = (resourceCount * 2 + 3) & ~3;
  const u32Block = resourceCount * 4;
  const sortedBytes = sortedCount * 4;
  const totalBytes = headerBytes + flagsAligned + modIdsAligned + u32Block * 3 + sortedBytes;
  const buffer = new ArrayBuffer(totalBytes);
  const header = new Uint32Array(buffer, 0, 2);
  header[0] = resourceCount;
  header[1] = sortedCount;
  let offset = headerBytes;
  new Uint8Array(buffer, offset, resourceCount).set(flags);
  offset += flagsAligned;
  new Uint16Array(buffer, offset, resourceCount).set(modIds);
  offset += modIdsAligned;
  new Uint32Array(buffer, offset, resourceCount).set(recipeCounts);
  offset += u32Block;
  new Uint32Array(buffer, offset, resourceCount).set(madeByCounts);
  offset += u32Block;
  new Uint32Array(buffer, offset, resourceCount).set(usedByCounts);
  offset += u32Block;
  new Uint32Array(buffer, offset, sortedCount).set(sortedResourceIndexes);
  return new Uint8Array(buffer);
}

export function unpackResourceSearchMeta(bytes: Uint8Array): {
  resourceCount: number;
  flags: Uint8Array;
  modIds: Uint16Array;
  recipeCounts: Uint32Array;
  madeByCounts: Uint32Array;
  usedByCounts: Uint32Array;
  sortedResourceIndexes: Uint32Array;
  sortedRanks: Int32Array;
} {
  const aligned = bytes.byteOffset % 4 === 0
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : new Uint8Array(bytes).buffer;
  const header = new Uint32Array(aligned, 0, 2);
  const resourceCount = header[0] ?? 0;
  const sortedCount = header[1] ?? 0;
  const flagsAligned = (resourceCount + 3) & ~3;
  const modIdsAligned = (resourceCount * 2 + 3) & ~3;
  const u32Block = resourceCount * 4;
  let offset = 8;
  const flags = new Uint8Array(aligned, offset, resourceCount);
  offset += flagsAligned;
  const modIds = new Uint16Array(aligned, offset, resourceCount);
  offset += modIdsAligned;
  const recipeCounts = new Uint32Array(aligned, offset, resourceCount);
  offset += u32Block;
  const madeByCounts = new Uint32Array(aligned, offset, resourceCount);
  offset += u32Block;
  const usedByCounts = new Uint32Array(aligned, offset, resourceCount);
  offset += u32Block;
  const sortedResourceIndexes = new Uint32Array(aligned, offset, sortedCount);
  const sortedRanks = new Int32Array(resourceCount);
  sortedRanks.fill(resourceCount);
  for (let rank = 0; rank < sortedCount; rank += 1) {
    sortedRanks[sortedResourceIndexes[rank]] = rank;
  }
  return {
    resourceCount,
    flags,
    modIds,
    recipeCounts,
    madeByCounts,
    usedByCounts,
    sortedResourceIndexes,
    sortedRanks,
  };
}

class BoundedLru<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly maxEntries: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): V {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.map.delete(oldest);
    }
    return value;
  }

  async getOrLoad(key: K, loader: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const value = await loader();
    return this.set(key, value);
  }

  clear(): void {
    this.map.clear();
  }
}

interface LoadedResourceSearchBundle {
  meta: ReturnType<typeof unpackResourceSearchMeta>;
  strings: ResourceSearchStringsFile;
  lowerNames: string[];
  vocabulary: SearchVocabulary;
  tokenIndexByWord: Map<string, number>;
  emptyQuerySortedByMode: Map<string, Uint32Array>;
  vocabMatchCache: BoundedLru<
    string,
    { exact: number[]; prefix: number[]; contains: number[]; byteLen: number }
  >;
}

interface ComputedResourceQuery {
  sortedResourceIndexes: Int32Array;
  mods: Array<{ id: string; count: number }>;
  searchPhase: SearchPhase;
  corrections: SearchCorrection[];
}

interface LoadedRecipeVocabBundle {
  tokens: string[];
  tokenIndexByWord: Map<string, number>;
}

interface CompiledPinyinCore {
  chars: Array<{ literal: string; readings: string[]; firsts: string }>;
  names: string[];
  rawEntries: Array<[number, number[]]>;
}

interface CompiledPinyinBucket {
  literals: Set<string>;
  starts: Map<string, number[]>;
}

const partitionExistsCache = new BoundedLru<string, boolean>(4);
const metaCache = new BoundedLru<string, PartitionedDatasetMeta>(2);
const recipeMetaArraysCache = new BoundedLru<string, ReturnType<typeof unpackRecipeMetaArrays>>(2);
const resourceSearchBundleCache = new BoundedLru<string, LoadedResourceSearchBundle>(1);
const resourcePostingsCache = new BoundedLru<string, ReturnType<typeof unpackPostingsBuffer>>(1);
const recipeVocabCache = new BoundedLru<string, LoadedRecipeVocabBundle>(1);
const choiceAlternativesCache = new BoundedLru<string, Map<string, ResourceAlternative[]>>(1);
const resourceEntriesPartCache = new BoundedLru<string, ReturnType<typeof unpackPostingsBuffer>>(2);
const resourceEntryCache = new BoundedLru<string, DatasetResourceIndexEntry>(1024);
interface IndexedJsonBucket {
  extractProp<T>(key: string): T | undefined;
}
const resourceKeyBucketCache = new BoundedLru<string, IndexedJsonBucket>(4);
const resolvedResourceKeyCache = new BoundedLru<string, ResourceKeyBucketEntry>(1024);
const lookupBucketCache = new BoundedLru<string, IndexedJsonBucket>(4);
const resolvedLookupEntryCache = new BoundedLru<string, Array<[number, number[]]>>(1024);
const recipeIdBucketCache = new BoundedLru<string, IndexedJsonBucket>(4);
const pinyinCoreCache = new BoundedLru<string, CompiledPinyinCore>(1);
const pinyinBucketCache = new BoundedLru<string, CompiledPinyinBucket>(4);
const pinyinQueryHitCache = new BoundedLru<string, readonly PinyinAlias[]>(64);
const recipeTokenBucketCache = new BoundedLru<string, ReturnType<typeof unpackPostingsBuffer>>(2);
interface IndexedShard {
  getRecipe(offset: number): Recipe | undefined;
}
const shardCache = new BoundedLru<string, IndexedShard>(4);
const recipeSummaryCache = new BoundedLru<string, RecipeSummary>(512);
const resourceQueryComputedCache = new BoundedLru<string, ComputedResourceQuery>(16);

let cachedManifest: DatasetManifest | undefined;

async function loadManifest(): Promise<DatasetManifest> {
  if (cachedManifest) {
    return cachedManifest;
  }
  cachedManifest = await readDatasetJson<DatasetManifest>("datasets.manifest.json");
  return cachedManifest;
}

export function clearPartitionedDatasetCaches(): void {
  cachedManifest = undefined;
  partitionExistsCache.clear();
  metaCache.clear();
  recipeMetaArraysCache.clear();
  resourceSearchBundleCache.clear();
  resourcePostingsCache.clear();
  recipeVocabCache.clear();
  choiceAlternativesCache.clear();
  resourceEntriesPartCache.clear();
  resourceEntryCache.clear();
  resourceKeyBucketCache.clear();
  resolvedResourceKeyCache.clear();
  lookupBucketCache.clear();
  resolvedLookupEntryCache.clear();
  recipeIdBucketCache.clear();
  pinyinCoreCache.clear();
  pinyinBucketCache.clear();
  pinyinQueryHitCache.clear();
  recipeTokenBucketCache.clear();
  shardCache.clear();
  recipeSummaryCache.clear();
  resourceQueryComputedCache.clear();
}

export async function hasPartitionedDataset(versionId: string): Promise<boolean> {
  if (process.env.GTNH_DISABLE_PARTITIONED_DATASET === "1") {
    return false;
  }
  return partitionExistsCache.getOrLoad(versionId, async () => {
    try {
      const manifest = await loadManifest();
      if (!manifest.versions.some((entry) => entry.id === versionId)) {
        return false;
      }
      await loadPartitionMeta(versionId);
      return true;
    } catch {
      return false;
    }
  });
}

async function loadPartitionMeta(versionId: string): Promise<PartitionedDatasetMeta> {
  return metaCache.getOrLoad(versionId, () =>
    readDatasetGzipJson<PartitionedDatasetMeta>(`${versionId}/partitions/meta.json.gz`),
  );
}

async function loadRecipeMetaArrays(versionId: string) {
  return recipeMetaArraysCache.getOrLoad(versionId, async () => {
    const bytes = await readDatasetGzipBytes(`${versionId}/partitions/recipe-meta-arrays.bin.gz`);
    return unpackRecipeMetaArrays(bytes);
  });
}

function buildVocabularyFromPrecomputed(tokens: string[], weights: number[]): SearchVocabulary {
  let cachedSorted: string[] | undefined;
  let cachedSet: Set<string> | undefined;
  const trigramCache = new Map<string, number[]>();
  const trigramProxy = {
    get(trigram: string): number[] | undefined {
      let list = trigramCache.get(trigram);
      if (list !== undefined) return list;
      list = [];
      for (let i = 0; i < tokens.length; i += 1) {
        if (tokens[i].includes(trigram)) {
          list.push(i);
        }
      }
      if (trigramCache.size >= 256) {
        const oldest = trigramCache.keys().next().value;
        if (oldest !== undefined) trigramCache.delete(oldest);
      }
      trigramCache.set(trigram, list);
      return list;
    },
  } as unknown as Map<string, number[]>;
  return {
    tokens,
    weights,
    get sortedTokens() {
      if (!cachedSorted) cachedSorted = [...tokens].sort();
      return cachedSorted;
    },
    get tokenSet() {
      if (!cachedSet) cachedSet = new Set(tokens);
      return cachedSet;
    },
    get trigramToTokens() {
      return trigramProxy;
    },
  };
}

async function loadResourceSearchBundle(versionId: string): Promise<LoadedResourceSearchBundle> {
  return resourceSearchBundleCache.getOrLoad(versionId, async () => {
    const [metaBytes, strings] = await Promise.all([
      readDatasetGzipBytes(`${versionId}/partitions/resource-search-meta.bin.gz`),
      readDatasetGzipJson<ResourceSearchStringsFile>(
        `${versionId}/partitions/resource-search-strings.json.gz`,
      ),
    ]);
    const meta = unpackResourceSearchMeta(metaBytes);
    const lowerNames = strings.displayNames.map((name) => name.trim().toLowerCase());
    const vocabulary = buildVocabularyFromPrecomputed(strings.vocabTokens, strings.vocabWeights);
    const tokenIndexByWord = new Map<string, number>();
    for (let i = 0; i < strings.allResourceTokens.length; i += 1) {
      tokenIndexByWord.set(strings.allResourceTokens[i], i);
    }
    return {
      meta,
      strings,
      lowerNames,
      vocabulary,
      tokenIndexByWord,
      emptyQuerySortedByMode: new Map(),
      vocabMatchCache: new BoundedLru(256),
    };
  });
}

async function loadResourcePostings(versionId: string) {
  return resourcePostingsCache.getOrLoad(versionId, async () => {
    const bytes = await readDatasetGzipBytes(`${versionId}/partitions/resource-postings.bin.gz`);
    return unpackPostingsBuffer(bytes);
  });
}

async function loadRecipeVocabBundle(versionId: string): Promise<LoadedRecipeVocabBundle> {
  return recipeVocabCache.getOrLoad(versionId, async () => {
    const file = await readDatasetGzipJson<RecipeSearchVocabFile>(
      `${versionId}/partitions/recipe-search-vocab.json.gz`,
    );
    const tokenIndexByWord = new Map<string, number>();
    for (let i = 0; i < file.tokens.length; i += 1) {
      tokenIndexByWord.set(file.tokens[i], i);
    }
    return {
      tokens: file.tokens,
      tokenIndexByWord,
    };
  });
}

async function loadRecipeTokenBucket(versionId: string, bucketIndex: number) {
  const key = `${versionId}:${bucketIndex}`;
  return recipeTokenBucketCache.getOrLoad(key, async () => {
    const bytes = await readDatasetGzipBytes(
      `${versionId}/partitions/recipe-token-buckets/bucket-${padBucketIndex(bucketIndex)}.bin.gz`,
    );
    return unpackPostingsBuffer(bytes);
  });
}

const RESOURCE_ENTRIES_PART_SIZE = 34000;
const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();

function createIndexedJsonBucket(bytes: Uint8Array): IndexedJsonBucket {
  const parsedProps = new Map<string, unknown>();
  return {
    extractProp<T>(key: string): T | undefined {
      if (parsedProps.has(key)) {
        return parsedProps.get(key) as T | undefined;
      }
      const needle = utf8Encoder.encode(`${JSON.stringify(key)}:`);
      const nLen = needle.length;
      const max = bytes.length - nLen;
      if (max < 0) {
        parsedProps.set(key, undefined);
        return undefined;
      }
      const pivotOffset = Math.max(1, nLen - 3);
      const pivotByte = needle[pivotOffset];
      let pos = pivotOffset;
      let foundStart = -1;
      while (pos <= max + pivotOffset) {
        const pIdx = bytes.indexOf(pivotByte, pos);
        if (pIdx === -1 || pIdx > max + pivotOffset) break;
        const start = pIdx - pivotOffset;
        if (bytes[start] === 34 && bytes[start + nLen - 1] === 58) {
          let ok = true;
          for (let i = 1; i < nLen - 1; i += 1) {
            if (bytes[start + i] !== needle[i]) {
              ok = false;
              break;
            }
          }
          if (ok && (start === 0 || bytes[start - 1] === 123 || bytes[start - 1] === 44 || bytes[start - 1] <= 32)) {
            foundStart = start;
            break;
          }
        }
        pos = pIdx + 1;
      }
      if (foundStart === -1) {
        parsedProps.set(key, undefined);
        return undefined;
      }
      let vStart = foundStart + nLen;
      const len = bytes.length;
      while (vStart < len && bytes[vStart] <= 32) vStart += 1;
      let vPos = vStart;
      let depth = 0;
      let inStr = false;
      while (vPos < len) {
        const b = bytes[vPos++];
        if (inStr) {
          if (b === 92) vPos += 1;
          else if (b === 34) {
            inStr = false;
            if (depth === 0) break;
          }
        } else if (b === 34) {
          inStr = true;
        } else if (b === 123 || b === 91) {
          depth += 1;
        } else if (b === 125 || b === 93) {
          if (depth === 0) {
            vPos -= 1;
            break;
          }
          depth -= 1;
          if (depth === 0) break;
        } else if (depth === 0 && (b === 44 || b <= 32)) {
          vPos -= 1;
          break;
        }
      }
      const value = JSON.parse(utf8Decoder.decode(bytes.subarray(vStart, vPos))) as T;
      parsedProps.set(key, value);
      return value;
    },
  };
}

async function loadResourceEntriesPart(
  versionId: string,
  partIndex: number,
): Promise<ReturnType<typeof unpackPostingsBuffer>> {
  const key = `${versionId}:${partIndex}`;
  return resourceEntriesPartCache.getOrLoad(key, async () => {
    const bytes = await readDatasetGzipBytes(
      `${versionId}/partitions/resource-entries-${padBucketIndex(partIndex)}.bin.gz`,
    );
    return unpackPostingsBuffer(bytes);
  });
}

async function loadResourceKeyBucket(
  versionId: string,
  bucketIndex: number,
): Promise<IndexedJsonBucket> {
  const key = `${versionId}:${bucketIndex}`;
  return resourceKeyBucketCache.getOrLoad(key, async () => {
    const bytes = await readDatasetGzipBytes(
      `${versionId}/partitions/resource-key-buckets/bucket-${padBucketIndex(bucketIndex)}.json.gz`,
    );
    return createIndexedJsonBucket(bytes);
  });
}

async function loadLookupBucket(versionId: string, bucketIndex: number): Promise<IndexedJsonBucket> {
  const key = `${versionId}:${bucketIndex}`;
  return lookupBucketCache.getOrLoad(key, async () => {
    const bytes = await readDatasetGzipBytes(
      `${versionId}/partitions/lookup-buckets/bucket-${padBucketIndex(bucketIndex)}.json.gz`,
    );
    return createIndexedJsonBucket(bytes);
  });
}

async function loadRecipeIdBucket(
  versionId: string,
  bucketIndex: number,
): Promise<IndexedJsonBucket> {
  const key = `${versionId}:${bucketIndex}`;
  return recipeIdBucketCache.getOrLoad(key, async () => {
    const bytes = await readDatasetGzipBytes(
      `${versionId}/partitions/recipe-id-buckets/bucket-${padBucketIndex(bucketIndex)}.json.gz`,
    );
    return createIndexedJsonBucket(bytes);
  });
}

async function loadChoiceAlternatives(
  versionId: string,
): Promise<Map<string, ResourceAlternative[]>> {
  return choiceAlternativesCache.getOrLoad(versionId, async () => {
    const entries = await readDatasetGzipJson<Array<[string, ResourceAlternative[]]>>(
      `${versionId}/partitions/choice-alternatives.json.gz`,
    );
    return new Map(entries);
  });
}

function indexShardRecipeBytes(bytes: Uint8Array): IndexedShard {
  let pos = 0;
  const len = bytes.length;
  let inString = false;
  while (pos < len) {
    const b = bytes[pos++];
    if (inString) {
      if (b === 92) pos += 1;
      else if (b === 34) inString = false;
    } else if (b === 34) {
      inString = true;
    } else if (b === 91) {
      break;
    }
  }
  const ranges: number[] = [];
  let depth = 0;
  let recipeStart = 0;
  inString = false;
  while (pos < len) {
    const b = bytes[pos++];
    if (inString) {
      if (b === 92) pos += 1;
      else if (b === 34) inString = false;
    } else if (b === 34) {
      inString = true;
    } else if (b === 123) {
      if (depth === 0) recipeStart = pos - 1;
      depth += 1;
    } else if (b === 125) {
      depth -= 1;
      if (depth === 0) {
        ranges.push(recipeStart, pos);
      }
    } else if (b === 93 && depth === 0) {
      break;
    }
  }
  const rangeArray = new Uint32Array(ranges);
  const count = rangeArray.length >>> 1;
  const parsed = new Map<number, Recipe>();
  return {
    getRecipe(offset: number): Recipe | undefined {
      if (offset < 0 || offset >= count) return undefined;
      const existing = parsed.get(offset);
      if (existing) return existing;
      const start = rangeArray[offset * 2];
      const end = rangeArray[offset * 2 + 1];
      const recipe = JSON.parse(utf8Decoder.decode(bytes.subarray(start, end))) as Recipe;
      parsed.set(offset, recipe);
      return recipe;
    },
  };
}

async function loadShardRecipes(
  versionId: string,
  shard: PartitionShardDescriptor,
): Promise<IndexedShard> {
  const key = `${versionId}:${shard.id}`;
  return shardCache.getOrLoad(key, async () => {
    const relativePath = shard.path.replace(/^\/+/, "").replace(/^datasets\/gtnh\/+/, "");
    const bytes = await readDatasetGzipBytes(relativePath);
    return indexShardRecipeBytes(bytes);
  });
}

// ---------------------------------------------------------------------------
// Fast Pinyin Bucket Loader & Matcher
// ---------------------------------------------------------------------------

const PINYIN_WORD_CHAR = /[a-z0-9\p{Script=Han}\ue900-\ue90f]/u;

function normalizePinyinQuery(value: string): string {
  return stripGameFormatting(value).normalize("NFKC").toLowerCase().replace(/ü/g, "v");
}

function compactPinyinQuery(value: string): string {
  return Array.from(normalizePinyinQuery(value))
    .filter((char) => PINYIN_WORD_CHAR.test(char))
    .join("");
}

function pinyinQueryNeedle(query: string): string | undefined {
  const normalized = normalizePinyinQuery(query).trim();
  if (
    normalized.length > 128 ||
    /[^a-z0-9\p{Script=Han}\ue900-\ue90f\s'’-]/u.test(normalized)
  ) {
    return undefined;
  }
  const needle = compactPinyinQuery(normalized);
  if (needle.length < 2 || !/[a-z]/.test(needle) || isReservedSearchToken(needle)) {
    return undefined;
  }
  return needle;
}

const pinyinMemoScores = new Float64Array(16384);
const pinyinMemoStamps = new Int32Array(16384);
let pinyinMemoGeneration = 0;

function matchPinyinChars(
  charIds: number[],
  allChars: Array<{ literal: string; readings: string[]; firsts: string }>,
  needle: string,
): number {
  let best = 0;
  const nLen = needle.length;
  const cLen = charIds.length;
  const n0 = needle[0];
  for (let start = 0; start < cLen; start += 1) {
    const first = allChars[charIds[start]];
    if (!first.firsts.includes(n0)) {
      continue;
    }
    pinyinMemoGeneration = (pinyinMemoGeneration + 1) | 0;
    const gen = pinyinMemoGeneration;
    const canContinue = (nextPos: number, nextOffset: number): boolean => {
      if (nextOffset === nLen) {
        return true;
      }
      if (nextPos >= cLen) {
        return false;
      }
      return allChars[charIds[nextPos]].firsts.includes(needle[nextOffset]);
    };
    const walk = (
      position: number,
      offset: number,
      abbreviated: boolean,
      phonetic: boolean,
    ): number => {
      if (offset === nLen) {
        if (!phonetic) {
          return 0;
        }
        return (
          (start === 0 ? (position === cLen ? 0.9 : 0.78) : 0.68) * (abbreviated ? 0.85 : 1)
        );
      }
      if (position === cLen) {
        return 0;
      }
      const key =
        ((position * (nLen + 1) + offset) * 2 + Number(abbreviated)) * 2 + Number(phonetic);
      if (key < 16384 && pinyinMemoStamps[key] === gen) {
        return pinyinMemoScores[key];
      }
      const char = allChars[charIds[position]];
      let score = 0;
      const litLen = char.literal.length;
      if (needle.startsWith(char.literal, offset) && canContinue(position + 1, offset + litLen)) {
        score = walk(position + 1, offset + litLen, abbreviated, phonetic);
      }
      const ch = needle[offset];
      for (let r = 0; r < char.readings.length; r += 1) {
        const reading = char.readings[r];
        if (reading[0] !== ch) {
          continue;
        }
        const rLen = reading.length;
        if (needle.startsWith(reading, offset) && canContinue(position + 1, offset + rLen)) {
          score = Math.max(score, walk(position + 1, offset + rLen, abbreviated, true));
        }
        if (canContinue(position + 1, offset + 1)) {
          score = Math.max(score, walk(position + 1, offset + 1, true, true));
        }
        if (
          (ch === "z" || ch === "c" || ch === "s") &&
          reading[1] === "h" &&
          needle[offset + 1] === "h" &&
          canContinue(position + 1, offset + 2)
        ) {
          score = Math.max(score, walk(position + 1, offset + 2, true, true));
        }
        const remainingLen = nLen - offset;
        if (remainingLen < rLen && reading.startsWith(needle.slice(offset))) {
          score = Math.max(score, walk(position + 1, nLen, true, true));
        }
      }
      if (key < 16384) {
        pinyinMemoStamps[key] = gen;
        pinyinMemoScores[key] = score;
      }
      return score;
    };
    best = Math.max(best, walk(start, 0, false, false));
    if (best === 0.9) {
      break;
    }
  }
  return best;
}

async function loadCompiledPinyinCore(versionId: string): Promise<CompiledPinyinCore> {
  return pinyinCoreCache.getOrLoad(versionId, async () => {
    const raw = await readDatasetGzipJson<PinyinCoreFile>(
      `${versionId}/partitions/pinyin-core.json.gz`,
    );
    const chars = raw.chars.map(([literal, readings]) => ({
      literal,
      readings,
      firsts: [...new Set([literal[0], ...readings.map((r) => r[0])])].join(""),
    }));
    return { chars, names: raw.names, rawEntries: raw.entries };
  });
}

async function loadCompiledPinyinBucket(
  versionId: string,
  bucketIndex: number,
): Promise<CompiledPinyinBucket> {
  const key = `${versionId}:${bucketIndex}`;
  return pinyinBucketCache.getOrLoad(key, async () => {
    const raw = await readDatasetGzipJson<PinyinBucketFile>(
      `${versionId}/partitions/pinyin-buckets/bucket-${padBucketIndex(bucketIndex)}.json.gz`,
    );
    return {
      literals: new Set(raw.literals),
      starts: new Map(Object.entries(raw.starts)),
    };
  });
}

async function createScopedPinyinIndex(
  versionId: string,
  pinyinBucketCount: number,
  rawQuery: string,
  parsedQuery: SearchQuery,
): Promise<PinyinSearchIndex> {
  if (!/[a-z]/i.test(rawQuery)) {
    return { search: () => [] };
  }
  const needles = new Set<string>();
  const rawWords = normalizePinyinQuery(rawQuery).trim().split(/\s+/);
  const rawNeedle = rawWords.every((w) => !isReservedSearchToken(w))
    ? pinyinQueryNeedle(rawQuery)
    : undefined;
  if (rawNeedle) {
    needles.add(rawNeedle);
  }
  for (const term of parsedQuery.terms) {
    const termNeedle = pinyinQueryNeedle(term.raw);
    if (termNeedle) {
      needles.add(termNeedle);
    }
  }

  if (needles.size === 0) {
    return { search: () => [] };
  }

  const uncachedNeedles = [...needles].filter(
    (n) => !pinyinQueryHitCache.get(`${versionId}:${n}`),
  );
  const buckets = new Map<number, CompiledPinyinBucket>();
  let core: CompiledPinyinCore | undefined;

  if (uncachedNeedles.length > 0) {
    const bucketIndexes = [
      ...new Set(
        uncachedNeedles.map((n) => hashPartitionKey(n.slice(0, 2), pinyinBucketCount)),
      ),
    ];
    await Promise.all(
      bucketIndexes.map(async (bucketIndex) => {
        buckets.set(bucketIndex, await loadCompiledPinyinBucket(versionId, bucketIndex));
      }),
    );
    const needsCore = uncachedNeedles.some((n) => {
      const p2 = n.slice(0, 2);
      const b = buckets.get(hashPartitionKey(p2, pinyinBucketCount));
      return Boolean(b && !b.literals.has(n) && b.starts.get(p2)?.length);
    });
    if (needsCore) {
      core = await loadCompiledPinyinCore(versionId);
    }
  }

  return {
    search(query: string): readonly PinyinAlias[] {
      const needle = pinyinQueryNeedle(query);
      if (!needle) {
        return [];
      }
      const cacheKey = `${versionId}:${needle}`;
      const cached = pinyinQueryHitCache.get(cacheKey);
      if (cached) {
        return cached;
      }
      const prefix2 = needle.slice(0, 2);
      const bucket = buckets.get(hashPartitionKey(prefix2, pinyinBucketCount));
      if (!bucket || bucket.literals.has(needle) || !core) {
        pinyinQueryHitCache.set(cacheKey, []);
        return [];
      }
      const weights = new Map<string, number>();
      for (const entryIndex of bucket.starts.get(prefix2) ?? []) {
        const rawEntry = core.rawEntries[entryIndex];
        const weight = matchPinyinChars(rawEntry[1], core.chars, needle);
        if (weight > 0) {
          const name = core.names[rawEntry[0]] ?? "";
          weights.set(name, Math.max(weights.get(name) ?? 0, weight));
        }
      }
      const hits = [...weights].map(([name, weight]) => ({ name, weight }));
      hits.sort(
        (left, right) =>
          right.weight - left.weight ||
          left.name.length - right.name.length ||
          left.name.localeCompare(right.name),
      );
      const cappedHits = hits.length > 256 ? hits.slice(0, 256) : hits;
      pinyinQueryHitCache.set(cacheKey, cappedHits);
      return cappedHits;
    },
  };
}

// ---------------------------------------------------------------------------
// Public Partitioned Query Operations
// ---------------------------------------------------------------------------

export async function getPartitionedDatasetCatalog(versionId: string) {
  const meta = await loadPartitionMeta(versionId);
  return {
    schemaVersion: 1 as const,
    datasetVersionId: meta.datasetVersionId,
    gtnhVersion: meta.gtnhVersion,
    sourceInfo: meta.sourceInfo,
    resources: [],
    resourceIndex: meta.machineConfigResources,
    recipes: [],
    recipeCount: meta.recipeCount,
    oreDictionary: {},
    recipeMaps: meta.recipeMaps,
    recipeMapIcons: meta.recipeMapIcons,
    machineHandlerIcons: meta.machineHandlerIcons,
    generatedAt: meta.generatedAt,
  };
}

export async function getPartitionedDatasetRecipeIds(versionId: string): Promise<string[]> {
  return readDatasetGzipJson<string[]>(`${versionId}/partitions/recipe-ids.json.gz`);
}

function searchOutcome(resolved: { query: SearchQuery; phase: SearchPhase }) {
  return {
    searchPhase: resolved.phase,
    corrections: resolved.phase === "corrected" ? resolved.query.corrections : [],
  };
}

const TRIE_CHAR_CODE = new Int8Array(128).fill(-1);
for (let i = 0; i < 26; i += 1) TRIE_CHAR_CODE[97 + i] = i;
for (let i = 0; i < 10; i += 1) TRIE_CHAR_CODE[48 + i] = 26 + i;

function matchQueryTokensInVocab(
  queryTokens: Iterable<string>,
  vocabTokens: string[],
  offsets?: Uint32Array,
  typedTokens?: ReadonlySet<string>,
  tokenIndexByWord?: ReadonlyMap<string, number>,
): Map<string, { exact: number[]; prefix: number[]; contains: number[]; byteLen: number }> {
  const qList = [...new Set(queryTokens)].filter(Boolean);
  const out = new Map<
    string,
    { exact: number[]; prefix: number[]; contains: number[]; byteLen: number }
  >();
  if (qList.length === 0) {
    return out;
  }

  const scanSubstringList: string[] = [];
  if (qList.length > 8 && tokenIndexByWord && typedTokens) {
    for (const qt of qList) {
      if (typedTokens.has(qt)) {
        scanSubstringList.push(qt);
        continue;
      }
      const tid = tokenIndexByWord.get(qt);
      if (tid !== undefined) {
        const b = offsets ? offsets[tid + 1] - offsets[tid] : 1;
        out.set(qt, { exact: [tid], prefix: [], contains: [], byteLen: b });
      } else {
        out.set(qt, { exact: [], prefix: [], contains: [], byteLen: 0 });
      }
    }
  } else {
    scanSubstringList.push(...qList);
  }

  for (const qt of scanSubstringList) {
    const exact: number[] = [];
    const prefix: number[] = [];
    const contains: number[] = [];
    let byteLen = 0;
    const qLen = qt.length;
    for (let tid = 0; tid < vocabTokens.length; tid += 1) {
      const vt = vocabTokens[tid];
      const pos = vt.indexOf(qt);
      if (pos === -1) continue;
      const b = offsets ? offsets[tid + 1] - offsets[tid] : 1;
      byteLen += b;
      if (pos === 0) {
        if (vt.length === qLen) exact.push(tid);
        else prefix.push(tid);
      } else {
        contains.push(tid);
      }
    }
    out.set(qt, { exact, prefix, contains, byteLen });
  }
  return out;
}

const RESOURCE_FIELD_WEIGHTS = [0.32, 0.4, 1.0] as const;
const NAME_EQUALS_BONUS = 8;
const NAME_STARTS_BONUS = 4;
const NAME_CONTAINS_BONUS = 1.5;
const NAME_ALIAS_BONUS = 0.1;
const PARTIAL_TERM_BONUS = 1;

interface ResourceScratchWorkspace {
  size: number;
  tokenScratchStamp: Int32Array;
  tokenScratchPrec: Float32Array;
  tokenScratchEntries: Int32Array;
  totalScores: Float64Array;
  matchedTermsCount: Uint16Array;
  termScores: Float64Array;
  termStamps: Int32Array;
  poolArrays: Float32Array[];
  scratchGen: number;
}
let sharedResourceScratch: ResourceScratchWorkspace | undefined;
function getResourceScratch(resourceCount: number): ResourceScratchWorkspace {
  if (!sharedResourceScratch || sharedResourceScratch.size < resourceCount) {
    sharedResourceScratch = {
      size: resourceCount,
      tokenScratchStamp: new Int32Array(resourceCount),
      tokenScratchPrec: new Float32Array(resourceCount),
      tokenScratchEntries: new Int32Array(resourceCount),
      totalScores: new Float64Array(resourceCount),
      matchedTermsCount: new Uint16Array(resourceCount),
      termScores: new Float64Array(resourceCount),
      termStamps: new Int32Array(resourceCount),
      poolArrays: Array.from({ length: 10 }, () => new Float32Array(resourceCount)),
      scratchGen: 0,
    };
  }
  return sharedResourceScratch;
}

interface RecipeScratchWorkspace {
  size: number;
  recipeScratchStamp: Int32Array;
  recipeScratchCode: Uint8Array;
  recipeScratchEntries: Int32Array;
  termBest: Float64Array;
  termStamp: Int32Array;
  totalScores: Float64Array;
  matchedTermsCount: Uint16Array;
  poolArrays: Uint8Array[];
  scratchGen: number;
}
let sharedRecipeScratch: RecipeScratchWorkspace | undefined;
function getRecipeScratch(recipeCount: number): RecipeScratchWorkspace {
  if (!sharedRecipeScratch || sharedRecipeScratch.size < recipeCount) {
    sharedRecipeScratch = {
      size: recipeCount,
      recipeScratchStamp: new Int32Array(recipeCount),
      recipeScratchCode: new Uint8Array(recipeCount),
      recipeScratchEntries: new Int32Array(recipeCount),
      termBest: new Float64Array(recipeCount),
      termStamp: new Int32Array(recipeCount),
      totalScores: new Float64Array(recipeCount),
      matchedTermsCount: new Uint16Array(recipeCount),
      poolArrays: Array.from({ length: 10 }, () => new Uint8Array(recipeCount)),
      scratchGen: 0,
    };
  }
  return sharedRecipeScratch;
}

export async function queryPartitionedDatasetResources(
  versionId: string,
  request: {
    query: string;
    offset: number;
    limit: number;
    kind?: "item" | "fluid";
    mod?: string;
    sort?: ResourceQuerySort;
    source?: ResourceSourceFilter;
    popularity?: Map<string, number>;
  },
) {
  const sort = request.sort ?? "relevance";
  const hasPopularity = Boolean(request.popularity && request.popularity.size > 0);
  const queryCacheKey = `${versionId}\0${request.query}\0${request.kind ?? ""}\0${request.mod ?? ""}\0${sort}\0${request.source ?? ""}`;
  let computed = !hasPopularity ? resourceQueryComputedCache.get(queryCacheKey) : undefined;

  if (!computed) {
    const [meta, bundle] = await Promise.all([
      loadPartitionMeta(versionId),
      loadResourceSearchBundle(versionId),
    ]);
    const {
      resourceCount,
      flags,
      modIds,
      recipeCounts,
      madeByCounts,
      usedByCounts,
      sortedResourceIndexes,
      sortedRanks,
    } = bundle.meta;
    const { modNames, displayNames, ids, allResourceTokens } = bundle.strings;
    const { lowerNames } = bundle;

    const bilingual = bilingualSearch(request.query);
    const baseParsed = parseSearchQuery(bilingual?.text ?? request.query);
    const pinyinIndex = await createScopedPinyinIndex(
      versionId,
      meta.pinyinBucketCount,
      request.query,
      baseParsed,
    );
    const parsed = withPinyinSearch(baseParsed, () => pinyinIndex, request.query);

    if (bilingual?.unresolved && parsed.terms.length === 0) {
      return {
        resources: [],
        total: 0,
        offset: request.offset,
        limit: request.limit,
        hasMore: false,
        mods: [],
        searchPhase: "exact" as const,
        corrections: [],
      };
    }

    const postings = parsed.terms.length > 0 ? await loadResourcePostings(versionId) : undefined;
    const baseTokens = new Set<string>();
    for (const term of baseParsed.terms) {
      for (const variant of term.variants) {
        for (const tok of variant.tokens) {
          baseTokens.add(tok);
        }
      }
    }
    const pinyinOnlyTokens = new Set<string>();
    for (const term of parsed.terms) {
      for (const variant of term.variants) {
        for (const tok of variant.tokens) {
          if (!baseTokens.has(tok)) {
            pinyinOnlyTokens.add(tok);
          }
        }
      }
    }

    const getTokenVocabMatch = (qt: string) => {
      if (pinyinOnlyTokens.size > 8 && pinyinOnlyTokens.has(qt)) {
        const tid = bundle.tokenIndexByWord.get(qt);
        if (tid !== undefined) {
          const b = postings ? postings.offsets[tid + 1] - postings.offsets[tid] : 1;
          return { exact: [tid], prefix: [], contains: [], byteLen: b };
        }
        return { exact: [], prefix: [], contains: [], byteLen: 0 };
      }
      const cached = bundle.vocabMatchCache.get(qt);
      if (cached) {
        return cached;
      }
      const exact: number[] = [];
      const prefix: number[] = [];
      const contains: number[] = [];
      let byteLen = 0;
      const qLen = qt.length;
      for (let tid = 0; tid < allResourceTokens.length; tid += 1) {
        const vt = allResourceTokens[tid];
        const pos = vt.indexOf(qt);
        if (pos === -1) continue;
        const b = postings ? postings.offsets[tid + 1] - postings.offsets[tid] : 1;
        byteLen += b;
        if (pos === 0) {
          if (vt.length === qLen) exact.push(tid);
          else prefix.push(tid);
        } else {
          contains.push(tid);
        }
      }
      const result = { exact, prefix, contains, byteLen };
      bundle.vocabMatchCache.set(qt, result);
      return result;
    };

    const decodedTokenCache = new Map<
      string,
      { entries: Int32Array; precs: Float32Array; count: number }
    >();
    const scratch = getResourceScratch(resourceCount);
    const {
      tokenScratchStamp,
      tokenScratchPrec,
      tokenScratchEntries,
      totalScores,
      matchedTermsCount,
      termScores,
      termStamps,
      poolArrays,
    } = scratch;

    const getDecodedResourceTokenMatches = (qt: string) => {
      const cached = decodedTokenCache.get(qt);
      if (cached) {
        return cached;
      }
      const matched = getTokenVocabMatch(qt);
    scratch.scratchGen = (scratch.scratchGen + 1) | 0;
    const gen = scratch.scratchGen;
    let count = 0;

    if (postings && matched.byteLen > 0) {
      for (const [group, matchPrec] of [
        [matched.exact, 1.0],
        [matched.prefix, 0.78],
        [matched.contains, 0.5],
      ] as const) {
        for (let g = 0; g < group.length; g += 1) {
          const tid = group[g];
          const startOff = postings.offsets[tid];
          const endOff = postings.offsets[tid + 1];
          let prev = 0;
          let pos = startOff;
          while (pos < endOff) {
            let shift = 0;
            let delta = 0;
            while (pos < endOff) {
              const byte = postings.data[pos++];
              delta |= (byte & 0x7f) << shift;
              if ((byte & 0x80) === 0) {
                break;
              }
              shift += 7;
            }
            prev = (prev + delta) | 0;
            const resourceIndex = prev >>> 2;
            const fieldCode = prev & 3;
            const weighted = matchPrec * RESOURCE_FIELD_WEIGHTS[fieldCode];
            if (tokenScratchStamp[resourceIndex] !== gen) {
              tokenScratchStamp[resourceIndex] = gen;
              tokenScratchPrec[resourceIndex] = weighted;
              tokenScratchEntries[count++] = resourceIndex;
            } else if (weighted > tokenScratchPrec[resourceIndex]) {
              tokenScratchPrec[resourceIndex] = weighted;
            }
          }
        }
      }
    }

    const entries = new Int32Array(count);
    const precs = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const r = tokenScratchEntries[i];
      entries[i] = r;
      precs[i] = tokenScratchPrec[r];
    }
    const result = { entries, precs, count };
    decodedTokenCache.set(qt, result);
    return result;
  };

  let modCountsArr = new Uint32Array(modNames.length);
  const requestedModIndex = request.mod ? modNames.indexOf(request.mod) : -2;

  const resourceMatchesFilter = (resourceIndex: number): boolean => {
    const f = flags[resourceIndex];
    if ((f & 1) === 0) {
      return false;
    }
    if (request.kind === "fluid" && (f & 2) === 0) {
      return false;
    }
    if (request.kind === "item" && (f & 2) !== 0) {
      return false;
    }
    if (request.source === "plants" && (f & 4) === 0) {
      return false;
    }
    if (request.source === "bees" && (f & 8) === 0) {
      return false;
    }
    return true;
  };

  const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

  const compareResourcesBySort = (l: number, r: number, lScore = 0, rScore = 0): number => {
    if (sort === "name") {
      return cmpStr(lowerNames[l], lowerNames[r]) || sortedRanks[l] - sortedRanks[r];
    }
    if (sort === "mod") {
      return (
        cmpStr(modNames[modIds[l]] ?? "other", modNames[modIds[r]] ?? "other") ||
        cmpStr(lowerNames[l], lowerNames[r]) ||
        sortedRanks[l] - sortedRanks[r]
      );
    }
    if (sort === "recipes") {
      return (
        recipeCounts[r] - recipeCounts[l] ||
        cmpStr(lowerNames[l], lowerNames[r]) ||
        sortedRanks[l] - sortedRanks[r]
      );
    }
    if (sort === "made") {
      return (
        madeByCounts[r] - madeByCounts[l] ||
        cmpStr(lowerNames[l], lowerNames[r]) ||
        sortedRanks[l] - sortedRanks[r]
      );
    }
    if (sort === "uses") {
      return (
        usedByCounts[r] - usedByCounts[l] ||
        cmpStr(lowerNames[l], lowerNames[r]) ||
        sortedRanks[l] - sortedRanks[r]
      );
    }
    if (sort === "popular") {
      const popDiff = hasPopularity
        ? (request.popularity!.get(`${(flags[r] & 2) !== 0 ? "fluid" : "item"}:${ids[r]}`) ?? 0) -
          (request.popularity!.get(`${(flags[l] & 2) !== 0 ? "fluid" : "item"}:${ids[l]}`) ?? 0)
        : 0;
      return (
        rScore - lScore ||
        popDiff ||
        madeByCounts[r] - madeByCounts[l] ||
        cmpStr(lowerNames[l], lowerNames[r]) ||
        sortedRanks[l] - sortedRanks[r]
      );
    }
    return (
      rScore - lScore ||
      madeByCounts[r] - madeByCounts[l] ||
      sortedRanks[l] - sortedRanks[r]
    );
  };

  const run = (query: SearchQuery, options: { partial?: boolean }) => {
    const counts = new Uint32Array(modNames.length);
    const matches: Array<{ resourceIndex: number; score: number }> = [];

    if (query.terms.length === 0) {
      let baseOrder =
        sort !== "popular" || !hasPopularity
          ? bundle.emptyQuerySortedByMode.get(sort)
          : undefined;
      if (!baseOrder) {
        const searchable: number[] = [];
        for (let i = 0; i < sortedResourceIndexes.length; i += 1) {
          const r = sortedResourceIndexes[i];
          if ((flags[r] & 1) !== 0) {
            searchable.push(r);
          }
        }
        searchable.sort((l, r) => compareResourcesBySort(l, r, 0, 0));
        baseOrder = new Uint32Array(searchable);
        if (sort !== "popular" || !hasPopularity) {
          bundle.emptyQuerySortedByMode.set(sort, baseOrder);
        }
      }
      for (let i = 0; i < baseOrder.length; i += 1) {
        const resourceIndex = baseOrder[i];
        if (!resourceMatchesFilter(resourceIndex)) {
          continue;
        }
        const mId = modIds[resourceIndex];
        counts[mId] += 1;
        if (request.mod && mId !== requestedModIndex) {
          continue;
        }
        matches.push({ resourceIndex, score: 0 });
      }
      modCountsArr = counts;
      return matches;
    }

    // Score each term over resource postings
    const candidateResources: number[] = [];

    const MAX_POOLED_ARRAYS = poolArrays.length;
    const tokenMapCache = new Map<
      string,
      { arr: Float32Array; decoded: ReturnType<typeof getDecodedResourceTokenMatches> }
    >();
    const getTokenFullArray = (qt: string): Float32Array => {
      const existing = tokenMapCache.get(qt);
      if (existing) {
        tokenMapCache.delete(qt);
        tokenMapCache.set(qt, existing);
        return existing.arr;
      }
      let arr: Float32Array;
      if (tokenMapCache.size >= MAX_POOLED_ARRAYS) {
        const oldestKey = tokenMapCache.keys().next().value!;
        const oldest = tokenMapCache.get(oldestKey)!;
        tokenMapCache.delete(oldestKey);
        arr = oldest.arr;
        for (let i = 0; i < oldest.decoded.count; i += 1) {
          arr[oldest.decoded.entries[i]] = 0;
        }
      } else {
        arr = poolArrays[tokenMapCache.size];
      }
      const decoded = getDecodedResourceTokenMatches(qt);
      for (let i = 0; i < decoded.count; i += 1) {
        arr[decoded.entries[i]] = decoded.precs[i];
      }
      tokenMapCache.set(qt, { arr, decoded });
      return arr;
    };

    for (let termIdx = 0; termIdx < query.terms.length; termIdx += 1) {
      const term = query.terms[termIdx];
      scratch.scratchGen = (scratch.scratchGen + 1) | 0;
      const tGen = scratch.scratchGen;
      const termTouched: number[] = [];

      const byAnchor = new Map<string, typeof term.variants>();
      const nonAnchorTokens = new Set<string>();
      for (const variant of term.variants) {
        if (variant.tokens.length === 0) continue;
        let anchorToken = variant.tokens[0];
        let minBytes = getTokenVocabMatch(anchorToken).byteLen;
        for (let i = 1; i < variant.tokens.length; i += 1) {
          const b = getTokenVocabMatch(variant.tokens[i]).byteLen;
          if (b < minBytes) {
            minBytes = b;
            anchorToken = variant.tokens[i];
          }
        }
        if (minBytes === 0) continue;
        let list = byAnchor.get(anchorToken);
        if (!list) {
          list = [];
          byAnchor.set(anchorToken, list);
        }
        list.push(variant);
        for (const tok of variant.tokens) {
          if (tok !== anchorToken) nonAnchorTokens.add(tok);
        }
      }

      for (const [anchorToken, vars] of byAnchor) {
        const anchorDecoded = getDecodedResourceTokenMatches(anchorToken);
        if (anchorDecoded.count === 0) continue;

        let singleWeight = 0;
        for (let vi = 0; vi < vars.length; vi += 1) {
          const v = vars[vi];
          if (v.tokens.length === 1 && v.weight > singleWeight) {
            singleWeight = v.weight;
          }
        }
        if (singleWeight > 0) {
          for (let i = 0; i < anchorDecoded.count; i += 1) {
            const r = anchorDecoded.entries[i];
            const s = anchorDecoded.precs[i] * singleWeight;
            if (termStamps[r] !== tGen) {
              termStamps[r] = tGen;
              termScores[r] = s;
              termTouched.push(r);
            } else if (s > termScores[r]) {
              termScores[r] = s;
            }
          }
        }

        for (let vi = 0; vi < vars.length; vi += 1) {
          const variant = vars[vi];
          if (variant.tokens.length <= 1) continue;
          const vWeight = variant.weight;
          if (variant.tokens.length === 2) {
            const otherTok =
              variant.tokens[0] === anchorToken ? variant.tokens[1] : variant.tokens[0];
            let otherArr: Float32Array | undefined;
            for (let i = 0; i < anchorDecoded.count; i += 1) {
              const r = anchorDecoded.entries[i];
              const prevBest = termStamps[r] === tGen ? termScores[r] : 0;
              const anchorPrec = anchorDecoded.precs[i];
              if (anchorPrec * vWeight <= prevBest) continue;
              if (!otherArr) otherArr = getTokenFullArray(otherTok);
              const otherPrec = otherArr[r];
              if (otherPrec === 0) continue;
              const weakest = otherPrec < anchorPrec ? otherPrec : anchorPrec;
              const s = weakest * vWeight;
              if (s > prevBest) {
                if (termStamps[r] !== tGen) {
                  termStamps[r] = tGen;
                  termTouched.push(r);
                }
                termScores[r] = s;
              }
            }
          } else {
            const otherTokens = variant.tokens
              .filter((tok) => tok !== anchorToken)
              .sort(
                (a, b) =>
                  getTokenVocabMatch(a).byteLen - getTokenVocabMatch(b).byteLen,
              );
            const oLen = otherTokens.length;
            for (let i = 0; i < anchorDecoded.count; i += 1) {
              const r = anchorDecoded.entries[i];
              const prevBest = termStamps[r] === tGen ? termScores[r] : 0;
              let weakest = anchorDecoded.precs[i];
              if (weakest * vWeight <= prevBest) continue;
              for (let ti = 0; ti < oLen; ti += 1) {
                const p = getTokenFullArray(otherTokens[ti])[r];
                if (p < weakest) {
                  weakest = p;
                  if (weakest * vWeight <= prevBest) {
                    weakest = 0;
                    break;
                  }
                }
              }
              if (weakest > 0) {
                const s = weakest * vWeight;
                if (s > prevBest) {
                  if (termStamps[r] !== tGen) {
                    termStamps[r] = tGen;
                    termTouched.push(r);
                  }
                  termScores[r] = s;
                }
              }
            }
          }
        }
      }

      for (let i = 0; i < termTouched.length; i += 1) {
        const r = termTouched[i];
        if (matchedTermsCount[r] === 0) {
          candidateResources.push(r);
        }
        matchedTermsCount[r] += 1;
        totalScores[r] += termScores[r];
      }
    }

    const requiredTerms = options.partial ? 1 : query.terms.length;
    candidateResources.sort((a, b) => sortedRanks[a] - sortedRanks[b]);

    for (let i = 0; i < candidateResources.length; i += 1) {
      const resourceIndex = candidateResources[i];
      const matched = matchedTermsCount[resourceIndex];
      if (matched < requiredTerms) {
        continue;
      }
      if (!resourceMatchesFilter(resourceIndex)) {
        continue;
      }

      const mId = modIds[resourceIndex];
      counts[mId] += 1;
      if (request.mod && mId !== requestedModIndex) {
        continue;
      }

      let score = totalScores[resourceIndex];
      if (options.partial) {
        score += matched * PARTIAL_TERM_BONUS;
      }
      const lowerName = lowerNames[resourceIndex];
      if (lowerName && query.text) {
        if (lowerName === query.text) {
          score += NAME_EQUALS_BONUS;
        } else if (lowerName.startsWith(query.text)) {
          score += NAME_STARTS_BONUS;
        } else if (lowerName.includes(query.text)) {
          score += NAME_CONTAINS_BONUS;
        }
      }
      if (lowerName && query.nameAliases?.size) {
        score += NAME_ALIAS_BONUS * (query.nameAliases.get(lowerName) ?? 0);
      }
      if (score > 0) {
        const rawName = displayNames[resourceIndex] ?? "";
        score += Math.log10(1 + recipeCounts[resourceIndex]) / 10 - rawName.length / 400;
      }
      matches.push({ resourceIndex, score });
    }

    for (let i = 0; i < candidateResources.length; i += 1) {
      const r = candidateResources[i];
      totalScores[r] = 0;
      matchedTermsCount[r] = 0;
    }
    for (const { arr, decoded } of tokenMapCache.values()) {
      for (let i = 0; i < decoded.count; i += 1) {
        arr[decoded.entries[i]] = 0;
      }
    }

    modCountsArr = counts;
    return matches;
  };

  let resolved = resolveSearchPhases(parsed, bundle.vocabulary, run);
  if (bilingual && resolved.results.length === 0) {
    for (const alternative of bilingual.alternatives) {
      const attempt = resolveSearchPhases(parseSearchQuery(alternative), bundle.vocabulary, run);
      if (attempt.results.length > 0) {
        resolved = attempt;
        break;
      }
    }
  }

    const sortedMatches =
      resolved.query.terms.length === 0
        ? resolved.results
        : [...resolved.results].sort((left, right) =>
            compareResourcesBySort(left.resourceIndex, right.resourceIndex, left.score, right.score),
          );
    const sortedIndexes = new Int32Array(sortedMatches.length);
    for (let i = 0; i < sortedMatches.length; i += 1) {
      sortedIndexes[i] = sortedMatches[i].resourceIndex;
    }
    const outcome = searchOutcome(resolved);
    computed = {
      sortedResourceIndexes: sortedIndexes,
      mods: Array.from(modCountsArr)
        .map((count, mId) => ({ id: modNames[mId] ?? "other", count }))
        .filter((entry) => entry.count > 0)
        .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
      searchPhase: outcome.searchPhase,
      corrections: outcome.corrections,
    };
    if (!hasPopularity) {
      resourceQueryComputedCache.set(queryCacheKey, computed);
    }
  }

  const pageSlice = computed.sortedResourceIndexes.subarray(
    request.offset,
    request.offset + request.limit,
  );
  const missingPartIndexes = new Set<number>();
  for (let i = 0; i < pageSlice.length; i += 1) {
    const resourceIndex = pageSlice[i];
    if (!resourceEntryCache.get(`${versionId}:${resourceIndex}`)) {
      missingPartIndexes.add(Math.floor(resourceIndex / RESOURCE_ENTRIES_PART_SIZE));
    }
  }
  const partsByIndex = new Map<number, ReturnType<typeof unpackPostingsBuffer>>();
  await Promise.all(
    [...missingPartIndexes].map(async (partIndex) => {
      partsByIndex.set(partIndex, await loadResourceEntriesPart(versionId, partIndex));
    }),
  );

  const resources: DatasetResourceIndexEntry[] = [];
  for (let i = 0; i < pageSlice.length; i += 1) {
    const resourceIndex = pageSlice[i];
    const cacheKey = `${versionId}:${resourceIndex}`;
    const cached = resourceEntryCache.get(cacheKey);
    if (cached) {
      resources.push(cached);
      continue;
    }
    const partIndex = Math.floor(resourceIndex / RESOURCE_ENTRIES_PART_SIZE);
    const offsetInPart = resourceIndex % RESOURCE_ENTRIES_PART_SIZE;
    const part = partsByIndex.get(partIndex);
    if (!part || offsetInPart >= part.tokenCount) {
      continue;
    }
    const startOff = part.offsets[offsetInPart];
    const endOff = part.offsets[offsetInPart + 1];
    const loaded = JSON.parse(
      utf8Decoder.decode(part.data.subarray(startOff, endOff)),
    ) as DatasetResourceIndexEntry;
    resourceEntryCache.set(cacheKey, loaded);
    resources.push(loaded);
  }

  return {
    resources,
    total: computed.sortedResourceIndexes.length,
    offset: request.offset,
    limit: request.limit,
    hasMore: request.offset + request.limit < computed.sortedResourceIndexes.length,
    mods: computed.mods,
    searchPhase: computed.searchPhase,
    corrections: computed.corrections,
  };
}

// ---------------------------------------------------------------------------
// Resource Key Hydration & Recipe Querying
// ---------------------------------------------------------------------------

async function loadResourcesByKeys(
  versionId: string,
  meta: PartitionedDatasetMeta,
  keys: Iterable<string>,
): Promise<Map<string, DatasetResource | DatasetResourceIndexEntry>> {
  const uniqueKeys = [...new Set(keys)];
  const out = new Map<string, DatasetResource | DatasetResourceIndexEntry>();
  if (uniqueKeys.length === 0) {
    return out;
  }
  const machineConfigByKey = new Map<string, DatasetResourceIndexEntry>(
    (meta.machineConfigResources ?? []).map((r) => [`${r.kind}:${r.id}`, r]),
  );
  const byBucket = new Map<number, string[]>();
  for (const key of uniqueKeys) {
    const mc = machineConfigByKey.get(key);
    if (mc) {
      out.set(key, mc);
      continue;
    }
    const cached = resolvedResourceKeyCache.get(`${versionId}:${key}`);
    if (cached !== undefined) {
      if (cached.resource) {
        out.set(key, cached.resource);
      }
      continue;
    }
    const bucketIdx = hashPartitionKey(key, meta.keyBucketCount);
    const list = byBucket.get(bucketIdx);
    if (list) {
      list.push(key);
    } else {
      byBucket.set(bucketIdx, [key]);
    }
  }

  await Promise.all(
    [...byBucket.entries()].map(async ([bucketIdx, bucketKeys]) => {
      const bucket = await loadResourceKeyBucket(versionId, bucketIdx);
      for (const key of bucketKeys) {
        const entry = bucket.extractProp<ResourceKeyBucketEntry>(key) ?? {};
        resolvedResourceKeyCache.set(`${versionId}:${key}`, entry);
        if (entry.resource) {
          out.set(key, entry.resource);
        }
      }
    }),
  );
  return out;
}

function getWildcardResourceLocal(
  resource: Pick<ResourceAmount, "kind" | "id">,
): Pick<ResourceAmount, "kind" | "id"> | undefined {
  if (resource.kind !== "item" || resource.id.endsWith("@32767")) {
    return undefined;
  }
  const separatorIndex = resource.id.lastIndexOf("@");
  const baseId = separatorIndex === -1 ? resource.id : resource.id.slice(0, separatorIndex);
  return { kind: "item", id: `${baseId}@32767` };
}

async function resolvePartitionedResourceScope(
  versionId: string,
  meta: PartitionedDatasetMeta,
  resource: Pick<ResourceAmount, "kind" | "id">,
  mode: "recipes" | "uses",
): Promise<Array<Pick<ResourceAmount, "kind" | "id">>> {
  const key = `${resource.kind}:${resource.id}`;
  const bucketIdx = hashPartitionKey(key, meta.keyBucketCount);
  const bucket = await loadResourceKeyBucket(versionId, bucketIdx);
  const bucketEntry = bucket.extractProp<ResourceKeyBucketEntry>(key);

  if (bucketEntry) {
    const precomputedKeys =
      mode === "uses" ? bucketEntry.usesScopeKeys : bucketEntry.recipesScopeKeys;
    if (!precomputedKeys?.length) {
      return [resource];
    }
    return precomputedKeys.map((scopedKey) => {
      const colon = scopedKey.indexOf(":");
      return {
        kind: scopedKey.slice(0, colon) as "item" | "fluid",
        id: scopedKey.slice(colon + 1),
      };
    });
  }

  // Fallback for unindexed resources
  const resources: Array<Pick<ResourceAmount, "kind" | "id">> = [resource];
  const addScoped = (candidate: Pick<ResourceAmount, "kind" | "id">) => {
    if (!resources.some((entry) => entry.kind === candidate.kind && entry.id === candidate.id)) {
      resources.push(candidate);
    }
  };

  if (resource.kind === "item") {
    const fluid = getFilledCellFluidEquivalent(resource);
    if (fluid) {
      addScoped({ kind: "fluid", id: fluid.id });
    }
  } else if (resource.kind === "fluid") {
    for (const cell of meta.filledCells) {
      if (isFluidEquivalentToFilledCell(resource, { kind: "item", ...cell })) {
        addScoped({ kind: "item", id: cell.id });
      }
    }
  }

  if (mode === "uses" && resource.kind === "item" && !isOreDictionaryResource(resource)) {
    const wildcard = getWildcardResourceLocal(resource);
    if (wildcard) {
      addScoped(wildcard);
      const wildcardKey = `item:${wildcard.id}`;
      const wbIdx = hashPartitionKey(wildcardKey, meta.keyBucketCount);
      const wb = wbIdx === bucketIdx ? bucket : await loadResourceKeyBucket(versionId, wbIdx);
      for (const oredictName of wb.extractProp<string[]>(wildcard.id) ?? []) {
        addScoped({ kind: "item", id: `oredict:${oredictName}` });
      }
    }
  }

  return resources;
}

async function loadLookupEntriesForScopedResources(
  versionId: string,
  meta: PartitionedDatasetMeta,
  scopedResources: Array<Pick<ResourceAmount, "kind" | "id">>,
  mode: "recipes" | "uses",
): Promise<Map<number, number[]>> {
  const byBucket = new Map<number, string[]>();
  for (const resource of scopedResources) {
    const resourceKey = `${resource.kind}:${resource.id}`;
    const bucketIdx = hashPartitionKey(resourceKey, meta.lookupBucketCount);
    const modeKey = `${mode}:${resourceKey}`;
    const list = byBucket.get(bucketIdx);
    if (list) {
      list.push(modeKey);
    } else {
      byBucket.set(bucketIdx, [modeKey]);
    }
  }

  const recipesByMap = new Map<number, number[]>();
  await Promise.all(
    [...byBucket.entries()].map(async ([bucketIdx, modeKeys]) => {
      const bucket = await loadLookupBucket(versionId, bucketIdx);
      for (const modeKey of modeKeys) {
        const cacheKey = `${versionId}:${modeKey}`;
        let entries = resolvedLookupEntryCache.get(cacheKey);
        if (entries === undefined) {
          entries = bucket.extractProp<Array<[number, number[]]>>(modeKey) ?? [];
          resolvedLookupEntryCache.set(cacheKey, entries);
        }
        if (entries.length === 0) {
          continue;
        }
        for (const [recipeMapId, recipeIndexes] of entries) {
          const existing = recipesByMap.get(recipeMapId);
          recipesByMap.set(
            recipeMapId,
            existing ? [...new Set([...existing, ...recipeIndexes])] : recipeIndexes,
          );
        }
      }
    }),
  );
  return recipesByMap;
}

function collectRecipeResourceKeys(
  recipes: Recipe[],
  meta: PartitionedDatasetMeta,
): Set<string> {
  const keys = new Set<string>();
  const altKeySet = new Set(meta.nonOredictAltKeys ?? []);
  const machineConfigByKey = new Map<string, DatasetResourceIndexEntry>(
    (meta.machineConfigResources ?? []).map((r) => [`${r.kind}:${r.id}`, r]),
  );
  const check = (r: ResourceAmount | undefined) => {
    if (!r) return;
    const key = `${r.kind}:${r.id}`;
    if (r.id.startsWith("factoryflow:machine_config/") && r.displayName && !machineConfigByKey.has(key)) {
      return;
    }
    if (
      !r.displayName ||
      (!r.iconPath && !r.iconAtlas) ||
      (!r.dominantColor && !r.iconAtlas?.dominantColor) ||
      (!r.alternatives?.length && (isOreDictionaryResource(r) || altKeySet.has(key)))
    ) {
      keys.add(key);
    }
  };
  for (const recipe of recipes) {
    const enriched = enrichPassiveProductionRecipe(recipe);
    for (const input of enriched.inputs) {
      check(input);
    }
    for (const output of enriched.outputs) {
      check(output);
    }
    for (const control of enriched.machineConfigControls ?? []) {
      for (const tier of control.tiers) {
        check(tier.resource);
      }
    }
    for (const handler of enriched.machineHandlers ?? []) {
      for (const control of handler.machineConfigControls ?? []) {
        for (const tier of control.tiers) {
          check(tier.resource);
        }
      }
    }
  }
  return keys;
}

function hydrateResourceLocal<T extends ResourceAmount>(
  resource: T,
  resourcesByKey: Map<string, DatasetResource | DatasetResourceIndexEntry>,
  choiceAlternatives?: Map<string, ResourceAlternative[]>,
): T {
  const indexed = resourcesByKey.get(`${resource.kind}:${resource.id}`);
  const choice =
    !resource.alternatives?.length && isVirtualChoiceResource(resource)
      ? choiceAlternatives?.get(`${resource.kind}:${resource.id}`)
      : undefined;
  if (!indexed) {
    return choice?.length ? { ...resource, alternatives: choice } : resource;
  }
  return {
    ...resource,
    displayName: resource.displayName ?? indexed.displayName,
    iconPath: resource.iconPath ?? indexed.iconPath,
    iconAtlas: resource.iconAtlas ?? indexed.iconAtlas,
    dominantColor:
      resource.dominantColor ??
      indexed.dominantColor ??
      resource.iconAtlas?.dominantColor ??
      indexed.iconAtlas?.dominantColor,
    alternatives:
      resource.alternatives ??
      ("alternatives" in indexed ? indexed.alternatives : undefined) ??
      choice,
  };
}

function hydrateMachineConfigControlsLocal<T extends Recipe["machineConfigControls"]>(
  controls: T,
  resourcesByKey: Map<string, DatasetResource | DatasetResourceIndexEntry>,
): T {
  return controls?.map((control) => ({
    ...control,
    tiers: control.tiers.map((tier) => ({
      ...tier,
      resource: tier.resource ? hydrateResourceLocal(tier.resource, resourcesByKey) : tier.resource,
    })),
  })) as T;
}

function hydrateMachineHandlersLocal<T extends Recipe["machineHandlers"]>(
  handlers: T,
  resourcesByKey: Map<string, DatasetResource | DatasetResourceIndexEntry>,
): T {
  return handlers?.map((handler) => ({
    ...handler,
    machineConfigControls: hydrateMachineConfigControlsLocal(
      handler.machineConfigControls,
      resourcesByKey,
    ),
  })) as T;
}

function toRecipeSummaryLocal(
  recipe: Recipe,
  resourcesByKey: Map<string, DatasetResource | DatasetResourceIndexEntry>,
  choiceAlternatives?: Map<string, ResourceAlternative[]>,
): RecipeSummary {
  const enrichedRecipe = enrichPassiveProductionRecipe(recipe);
  return {
    id: enrichedRecipe.id,
    name: enrichedRecipe.name,
    kind: enrichedRecipe.kind,
    category: enrichedRecipe.category,
    recipeMap: enrichedRecipe.source?.recipeMap ?? enrichedRecipe.machineType,
    machineType: enrichedRecipe.machineType,
    minimumTier: enrichedRecipe.minimumTier,
    durationTicks: enrichedRecipe.durationTicks,
    eut: enrichedRecipe.eut,
    programmedCircuit: enrichedRecipe.programmedCircuit,
    specialValue: enrichedRecipe.specialValue,
    metadata: enrichedRecipe.metadata,
    machineHandlers: hydrateMachineHandlersLocal(enrichedRecipe.machineHandlers, resourcesByKey),
    machineConfigControls: hydrateMachineConfigControlsLocal(
      enrichedRecipe.machineConfigControls,
      resourcesByKey,
    ),
    inputs: enrichedRecipe.inputs.map((resource) =>
      hydrateResourceLocal(resource, resourcesByKey, choiceAlternatives),
    ),
    outputs: enrichedRecipe.outputs.map((resource) =>
      hydrateResourceLocal(resource, resourcesByKey),
    ),
    source: enrichedRecipe.source?.recipeMap
      ? { recipeMap: enrichedRecipe.source.recipeMap }
      : undefined,
    nei: enrichedRecipe.nei,
    slots: [],
  };
}

async function getPartitionedRecipeSummariesByIndexMap(
  versionId: string,
  meta: PartitionedDatasetMeta,
  recipeIndexes: number[],
): Promise<Map<number, RecipeSummary>> {
  if (recipeIndexes.length === 0) {
    return new Map();
  }
  const summaries = new Map<number, RecipeSummary>();
  const shardRequests = new Map<PartitionShardDescriptor, number[]>();
  for (const recipeIndex of new Set(recipeIndexes)) {
    const cached = recipeSummaryCache.get(`${versionId}:${recipeIndex}`);
    if (cached) {
      summaries.set(recipeIndex, cached);
      continue;
    }
    const shard = meta.shards.find(
      (entry) => recipeIndex >= entry.start && recipeIndex < entry.end,
    );
    if (!shard) {
      continue;
    }
    const existing = shardRequests.get(shard);
    if (existing) {
      existing.push(recipeIndex);
    } else {
      shardRequests.set(shard, [recipeIndex]);
    }
  }

  if (shardRequests.size === 0) {
    return summaries;
  }

  const rawRecipesByIndex = new Map<number, Recipe>();
  await Promise.all(
    [...shardRequests.entries()].map(async ([shard, indexes]) => {
      const indexedShard = await loadShardRecipes(versionId, shard);
      for (const recipeIndex of indexes) {
        const recipe = indexedShard.getRecipe(recipeIndex - shard.start);
        if (recipe) {
          rawRecipesByIndex.set(recipeIndex, recipe);
        }
      }
    }),
  );

  const rawRecipes = [...rawRecipesByIndex.values()];
  const resourceKeys = collectRecipeResourceKeys(rawRecipes, meta);
  const needsChoiceAlternatives = rawRecipes.some((recipe) =>
    recipe.inputs.some((input) => !input.alternatives?.length && isVirtualChoiceResource(input)),
  );
  const [resourcesByKey, choiceAlternatives] = await Promise.all([
    loadResourcesByKeys(versionId, meta, resourceKeys),
    needsChoiceAlternatives ? loadChoiceAlternatives(versionId) : Promise.resolve(undefined),
  ]);

  for (const [recipeIndex, recipe] of rawRecipesByIndex) {
    const summary = toRecipeSummaryLocal(recipe, resourcesByKey, choiceAlternatives);
    recipeSummaryCache.set(`${versionId}:${recipeIndex}`, summary);
    summaries.set(recipeIndex, summary);
  }
  return summaries;
}

async function loadPartitionedRecipeBodies(
  versionId: string,
  meta: PartitionedDatasetMeta,
  recipeIndexes: number[],
): Promise<Map<number, Recipe>> {
  const shardRequests = new Map<PartitionShardDescriptor, number[]>();
  for (const recipeIndex of new Set(recipeIndexes)) {
    const shard = meta.shards.find(
      (entry) => recipeIndex >= entry.start && recipeIndex < entry.end,
    );
    if (!shard) {
      continue;
    }
    const existing = shardRequests.get(shard);
    if (existing) {
      existing.push(recipeIndex);
    } else {
      shardRequests.set(shard, [recipeIndex]);
    }
  }

  const bodies = new Map<number, Recipe>();
  for (const [shard, indexes] of shardRequests) {
    const indexedShard = await loadShardRecipes(versionId, shard);
    for (const recipeIndex of indexes) {
      const recipe = indexedShard.getRecipe(recipeIndex - shard.start);
      if (recipe) {
        bodies.set(recipeIndex, recipe);
      }
    }
  }
  return bodies;
}

export async function getPartitionedDatasetRecipe(
  versionId: string,
  recipeId: string,
): Promise<Recipe | undefined> {
  const meta = await loadPartitionMeta(versionId);
  const bucketIdx = hashPartitionKey(recipeId, meta.recipeIdBucketCount);
  const idBucket = await loadRecipeIdBucket(versionId, bucketIdx);
  const recipeIndex = idBucket.extractProp<number>(recipeId) ?? -1;
  if (recipeIndex < 0) {
    return undefined;
  }
  const shard = meta.shards.find((entry) => recipeIndex >= entry.start && recipeIndex < entry.end);
  if (!shard) {
    return undefined;
  }
  const indexedShard = await loadShardRecipes(versionId, shard);
  const recipe = indexedShard.getRecipe(recipeIndex - shard.start);
  if (!recipe) {
    return undefined;
  }

  const enrichedRecipe = enrichPassiveProductionRecipe(recipe);
  const resourceKeys = collectRecipeResourceKeys([enrichedRecipe], meta);
  const needsChoice = enrichedRecipe.inputs.some(
    (input) => !input.alternatives?.length && isVirtualChoiceResource(input),
  );
  const [resourcesByKey, choiceAlternatives] = await Promise.all([
    loadResourcesByKeys(versionId, meta, resourceKeys),
    needsChoice ? loadChoiceAlternatives(versionId) : Promise.resolve(undefined),
  ]);

  return {
    ...enrichedRecipe,
    machineConfigControls: hydrateMachineConfigControlsLocal(
      enrichedRecipe.machineConfigControls,
      resourcesByKey,
    ),
    machineHandlers: hydrateMachineHandlersLocal(enrichedRecipe.machineHandlers, resourcesByKey),
    inputs: enrichedRecipe.inputs.map((resource) =>
      hydrateResourceLocal(resource, resourcesByKey, choiceAlternatives),
    ),
    outputs: enrichedRecipe.outputs.map((resource) =>
      hydrateResourceLocal(resource, resourcesByKey),
    ),
  };
}

const RECIPE_REF_MIGRATION_SCORE = 300;
const RECIPE_REF_CANDIDATE_LIMIT = 600;

export async function resolvePartitionedDatasetRecipeRefs(
  versionId: string,
  refs: RecipeContentRef[],
): Promise<Array<{ importedId: string; recipeId: string; exact: boolean }>> {
  if (refs.length === 0) {
    return [];
  }
  const meta = await loadPartitionMeta(versionId);
  const mapIds = new Map(meta.lookupRecipeMaps.map((name, idx) => [name, idx]));

  const candidateIndexesByRef = new Map<RecipeContentRef, number[]>();
  await Promise.all(
    refs.map(async (ref) => {
      const mapId = ref.recipeMap ? mapIds.get(ref.recipeMap) : undefined;
      const indexes: number[] = [];
      for (const output of ref.outputs) {
        const recipesByMap = await loadLookupEntriesForScopedResources(
          versionId,
          meta,
          [{ kind: output.kind, id: output.id }],
          "recipes",
        );
        if (recipesByMap.size === 0) {
          continue;
        }
        if (mapId !== undefined) {
          indexes.push(...(recipesByMap.get(mapId) ?? []));
        } else {
          for (const list of recipesByMap.values()) {
            indexes.push(...list);
          }
        }
        if (indexes.length > 0) {
          break;
        }
      }
      candidateIndexesByRef.set(
        ref,
        [...new Set(indexes)].sort((a, b) => a - b).slice(0, RECIPE_REF_CANDIDATE_LIMIT),
      );
    }),
  );

  const candidatesByIndex = await loadPartitionedRecipeBodies(
    versionId,
    meta,
    [...candidateIndexesByRef.values()].flat(),
  );
  const matches = new Map<string, { recipeId: string; exact: boolean }>();
  const unsettled: RecipeContentRef[] = [];

  for (const ref of refs) {
    const match = pickRecipeRefMatch(
      ref,
      (candidateIndexesByRef.get(ref) ?? [])
        .map((recipeIndex) => candidatesByIndex.get(recipeIndex))
        .filter((recipe): recipe is Recipe => recipe !== undefined),
    );
    if (match && match.score >= RECIPE_REF_MIGRATION_SCORE) {
      matches.set(ref.id, { recipeId: match.candidate.id, exact: match.exact });
    } else if (ref.rawRecipeId) {
      unsettled.push(ref);
    }
  }

  if (unsettled.length > 0) {
    const rawIndexesById = new Map<string, number[]>();
    await Promise.all(
      unsettled.map(async (ref) => {
        const rawId = ref.rawRecipeId;
        if (!rawId) {
          return;
        }
        const bucketIdx = hashPartitionKey(rawId, meta.recipeIdBucketCount);
        const bucket = await loadRecipeIdBucket(versionId, bucketIdx);
        rawIndexesById.set(rawId, bucket.extractProp<number[]>(rawId) ?? []);
      }),
    );
    const rawCandidatesByIndex = await loadPartitionedRecipeBodies(
      versionId,
      meta,
      [...rawIndexesById.values()].flat(),
    );
    for (const ref of unsettled) {
      const match = pickRecipeRefMatch(
        ref,
        (rawIndexesById.get(ref.rawRecipeId ?? "") ?? [])
          .map((recipeIndex) => rawCandidatesByIndex.get(recipeIndex))
          .filter((recipe): recipe is Recipe => recipe !== undefined),
      );
      if (match && match.score >= RECIPE_REF_MIGRATION_SCORE) {
        matches.set(ref.id, { recipeId: match.candidate.id, exact: match.exact });
      }
    }
  }

  return refs.flatMap((ref) => {
    const match = matches.get(ref.id);
    return match ? [{ importedId: ref.id, ...match }] : [];
  });
}

async function listPartitionedMapRecipes(versionId: string, recipeMap: string) {
  const [meta, arrays] = await Promise.all([
    loadPartitionMeta(versionId),
    loadRecipeMetaArrays(versionId),
  ]);
  const mapId = meta.lookupRecipeMaps.indexOf(recipeMap);
  if (mapId === -1) {
    return [];
  }
  const recipeIndexes: number[] = [];
  for (let recipeIndex = 0; recipeIndex < arrays.recipeCount; recipeIndex += 1) {
    if (arrays.recipeMapIdsByRecipeIndex[recipeIndex] === mapId) {
      recipeIndexes.push(recipeIndex);
    }
  }
  const summariesMap = await getPartitionedRecipeSummariesByIndexMap(
    versionId,
    meta,
    recipeIndexes,
  );
  const recipes = recipeIndexes
    .map((idx) => summariesMap.get(idx))
    .filter((summary): summary is RecipeSummary => Boolean(summary));
  recipes.sort((left, right) => left.name.localeCompare(right.name));
  return recipes;
}

export async function listPartitionedDatasetCropFarmRecipes(versionId: string) {
  return { crops: await listPartitionedMapRecipes(versionId, "Crop Farm") };
}

export async function listPartitionedDatasetEecMobs(versionId: string) {
  return { mobs: await listPartitionedMapRecipes(versionId, EEC_MACHINE_TYPE) };
}

// ---------------------------------------------------------------------------
// Partitioned Recipe Query Engine
// ---------------------------------------------------------------------------

function normalizedRecipeQueryClauses(request: DatasetRecipeQueryRequest): RecipeQueryClause[] {
  if (request.clauses?.length) {
    return request.clauses.slice(0, MAX_RECIPE_QUERY_CLAUSES);
  }
  if (request.resource) {
    return [
      {
        kind: request.resource.kind,
        id: request.resource.id,
        role: request.mode === "uses" ? "takes" : "makes",
      },
    ];
  }
  return [];
}

function unionRecipesByMap(
  left: Map<number, number[]>,
  right: Map<number, number[]>,
): Map<number, number[]> {
  const merged = new Map(left);
  for (const [recipeMapId, recipeIndexes] of right) {
    const existing = merged.get(recipeMapId);
    merged.set(
      recipeMapId,
      existing ? [...new Set([...existing, ...recipeIndexes])] : recipeIndexes,
    );
  }
  return merged;
}

function intersectRecipesByMap(
  left: Map<number, number[]>,
  right: Map<number, number[]>,
): Map<number, number[]> {
  const merged = new Map<number, number[]>();
  for (const [recipeMapId, recipeIndexes] of left) {
    const other = right.get(recipeMapId);
    if (!other) {
      continue;
    }
    const keep = new Set(other);
    const kept = recipeIndexes.filter((recipeIndex) => keep.has(recipeIndex));
    if (kept.length > 0) {
      merged.set(recipeMapId, kept);
    }
  }
  return merged;
}

function getTierIndex(tier: Exclude<MachineTier, "DEMO">): number {
  const index = GT_VOLTAGE_TIERS.findIndex((entry) => entry.tier === tier);
  return index === -1 ? GT_VOLTAGE_TIERS.length - 1 : index;
}

function tierFilteredByMap(
  tierIndexes: Uint8Array,
  recipesByMap: Map<number, number[]>,
  maxTier: TierFilter,
): Map<number, number[]> {
  if (maxTier === "all") {
    return recipesByMap;
  }
  const maxTierIdx = getTierIndex(maxTier);
  const filtered = new Map<number, number[]>();
  for (const [recipeMapId, recipeIndexes] of recipesByMap) {
    const candidates = recipeIndexes.filter(
      (recipeIndex) => (tierIndexes[recipeIndex] ?? GT_VOLTAGE_TIERS.length - 1) <= maxTierIdx,
    );
    if (candidates.length > 0) {
      filtered.set(recipeMapId, candidates);
    }
  }
  return filtered;
}

const ONLY_VERIFY_LIMIT = 5000;

function hasOnlySide(
  clauses: RecipeQueryClause[],
  ops: { takesOp?: RecipeQuerySideOp; makesOp?: RecipeQuerySideOp },
): boolean {
  return (
    (ops.takesOp === "only" && clauses.some((clause) => clause.role === "takes")) ||
    (ops.makesOp === "only" && clauses.some((clause) => clause.role === "makes"))
  );
}

function slotSatisfiedByClauses(slot: ResourceAmount, sideClauses: RecipeQueryClause[]): boolean {
  return sideClauses.some(
    (clause) =>
      (slot.kind === clause.kind && slot.id === clause.id) ||
      resourceMatchesInput({ kind: clause.kind, id: clause.id }, slot),
  );
}

function recipeIsOnlyMatch(
  summary: RecipeSummary,
  clauses: RecipeQueryClause[],
  ops: { takesOp?: RecipeQuerySideOp; makesOp?: RecipeQuerySideOp },
): boolean {
  if (ops.makesOp === "only") {
    const makesClauses = clauses.filter((clause) => clause.role === "makes");
    if (
      makesClauses.length > 0 &&
      !summary.outputs.every((output) => slotSatisfiedByClauses(output, makesClauses))
    ) {
      return false;
    }
  }
  if (ops.takesOp === "only") {
    const takesClauses = clauses.filter((clause) => clause.role === "takes");
    if (
      takesClauses.length > 0 &&
      !summary.inputs.every(
        (input) => !isRecipeInputConsumed(input) || slotSatisfiedByClauses(input, takesClauses),
      )
    ) {
      return false;
    }
  }
  return true;
}

function flattenRecipeIndexes(recipesByMap: Map<number, number[]>): number[] {
  return [...new Set([...recipesByMap.values()].flat())];
}

function isRecipeMapSelected(
  selection: RecipeMapSelection | undefined,
  recipeMap: string | undefined,
): boolean {
  if (!selection || !recipeMap) {
    return true;
  }
  const listed = selection.maps.includes(recipeMap);
  return selection.mode === "exclude" ? !listed : listed;
}

interface RankedRecipe {
  recipeIndex: number;
  score: number;
  iconScore: number;
  focus?: number;
  bulk?: number;
}

function rankRecipes(matches: RankedRecipe[]): RankedRecipe[] {
  return [...matches].sort(
    (left, right) =>
      Number(right.iconScore > 0) - Number(left.iconScore > 0) ||
      right.score - left.score ||
      (right.focus ?? 0) - (left.focus ?? 0) ||
      (left.bulk ?? 0) - (right.bulk ?? 0) ||
      right.iconScore - left.iconScore ||
      left.recipeIndex - right.recipeIndex,
  );
}

function orderByRecipeMapLocal<T extends { recipeIndex: number }>(
  ranked: T[],
  recipeMapOf: (recipeIndex: number) => string | undefined,
  recipeMaps: string[],
): T[] {
  const position = new Map(recipeMaps.map((recipeMap, index) => [recipeMap, index]));
  const place = (match: T) => {
    const recipeMap = recipeMapOf(match.recipeIndex);
    return (recipeMap === undefined ? undefined : position.get(recipeMap)) ?? recipeMaps.length;
  };
  return [...ranked].sort((left, right) => place(left) - place(right));
}

function recipeFocusScore(summary: RecipeSummary, clauses: RecipeQueryClause[]): number {
  const makesClauses = clauses.filter((clause) => clause.role === "makes");
  const takesClauses = clauses.filter((clause) => clause.role === "takes");
  let total = 0;
  let sides = 0;
  if (makesClauses.length > 0 && summary.outputs.length > 0) {
    const matched = summary.outputs.filter((output) =>
      slotSatisfiedByClauses(output, makesClauses),
    ).length;
    total += matched / summary.outputs.length;
    sides += 1;
  }
  if (takesClauses.length > 0) {
    const consumed = summary.inputs.filter(isRecipeInputConsumed);
    if (consumed.length > 0) {
      const matched = consumed.filter((input) => slotSatisfiedByClauses(input, takesClauses)).length;
      total += matched / consumed.length;
      sides += 1;
    }
  }
  return sides > 0 ? total / sides : 0;
}

function resourceIdsAreCompatibleLocal(candidateId: string, selectedId: string): boolean {
  if (candidateId === selectedId) {
    return true;
  }
  if (!candidateId.endsWith("@32767")) {
    return false;
  }
  const wildcardBaseId = candidateId.slice(0, -"@32767".length);
  return selectedId === wildcardBaseId || selectedId.startsWith(`${wildcardBaseId}@`);
}

function isContextCompatibleItemInputLocal(
  input: ResourceAmount,
  selected: DatasetResource | DatasetResourceIndexEntry,
): boolean {
  if (input.kind !== selected.kind || input.kind !== "item") {
    return false;
  }
  if (!isOreDictionaryResource(input)) {
    return resourceIdsAreCompatibleLocal(input.id, selected.id);
  }
  const oreDictionaryName = input.id.slice("oredict:".length);
  return Boolean(
    input.alternatives?.some((alternative) =>
      resourceIdsAreCompatibleLocal(alternative.id, selected.id),
    ) || selected.oreDictionary?.includes(oreDictionaryName),
  );
}

function applyClauseResourceContextsLocal<T extends RecipeSummary>(
  recipe: T,
  clauseResourcesByKey: Map<string, DatasetResource | DatasetResourceIndexEntry>,
  clauses: RecipeQueryClause[],
): T {
  let contextualized = recipe;
  for (const clause of clauses) {
    if (clause.kind !== "item" || isOreDictionaryResource(clause)) {
      continue;
    }
    const selected = clauseResourcesByKey.get(`${clause.kind}:${clause.id}`);
    if (!selected) {
      continue;
    }
    let changed = false;
    const inputs = contextualized.inputs.map((input) => {
      if (!isContextCompatibleItemInputLocal(input, selected)) {
        return input;
      }
      changed = true;
      return {
        ...input,
        id: selected.id,
        displayName: selected.displayName ?? input.displayName,
        iconPath: selected.iconPath ?? input.iconPath,
        iconAtlas: selected.iconAtlas ?? input.iconAtlas,
        dominantColor: selected.dominantColor ?? input.dominantColor,
        tooltip: "tooltip" in selected ? selected.tooltip : undefined,
        alternatives: undefined,
        oreDictionary: undefined,
      };
    });
    if (changed) {
      contextualized = { ...contextualized, inputs };
    }
  }
  return contextualized;
}

const CODE_PREC = [0, 0.5, 0.78, 1.0] as const;

export async function queryPartitionedDatasetRecipes(
  versionId: string,
  request: DatasetRecipeQueryRequest,
) {
  const [meta, arrays] = await Promise.all([
    loadPartitionMeta(versionId),
    loadRecipeMetaArrays(versionId),
  ]);
  const clauses = normalizedRecipeQueryClauses(request);
  const bilingual = bilingualSearch(request.query);
  const baseParsed = parseSearchQuery(bilingual?.text ?? request.query);
  const pinyinIndex = await createScopedPinyinIndex(
    versionId,
    meta.pinyinBucketCount,
    request.query,
    baseParsed,
  );
  const parsedQuery = withPinyinSearch(baseParsed, () => pinyinIndex, request.query);

  if (clauses.length === 0 && parsedQuery.terms.length === 0) {
    return {
      recipes: [],
      total: 0,
      recipeMaps: [],
      recipeMapCounts: {},
      recipeMapIcons: {},
      offset: request.offset,
      limit: request.limit,
      hasMore: false,
    };
  }

  let scopedByMap: Map<number, number[]> | undefined;
  if (clauses.length > 0) {
    const sides: Array<Map<number, number[]>> = [];
    for (const role of ["takes", "makes"] as const) {
      const sideClauses = clauses.filter((clause) => clause.role === role);
      if (sideClauses.length === 0) {
        continue;
      }
      const op = (role === "takes" ? request.takesOp : request.makesOp) ?? "any";
      const perClause = await Promise.all(
        sideClauses.map(async (clause) => {
          const mode = recipeQueryClauseMode(clause.role);
          const scopedResources = await resolvePartitionedResourceScope(
            versionId,
            meta,
            clause,
            mode,
          );
          return loadLookupEntriesForScopedResources(versionId, meta, scopedResources, mode);
        }),
      );
      sides.push(perClause.reduce(op === "any" ? unionRecipesByMap : intersectRecipesByMap));
    }
    scopedByMap = tierFilteredByMap(
      arrays.tierIndexes,
      sides.reduce(intersectRecipesByMap),
      request.maxTier,
    );
    if (hasOnlySide(clauses, request)) {
      const candidates = flattenRecipeIndexes(scopedByMap);
      if (candidates.length > 0 && candidates.length <= ONLY_VERIFY_LIMIT) {
        const summaries = await getPartitionedRecipeSummariesByIndexMap(
          versionId,
          meta,
          candidates,
        );
        const filtered = new Map<number, number[]>();
        for (const [recipeMapId, recipeIndexes] of scopedByMap) {
          const kept = recipeIndexes.filter((recipeIndex) => {
            const summary = summaries.get(recipeIndex);
            return !summary || recipeIsOnlyMatch(summary, clauses, request);
          });
          if (kept.length > 0) {
            filtered.set(recipeMapId, kept);
          }
        }
        scopedByMap = filtered;
      }
    }
  }

  const scopedSet = scopedByMap ? new Set(flattenRecipeIndexes(scopedByMap)) : undefined;

  let resolved: {
    query: SearchQuery;
    phase: SearchPhase;
    searchScores: Map<number, number> | undefined;
  };

  if (parsedQuery.terms.length === 0) {
    resolved = {
      query: parsedQuery,
      phase: "exact",
      searchScores: bilingual?.unresolved ? new Map<number, number>() : undefined,
    };
  } else {
    const hasCorrectable = parsedQuery.terms.some((t) => t.correctable && t.variants.length <= 8);
    const needsVocabulary = hasCorrectable || Boolean(bilingual?.alternatives?.length);
    const [recipeVocab, resourceBundle] = await Promise.all([
      loadRecipeVocabBundle(versionId),
      needsVocabulary ? loadResourceSearchBundle(versionId) : Promise.resolve(undefined),
    ]);
    const vocabulary =
      resourceBundle?.vocabulary ?? buildVocabularyFromPrecomputed([], []);
    const correctedPreview = hasCorrectable
      ? withSearchCorrections(parsedQuery, searchCorrector(vocabulary))
      : parsedQuery;
    const altQueries = (bilingual?.alternatives ?? [])
      .map((alt) => {
        const q = parseSearchQuery(alt);
        return [q, withSearchCorrections(q, searchCorrector(vocabulary))];
      })
      .flat();

    const typedTokens = new Set<string>();
    for (const q of [baseParsed, ...altQueries]) {
      for (const term of q.terms) {
        for (const variant of term.variants) {
          for (const tok of variant.tokens) {
            typedTokens.add(tok);
          }
        }
      }
    }
    const allQueryTokens = new Set<string>(typedTokens);
    for (const q of [parsedQuery, correctedPreview]) {
      for (const term of q.terms) {
        for (const variant of term.variants) {
          for (const tok of variant.tokens) {
            allQueryTokens.add(tok);
          }
        }
      }
    }

    const qTokenMatches = new Map<
      string,
      { exact: number[]; prefix: number[]; contains: number[]; byteLen: number }
    >();
    const neededChunks = new Set<number>();
    const tokensPerChunk = meta.recipeTokensPerChunk;

    const rawVocabMatches = matchQueryTokensInVocab(
      allQueryTokens,
      recipeVocab.tokens,
      undefined,
      typedTokens,
      recipeVocab.tokenIndexByWord,
    );
    for (const [qt, m] of rawVocabMatches) {
      qTokenMatches.set(qt, { ...m, byteLen: 0 });
      for (const tid of [...m.exact, ...m.prefix, ...m.contains]) {
        neededChunks.add(Math.floor(tid / tokensPerChunk));
      }
    }

    const chunksByIndex = new Map<number, ReturnType<typeof unpackPostingsBuffer>>();
    await Promise.all(
      [...neededChunks].map(async (chunkIndex) => {
        chunksByIndex.set(chunkIndex, await loadRecipeTokenBucket(versionId, chunkIndex));
      }),
    );

    for (const info of qTokenMatches.values()) {
      let bytes = 0;
      for (const group of [info.exact, info.prefix, info.contains]) {
        for (let i = 0; i < group.length; i += 1) {
          const tid = group[i];
          const chunk = chunksByIndex.get(Math.floor(tid / tokensPerChunk));
          if (chunk) {
            const localTid = tid % tokensPerChunk;
            bytes += chunk.offsets[localTid + 1] - chunk.offsets[localTid];
          }
        }
      }
      info.byteLen = bytes;
    }

    const recipeCount = meta.recipeCount;
    const decodedRecipeTokenCache = new Map<
      string,
      { entries: Int32Array; codes: Uint8Array; count: number }
    >();
    const rScratch = getRecipeScratch(recipeCount);
    const {
      recipeScratchStamp,
      recipeScratchCode,
      recipeScratchEntries,
      termBest,
      termStamp,
      totalScores,
      matchedTermsCount,
      poolArrays: recipePoolArrays,
    } = rScratch;

    const getDecodedRecipeTokenMatches = (qt: string) => {
      const cached = decodedRecipeTokenCache.get(qt);
      if (cached) {
        return cached;
      }
      const info = qTokenMatches.get(qt);
      rScratch.scratchGen = (rScratch.scratchGen + 1) | 0;
      const gen = rScratch.scratchGen;
      let count = 0;

      if (info && info.byteLen > 0) {
        for (const [group, code] of [
          [info.exact, 3],
          [info.prefix, 2],
          [info.contains, 1],
        ] as const) {
          for (let g = 0; g < group.length; g += 1) {
            const tid = group[g];
            const chunk = chunksByIndex.get(Math.floor(tid / tokensPerChunk));
            if (!chunk) continue;
            const localTid = tid % tokensPerChunk;
            const startOff = chunk.offsets[localTid];
            const endOff = chunk.offsets[localTid + 1];
            let prev = 0;
            let pos = startOff;
            while (pos < endOff) {
              let shift = 0;
              let delta = 0;
              while (pos < endOff) {
                const byte = chunk.data[pos++];
                delta |= (byte & 0x7f) << shift;
                if ((byte & 0x80) === 0) break;
                shift += 7;
              }
              prev = (prev + delta) | 0;
              if (scopedSet && !scopedSet.has(prev)) continue;
              if (recipeScratchStamp[prev] !== gen) {
                recipeScratchStamp[prev] = gen;
                recipeScratchCode[prev] = code;
                recipeScratchEntries[count++] = prev;
              } else if (code > recipeScratchCode[prev]) {
                recipeScratchCode[prev] = code;
              }
            }
          }
        }
      }

      const entries = new Int32Array(count);
      const codes = new Uint8Array(count);
      for (let i = 0; i < count; i += 1) {
        const r = recipeScratchEntries[i];
        entries[i] = r;
        codes[i] = recipeScratchCode[r];
      }
      const res = { entries, codes, count };
      decodedRecipeTokenCache.set(qt, res);
      return res;
    };

    const MAX_RECIPE_TOKEN_ARRAYS = recipePoolArrays.length;
    const tokenArrayCache = new Map<
      string,
      { arr: Uint8Array; decoded: ReturnType<typeof getDecodedRecipeTokenMatches> }
    >();
    const getTokenCodeArray = (qt: string): Uint8Array => {
      const existing = tokenArrayCache.get(qt);
      if (existing) {
        tokenArrayCache.delete(qt);
        tokenArrayCache.set(qt, existing);
        return existing.arr;
      }
      let arr: Uint8Array;
      if (tokenArrayCache.size >= MAX_RECIPE_TOKEN_ARRAYS) {
        const oldestKey = tokenArrayCache.keys().next().value!;
        const oldest = tokenArrayCache.get(oldestKey)!;
        tokenArrayCache.delete(oldestKey);
        arr = oldest.arr;
        for (let i = 0; i < oldest.decoded.count; i += 1) {
          arr[oldest.decoded.entries[i]] = 0;
        }
      } else {
        arr = recipePoolArrays[tokenArrayCache.size];
      }
      const decoded = getDecodedRecipeTokenMatches(qt);
      for (let i = 0; i < decoded.count; i += 1) {
        arr[decoded.entries[i]] = decoded.codes[i];
      }
      tokenArrayCache.set(qt, { arr, decoded });
      return arr;
    };

    const runRecipeQuery = (
      query: SearchQuery,
      options: { partial?: boolean },
    ): RankedRecipe[] => {
      if (query.terms.length === 0) {
        return [];
      }
      const candidateRecipes: number[] = [];

      for (const term of query.terms) {
        const byAnchor = new Map<string, typeof term.variants>();
        for (const v of term.variants) {
          if (v.tokens.length === 0) continue;
          let anchor = v.tokens[0];
          let minB = qTokenMatches.get(anchor)?.byteLen ?? 0;
          for (let i = 1; i < v.tokens.length; i += 1) {
            const b = qTokenMatches.get(v.tokens[i])?.byteLen ?? 0;
            if (b < minB) {
              minB = b;
              anchor = v.tokens[i];
            }
          }
          if (minB === 0) continue;
          let list = byAnchor.get(anchor);
          if (!list) {
            list = [];
            byAnchor.set(anchor, list);
          }
          list.push(v);
        }

        rScratch.scratchGen = (rScratch.scratchGen + 1) | 0;
        const scoreStamp = rScratch.scratchGen;
        const touched: number[] = [];

        for (const [anchor, vars] of byAnchor) {
          const anchorDecoded = getDecodedRecipeTokenMatches(anchor);
          if (anchorDecoded.count === 0) continue;

          let singleWeight = 0;
          for (let vi = 0; vi < vars.length; vi += 1) {
            const v = vars[vi];
            if (v.tokens.length === 1 && v.weight > singleWeight) {
              singleWeight = v.weight;
            }
          }
          if (singleWeight > 0) {
            for (let i = 0; i < anchorDecoded.count; i += 1) {
              const r = anchorDecoded.entries[i];
              const s = CODE_PREC[anchorDecoded.codes[i]] * singleWeight;
              if (termStamp[r] !== scoreStamp) {
                termStamp[r] = scoreStamp;
                termBest[r] = s;
                touched.push(r);
              } else if (s > termBest[r]) {
                termBest[r] = s;
              }
            }
          }

          for (let vi = 0; vi < vars.length; vi += 1) {
            const v = vars[vi];
            if (v.tokens.length <= 1) continue;
            const vWeight = v.weight;
            if (v.tokens.length === 2) {
              const otherTok = v.tokens[0] === anchor ? v.tokens[1] : v.tokens[0];
              let otherArr: Uint8Array | undefined;
              for (let i = 0; i < anchorDecoded.count; i += 1) {
                const r = anchorDecoded.entries[i];
                const prevBest = termStamp[r] === scoreStamp ? termBest[r] : 0;
                const anchorCode = anchorDecoded.codes[i];
                if (CODE_PREC[anchorCode] * vWeight <= prevBest) continue;
                if (!otherArr) otherArr = getTokenCodeArray(otherTok);
                const otherCode = otherArr[r];
                if (otherCode === 0) continue;
                const minCode = otherCode < anchorCode ? otherCode : anchorCode;
                const s = CODE_PREC[minCode] * vWeight;
                if (s > prevBest) {
                  if (termStamp[r] !== scoreStamp) {
                    termStamp[r] = scoreStamp;
                    touched.push(r);
                  }
                  termBest[r] = s;
                }
              }
            } else {
              const otherTokens = v.tokens
                .filter((tok) => tok !== anchor)
                .sort(
                  (a, b) =>
                    (qTokenMatches.get(a)?.byteLen ?? 0) - (qTokenMatches.get(b)?.byteLen ?? 0),
                );
              const oLen = otherTokens.length;
              for (let i = 0; i < anchorDecoded.count; i += 1) {
                const r = anchorDecoded.entries[i];
                const prevBest = termStamp[r] === scoreStamp ? termBest[r] : 0;
                let minCode = anchorDecoded.codes[i];
                if (CODE_PREC[minCode] * vWeight <= prevBest) continue;
                for (let ti = 0; ti < oLen; ti += 1) {
                  const c = getTokenCodeArray(otherTokens[ti])[r];
                  if (c < minCode) {
                    minCode = c;
                    if (CODE_PREC[minCode] * vWeight <= prevBest) {
                      minCode = 0;
                      break;
                    }
                  }
                }
                if (minCode > 0) {
                  const s = CODE_PREC[minCode] * vWeight;
                  if (s > prevBest) {
                    if (termStamp[r] !== scoreStamp) {
                      termStamp[r] = scoreStamp;
                      touched.push(r);
                    }
                    termBest[r] = s;
                  }
                }
              }
            }
          }
        }

        for (let i = 0; i < touched.length; i += 1) {
          const r = touched[i];
          if (matchedTermsCount[r] === 0) {
            candidateRecipes.push(r);
          }
          matchedTermsCount[r] += 1;
          totalScores[r] += termBest[r];
        }
      }

      const requiredTerms = options.partial ? 1 : query.terms.length;
      const matches: RankedRecipe[] = [];
      for (let i = 0; i < candidateRecipes.length; i += 1) {
        const recipeIndex = candidateRecipes[i];
        const matched = matchedTermsCount[recipeIndex];
        if (matched < requiredTerms) {
          continue;
        }
        let score = totalScores[recipeIndex];
        if (options.partial) {
          score += matched * PARTIAL_TERM_BONUS;
        }
        matches.push({ recipeIndex, score, iconScore: 0 });
      }
      for (let i = 0; i < candidateRecipes.length; i += 1) {
        const r = candidateRecipes[i];
        totalScores[r] = 0;
        matchedTermsCount[r] = 0;
      }
      return matches;
    };

    let phaseResolved = resolveSearchPhases(parsedQuery, vocabulary, runRecipeQuery);
    if (bilingual && phaseResolved.results.length === 0) {
      for (const alternative of bilingual.alternatives) {
        const attempt = resolveSearchPhases(
          parseSearchQuery(alternative),
          vocabulary,
          runRecipeQuery,
        );
        if (attempt.results.length > 0) {
          phaseResolved = attempt;
          break;
        }
      }
    }
    for (const { arr, decoded } of tokenArrayCache.values()) {
      for (let i = 0; i < decoded.count; i += 1) {
        arr[decoded.entries[i]] = 0;
      }
    }

    resolved = {
      query: phaseResolved.query,
      phase: phaseResolved.phase,
      searchScores: new Map(
        phaseResolved.results.map((match) => [match.recipeIndex, match.score]),
      ),
    };
  }

  const searchScores = resolved.searchScores;
  const groupRecipesByMapLocal = (recipeIndexes: Iterable<number>): Map<number, number[]> => {
    const byMap = new Map<number, number[]>();
    for (const recipeIndex of recipeIndexes) {
      const recipeMapId = arrays.recipeMapIdsByRecipeIndex[recipeIndex] ?? -1;
      if (recipeMapId < 0) continue;
      const existing = byMap.get(recipeMapId);
      if (existing) {
        existing.push(recipeIndex);
      } else {
        byMap.set(recipeMapId, [recipeIndex]);
      }
    }
    return byMap;
  };

  const tierCandidatesByMap =
    scopedByMap ??
    tierFilteredByMap(
      arrays.tierIndexes,
      groupRecipesByMapLocal(searchScores?.keys() ?? []),
      request.maxTier,
    );

  const countedRecipeMaps = [...tierCandidatesByMap.entries()]
    .map(([recipeMapId, recipeIndexes]) => {
      const recipeMap = meta.lookupRecipeMaps[recipeMapId];
      if (!recipeMap) {
        return undefined;
      }
      const count = searchScores
        ? recipeIndexes.filter((recipeIndex) => searchScores.has(recipeIndex)).length
        : recipeIndexes.length;
      return count > 0 ? { recipeMap, count } : undefined;
    })
    .filter((entry): entry is { recipeMap: string; count: number } => Boolean(entry))
    .sort((a, b) => a.recipeMap.localeCompare(b.recipeMap));

  const sortedRecipeMaps = countedRecipeMaps.map((entry) => entry.recipeMap);
  const recipeMapCounts = Object.fromEntries(
    countedRecipeMaps.map((entry) => [entry.recipeMap, entry.count]),
  );

  const effectiveMap = request.allMaps
    ? undefined
    : request.recipeMap && sortedRecipeMaps.includes(request.recipeMap)
      ? request.recipeMap
      : sortedRecipeMaps[0];
  const effectiveMapId = effectiveMap ? meta.lookupRecipeMaps.indexOf(effectiveMap) : undefined;

  const selectedByMap = request.mapSelection
    ? new Map(
        [...tierCandidatesByMap.entries()].filter(([recipeMapId]) =>
          isRecipeMapSelected(request.mapSelection, meta.lookupRecipeMaps[recipeMapId]),
        ),
      )
    : tierCandidatesByMap;

  const scopedCandidates =
    effectiveMapId !== undefined && effectiveMapId >= 0
      ? (tierCandidatesByMap.get(effectiveMapId) ?? [])
      : flattenRecipeIndexes(selectedByMap);

  const matching: RankedRecipe[] = [];
  for (const recipeIndex of scopedCandidates) {
    if (searchScores && !searchScores.has(recipeIndex)) {
      continue;
    }
    matching.push({
      recipeIndex,
      score: searchScores?.get(recipeIndex) ?? 0,
      iconScore: arrays.iconScores[recipeIndex] ?? 0,
    });
  }

  let focusScored = matching;
  if (
    clauses.length > 0 &&
    matching.length > 0 &&
    matching.length <= ONLY_VERIFY_LIMIT
  ) {
    const summaries = await getPartitionedRecipeSummariesByIndexMap(
      versionId,
      meta,
      matching.map((m) => m.recipeIndex),
    );
    focusScored = matching.map((match) => {
      const summary = summaries.get(match.recipeIndex);
      if (!summary) {
        return match;
      }
      return {
        ...match,
        focus: recipeFocusScore(summary, clauses),
        bulk: summary.inputs.filter(isRecipeInputConsumed).length + summary.outputs.length,
      };
    });
  }

  const ranked = rankRecipes(focusScored);
  const pageRecipeIndexes = (
    request.allMaps
      ? orderByRecipeMapLocal(
          ranked,
          (recipeIndex) => meta.lookupRecipeMaps[arrays.recipeMapIdsByRecipeIndex[recipeIndex] ?? -1],
          sortedRecipeMaps,
        )
      : ranked
  )
    .slice(request.offset, request.offset + request.limit)
    .map((match) => match.recipeIndex);

  const [summariesMap, clauseResourcesByKey] = await Promise.all([
    getPartitionedRecipeSummariesByIndexMap(versionId, meta, pageRecipeIndexes),
    clauses.length > 0
      ? loadResourcesByKeys(
          versionId,
          meta,
          clauses.map((c) => `${c.kind}:${c.id}`),
        )
      : Promise.resolve(new Map<string, DatasetResource | DatasetResourceIndexEntry>()),
  ]);

  const recipes = pageRecipeIndexes
    .map((recipeIndex) => summariesMap.get(recipeIndex))
    .filter((summary): summary is RecipeSummary => Boolean(summary))
    .map((recipe) => applyClauseResourceContextsLocal(recipe, clauseResourcesByKey, clauses));

  const recipeMapIcons: Record<string, DatasetResourceIndexEntry> = {};
  for (const recipeMap of sortedRecipeMaps) {
    const icon = meta.resolvedRecipeMapIcons[recipeMap];
    if (icon) {
      recipeMapIcons[recipeMap] = icon;
    }
  }

  return {
    recipes,
    total: matching.length,
    recipeMaps: sortedRecipeMaps,
    recipeMapCounts,
    recipeMapIcons,
    offset: request.offset,
    limit: request.limit,
    hasMore: request.offset + request.limit < matching.length,
    ...searchOutcome(resolved),
  };
}

export async function prewarmPartitionedDatasetVersion(versionId: string): Promise<void> {
  await Promise.all([
    loadPartitionMeta(versionId),
    loadRecipeMetaArrays(versionId),
    loadResourceSearchBundle(versionId),
    loadRecipeVocabBundle(versionId),
  ]);
}
