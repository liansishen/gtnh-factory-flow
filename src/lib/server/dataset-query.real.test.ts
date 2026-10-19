// The real resource and recipe queries over a small RC-2 dataset fixture.
//
// The server reads the published dataset through `node:fs/promises`, so this
// test mocks ONLY that I/O and serves genuine gzipped JSON in the exact file
// shapes the loader expects (manifest, resource index, recipe index, lookup
// index, recipe shard). Every other part of the query - the tokenizer, the
// trigram index, the ranking, the bilingual planning - is the shipped code, and
// the sample ids and names are taken from the local RC-2 export.
import { describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => {
  const { gzipSync } = (
    process as unknown as { getBuiltinModule: (id: string) => unknown }
  ).getBuiltinModule("node:zlib") as typeof import("node:zlib");
  const gz = (value: unknown) => gzipSync(Buffer.from(JSON.stringify(value), "utf8"));

  const versionId = "local-2.9.0-rc-2";
  const fallbackVersionId = "local-2.9.0-rc-2-nolookup";
  const base = "/datasets/gtnh/local-2.9.0-rc-2";
  const shardPath = `${base}/recipes-shards/shard-0000.json.gz`;
  const rendered = `${base}/textures/rendered`;
  const sourceInfo = {
    sourceId: "gtnh-oracle",
    sourceVersion: "dev.gtnhplanner.oracle.v1",
    generatedAt: "2026-10-16T21:32:37.292Z",
  };

  // Real RC-2 ids and display names.
  const resourceIndex = [
    {
      kind: "item",
      id: "gregtech:gt.metaitem.01@17305",
      displayName: "Steel Plate",
      iconPath: `${rendered}/steel_plate-c6cc2f3ecfae.png`,
      dominantColor: "#323232",
      recipeCount: 163,
    },
    {
      kind: "item",
      id: "gregtech:gt.metaitem.01@11305",
      displayName: "Steel Ingot",
      iconPath: `${rendered}/steel_ingot-bc20fcddb4f8.png`,
      dominantColor: "#222222",
      recipeCount: 770,
    },
    {
      kind: "item",
      id: "gregtech:gt.metaitem.02@31305",
      displayName: "Steel Gear",
      iconPath: `${rendered}/steel_gear-d5276fd77b30.png`,
      dominantColor: "#292929",
      recipeCount: 26,
    },
    {
      kind: "item",
      id: "gregtech:gt.metaitem.01@23305",
      displayName: "Steel Rod",
      iconPath: `${rendered}/steel_rod-28b9aaaad577.png`,
      dominantColor: "#2e2e2e",
      recipeCount: 187,
    },
    {
      kind: "item",
      id: "gregtech:gt.blockmachines@301",
      displayName: "Basic Macerator",
      iconPath: `${rendered}/basic_macerator-09de5dcb8708.png`,
      dominantColor: "#5f5959",
      recipeCount: 6,
    },
    {
      kind: "item",
      id: "ic2:blockmachine@3",
      displayName: "Macerator",
      iconPath: `${rendered}/macerator-892766729788.png`,
      dominantColor: "#8a8f90",
      recipeCount: 1,
    },
    {
      kind: "item",
      id: "gregtech:gt.metaitem.01@2032",
      displayName: "Iron Dust",
      iconPath: `${rendered}/iron_dust-b076ec06aa8a.png`,
      dominantColor: "#747474",
      recipeCount: 1161,
    },
    {
      kind: "fluid",
      id: "oxygen",
      displayName: "Oxygen",
      iconPath: `${rendered}/oxygen-db4ce49a39d6.png`,
      dominantColor: "#00799e",
      recipeCount: 912,
    },
    {
      kind: "fluid",
      id: "water",
      displayName: "Water",
      iconPath: `${rendered}/water-496e39419600.png`,
      dominantColor: "#2c3ef4",
      recipeCount: 5710,
    },
    {
      kind: "item",
      id: "gregtech:gt.metaitem.01@99001",
      displayName: "Hint 1 dot",
      iconPath: `${rendered}/hint_1_dot-000000000001.png`,
      dominantColor: "#f5f5f5",
      recipeCount: 0,
    },
    {
      kind: "item",
      id: "gregtech:gt.metaitem.01@99002",
      displayName: "Casting Form (Bolt Mold)",
      iconPath: `${rendered}/casting_form_bolt_mold-000000000002.png`,
      dominantColor: "#8a8a8a",
      recipeCount: 0,
    },
    {
      kind: "item",
      id: "gregtech:gt.metaitem.01@99003",
      displayName: "Beet",
      iconPath: `${rendered}/beet-000000000003.png`,
      dominantColor: "#8b1a1a",
      recipeCount: 0,
    },
    {
      kind: "item",
      id: "gregtech:gt.metaitem.01@99004",
      displayName: "Tomato",
      iconPath: `${rendered}/tomato-000000000004.png`,
      dominantColor: "#c62828",
      recipeCount: 0,
    },
    {
      kind: "item",
      id: "gregtech:gt.metaitem.01@99005",
      displayName: "Beeswax",
      iconPath: `${rendered}/beeswax-000000000005.png`,
      dominantColor: "#e0b040",
      recipeCount: 0,
    },
  ];
  const resources = resourceIndex.map((entry) => ({
    kind: entry.kind,
    id: entry.id,
    displayName: entry.displayName,
    iconPath: entry.iconPath,
    dominantColor: entry.dominantColor,
    modId: entry.id.includes(":") ? entry.id.slice(0, entry.id.indexOf(":")) : undefined,
  }));

  // Real RC-2 recipes: one makes Steel Plate, one uses it.
  const makesSteelPlate = {
    id: "oracle:local-2.9.0-beta-2:gregtech:gt-recipe-alloysmelter:3134fe95649ac389",
    name: "Alloy Smelter: Steel Plate",
    kind: "gregtech_machine",
    category: "gregtech",
    machineType: "Alloy Smelter",
    recipeMap: "Alloy Smelter",
    minimumTier: "LV",
    durationTicks: 112,
    eut: 30,
    inputs: [
      {
        kind: "item",
        id: "gregtech:gt.metaitem.01@11305",
        amount: 2,
        displayName: "Steel Ingot",
        iconPath: `${rendered}/steel_ingot-bc20fcddb4f8.png`,
        dominantColor: "#222222",
        modId: "gregtech",
      },
      { kind: "item", id: "gregtech:gt.metaitem.01@32301", amount: 1, displayName: "Mold (Plate)" },
    ],
    outputs: [
      {
        kind: "item",
        id: "gregtech:gt.metaitem.01@17305",
        amount: 1,
        displayName: "Steel Plate",
        iconPath: `${rendered}/steel_plate-c6cc2f3ecfae.png`,
        dominantColor: "#323232",
        modId: "gregtech",
      },
    ],
    source: {
      datasetVersionId: versionId,
      recipeMap: "Alloy Smelter",
      exporter: "gtnh-oracle",
      rawRecipeId: "gt.recipe.alloysmelter:3134fe95649ac389",
    },
  };
  const usesSteelPlate = {
    id: "oracle:local-2.9.0-beta-2:gregtech:gt-recipe-arcfurnace:eb49c726e6d78a40",
    name: "Arc Furnace: Steel Ingot",
    kind: "gregtech_machine",
    category: "gregtech",
    machineType: "Arc Furnace",
    recipeMap: "Arc Furnace",
    minimumTier: "LV",
    durationTicks: 70,
    eut: 30,
    inputs: [
      {
        kind: "item",
        id: "gregtech:gt.metaitem.01@17305",
        amount: 1,
        displayName: "Steel Plate",
        iconPath: `${rendered}/steel_plate-c6cc2f3ecfae.png`,
        dominantColor: "#323232",
        modId: "gregtech",
      },
      {
        kind: "item",
        id: "gregtech:gt.integrated_circuit@1",
        amount: 1,
        displayName: "Programmed Circuit",
      },
    ],
    outputs: [
      {
        kind: "item",
        id: "gregtech:gt.metaitem.01@11305",
        amount: 1,
        displayName: "Steel Ingot",
        iconPath: `${rendered}/steel_ingot-bc20fcddb4f8.png`,
        dominantColor: "#222222",
        modId: "gregtech",
      },
    ],
    source: {
      datasetVersionId: versionId,
      recipeMap: "Arc Furnace",
      exporter: "gtnh-oracle",
      rawRecipeId: "gt.recipe.arcfurnace:eb49c726e6d78a40",
    },
  };
  const recipeMaps = ["Alloy Smelter", "Arc Furnace"];
  const searchText = [
    "alloy smelter: steel plate alloy smelter alloy smelter steel ingot steel ingot gregtech:gt.metaitem.01@11305 item mold (plate) mold (plate) gregtech:gt.metaitem.01@32301 item steel plate steel plate gregtech:gt.metaitem.01@17305 item",
    "arc furnace: steel ingot arc furnace arc furnace steel plate steel plate gregtech:gt.metaitem.01@17305 item programmed circuit programmed circuit gregtech:gt.integrated_circuit@1 item steel ingot steel ingot gregtech:gt.metaitem.01@11305 item",
  ];
  const shards = [{ id: "0", path: shardPath, start: 0, end: 2 }];

  const manifest = {
    schemaVersion: 1,
    latestStableVersion: versionId,
    versions: [
      {
        id: versionId,
        gtnhVersion: "2.9.0-RC-2",
        channel: "experimental",
        publishedAt: "2026-10-16T21:49:22.910Z",
        manifestPath: "/datasets/gtnh/datasets.manifest.json",
        recipeDatasetPath: `${base}/recipes.json.gz`,
        resourceIndexPath: `${base}/resource-index.json.gz`,
        recipeIndexPath: `${base}/recipe-index.json.gz`,
        recipeLookupIndexPath: `${base}/recipe-lookup-index.json.gz`,
        checksumSha256: "a306a680a7bccb28fa2a98fb627787fbc4f6ccd8eb73814e8d9f178cba171b74",
        sourceInfo,
      },
      {
        id: fallbackVersionId,
        gtnhVersion: "2.9.0-RC-2",
        channel: "experimental",
        publishedAt: "2026-10-16T21:49:22.911Z",
        manifestPath: "/datasets/gtnh/datasets.manifest.json",
        recipeDatasetPath: `${base}/recipes.json.gz`,
        resourceIndexPath: `${base}/resource-index.json.gz`,
        recipeIndexPath: `${base}/recipe-index.json.gz`,
        checksumSha256: "b306a680a7bccb28fa2a98fb627787fbc4f6ccd8eb73814e8d9f178cba171b75",
        sourceInfo,
      },
    ],
  };
  const resourceIndexFile = {
    schemaVersion: 1,
    datasetVersionId: versionId,
    gtnhVersion: "2.9.0-RC-2",
    sourceInfo,
    resources,
    resourceIndex,
    recipeMaps,
    recipeMapIcons: [],
    machineHandlerIcons: [],
    generatedAt: "2026-10-16T21:32:37.292Z",
    recipeCount: 2,
    shardSize: 250,
    shards,
  };
  const recipeIndexFile = {
    schemaVersion: 1,
    datasetVersionId: versionId,
    gtnhVersion: "2.9.0-RC-2",
    sourceInfo,
    recipeMaps,
    generatedAt: "2026-10-16T21:32:37.292Z",
    recipeCount: 2,
    shardSize: 250,
    shards,
    recipes: [makesSteelPlate, usesSteelPlate],
    searchText,
    tierIndexes: [1, 1],
    iconScores: [3, 3],
  };
  const lookupIndexFile = {
    schemaVersion: 1,
    datasetVersionId: versionId,
    recipeCount: 2,
    shards,
    recipeMaps,
    recipeIds: [makesSteelPlate.id, usesSteelPlate.id],
    tierIndexes: [1, 1],
    iconScores: [3, 3],
    searchText,
    entries: [
      ["recipes:item:gregtech:gt.metaitem.01@17305", [[0, [0]]]],
      ["uses:item:gregtech:gt.metaitem.01@17305", [[1, [1]]]],
      ["recipes:item:gregtech:gt.metaitem.01@11305", [[1, [1]]]],
      ["uses:item:gregtech:gt.metaitem.01@11305", [[0, [0]]]],
    ],
  };
  const shardFile = {
    schemaVersion: 1,
    datasetVersionId: versionId,
    shardIndex: 0,
    start: 0,
    end: 2,
    recipes: [makesSteelPlate, usesSteelPlate],
  };

  const manifestText = JSON.stringify(manifest);
  const files = new Map<string, Buffer>([
    [`datasets/gtnh/${versionId}/resource-index.json.gz`, gz(resourceIndexFile)],
    [`datasets/gtnh/${versionId}/recipe-index.json.gz`, gz(recipeIndexFile)],
    [`datasets/gtnh/${versionId}/recipe-lookup-index.json.gz`, gz(lookupIndexFile)],
    [`datasets/gtnh/${versionId}/recipes-shards/shard-0000.json.gz`, gz(shardFile)],
  ]);

  const key = (file: string) => {
    const normalized = file.replaceAll("\\", "/");
    const index = normalized.indexOf("datasets/gtnh/");
    return index >= 0 ? normalized.slice(index) : normalized;
  };

  async function readFile(file: string, encoding?: string): Promise<string | Buffer> {
    const path = key(file);
    if (path.endsWith("datasets.manifest.json")) {
      return encoding === "utf8" ? manifestText : Buffer.from(manifestText, "utf8");
    }
    const buffer = files.get(path);
    if (!buffer) {
      throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
    }
    return buffer;
  }

  async function stat() {
    return { mtimeMs: 1, size: manifestText.length, isFile: () => true };
  }

  return { readFile, stat, fallbackVersionId };
});

