#!/usr/bin/env node
/** Static UI-message lookup inventory, measured through the shipped translator.
 * Runtime wiring and dynamic data require separate component/browser checks.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import ts from "typescript";

import { hasMessageTranslation, translateMessage } from "../src/lib/i18n/messages";
import { getGameDataMeta, resolveGameName } from "../src/lib/i18n/game-names";

export type CandidateKind = "jsx-text" | "jsx-attr" | "message-call" | "data-message";
export type Evidence = "verified" | "candidate";

export interface Candidate {
  text: string;
  kind: CandidateKind;
  evidence: Evidence;
  /** A message-call candidate only: whether the file imports the i18n translator. */
  translatorBacked?: boolean;
  file: string;
  line: number;
  column: number;
}

export interface ExcludedString {
  reason: string;
  text: string;
  file: string;
  line: number;
}

export interface Extraction {
  candidates: Candidate[];
  excluded: ExcludedString[];
}

/** Props whose string value is read by a person, so they are UI copy. */
const USER_FACING_ATTRS = new Set([
  "title",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "placeholder",
  "alt",
  "label",
]);

/** Callee names that plausibly translate. Only an i18n import makes them verified. */
const TRANSLATE_CALLEES = new Set(["t", "_i18nT", "translate", "translateMessage", "tr", "i18nT"]);

/** Directories that are not player-facing UI, or are the translation assets themselves. */
const EXCLUDED_DIRS: readonly { prefix: string; reason: string }[] = [
  { prefix: "src/lib/i18n/", reason: "translation-assets" },
  { prefix: "src/components/i18n/", reason: "language-control" },
  { prefix: "src/app/dev/", reason: "dev-only" },
  { prefix: "src/examples/", reason: "fixture-or-example" },
  { prefix: "examples/", reason: "fixture-or-example" },
];

export function excludedFileReason(relPath: string): string | undefined {
  const posix = relPath.split(path.sep).join("/");
  if (/(^|\/)[^/]*\.test\.[^/]+$/.test(posix) || /\.local\.test\.[^/]+$/.test(posix)) {
    return "test-file";
  }
  if (posix.includes("__fixtures__/")) {
    return "fixture-or-example";
  }
  for (const dir of EXCLUDED_DIRS) {
    if (posix.startsWith(dir.prefix)) {
      return dir.reason;
    }
  }
  return undefined;
}

/**
 * JSX collapses runs of whitespace and drops indentation; do the same so a
 * string split across lines is one key. Returns "" when nothing readable is
 * left (pure punctuation, entities, layout).
 */
export function normalizeJsxText(raw: string): string {
  const entities: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", deg: "°", times: "×", middot: "·", hellip: "…",
  };
  return raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith("#")) {
      const point = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    return entities[entity] ?? whole;
  }).replace(/\s+/g, " ").trim();
}

function hasReadableLetter(text: string): boolean {
  return /[\p{L}]/u.test(text);
}

/**
 * A string that is plainly not UI copy: an id, a class, a path, a URL, a
 * resource key or a file name. Returning a reason excludes it and counts it.
 */
export function nonCopyReason(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return "empty";
  }
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes("://")) {
    return "url";
  }
  if (/^data:/i.test(trimmed)) {
    return "data-url";
  }
  if (/^[./]/.test(trimmed)) {
    return "path";
  }
  if (/\.(png|jpe?g|webp|gif|svg|ogg|mp3|wav|json|ts|tsx|mjs|js|css|txt|md|woff2?|ttf|otf)$/i.test(trimmed)) {
    return "file-name";
  }
  if (/^[a-z0-9]+([._-][a-z0-9]+)+$/.test(trimmed)) {
    return "identifier-or-class";
  }
  if (!/\s/.test(trimmed) && /\S:\S/.test(trimmed)) {
    return "resource-id-or-scheme";
  }
  if (/^[a-z0-9]+:[a-z0-9]/i.test(trimmed) && !/\s/.test(trimmed)) {
    return "resource-id-or-scheme";
  }
  if (/^(?:EU(?:\/t)?(?: ≤)?|L\/s|ms|s(?: ·)?|0A|A(?: ×| each\)| per hatch\)|:)?|s ÷ \(1\+|N|NC(?: · ×)?|v|x|GTNH(?: Planner)?)$/.test(trimmed)) {
    return "technical-literal";
  }
  if (!hasReadableLetter(trimmed)) {
    return "no-readable-text";
  }
  return undefined;
}

