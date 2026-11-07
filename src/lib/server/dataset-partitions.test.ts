import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildPartitionedDatasetForVersion } from "../../../tools/dataset-pipeline/scripts/build-partitioned-dataset";
import {
  clearDatasetQueryCaches,
  getDatasetCatalog,
  getDatasetRecipe,
  getDatasetRecipeIds,
  listDatasetCropFarmRecipes,
  listDatasetEecMobs,
  queryDatasetRecipes,
  queryDatasetResources,
  resolveDatasetRecipeRefs,
} from "./dataset-query";
import {
  clearPartitionedDatasetCaches,
  encodeDeltaVarints,
  decodeDeltaVarintSlice,
  hasPartitionedDataset,
  packPostingsBuffer,
  unpackPostingsBuffer,
} from "./dataset-partitions";
import {
  readDatasetBytes,
  serveDatasetTextureWithFallback,
  setCloudflareRuntimeBindings,
  type R2BucketLike,
} from "./dataset-storage";

async function writeGzipJson(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, gzipSync(Buffer.from(JSON.stringify(payload), "utf8")));
}

async function createSelfContainedPartitionedFixture(): Promise<string> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gtnh-partition-fixture-"));
  const versionId = "local-2.9.0-rc-2";
  const base = `/datasets/gtnh/${versionId}`;
  const rendered = `${base}/textures/rendered`;
  const shardPath = `${base}/recipes-shards/shard-0000.json.gz`;
  const sourceInfo = {
    sourceId: "gtnh-oracle" as const,
    sourceVersion: "dev.gtnhplanner.oracle.v1",
    generatedAt: "2026-10-16T21:32:37.292Z",
  };

  const version = {
    id: versionId,
    gtnhVersion: "2.9.0-RC-2",
    channel: "experimental" as const,
    publishedAt: "2026-10-16T21:49:22.910Z",
    manifestPath: "/datasets/gtnh/datasets.manifest.json",
    recipeDatasetPath: `${base}/recipes.json.gz`,
    resourceIndexPath: `${base}/resource-index.json.gz`,
    recipeIndexPath: `${base}/recipe-index.json.gz`,
    recipeLookupIndexPath: `${base}/recipe-lookup-index.json.gz`,
    checksumSha256: "4d5dcc81e36fa313bdbd4cbc0f96626e33041604ef484cea588e398be955674f",
    sourceInfo,
  };

  const resourceIndex = [
    {
      kind: "item" as const,
      id: "gregtech:gt.metaitem.01@17305",
      displayName: "Steel Plate",
      iconPath: `${rendered}/steel_plate-c6cc2f3ecfae.png`,
      dominantColor: "#323232",
      recipeCount: 163,
      oreDictionary: ["plateSteel"],
    },
    {
      kind: "item" as const,
      id: "gregtech:gt.metaitem.01@17306",
      displayName: "Stainless Steel Plate",
      iconPath: `${rendered}/stainless_steel_plate-b663593988d3.png`,
      dominantColor: "#b6b6c6",
      recipeCount: 110,
    },
    {
      kind: "item" as const,
      id: "miscutils:itemplateeglinsteel",
      displayName: "Eglin Steel Plate",
      iconPath: `${rendered}/eglin_steel_plate-a1235fafd082.png`,
      dominantColor: "#69340e",
      recipeCount: 51,
    },
    {
      kind: "item" as const,
      id: "gregtech:gt.metaitem.01@17364",
      displayName: "Dark Steel Plate",
      iconPath: `${rendered}/dark_steel_plate-43c10abd6785.png`,
      dominantColor: "#120e12",
      recipeCount: 44,
    },
    {
      kind: "item" as const,
      id: "gregtech:gt.metaitem.01@17334",
      displayName: "Black Steel Plate",
      iconPath: `${rendered}/black_steel_plate-c9d8074f0ba0.png`,
      dominantColor: "#1e1e1e",
      recipeCount: 43,
    },
    {
      kind: "item" as const,
      id: "gregtech:gt.metaitem.01@11305",
      displayName: "Steel Ingot",
      iconPath: `${rendered}/steel_ingot-bc20fcddb4f8.png`,
      dominantColor: "#222222",
      recipeCount: 770,
    },
    {
      kind: "item" as const,
      id: "gregtech:gt.metaitem.01@2032",
      displayName: "Iron Dust",
      iconPath: `${rendered}/iron_dust-b076ec06aa8a.png`,
      dominantColor: "#747474",
      recipeCount: 1161,
    },
    {
      kind: "fluid" as const,
      id: "oxygen",
      displayName: "Oxygen",
      iconPath: `${rendered}/oxygen-db4ce49a39d6.png`,
      dominantColor: "#00799e",
      recipeCount: 912,
    },
    {
      kind: "item" as const,
      id: "cropsnh:berry",
      displayName: "Sugar Beet",
      iconPath: `${rendered}/sugar_beet-000000000001.png`,
      dominantColor: "#8b1a1a",
      recipeCount: 4,
    },
    {
      kind: "item" as const,
      id: "oredict:plateSteel",
      displayName: "Ore Dictionary: plateSteel",
      alternatives: [
        {
          kind: "item" as const,
          id: "gregtech:gt.metaitem.01@17305",
          displayName: "Steel Plate",
          iconPath: `${rendered}/steel_plate-c6cc2f3ecfae.png`,
          dominantColor: "#323232",
        },
      ],
    },
  ];

  const resources = resourceIndex.map((entry) => ({
    ...entry,
    modId: entry.id.includes(":") ? entry.id.slice(0, entry.id.indexOf(":")) : undefined,
  }));

  const recipes = [
    {
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
        },
      ],
      outputs: [
        {
          kind: "item",
          id: "gregtech:gt.metaitem.01@17305",
          amount: 1,
          displayName: "Steel Plate",
          iconPath: `${rendered}/steel_plate-c6cc2f3ecfae.png`,
          dominantColor: "#323232",
        },
      ],
      source: {
        datasetVersionId: versionId,
        recipeMap: "Alloy Smelter",
        exporter: "gtnh-oracle",
        rawRecipeId: "gt.recipe.alloysmelter:3134fe95649ac389",
      },
    },
    {
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
          id: "oredict:plateSteel",
          amount: 1,
          displayName: "Ore Dictionary: plateSteel",
        },
        {
          kind: "fluid",
          id: "oxygen",
          amount: 100,
          displayName: "Oxygen",
          iconPath: `${rendered}/oxygen-db4ce49a39d6.png`,
          dominantColor: "#00799e",
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
        },
      ],
      source: {
        datasetVersionId: versionId,
        recipeMap: "Arc Furnace",
        exporter: "gtnh-oracle",
        rawRecipeId: "gt.recipe.arcfurnace:eb49c726e6d78a40",
      },
    },
    {
      id: "oracle:local-2.9.0-rc-2:cropsnh:crop-farm:sugar-beet",
      name: "Crop Farm: Sugar Beet",
      kind: "gregtech_machine",
      category: "gregtech",
      machineType: "Crop Farm",
      recipeMap: "Crop Farm",
      minimumTier: "LV",
      durationTicks: 20,
      eut: 16,
      inputs: [],
      outputs: [
        {
          kind: "item",
          id: "cropsnh:berry",
          amount: 1,
          displayName: "Sugar Beet",
          iconPath: `${rendered}/sugar_beet-000000000001.png`,
          dominantColor: "#8b1a1a",
        },
      ],
      source: {
        datasetVersionId: versionId,
        recipeMap: "Crop Farm",
        exporter: "gtnh-oracle",
        rawRecipeId: "cropsnh:sugar-beet",
      },
    },
    {
      id: "oracle:local-2.9.0-rc-2:kubatech:eec:iron-golem",
      name: "Extreme Entity Crusher: Iron Golem",
      kind: "gregtech_machine",
      category: "gregtech",
      machineType: "Extreme Entity Crusher",
      recipeMap: "Extreme Entity Crusher",
      minimumTier: "EV",
      durationTicks: 40,
      eut: 1920,
      inputs: [],
      outputs: [
        {
          kind: "item",
          id: "gregtech:gt.metaitem.01@2032",
          amount: 1,
          displayName: "Iron Dust",
          iconPath: `${rendered}/iron_dust-b076ec06aa8a.png`,
          dominantColor: "#747474",
        },
      ],
      source: {
        datasetVersionId: versionId,
        recipeMap: "Extreme Entity Crusher",
        exporter: "gtnh-oracle",
        rawRecipeId: "eec:iron-golem",
      },
    },
  ];

  const recipeMaps = [
    "Alloy Smelter",
    "Arc Furnace",
    "Crop Farm",
    "Extreme Entity Crusher",
  ];
  const searchText = [
    "alloy smelter: steel plate alloy smelter steel ingot gregtech:gt.metaitem.01@11305 steel plate gregtech:gt.metaitem.01@17305",
    "arc furnace: steel ingot arc furnace steel plate oredict:platesteel oxygen steel ingot gregtech:gt.metaitem.01@11305",
    "crop farm: sugar beet crop farm sugar beet cropsnh:berry",
    "extreme entity crusher: iron golem extreme entity crusher iron dust gregtech:gt.metaitem.01@2032",
  ];
  const shards = [{ id: "0", path: shardPath, start: 0, end: recipes.length }];

  await fs.writeFile(
    path.join(tempRoot, "datasets.manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      latestStableVersion: versionId,
      versions: [version],
    }),
    "utf8",
  );

  await writeGzipJson(path.join(tempRoot, versionId, "resource-index.json.gz"), {
    schemaVersion: 1,
    datasetVersionId: versionId,
    gtnhVersion: version.gtnhVersion,
    sourceInfo,
    resources,
    resourceIndex,
    recipeMaps,
    recipeMapIcons: [],
    machineHandlerIcons: [],
    generatedAt: sourceInfo.generatedAt,
    recipeCount: recipes.length,
    shardSize: 250,
    shards,
  });

  await writeGzipJson(path.join(tempRoot, versionId, "recipe-lookup-index.json.gz"), {
    schemaVersion: 1,
    datasetVersionId: versionId,
    recipeCount: recipes.length,
    shards,
    recipeMaps,
    recipeIds: recipes.map((r) => r.id),
    tierIndexes: [1, 1, 1, 4],
    iconScores: [3, 3, 2, 2],
    searchText,
    entries: [
      ["recipes:item:gregtech:gt.metaitem.01@17305", [[0, [0]]]],
      ["uses:item:oredict:plateSteel", [[1, [1]]]],
      ["uses:fluid:oxygen", [[1, [1]]]],
      ["recipes:item:gregtech:gt.metaitem.01@11305", [[1, [1]]]],
      ["uses:item:gregtech:gt.metaitem.01@11305", [[0, [0]]]],
      ["recipes:item:cropsnh:berry", [[2, [2]]]],
      ["recipes:item:gregtech:gt.metaitem.01@2032", [[3, [3]]]],
    ],
  });

  await writeGzipJson(path.join(tempRoot, versionId, "recipes-shards", "shard-0000.json.gz"), {
    schemaVersion: 1,
    datasetVersionId: versionId,
    shardIndex: 0,
    start: 0,
    end: recipes.length,
    recipes,
  });

  await buildPartitionedDatasetForVersion(tempRoot, version);
  return tempRoot;
}
describe("partitioned dataset engine & Cloudflare storage bindings", () => {
  let fixtureDatasetRoot: string | undefined;

  beforeAll(async () => {
    fixtureDatasetRoot = await createSelfContainedPartitionedFixture();
  }, 30000);

  afterAll(async () => {
    if (fixtureDatasetRoot) {
      await fs.rm(fixtureDatasetRoot, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    delete process.env.GTNH_DISABLE_PARTITIONED_DATASET;
    delete process.env.GTNH_DATASET_ROOT;
    setCloudflareRuntimeBindings(undefined);
    clearPartitionedDatasetCaches();
    clearDatasetQueryCaches();
  });

  it("encodes and decodes delta varint posting slices losslessly", () => {
    const lists = [
      [0, 1, 5, 130, 16385, 277968],
      [],
      [42, 43, 1000],
    ];
    const encoded = encodeDeltaVarints(lists);
    const packed = packPostingsBuffer(encoded.offsets, encoded.data);
    const unpacked = unpackPostingsBuffer(packed);

    expect(unpacked.tokenCount).toBe(3);
    expect([...decodeDeltaVarintSlice(unpacked.data, unpacked.offsets[0], unpacked.offsets[1])]).toEqual(
      lists[0],
    );
    expect([...decodeDeltaVarintSlice(unpacked.data, unpacked.offsets[1], unpacked.offsets[2])]).toEqual(
      lists[1],
    );
    expect([...decodeDeltaVarintSlice(unpacked.data, unpacked.offsets[2], unpacked.offsets[3])]).toEqual(
      lists[2],
    );
  });

  it("serves partitioned catalog, English/Chinese/pinyin resource queries, and recipe queries matching legacy output", async () => {
    process.env.GTNH_DATASET_ROOT = fixtureDatasetRoot;
    clearPartitionedDatasetCaches();
    clearDatasetQueryCaches();

    const versionId = "local-2.9.0-rc-2";
    const partitionedAvailable = await hasPartitionedDataset(versionId);
    expect(partitionedAvailable).toBe(true);

    // Run against partitioned artifacts
    process.env.GTNH_DISABLE_PARTITIONED_DATASET = "0";
    const [
      partCatalog,
      partResEn,
      partResZh,
      partResPinyin,
      partRecPinyin,
      partRecClause,
      partRecUses,
      partCrops,
      partMobs,
    ] = await Promise.all([
      getDatasetCatalog(versionId),
      queryDatasetResources(versionId, { query: "steel plate", offset: 0, limit: 5 }),
      queryDatasetResources(versionId, { query: "钢板", offset: 0, limit: 5 }),
      queryDatasetResources(versionId, { query: "gangban", offset: 0, limit: 5 }),
      queryDatasetRecipes(versionId, {
        query: "gangban",
        mode: "recipes",
        maxTier: "all",
        offset: 0,
        limit: 5,
      }),
      queryDatasetRecipes(versionId, {
        query: "",
        mode: "recipes",
        clauses: [{ kind: "item", id: "gregtech:gt.metaitem.01@17305", role: "makes" }],
        maxTier: "HV",
        offset: 0,
        limit: 5,
      }),
      queryDatasetRecipes(versionId, {
        query: "",
        mode: "uses",
        clauses: [{ kind: "item", id: "gregtech:gt.metaitem.01@17305", role: "takes" }],
        maxTier: "all",
        offset: 0,
        limit: 5,
      }),
      listDatasetCropFarmRecipes(versionId),
      listDatasetEecMobs(versionId),
    ]);

    expect(partCatalog.datasetVersionId).toBe(versionId);
    expect(partResEn.resources[0]?.displayName).toBe("Steel Plate");
    expect(partResZh.resources.map((r) => r.id)).toEqual(partResEn.resources.map((r) => r.id));
    expect(partResPinyin.resources[0]?.displayName).toBe("Steel Plate");
    expect(partRecPinyin.total).toBeGreaterThan(0);
    expect(partRecClause.total).toBe(1);
    expect(partRecUses.total).toBe(1);
    expect(partCrops.crops.length).toBe(1);
    expect(partMobs.mobs.length).toBe(1);

    // Compare against legacy unpartitioned path on the same dataset
    process.env.GTNH_DISABLE_PARTITIONED_DATASET = "1";
    const [
      legResEn,
      legResZh,
      legResPinyin,
      legRecPinyin,
      legRecClause,
      legRecUses,
    ] = await Promise.all([
      queryDatasetResources(versionId, { query: "steel plate", offset: 0, limit: 5 }),
      queryDatasetResources(versionId, { query: "钢板", offset: 0, limit: 5 }),
      queryDatasetResources(versionId, { query: "gangban", offset: 0, limit: 5 }),
      queryDatasetRecipes(versionId, {
        query: "gangban",
        mode: "recipes",
        maxTier: "all",
        offset: 0,
        limit: 5,
      }),
      queryDatasetRecipes(versionId, {
        query: "",
        mode: "recipes",
        clauses: [{ kind: "item", id: "gregtech:gt.metaitem.01@17305", role: "makes" }],
        maxTier: "HV",
        offset: 0,
        limit: 5,
      }),
      queryDatasetRecipes(versionId, {
        query: "",
        mode: "uses",
        clauses: [{ kind: "item", id: "gregtech:gt.metaitem.01@17305", role: "takes" }],
        maxTier: "all",
        offset: 0,
        limit: 5,
      }),
    ]);

    expect(partResEn.resources.map((r) => r.id)).toEqual(legResEn.resources.map((r) => r.id));
    expect(partResZh.resources.map((r) => r.id)).toEqual(legResZh.resources.map((r) => r.id));
    expect(partResPinyin.resources.map((r) => r.id)).toEqual(
      legResPinyin.resources.map((r) => r.id),
    );
    expect(partRecPinyin.recipes.map((r) => r.id)).toEqual(legRecPinyin.recipes.map((r) => r.id));
    expect(partRecClause.recipes.map((r) => r.id)).toEqual(legRecClause.recipes.map((r) => r.id));
    expect(partRecUses.recipes.map((r) => r.id)).toEqual(legRecUses.recipes.map((r) => r.id));

    process.env.GTNH_DISABLE_PARTITIONED_DATASET = "0";
    const sampleRecipeId = partRecClause.recipes[0]!.id;
    const singleRecipe = await getDatasetRecipe(versionId, sampleRecipeId);
    expect(singleRecipe?.id).toBe(sampleRecipeId);

    const recipeIds = await getDatasetRecipeIds(versionId);
    expect(recipeIds.length).toBe(partCatalog.recipeCount);

    const resolvedRefs = await resolveDatasetRecipeRefs(versionId, [
      {
        id: "legacy-ref-1",
        name: partRecClause.recipes[0]!.name,
        machineType: partRecClause.recipes[0]!.machineType,
        recipeMap: partRecClause.recipes[0]!.recipeMap,
        inputs: partRecClause.recipes[0]!.inputs,
        outputs: partRecClause.recipes[0]!.outputs,
        durationTicks: partRecClause.recipes[0]!.durationTicks,
        eut: partRecClause.recipes[0]!.eut,
      },
    ]);
    expect(resolvedRefs).toEqual([
      {
        importedId: "legacy-ref-1",
        recipeId: sampleRecipeId,
        exact: true,
      },
    ]);
  }, 30000);

  it("reads dataset objects from R2 bucket bindings and caches missing textures from gtnhplanner.com", async () => {
    const storedR2 = new Map<string, Uint8Array>();
    const waitUntilPromises: Promise<unknown>[] = [];

    const r2Bucket: R2BucketLike = {
      async get(key: string) {
        const bytes = storedR2.get(key);
        if (!bytes) return null;
        return {
          async arrayBuffer() {
            return bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer;
          },
        };
      },
      async put(key: string, value: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array> | string) {
        if (value instanceof Uint8Array) {
          storedR2.set(key, new Uint8Array(value));
        } else if (value instanceof ArrayBuffer) {
          storedR2.set(key, new Uint8Array(value));
        }
      },
    };
    setCloudflareRuntimeBindings({
      DATASET_BUCKET: r2Bucket,
      ctx: {
        waitUntil(promise: Promise<unknown>) {
          waitUntilPromises.push(promise);
        },
      },
    });

    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "https://gtnhplanner.com/datasets/gtnh/local-2.9.0-rc-2/textures/rendered/missing_icon-123456.png",
      );
      return new Response(fakePng, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });

    const missResponse = await serveDatasetTextureWithFallback(
      "local-2.9.0-rc-2/textures/rendered/missing_icon-123456.png",
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(missResponse.status).toBe(200);
    expect(missResponse.headers.get("X-GTNH-Asset-Cache")).toBe("MISS");
    expect(new Uint8Array(await missResponse.arrayBuffer())).toEqual(fakePng);

    await Promise.all(waitUntilPromises);
    expect(
      storedR2.has("datasets/gtnh/local-2.9.0-rc-2/textures/rendered/missing_icon-123456.png"),
    ).toBe(true);

    // Subsequent read hits R2 directly without calling upstream fetch
    const hitBytes = await readDatasetBytes(
      "local-2.9.0-rc-2/textures/rendered/missing_icon-123456.png",
    );
    expect(hitBytes).toEqual(fakePng);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