vi.mock("node:fs/promises", () => ({
  default: { readFile: io.readFile, stat: io.stat },
  readFile: io.readFile,
  stat: io.stat,
}));

import { queryDatasetRecipes, queryDatasetResources } from "./dataset-query";

const VERSION_ID = "local-2.9.0-rc-2";
const STEEL_PLATE = "gregtech:gt.metaitem.01@17305";
const MAKES_STEEL_PLATE =
  "oracle:local-2.9.0-beta-2:gregtech:gt-recipe-alloysmelter:3134fe95649ac389";
const USES_STEEL_PLATE =
  "oracle:local-2.9.0-beta-2:gregtech:gt-recipe-arcfurnace:eb49c726e6d78a40";
const HINT_DOT = "gregtech:gt.metaitem.01@99001";
const CASTING_FORM = "gregtech:gt.metaitem.01@99002";
const BEET = "gregtech:gt.metaitem.01@99003";
const TOMATO = "gregtech:gt.metaitem.01@99004";
const BEESWAX = "gregtech:gt.metaitem.01@99005";

const resourceQuery = (query: string, extra: Record<string, unknown> = {}) =>
  queryDatasetResources(VERSION_ID, { query, offset: 0, limit: 24, ...extra });

const recipeQuery = (query: string, extra: Record<string, unknown> = {}) =>
  queryDatasetRecipes(VERSION_ID, {
    query,
    mode: "recipes",
    maxTier: "all",
    allMaps: true,
    offset: 0,
    limit: 24,
    ...extra,
  });