/**
 * The strings one source file contributes. Pure: same source in, same
 * candidates out, so a test can pin the walker without touching the repo.
 */
export function extractCandidates(fileName: string, source: string): Extraction {
  const scriptKind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);
  const candidates: Candidate[] = [];
  const excluded: ExcludedString[] = [];
  let importsTranslator = false;

  const locate = (node: ts.Node) => {
    const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return { line: pos.line + 1, column: pos.character + 1 };
  };

  const add = (text: string, kind: CandidateKind, evidence: Evidence, node: ts.Node, translatorBacked?: boolean) => {
    const reason = nonCopyReason(text);
    if (reason) {
      const at = locate(node);
      excluded.push({ reason, text, file: fileName, ...at });
      return;
    }
    const at = locate(node);
    candidates.push({ text, kind, evidence, translatorBacked, file: fileName, ...at });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      if (/(^|\/)i18n(\/|$)/.test(specifier)) {
        importsTranslator = true;
      }
    }
  }

  const dataFile = ["src/lib/changelog.ts", "src/components/chrome/ModSettings.tsx", "src/components/chrome/ControlsList.tsx", "src/components/chrome/settings-model.ts"].includes(fileName);
  const dataProperties = new Set(["label", "hint", "about", "name", "intro", "headline", "warning", "notes", "names"]);
  const addData = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (fileName.endsWith("/ControlsList.tsx") && ["Ctrl+A", "Ctrl+C, Ctrl+X, Ctrl+V", "Ctrl+Z, Ctrl+Shift+Z", "Delete"].includes(node.text)) {
        excluded.push({ reason: "keyboard-token", text: node.text, file: fileName, ...locate(node) });
        return;
      }
      add(node.text, "data-message", "candidate", node);
    } else if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach(addData);
    }
  };

  const visit = (node: ts.Node): void => {
    if (dataFile && ts.isPropertyAssignment(node) && dataProperties.has(node.name.getText(sourceFile).replace(/^['"]|['"]$/g, ""))) {
      addData(node.initializer);
    }
    if (dataFile && ts.isVariableDeclaration(node) && node.initializer && /^(CONTROLS|WHEEL_ROW|SIZE_NAMES|SOUND_NAMES)$/.test(node.name.getText(sourceFile))) {
      addData(node.initializer);
    }
    if (ts.isJsxText(node)) {
      const text = normalizeJsxText(node.text);
      if (text) {
        add(text, "jsx-text", "verified", node);
      }
      return;
    }

    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      ts.isStringLiteral(node.expression) &&
      !ts.isJsxAttribute(node.parent)
    ) {
      const text = normalizeJsxText(node.expression.text);
      if (text) {
        add(text, "jsx-text", "verified", node.expression);
      }
    }

    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      const initializer = node.initializer;
      if (initializer && ts.isStringLiteral(initializer)) {
        if (USER_FACING_ATTRS.has(name)) {
          const text = normalizeJsxText(initializer.text);
          if (text) {
            add(text, "jsx-attr", "verified", initializer);
          }
        } else {
          const at = locate(initializer);
          excluded.push({
            reason: name === "className" || name === "class" ? "css-class-name" : "non-user-attribute",
            text: initializer.text,
            file: fileName,
            ...at,
          });
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const calleeName = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)
          ? callee.name.text
          : undefined;
      if (calleeName && TRANSLATE_CALLEES.has(calleeName)) {
        const argument = node.arguments[0];
        if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
          const text = argument.text;
          if (text.trim()) {
            add(text, "message-call", "candidate", argument, importsTranslator);
          } else {
            const at = locate(argument);
            excluded.push({ reason: "empty", text, file: fileName, ...at });
          }
        } else if (argument) {
          const at = locate(argument);
          excluded.push({ reason: "non-literal-message-argument", text: "", file: fileName, ...at });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { candidates, excluded };
}

/** Every .ts/.tsx under a source directory, repo-relative and sorted for determinism. */
export function listSourceFiles(rootDir: string, sourceDir = "src"): string[] {
  const base = path.join(rootDir, sourceDir);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        out.push(path.relative(rootDir, full).split(path.sep).join("/"));
      }
    }
  };
  if (fs.existsSync(base)) {
    walk(base);
  }
  return out;
}

export interface Inventory {
  filesScanned: number;
  candidates: Candidate[];
  excluded: ExcludedString[];
}

export function collectInventory(rootDir: string, sourceDir = "src"): Inventory {
  const candidates: Candidate[] = [];
  const excluded: ExcludedString[] = [];
  let filesScanned = 0;
  for (const rel of listSourceFiles(rootDir, sourceDir)) {
    const reason = excludedFileReason(rel);
    if (reason) {
      continue;
    }
    filesScanned += 1;
    const source = fs.readFileSync(path.join(rootDir, rel), "utf8");
    const extraction = extractCandidates(rel, source);
    candidates.push(...extraction.candidates);
    excluded.push(...extraction.excluded);
  }
  return { filesScanned, candidates, excluded };
}

export interface Coverage {
  total: number;
  covered: number;
  exact: number;
  rule: number;
  fallback: number;
  percent: number;
}

const hasExact = hasMessageTranslation;

function roundPercent(covered: number, total: number): number {
  return total === 0 ? 0 : Math.round((covered / total) * 1000) / 10;
}

/** Run the shipped translator over a set of distinct source strings. */
export function measureCoverage(texts: Iterable<string>): Coverage {
  let exact = 0;
  let rule = 0;
  let fallback = 0;
  for (const text of texts) {
    const translated = translateMessage(text, "zh-CN");
    if (translated === text) {
      fallback += 1;
    } else if (hasExact(text)) {
      exact += 1;
    } else {
      rule += 1;
    }
  }
  const total = exact + rule + fallback;
  const covered = exact + rule;
  return { total, covered, exact, rule, fallback, percent: roundPercent(covered, total) };
}

function distinct(texts: Iterable<string>): Set<string> {
  return new Set(texts);
}

export interface MissingEntry {
  text: string;
  kind: CandidateKind;
  evidence: Evidence;
  translatorBacked?: boolean;
  locations: Array<{ file: string; line: number; column: number }>;
}

export function buildMissing(candidates: Candidate[]): MissingEntry[] {
  const byText = new Map<string, MissingEntry>();
  for (const candidate of candidates) {
    if (translateMessage(candidate.text, "zh-CN") !== candidate.text) {
      continue;
    }
    let entry = byText.get(candidate.text);
    if (!entry) {
      entry = {
        text: candidate.text,
        kind: candidate.kind,
        evidence: candidate.evidence,
        translatorBacked: candidate.translatorBacked,
        locations: [],
      };
      byText.set(candidate.text, entry);
    }
    entry.locations.push({ file: candidate.file, line: candidate.line, column: candidate.column });
  }
  return [...byText.values()].sort((a, b) => a.text.localeCompare(b.text));
}

export interface NameEngineReport {
  assets: ReturnType<typeof getGameDataMeta>["assets"];
  attribution: ReturnType<typeof getGameDataMeta>["attribution"];
  dataset: {
    datasetVersionId: string;
    gtnhVersion: string;
    resourceCount: number;
    measured: { dictionary: number; generated: number; fallback: number };
    percent: number;
    byKind: Record<string, { dictionary: number; generated: number; fallback: number }>;
  } | null;
  note: string;
}

/** Measure the name engine over the dataset the app actually ships with. */
export function measureNameEngine(rootDir: string): NameEngineReport {
  const meta = getGameDataMeta();
  const manifestPath = path.join(rootDir, "public", "datasets", "gtnh", "datasets.manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return {
      assets: meta.assets,
      attribution: meta.attribution,
      dataset: null,
      note: "No local dataset manifest; name-engine coverage over the dataset is not measured.",
    };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    versions?: Array<{ id: string; gtnhVersion: string; resourceIndexPath?: string }>;
  };
  const version = manifest.versions?.[0];
  if (!version?.resourceIndexPath) {
    return {
      assets: meta.assets,
      attribution: meta.attribution,
      dataset: null,
      note: "The dataset manifest lists no resource index; name-engine coverage is not measured.",
    };
  }

  const resourcePath = path.join(rootDir, "public", version.resourceIndexPath.replace(/^\/+/, ""));
  if (!fs.existsSync(resourcePath)) {
    return {
      assets: meta.assets,
      attribution: meta.attribution,
      dataset: null,
      note: `The dataset's resource index is missing (${resourcePath}); name-engine coverage is not measured.`,
    };
  }

  const parsed = JSON.parse(gunzipSync(fs.readFileSync(resourcePath)).toString("utf8")) as {
    resources?: Array<{ kind?: string; displayName?: string }>;
  };
  const resources = parsed.resources ?? [];
  const byKind: Record<string, { dictionary: number; generated: number; fallback: number }> = {};
  const totals = { dictionary: 0, generated: 0, fallback: 0 };
  let resourceCount = 0;
  for (const resource of resources) {
    const name = resource.displayName;
    if (!name) {
      continue;
    }
    resourceCount += 1;
    const source = resolveGameName(name, "zh-CN").source;
    totals[source] += 1;
    const kind = resource.kind ?? "unknown";
    byKind[kind] ??= { dictionary: 0, generated: 0, fallback: 0 };
    byKind[kind][source] += 1;
  }
  const covered = totals.dictionary + totals.generated;

  return {
    assets: meta.assets,
    attribution: meta.attribution,
    dataset: {
      datasetVersionId: version.id,
      gtnhVersion: version.gtnhVersion,
      resourceCount,
      measured: totals,
      percent: roundPercent(covered, resourceCount),
      byKind,
    },
    note: "Measured over every resource displayName in the supported dataset's resource index.",
  };
}

