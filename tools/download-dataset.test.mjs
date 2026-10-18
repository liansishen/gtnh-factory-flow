import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { collectDatasetAssets, datasetFile, downloadDataset } from "./download-dataset.mjs";

const temporary = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

describe("local dataset preparation", () => {
  it("collects the actual referenced shards and pictures once", () => {
    expect(collectDatasetAssets({ resources: [{ iconPath: "/datasets/gtnh/v/textures/a.png" }], shards: [{ path: "/datasets/gtnh/v/recipes-shards/a.json.gz" }], other: "/datasets/gtnh/v/textures/a.png" })).toEqual([
      "/datasets/gtnh/v/recipes-shards/a.json.gz", "/datasets/gtnh/v/textures/a.png",
    ]);
  });

  it("confines downloaded paths to the local dataset tree", () => {
    expect(datasetFile("/app/public", "/datasets/gtnh/v/resource-index.json.gz")).toBe("/app/public/datasets/gtnh/v/resource-index.json.gz");
    for (const input of ["/etc/passwd", "/datasets/gtnh/../../secret", "/datasets/gtnh/%2e%2e/secret", "/datasets/gtnh/v/%2f..%2f..%2f..%2fsecret"]) {
      expect(() => datasetFile("/app/public", input)).toThrow();
    }
  });

  it("downloads the manifest, indexes and recipe bodies through the shipped preparation path", async () => {
    const directory = await fs.mkdtemp(path.join(process.env.GTNH_TEST_TMP ?? os.tmpdir(), "gtnh-dataset-"));
    temporary.push(directory);
    const version = { id: "v", resourceIndexPath: "/datasets/gtnh/v/resource-index.json.gz", recipeIndexPath: "/datasets/gtnh/v/recipe-index.json.gz" };
    const index = { resources: [{ id: "steel", displayName: "Steel Plate", iconPath: "/datasets/gtnh/v/textures/steel.png" }], shards: [{ path: "/datasets/gtnh/v/recipes-shards/shard-0.json.gz" }] };
    const files = new Map([
      ["/datasets/gtnh/datasets.manifest.json", Buffer.from(JSON.stringify({ versions: [version, { id: "uninstalled" }], latestStableVersion: "v" }))],
      [version.resourceIndexPath, gzipSync(JSON.stringify(index))],
      [version.recipeIndexPath, gzipSync(JSON.stringify({ recipes: [] }))],
      [index.shards[0].path, gzipSync(JSON.stringify({ recipes: [{ id: "recipe:steel" }] }))],
      [index.resources[0].iconPath, Buffer.from([137, 80, 78, 71])],
    ]);
    const requests = [];
    const report = await downloadDataset({
      manifestUrl: "https://example.invalid/datasets/gtnh/datasets.manifest.json",
      publicRoot: directory,
      fetchImpl: async input => {
        const pathname = new URL(input).pathname;
        requests.push(pathname);
        return new Response(files.get(pathname), { status: files.has(pathname) ? 200 : 404 });
      },
      onProgress: () => {},
    });
    expect(report.versionId).toBe("v");
    expect(requests).toContain(index.shards[0].path);
    expect(await fs.readFile(datasetFile(directory, index.resources[0].iconPath))).toEqual(files.get(index.resources[0].iconPath));
    const installed = JSON.parse(await fs.readFile(datasetFile(directory, "/datasets/gtnh/datasets.manifest.json"), "utf8"));
    expect(installed.versions).toEqual([version]);
    expect(installed.latestStableVersion).toBe("v");
  });

  it("refuses an absent requested version without silently selecting another", async () => {
    await expect(downloadDataset({ versionId: "missing", fetchImpl: async () => new Response(JSON.stringify({ versions: [{ id: "v" }], latestStableVersion: "v" })) })).rejects.toThrow("absent");
  });
});