const ids = (result: { resources: Array<{ id: string }> }) => result.resources.map((r) => r.id);

describe("the real resource query over an RC-2 fixture", () => {
  it("answers a Chinese name with the same resources as its English name", async () => {
    const chinese = await resourceQuery("钢板");
    const english = await resourceQuery("Steel Plate");

    expect(ids(chinese)).toEqual(ids(english));
    expect(ids(chinese)).toContain(STEEL_PLATE);
  });

  it("finds the resources a Chinese fragment covers", async () => {
    const steel = await resourceQuery("钢");
    expect(ids(steel)).toContain(STEEL_PLATE);
    expect(ids(steel)).toContain("gregtech:gt.metaitem.01@11305");
    expect(ids(steel)).not.toContain("ic2:blockmachine@3");

    const macerator = await resourceQuery("研磨机");
    expect(ids(macerator)).toContain("gregtech:gt.blockmachines@301");
  });

  it("finds the Chinese part's resource through a mixed query", async () => {
    expect(ids(await resourceQuery("gt 钢板"))).toContain(STEEL_PLATE);
    expect(ids(await resourceQuery("HV 研磨机"))).toContain("gregtech:gt.blockmachines@301");
  });

  it("answers nothing, not the whole catalog, for unknown Chinese", async () => {
    const none = await resourceQuery("不存在的词");
    expect(none.total).toBe(0);
    expect(none.resources).toEqual([]);

    // The blank query is the browse: it still lists everything.
    expect((await resourceQuery("")).total).toBeGreaterThan(0);
  });

  it("answers a full-width punctuated Chinese name in either width", async () => {
    expect(ids(await resourceQuery("提示方块：1号"))).toContain(HINT_DOT);
    expect(ids(await resourceQuery("提示方块:1号"))).toContain(HINT_DOT);
    expect(ids(await resourceQuery("铸件（螺栓）"))).toContain(CASTING_FORM);
    expect(ids(await resourceQuery("铸件(螺栓)"))).toContain(CASTING_FORM);
  });

  it("answers an ambiguous Chinese name with its candidates", async () => {
    expect(ids(await resourceQuery("甜菜"))).toContain(BEET);
    expect(ids(await resourceQuery("番茄"))).toContain(TOMATO);
    expect(ids(await resourceQuery("蜂蜡"))).toContain(BEESWAX);
  });

  it("keeps the kind and mod filters and their counts", async () => {
    const fluids = await resourceQuery("", { kind: "fluid" });
    expect(fluids.resources.every((resource) => resource.kind === "fluid")).toBe(true);
    expect(ids(fluids)).toContain("oxygen");
    expect(ids(fluids)).not.toContain(STEEL_PLATE);

    const ic2 = await resourceQuery("", { mod: "ic2" });
    expect(ids(ic2)).toEqual(["ic2:blockmachine@3"]);
    expect(ic2.mods.map((mod) => mod.id)).toContain("gregtech");
  });

  it("pages the same ranking", async () => {
    const first = await resourceQuery("steel", { sort: "name", limit: 2 });
    const second = await resourceQuery("steel", { sort: "name", limit: 2, offset: 2 });

    expect(first.total).toBeGreaterThanOrEqual(4);
    expect(second.total).toBe(first.total);
    expect(first.hasMore).toBe(true);
    expect(second.offset).toBe(2);
    expect(ids(first)).not.toEqual(ids(second));
  });
});