function excludedSummary(excluded: ExcludedString[]) {
  const byReason: Record<string, number> = {};
  const examples: Record<string, string[]> = {};
  for (const entry of excluded) {
    byReason[entry.reason] = (byReason[entry.reason] ?? 0) + 1;
    if (entry.text) {
      const list = (examples[entry.reason] ??= []);
      if (list.length < 5 && !list.includes(entry.text)) {
        list.push(entry.text);
      }
    }
  }
  return { occurrences: excluded.length, byReason, examples };
}

function gitSource(rootDir: string): { commit?: string; dirty?: boolean } {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir }).toString().trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: rootDir }).toString().trim().length > 0;
    return { commit, dirty };
  } catch {
    return {};
  }
}

export interface Report {
  generatedAt: string;
  tool: string;
  locale: string;
  notes: string[];
  source: { commit?: string; dirty?: boolean };
  inventory: {
    filesScanned: number;
    occurrences: number;
    distinctStrings: number;
    byKind: Record<string, number>;
    byEvidence: Record<string, number>;
  };
  coverage: {
    verified: Coverage;
    candidate: Coverage;
    all: Coverage;
    data: Coverage;
  };
  excluded: ReturnType<typeof excludedSummary>;
  missing: MissingEntry[];
  nameEngine: NameEngineReport;
}

