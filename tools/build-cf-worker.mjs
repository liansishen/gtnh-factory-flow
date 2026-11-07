import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import * as esbuild from "esbuild";

const rootDir = process.cwd();
const cfDistDir = path.join(rootDir, ".cf-dist");
const cfAssetsDir = path.join(cfDistDir, "assets");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function captureRenderedHomePage() {
  const standaloneServer = path.join(rootDir, ".next", "standalone", "server.js");
  if (!(await exists(standaloneServer))) {
    throw new Error(".next/standalone/server.js not found; run next build first.");
  }

  // Ensure static files are linked inside .next/standalone/.next/static for rendering
  const standaloneStatic = path.join(rootDir, ".next", "standalone", ".next", "static");
  if (!(await exists(standaloneStatic))) {
    await fs.cp(path.join(rootDir, ".next", "static"), standaloneStatic, { recursive: true });
  }

  const port = 34189;
  const child = spawn(process.execPath, [standaloneServer], {
    cwd: path.join(rootDir, ".next", "standalone"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      GTNH_PREWARM_ON_STARTUP: "0",
      NEXT_PUBLIC_OFFICIAL_COMMUNITY_READ_ONLY:
        process.env.NEXT_PUBLIC_OFFICIAL_COMMUNITY_READ_ONLY ?? "1",
      NEXT_PUBLIC_SITE_URL:
        process.env.NEXT_PUBLIC_SITE_URL ?? "https://plan.playgtnh.dpdns.org",
    },
    stdio: "ignore",
  });

  try {
    let html = "";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        if (res.ok) {
          html = await res.text();
          break;
        }
      } catch {
        // Wait for server listen
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!html) {
      throw new Error("Failed to capture rendered home page HTML from standalone server.");
    }
    return html;
  } finally {
    child.kill("SIGTERM");
  }
}

async function main() {
  const skipNextBuild = process.argv.includes("--skip-next");

  // 1. Ensure partitioned dataset exists for local-2.9.0-rc-2
  const partitionMeta = path.join(
    rootDir,
    "public",
    "datasets",
    "gtnh",
    "local-2.9.0-rc-2",
    "partitions",
    "meta.json.gz",
  );
  if (
    (await exists(path.join(rootDir, "public", "datasets", "gtnh", "datasets.manifest.json"))) &&
    !(await exists(partitionMeta))
  ) {
    console.info("Building partitioned dataset artifacts...");
    execFileSync(
      "npx",
      ["tsx", "tools/dataset-pipeline/scripts/build-partitioned-dataset.ts", "local-2.9.0-rc-2"],
      { stdio: "inherit", cwd: rootDir },
    );
  }

  // 2. Run next build if needed
  if (!skipNextBuild || !(await exists(path.join(rootDir, ".next", "standalone", "server.js")))) {
    console.info("Running Next.js production build...");
    execFileSync("npm", ["run", "build"], {
      stdio: "inherit",
      cwd: rootDir,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        NEXT_PUBLIC_OFFICIAL_COMMUNITY_READ_ONLY:
          process.env.NEXT_PUBLIC_OFFICIAL_COMMUNITY_READ_ONLY ?? "1",
        NEXT_PUBLIC_SITE_URL:
          process.env.NEXT_PUBLIC_SITE_URL ?? "https://plan.playgtnh.dpdns.org",
      },
    });
  }

  // 3. Prepare .cf-dist/assets
  await fs.rm(cfDistDir, { recursive: true, force: true });
  await fs.mkdir(cfAssetsDir, { recursive: true });

  console.info("Capturing rendered home page shell...");
  const homeHtml = await captureRenderedHomePage();
  await fs.writeFile(path.join(cfAssetsDir, "index.html"), homeHtml, "utf8");

  // Copy .next/static -> .cf-dist/assets/_next/static
  await fs.cp(path.join(rootDir, ".next", "static"), path.join(cfAssetsDir, "_next", "static"), {
    recursive: true,
  });

  // Copy top-level public files (excluding datasets/)
  const publicDir = path.join(rootDir, "public");
  const publicEntries = await fs.readdir(publicDir, { withFileTypes: true });
  for (const entry of publicEntries) {
    if (entry.name === "datasets") {
      continue;
    }
    await fs.cp(path.join(publicDir, entry.name), path.join(cfAssetsDir, entry.name), {
      recursive: true,
    });
  }
  // Exclude announce/in-game-trailer.mp4 (>25 MiB Cloudflare Static Assets limit)
  await fs.rm(path.join(cfAssetsDir, "announce", "in-game-trailer.mp4"), { force: true });

  // Copy datasets.manifest.json and partitioned dataset + shards + textures (excluding unpartitioned monoliths)
  const datasetRoot = path.join(publicDir, "datasets", "gtnh");
  if (await exists(datasetRoot)) {
    const destDatasetRoot = path.join(cfAssetsDir, "datasets", "gtnh");
    await fs.mkdir(destDatasetRoot, { recursive: true });
    await fs.copyFile(
      path.join(datasetRoot, "datasets.manifest.json"),
      path.join(destDatasetRoot, "datasets.manifest.json"),
    );

    const versionDir = path.join(datasetRoot, "local-2.9.0-rc-2");
    if (await exists(versionDir)) {
      const destVersionDir = path.join(destDatasetRoot, "local-2.9.0-rc-2");
      await fs.mkdir(destVersionDir, { recursive: true });
      for (const subdir of ["partitions", "recipes-shards", "textures"]) {
        const srcSub = path.join(versionDir, subdir);
        if (await exists(srcSub)) {
          await fs.cp(srcSub, path.join(destVersionDir, subdir), { recursive: true });
        }
      }
    }
  }

  // 4. Bundle Cloudflare Worker entrypoint with esbuild
  console.info("Bundling Cloudflare Worker entrypoint (.cf-dist/worker.mjs)...");
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src", "cloudflare", "worker.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    conditions: ["workerd", "worker", "browser"],
    outfile: path.join(cfDistDir, "worker.mjs"),
    external: ["node:*"],
    alias: {
      "next/server": path.join(rootDir, "src", "cloudflare", "next-server-shim.ts"),
      "@": path.join(rootDir, "src"),
    },
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    logLevel: "info",
  });

  console.info("Cloudflare Worker build complete in .cf-dist/");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