describe("the real recipe query over an RC-2 fixture", () => {
  it("answers a Chinese name with the same recipes as its English name", async () => {
    const chinese = await recipeQuery("钢板");
    const english = await recipeQuery("Steel Plate");

    expect(chinese.recipes.map((recipe) => recipe.id)).toEqual(
      english.recipes.map((recipe) => recipe.id),
    );
    expect(chinese.recipes.map((recipe) => recipe.id)).toContain(MAKES_STEEL_PLATE);
  });

  it("answers nothing, not every recipe, for unknown Chinese", async () => {
    const none = await recipeQuery("不存在的词");
    expect(none.total).toBe(0);
    expect(none.recipes).toEqual([]);

    expect((await recipeQuery("Steel Plate")).total).toBeGreaterThan(0);
  });

  it("browses a resource by id in both directions", async () => {
    const makes = await queryDatasetRecipes(VERSION_ID, {
      query: "",
      resource: { kind: "item", id: STEEL_PLATE },
      mode: "recipes",
      maxTier: "all",
      offset: 0,
      limit: 24,
    });
    const uses = await queryDatasetRecipes(VERSION_ID, {
      query: "",
      resource: { kind: "item", id: STEEL_PLATE },
      mode: "uses",
      maxTier: "all",
      offset: 0,
      limit: 24,
    });

    expect(makes.recipes.map((recipe) => recipe.id)).toEqual([MAKES_STEEL_PLATE]);
    expect(uses.recipes.map((recipe) => recipe.id)).toEqual([USES_STEEL_PLATE]);
  });

  it("pages the same ranking", async () => {
    const first = await recipeQuery("steel", { limit: 1 });
    const second = await recipeQuery("steel", { limit: 1, offset: 1 });

    expect(first.total).toBe(second.total);
    expect(first.hasMore).toBe(true);
    expect(first.recipes.map((recipe) => recipe.id)).not.toEqual(
      second.recipes.map((recipe) => recipe.id),
    );
  });
});