export function buildReport(rootDir: string, generatedAt = new Date().toISOString()): Report {
  const inventory = collectInventory(rootDir);
  const verifiedCandidates = inventory.candidates.filter((candidate) => candidate.evidence === "verified");
  const candidateCandidates = inventory.candidates.filter((candidate) => candidate.kind === "message-call");
  const dataCandidates = inventory.candidates.filter((candidate) => candidate.kind === "data-message");

  const byKind: Record<string, number> = {};
  const byEvidence: Record<string, number> = {};
  for (const candidate of inventory.candidates) {
    byKind[candidate.kind] = (byKind[candidate.kind] ?? 0) + 1;
    byEvidence[candidate.evidence] = (byEvidence[candidate.evidence] ?? 0) + 1;
  }

  const allTexts = distinct(inventory.candidates.map((candidate) => candidate.text));
  const verifiedTexts = distinct(verifiedCandidates.map((candidate) => candidate.text));
  const candidateTexts = distinct(candidateCandidates.map((candidate) => candidate.text));
  const dataTexts = distinct(dataCandidates.map((candidate) => candidate.text));

  return {
    generatedAt,
    tool: "tools/i18n-report.ts",
    locale: "zh-CN",
    notes: [
      "Verified inventory = JSX text and user-facing attributes (title, aria-label, placeholder, alt, label): static strings in UI-facing syntax; runtime integration is verified separately.",
      "Candidate = a string passed to a translate-named call; translatorBacked says whether the file imports the i18n translator. Data messages separately include settings, controls and changelog literals rendered through dynamic fields.",
      "Covered = the shipped translateMessage returns something other than its English input. Fallback is the honest gap.",
      "exact = the shipped translator answered from its merged catalogs; rule = a dynamic rule matched. Message lookup coverage is separate from runtime integration and name-generation quality.",
      "Excluded (with reasons): identifiers, CSS class names, resource ids, paths, URLs, file names, tests, fixtures, examples, dev-only screens and the language control.",
    ],
    source: gitSource(rootDir),
    inventory: {
      filesScanned: inventory.filesScanned,
      occurrences: inventory.candidates.length,
      distinctStrings: allTexts.size,
      byKind,
      byEvidence,
    },
    coverage: {
      verified: measureCoverage(verifiedTexts),
      candidate: measureCoverage(candidateTexts),
      all: measureCoverage(allTexts),
      data: measureCoverage(dataTexts),
    },
    excluded: excludedSummary(inventory.excluded),
    missing: buildMissing(inventory.candidates),
    nameEngine: measureNameEngine(rootDir),
  };
}

