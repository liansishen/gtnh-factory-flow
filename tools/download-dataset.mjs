import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const PREFIX = "/datasets/gtnh/";
const DEFAULT_MANIFEST = "https://gtnhplanner.com/datasets/gtnh/datasets.manifest.json";

export function datasetFile(publicRoot, assetPath) {
  const pathname = decodeURIComponent(new URL(assetPath, "https://dataset.invalid").pathname);
  if (!pathname.startsWith(PREFIX) || pathname.includes("\\")) {
    throw new Error(`Unexpected dataset path: ${assetPath}`);
  }
  const root = path.resolve(publicRoot, "datasets/gtnh");
  const file = path.resolve(publicRoot, `.${pathname}`);
  if (!file.startsWith(root + path.sep)) throw new Error(`Unsafe dataset path: ${assetPath}`);
  return file;
}

export function collectDatasetAssets(value) {
  const paths = new Set();
  function visit(node) {
    if (typeof node === "string") {
      if (node.startsWith(PREFIX) && /\.(png|webp|jpg|jpeg|gif|json\.gz)$/.test(node)) paths.add(node);
    } else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") Object.values(node).forEach(visit);
  }
  visit(value);
  return [...paths].sort();
}

export async function downloadDataset({
  manifestUrl = DEFAULT_MANIFEST,
  versionId,
  publicRoot = path.resolve("public"),
  concurrency = 6,
  icons = true,
  indexesOnly = false,
  fetchImpl = fetch,
  onProgress = console.log,
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error("Concurrency must be 1–16.");
  async function get(url) {
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 GTNH-Factory-Flow-Dataset/1.0" }, signal: AbortSignal.timeout(90000) });
        if (!response.ok) throw new Error(`${response.status} ${url}`);
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        failure = error;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    throw failure;
  }
  const manifest = JSON.parse((await get(manifestUrl)).toString("utf8"));
  const wanted = versionId ?? manifest.latestStableVersion ?? manifest.versions[0]?.id;
  const version = manifest.versions.find(entry => entry.id === wanted);
  if (!version) throw new Error(`Dataset ${wanted} is absent from the manifest.`);
  const paths = new Set([version.resourceIndexPath, version.recipeIndexPath, version.recipeLookupIndexPath].filter(Boolean));
  if (!version.resourceIndexPath) throw new Error(`Dataset ${wanted} has no resource index.`);
  async function save(asset) {
    const destination = datasetFile(publicRoot, asset);
    let buffer;
    try { buffer = await fs.readFile(destination); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!buffer) {
      buffer = await get(new URL(asset, manifestUrl));
      if (asset.endsWith(".json.gz")) JSON.parse(gunzipSync(buffer).toString("utf8"));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, buffer);
    }
    return buffer;
  }
  const index = JSON.parse(gunzipSync(await save(version.resourceIndexPath)).toString("utf8"));
  if (!indexesOnly) {
    for (const asset of collectDatasetAssets(index)) {
      if (icons || asset.endsWith(".json.gz")) paths.add(asset);
    }
  }
  const pending = [...paths];
  let next = 0, complete = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < pending.length) {
      const asset = pending[next++];
      await save(asset);
      complete++;
      if (complete % 100 === 0) onProgress(`${complete}/${pending.length} files`);
    }
  }));
  const localManifest = { ...manifest, versions: [version], latestStableVersion: version.id };
  delete localManifest.latestDailyVersion;
  const destination = datasetFile(publicRoot, PREFIX + "datasets.manifest.json");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, JSON.stringify(localManifest, null, 2) + "\n");
  const report = { versionId: version.id, checksumSha256: version.checksumSha256, files: pending.length, icons, indexesOnly };
  onProgress(JSON.stringify(report));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
  await downloadDataset({
    manifestUrl: value("--manifest") ?? DEFAULT_MANIFEST,
    versionId: value("--version"),
    publicRoot: value("--public-root") ?? path.resolve("public"),
    concurrency: Number(value("--concurrency") ?? 6),
    icons: !args.includes("--no-icons"),
    indexesOnly: args.includes("--indexes-only"),
  });
}
