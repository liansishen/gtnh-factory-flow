import { describe, expect, it } from "vitest";
import {
  chineseNameCandidates,
  chineseNameToEnglish,
  englishNamesContaining,
  gameDataSupportsGtnhVersion,
  getGameDataMeta,
  resolveGameName,
  translateGameName,
} from "./game-names";

describe("game name translation", () => {
  it("translates a dictionary name exactly", () => {
    expect(translateGameName("Steel Plate", "zh-CN")).toBe("钢板");
    expect(resolveGameName("Steel Plate", "zh-CN").source).toBe("dictionary");
  });

  it("translates a Chinese name back to its canonical English one", () => {
    expect(translateGameName("钢板", "en")).toBe("Steel Plate");
    expect(translateGameName("研磨", "en")).toBe("Macerator");
  });

  it("leaves English alone in English", () => {
    expect(translateGameName("Steel Plate", "en")).toBe("Steel Plate");
    expect(translateGameName("钢板", "zh-CN")).toBe("钢板");
  });

  it("composes a name the dictionary never spelled out, and says so", () => {
    const resolution = resolveGameName("Elite Mass Fabricator", "zh-CN");
    expect(resolution.text).toBe("精英质量发生器");
    expect(resolution.source).toBe("generated");
  });

  it("falls back to the English source rather than half-translating nonsense", () => {
    expect(resolveGameName("Xyzzyplugh", "zh-CN")).toEqual({
      text: "Xyzzyplugh",
      source: "fallback",
    });
  });

  it("never picks one English key for an ambiguous Chinese name", () => {
    // 水果 stands for dozens of nuts and berries; answering it with one of
    // them would be a wrong key, so the resolver refuses and the caller sees
    // the input back.
    expect(chineseNameCandidates("水果").length).toBeGreaterThan(1);
    expect(chineseNameToEnglish("水果")).toBeUndefined();
    expect(resolveGameName("水果", "en")).toEqual({ text: "水果", source: "fallback" });
  });

  it("leaves a registry id as the id when no display label is supplied", () => {
    // The board passes `displayName ?? id`; an id has no translation, and
    // composing one would render "minecraft:石头".
    for (const id of [
      "minecraft:stone",
      "gregtech:gt.metaitem.01@17305",
      "ic2:blockmachine@3",
      "thaumcraft:aspect:aer",
    ]) {
      expect(resolveGameName(id, "zh-CN")).toEqual({ text: id, source: "fallback" });
      expect(translateGameName(id, "en")).toBe(id);
    }
    // A display name still translates; only ids are left alone.
    expect(translateGameName("Steel Plate", "zh-CN")).toBe("钢板");
  });

  it("finds the English names a Chinese fragment appears in", () => {
    expect(englishNamesContaining("石莲", 3)).toContain("Sand Lily");
  });
});

describe("game data metadata", () => {
  it("attributes the dictionary and marks exact against generated", () => {
    const meta = getGameDataMeta();
    expect(meta.source.datasetVersion).toBeTruthy();
    const names = meta.assets.find((asset) => asset.kind === "names");
    const search = meta.assets.find((asset) => asset.kind === "search");
    expect(names?.quality).toBe("exact");
    expect(search?.quality).toBe("generated");
    expect(meta.attribution.license).toContain("MIT");
    expect(meta.attribution.license).toContain("LGPL-3.0");
  });

  it("supports the RC-2 dataset line without mutating anything", () => {
    expect(gameDataSupportsGtnhVersion("2.9.0-RC-2")).toBe(true);
    expect(gameDataSupportsGtnhVersion("2.9.84")).toBe(true);
    expect(gameDataSupportsGtnhVersion("2.8.0")).toBe(false);
  });
});

it("returns display strings for object-prototype keys", () => {
  for (const name of ["constructor", "toString", "__proto__"]) {
    expect(typeof translateGameName(name, "zh-CN")).toBe("string");
  }
});