export function writeReports(rootDir: string, report: Report): { coverage: string; missing: string } {
  const docsDir = path.join(rootDir, "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  const coveragePath = path.join(docsDir, "i18n-coverage.json");
  const missingPath = path.join(docsDir, "i18n-missing.json");
  fs.writeFileSync(coveragePath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(
    missingPath,
    `${JSON.stringify(
      {
        generatedAt: report.generatedAt,
        locale: report.locale,
        count: report.missing.length,
        entries: report.missing,
      },
      null,
      2,
    )}\n`,
  );
  return { coverage: coveragePath, missing: missingPath };
}

function main(): void {
  const rootDir = process.cwd();
  const report = buildReport(rootDir);
  const { coverage, missing } = writeReports(rootDir, report);

  const c = report.coverage;
  console.log(`i18n coverage (${report.locale})`);
  console.log(
    `  verified inventory: ${c.verified.covered}/${c.verified.total} (${c.verified.percent}%), ` +
      `${c.verified.fallback} fallback`,
  );
  console.log(
    `  candidates:         ${c.candidate.covered}/${c.candidate.total} (${c.candidate.percent}%), ` +
      `${c.candidate.fallback} fallback`,
  );
  console.log(`  data messages:      ${c.data.covered}/${c.data.total} (${c.data.percent}%), ${c.data.fallback} fallback`);
  console.log(`  all distinct:       ${c.all.covered}/${c.all.total} (${c.all.percent}%)`);
  const engine = report.nameEngine.dataset;
  if (engine) {
    console.log(
      `  name engine:        ${engine.measured.dictionary} dictionary, ${engine.measured.generated} generated, ` +
        `${engine.measured.fallback} fallback of ${engine.resourceCount} (${engine.percent}%) on ${engine.datasetVersionId}`,
    );
  }
  console.log(`wrote ${path.relative(rootDir, coverage)} and ${path.relative(rootDir, missing)}`);
}

const invokedDirectly = process.argv[1] !== undefined && /i18n-report\.(ts|js|mjs)$/.test(process.argv[1]);
if (invokedDirectly) {
  main();
}
