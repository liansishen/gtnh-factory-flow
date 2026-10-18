import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildMissing,
  collectInventory,
  excludedFileReason,
  extractCandidates,
  measureCoverage,
  nonCopyReason,
  normalizeJsxText,
} from "./i18n-report.ts";

describe("i18n report walker", () => {
  it("collapses JSX whitespace into one key", () => {
    expect(normalizeJsxText("\n   Save\n   plan\n ")).toBe("Save plan");
    expect(normalizeJsxText("   \n\t ")).toBe("");
    expect(normalizeJsxText("a card&apos;s &ldquo;name&rdquo; &amp; &#x94a2;")).toBe('a card\'s “name” & 钢');
  });

  it("names the reason a string is not UI copy", () => {
    expect(nonCopyReason("gtnh-locale")).toBe("identifier-or-class");
    expect(nonCopyReason("/items/dust.png")).toBe("path");
    expect(nonCopyReason("minecraft:stick")).toBe("resource-id-or-scheme");
    expect(nonCopyReason("https://gtnhplanner.com")).toBe("url");
    expect(nonCopyReason("Close (Esc)")).toBeUndefined();
    expect(nonCopyReason("Language / 语言")).toBeUndefined();
  });

  it("excludes files that are not player UI", () => {
    expect(excludedFileReason("src/store/design-store.test.ts")).toBe("test-file");
    expect(excludedFileReason("src/lib/i18n/locale.ts")).toBe("translation-assets");
    expect(excludedFileReason("src/components/i18n/LanguageSelect.tsx")).toBe("language-control");
    expect(excludedFileReason("src/examples/biodiesel-demo.ts")).toBe("fixture-or-example");
    expect(excludedFileReason("src/lib/solver/plan/__fixtures__/digest.ts")).toBe("fixture-or-example");
    expect(excludedFileReason("src/components/BoardActions.tsx")).toBeUndefined();
  });

  it("inventories JSX text, user-facing attributes and translator calls", () => {
    const source = `
      import { useT } from "@/lib/i18n/react";
      export function Card() {
        const _i18nT = useT();
        return (
          <button className="ms-row" title={_i18nT("Close")} aria-label="Close">
            Save plan
            <span>{"Static"}</span>
          </button>
        );
      }
    `;
    const { candidates, excluded } = extractCandidates("src/components/Card.tsx", source);
    const texts = candidates.map((candidate) => `${candidate.kind}:${candidate.evidence}:${candidate.text}`);

    expect(texts).toContain("jsx-text:verified:Save plan");
    expect(texts).toContain("jsx-text:verified:Static");
    expect(texts).toContain("jsx-attr:verified:Close");
    expect(texts).toContain("message-call:candidate:Close");

    const call = candidates.find((candidate) => candidate.kind === "message-call");
    expect(call?.translatorBacked).toBe(true);
    expect(excluded.some((entry) => entry.reason === "css-class-name" && entry.text === "ms-row")).toBe(true);
  });

  it("marks a translate-named call without the i18n import as unbacked", () => {
    const source = `const t = (s: string) => s; export const x = t("Hello");`;
    const { candidates } = extractCandidates("src/lib/thing.ts", source);
    const call = candidates.find((candidate) => candidate.kind === "message-call");

    expect(call?.text).toBe("Hello");
    expect(call?.evidence).toBe("candidate");
    expect(call?.translatorBacked).toBe(false);
  });

  it("includes settings and changelog messages held in data while excluding canonical fields", () => {
    const settings = extractCandidates("src/components/chrome/ModSettings.tsx", `const sections = [{ name: "Board", rows: [{ label: "Font", about: "Sets the font of the planner.", names: ["Left", "Right"] }] }];`);
    expect(settings.candidates.filter(candidate => candidate.kind === "data-message").map(candidate => candidate.text)).toEqual(["Board", "Font", "Sets the font of the planner.", "Left", "Right"]);
    const changelog = extractCandidates("src/lib/changelog.ts", `const entries = [{ version: "4.2.0", date: "2026-10-17", headline: "Pick where the zoomed-out view starts", notes: ["Settings has a slider."] }];`);
    expect(changelog.candidates.map(candidate => candidate.text)).toEqual(["Pick where the zoomed-out view starts", "Settings has a slider."]);
    expect(buildMissing(changelog.candidates).some(entry => entry.text === "Settings has a slider.")).toBe(true);
    const canonical = extractCandidates("src/lib/model/resources.ts", `const x = { name: "Steel Plate", id: "gregtech:item" };`);
    expect(canonical.candidates).toEqual([]);
    const controls = extractCandidates("src/components/chrome/ControlsList.tsx", `const CONTROLS = [["Ctrl+A", "Select everything"], ["Delete", "Delete the selection"]];`);
    expect(controls.candidates.map(candidate => candidate.text)).toEqual(["Select everything", "Delete the selection"]);
    expect(controls.excluded.filter(entry => entry.reason === "keyboard-token")).toHaveLength(2);
  });
});

describe("i18n report coverage", () => {
  it("counts a fallback, never a fake hundred", () => {
    const coverage = measureCoverage(["Zzz nonsense zzz"]);
    expect(coverage.fallback).toBe(1);
    expect(coverage.covered).toBe(0);
    expect(coverage.percent).toBe(0);
  });

  it("counts a dynamic rule match as covered", () => {
    const coverage = measureCoverage(["3 pages"]);
    expect(coverage.covered).toBe(1);
    expect(coverage.rule).toBe(1);
  });

  it("lists missing strings with their locations", () => {
    const { candidates } = extractCandidates("src/components/X.tsx", `<span>Zzz nonsense zzz</span>`);
    const missing = buildMissing(candidates);

    expect(missing).toHaveLength(1);
    expect(missing[0].text).toBe("Zzz nonsense zzz");
    expect(missing[0].evidence).toBe("verified");
    expect(missing[0].locations[0]).toEqual({ file: "src/components/X.tsx", line: 1, column: 7 });
  });
});

describe("i18n report inventory over a tree", () => {
  it("skips excluded files and reads the rest", () => {
    const dir = fs.mkdtempSync(path.join(process.env.GTNH_TEST_TMP ?? os.tmpdir(), "i18n-report-"));
    try {
      fs.mkdirSync(path.join(dir, "src", "components"), { recursive: true });
      fs.writeFileSync(path.join(dir, "src", "components", "A.tsx"), `<span>Zzz nonsense zzz</span>`);
      fs.writeFileSync(path.join(dir, "src", "components", "A.test.tsx"), `<span>Test only string</span>`);

      const inventory = collectInventory(dir);
      const texts = inventory.candidates.map((candidate) => candidate.text);

      expect(inventory.filesScanned).toBe(1);
      expect(texts).toContain("Zzz nonsense zzz");
      expect(texts).not.toContain("Test only string");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