const FALLBACK_VERSION_ID = io.fallbackVersionId;
const MACERATOR = "gregtech:gt.blockmachines@301";

// Every reading of 钢板 the shared phonetic index must answer: whole, spaced,
// initials, prefix/infix fragments, and the two mixed Chinese/pinyin spellings.
const STEEL_PLATE_PINYIN = ["gangban", "gang ban", "gb", "gangb", "gban", "钢ban", "gang板"];

describe("pinyin queries over the real RC-2 fixture", () => {
  it("reads every pinyin form of 钢板 as Steel Plate", async () => {
    for (const reading of STEEL_PLATE_PINYIN) {
      expect(ids(await resourceQuery(reading)), reading).toContain(STEEL_PLATE);
    }
  });

  it("ranks the canonical Steel Plate first for a whole reading", async () => {
    expect(ids(await resourceQuery("gangban"))[0]).toBe(STEEL_PLATE);
    expect(ids(await resourceQuery("gang ban"))[0]).toBe(STEEL_PLATE);
  });

  it("keeps a Latin modifier meaningful beside pinyin", async () => {
    expect(ids(await resourceQuery("gt gangban"))).toContain(STEEL_PLATE);
    expect(ids(await resourceQuery("gregtech gangban"))).toContain(STEEL_PLATE);
  });

  it("answers nothing, not the whole catalog, for unknown pinyin", async () => {
    const none = await resourceQuery("zzzzzqpyn");
    expect(none.total).toBe(0);
    expect(none.resources).toEqual([]);

    // The blank query is still the browse.
    expect((await resourceQuery("")).total).toBeGreaterThan(0);
  });

  it("pages a pinyin query like an English one", async () => {
    const all = await resourceQuery("gangban", { sort: "name" });
    const first = await resourceQuery("gangban", { sort: "name", limit: 1 });
    const second = await resourceQuery("gangban", { sort: "name", limit: 1, offset: 1 });

    expect(first.total).toBe(all.total);
    expect(second.total).toBe(all.total);
    expect(second.offset).toBe(1);
    expect(ids(first)).toEqual(all.resources.slice(0, 1).map((resource) => resource.id));
    expect(ids(second)).toEqual(all.resources.slice(1, 2).map((resource) => resource.id));
  });

  it("keeps the kind and mod filters on a pinyin query", async () => {
    const items = await resourceQuery("gangban", { kind: "item" });
    expect(items.resources.every((resource) => resource.kind === "item")).toBe(true);
    expect(ids(items)).toContain(STEEL_PLATE);

    const fluids = await resourceQuery("gangban", { kind: "fluid" });
    expect(ids(fluids)).not.toContain(STEEL_PLATE);
    expect(fluids.total).toBe(0);

    const gregtech = await resourceQuery("gangban", { mod: "gregtech" });
    expect(ids(gregtech)).toContain(STEEL_PLATE);

    const ic2 = await resourceQuery("gangban", { mod: "ic2" });
    expect(ids(ic2)).not.toContain(STEEL_PLATE);
    expect(ic2.total).toBe(0);
  });
});

