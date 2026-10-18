#!/usr/bin/env node
/**
 * Adapt the read-only GTNH Chinese dictionaries into the assets the app ships.
 *
 * The reference project (gtnh-planner-zh) resolves display names, tooltips and
 * search queries in the browser; here the app itself needs the same two things:
 *
 *   - `game-names.zh-CN.json`  English display name -> Chinese name, the exact
 *     dictionary the resolver answers labels with;
 *   - `game-words.zh-CN.json`  words/materials/patterns for names the dictionary
 *     never spelled out, the *generated approximate* half of the resolver;
 *   - `game-search.zh-CN.json` Chinese word -> English candidates, what turns a
 *     Chinese query into the English one the dataset indexes.
 *
 * Every asset carries its provenance and quality in `game-data.meta.json`:
 * source file checksums, the dataset version the dictionaries were built from,
 * and whether each asset is dictionary-exact or generated-approximate.
 *
 * Run: node tools/i18n-game-data.mjs
 * Source dir override: GTNH_ZH_DICT_DIR=/path/to/dict
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT_DIR = path.join(ROOT, "src", "lib", "i18n");
const SRC_DIR = process.env.GTNH_ZH_DICT_DIR ?? "/root/projects/gtnh-planner-zh/dict";

const CJK = /[\u4e00-\u9fff]/;

async function readJson(name) {
  const file = path.join(SRC_DIR, name);
  const text = await fs.readFile(file, "utf8");
  return { value: JSON.parse(text), sha256: sha256(text), file };
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/** The reference project's dataset manifest, when its cache is present. */
async function readOptionalJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

function isTranslatable(english, chinese) {
  return (
    typeof english === "string" &&
    typeof chinese === "string" &&
    // `.name` and `_comment` are language-file keys, not display names.
    !english.startsWith("_") &&
    !english.startsWith(".") &&
    CJK.test(chinese)
  );
}

/** English display name -> Chinese, from the generated names then the crop table. */
function buildNames(gamedata, crops) {
  const names = new Map();
  for (const [english, chinese] of Object.entries(gamedata)) {
    if (!isTranslatable(english, chinese)) continue;
    names.set(english, chinese.trim());
  }
  // Crop names come from a hand-aligned wiki table and win where they overlap.
  for (const [english, chinese] of Object.entries(crops)) {
    if (!isTranslatable(english, chinese)) continue;
    names.set(english, chinese.trim());
  }
  return Object.fromEntries([...names.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function buildWords(vocab) {
  const words = {};
  for (const [english, chinese] of Object.entries(vocab.words ?? {})) {
    if (typeof chinese === "string" && CJK.test(chinese)) words[english.toLowerCase()] = chinese;
  }
  const materials = {};
  for (const [english, chinese] of Object.entries(vocab.materials ?? {})) {
    if (typeof chinese === "string" && CJK.test(chinese)) materials[english] = chinese;
  }
  const patterns = (vocab.patterns ?? []).filter(
    (pattern) => pattern && pattern.prefix != null && pattern.suffix != null,
  );
  return { words, materials, patterns };
}

function buildSearch(search) {
  const zhWords = {};
  for (const [chinese, list] of Object.entries(search.zhWords ?? {})) {
    if (!CJK.test(chinese) || !Array.isArray(list) || list.length === 0) continue;
    zhWords[chinese] = list.filter((entry) => typeof entry === "string" && entry.length > 0);
  }
  return { zhWords };
}

async function writeAsset(file, value) {
  const text = `${JSON.stringify(value)}\n`;
  await fs.writeFile(path.join(OUT_DIR, file), text);
  return { file, bytes: Buffer.byteLength(text), sha256: sha256(text) };
}

async function main() {
  const [gamedata, vocab, search, crops, report] = await Promise.all([
    readJson("gamedata.json"),
    readJson("vocab.json"),
    readJson("search.json"),
    readJson("crops.json"),
    readJson("report.json"),
  ]);

  await fs.mkdir(OUT_DIR, { recursive: true });

  const names = buildNames(gamedata.value, crops.value);
  const words = buildWords(vocab.value);
  const searchWords = buildSearch(search.value);

  const manifest = await readOptionalJson(
    path.resolve(SRC_DIR, "..", ".cache", "dataset", "datasets.manifest.json"),
  );
  const datasetChecksum =
    manifest?.versions?.find((version) => version.id === report.value.datasetVersion)
      ?.checksumSha256 ?? null;

  const namesAsset = await writeAsset("game-names.zh-CN.json", names);
  const wordsAsset = await writeAsset("game-words.zh-CN.json", words);
  const searchAsset = await writeAsset("game-search.zh-CN.json", searchWords);

  const meta = {
    schemaVersion: 1,
    locale: "zh-CN",
    generatedAt: new Date().toISOString(),
    source: {
      project: "gtnh-planner-zh",
      dictionaryDir: SRC_DIR,
      datasetVersion: report.value.datasetVersion,
      gtnhVersion: report.value.gtnhVersion,
      datasetChecksumSha256: datasetChecksum,
      files: {
        "gamedata.json": gamedata.sha256,
        "vocab.json": vocab.sha256,
        "search.json": search.sha256,
        "crops.json": crops.sha256,
        "report.json": report.sha256,
      },
    },
    target: {
      datasetLine: "gtnh-2.9",
      // The dictionary was aligned against the 2.9 line; RC-2 is the same line,
      // so the resolver answers it and reports the exact source version instead.
      supportedGtnhVersions: ["2.9.0-beta-2", "2.9.0-RC-2"],
    },
    assets: [
      { ...namesAsset, kind: "names", quality: "exact", entries: Object.keys(names).length },
      {
        ...wordsAsset,
        kind: "words",
        quality: "generated",
        entries: Object.keys(words.words).length,
        materials: Object.keys(words.materials).length,
        patterns: words.patterns.length,
      },
      {
        ...searchAsset,
        kind: "search",
        quality: "generated",
        entries: Object.keys(searchWords.zhWords).length,
      },
    ],
    attribution: {
      dictionary: "GT5-Unofficial en_US.lang, Kiwi233/Translation-of-GTNH (MIT), hand-aligned crop table",
      license: "Translation pack: MIT; source language templates: LGPL-3.0. See THIRD_PARTY_NOTICES.md.",
      note: "Dictionary lookup is exact by key and includes previously generated translations. Runtime composed names are approximate. Neither category implies manual certification.",
    },
  };

  await writeAsset("game-data.meta.json", meta);

  for (const asset of meta.assets) {
    console.log(`${asset.file}: ${asset.entries} entries, ${(asset.bytes / 1024).toFixed(0)} KB`);
  }
  console.log(`dataset: ${meta.source.datasetVersion} (${meta.source.gtnhVersion})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