describe("technical tokens keep their meaning", () => {
  it("keeps voltage and unit modifiers next to a name", async () => {
    expect(ids(await resourceQuery("gt 钢板"))).toContain(STEEL_PLATE);
    expect(ids(await resourceQuery("LV 研磨机"))).toContain(MACERATOR);
    expect(ids(await resourceQuery("HV 研磨机"))).toContain(MACERATOR);
    expect(ids(await resourceQuery("512 EU/t 钢板"))).toContain(STEEL_PLATE);
  });

  it("keeps a registry id searchable as an id", async () => {
    const byId = await resourceQuery("gregtech:gt.metaitem.01@17305");
    expect(ids(byId)).toContain(STEEL_PLATE);
    expect(ids(byId)).not.toContain("gregtech:gt.metaitem.01@11305");
  });

  it("does not turn an unknown acronym into a pinyin reading", async () => {
    const ebf = await resourceQuery("ebf");
    expect(ebf.total).toBe(0);
    expect(ebf.resources).toEqual([]);
  });
});

describe("pinyin queries over the real recipe lookup", () => {
  it("reads a pinyin name like its English name", async () => {
    const pinyin = await recipeQuery("gangban");
    expect(pinyin.total).toBeGreaterThan(0);
    expect(pinyin.recipes.map((recipe) => recipe.id)).toContain(MAKES_STEEL_PLATE);
  });

  it("keeps mode, tier, map and clause scope on a pinyin query", async () => {
    const makes = await queryDatasetRecipes(VERSION_ID, {
      query: "gangban",
      resource: { kind: "item", id: STEEL_PLATE },
      mode: "recipes",
      maxTier: "all",
      offset: 0,
      limit: 24,
    });
    const uses = await queryDatasetRecipes(VERSION_ID, {
      query: "gangban",
      resource: { kind: "item", id: STEEL_PLATE },
      mode: "uses",
      maxTier: "all",
      offset: 0,
      limit: 24,
    });
    expect(makes.recipes.map((recipe) => recipe.id)).toEqual([MAKES_STEEL_PLATE]);
    expect(uses.recipes.map((recipe) => recipe.id)).toEqual([USES_STEEL_PLATE]);

    const tiered = await recipeQuery("gangban", { maxTier: "LV" });
    expect(tiered.recipes.map((recipe) => recipe.id)).toContain(MAKES_STEEL_PLATE);
    const belowTier = await recipeQuery("gangban", { maxTier: "ULV" });
    expect(belowTier.total).toBe(0);

    const alloy = await queryDatasetRecipes(VERSION_ID, {
      query: "gangban",
      mode: "recipes",
      recipeMap: "Alloy Smelter",
      maxTier: "all",
      offset: 0,
      limit: 24,
    });
    expect(alloy.recipes.map((recipe) => recipe.id)).toEqual([MAKES_STEEL_PLATE]);

    const clause = await queryDatasetRecipes(VERSION_ID, {
      query: "gangban",
      mode: "recipes",
      clauses: [{ role: "makes", kind: "item", id: STEEL_PLATE }],
      maxTier: "all",
      offset: 0,
      limit: 24,
    });
    expect(clause.recipes.map((recipe) => recipe.id)).toEqual([MAKES_STEEL_PLATE]);
  });

  it("answers the same through the non-lookup fallback path", async () => {
    const pinyin = await queryDatasetRecipes(FALLBACK_VERSION_ID, {
      query: "gangban",
      mode: "recipes",
      maxTier: "all",
      offset: 0,
      limit: 24,
    });
    const english = await queryDatasetRecipes(FALLBACK_VERSION_ID, {
      query: "Steel Plate",
      mode: "recipes",
      maxTier: "all",
      offset: 0,
      limit: 24,
    });
    expect(pinyin.total).toBeGreaterThan(0);
    expect(pinyin.recipes.map((recipe) => recipe.id)).toContain(MAKES_STEEL_PLATE);
    expect(pinyin.recipes.map((recipe) => recipe.id)).toEqual(
      english.recipes.map((recipe) => recipe.id),
    );

    const fallbackMakes = await queryDatasetRecipes(FALLBACK_VERSION_ID, {
      query: "gangban",
      resource: { kind: "item", id: STEEL_PLATE },
      mode: "recipes",
      maxTier: "all",
      offset: 0,
      limit: 24,
    });
    expect(fallbackMakes.recipes.map((recipe) => recipe.id)).toEqual([MAKES_STEEL_PLATE]);

    const fallbackBelowTier = await queryDatasetRecipes(FALLBACK_VERSION_ID, {
      query: "gangban",
      mode: "recipes",
      maxTier: "ULV",
      offset: 0,
      limit: 24,
    });
    expect(fallbackBelowTier.total).toBe(0);

    const fallbackMap = await queryDatasetRecipes(FALLBACK_VERSION_ID, {
      query: "gangban",
      mode: "recipes",
      recipeMap: "Alloy Smelter",
      maxTier: "all",
      offset: 0,
      limit: 24,
    });
    expect(fallbackMap.recipes.map((recipe) => recipe.id)).toEqual([MAKES_STEEL_PLATE]);

    const fallbackClause = await queryDatasetRecipes(FALLBACK_VERSION_ID, {
      query: "gangban",
      mode: "recipes",
      clauses: [{ role: "makes", kind: "item", id: STEEL_PLATE }],
      maxTier: "all",
      offset: 0,
      limit: 24,
    });
    expect(fallbackClause.recipes.map((recipe) => recipe.id)).toEqual([MAKES_STEEL_PLATE]);
  });
});
