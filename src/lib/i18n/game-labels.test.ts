import { describe, expect, it } from "vitest";
import { translateGameLabel } from "./game-labels";
import { translateGameName } from "./game-names";
import { translateMessage } from "./messages";
import { planBilingualQuery } from "./game-search";
import { buildPinyinSearchIndex } from "./pinyin-search";

const electricTools = ["Drill", "Chainsaw", "Wrench", "JackHammer", "Buzzsaw", "Screwdriver", "Soldering Iron", "Wire Cutter", "File"];
const tieredNames = electricTools.flatMap(tool => ["LV", "MV", "HV"].map(tier => `${tool} (${tier})`));

describe("game labels and UI rules", () => {
  it.each(tieredNames)("localizes %s beyond a punctuation-only UI match", name => {
    expect(translateMessage(name, "zh-CN")).toMatch(/[A-Za-z]+.*（(?:LV|MV|HV)）$/);
    const translated = translateGameLabel(name, "zh-CN");
    expect(translated).toBe(translateGameName(name, "zh-CN"));
    expect(translated).toMatch(/[\u4e00-\u9fff]/);
    expect(translated.match(/[A-Za-z]+/g)).toEqual([name.match(/\((\w+)\)$/)![1]]);
    expect(translateGameLabel(name, "en")).toBe(name);
  });

  it.each(["LV", "MV", "HV"])("uses the corrected JackHammer %s tier in Chinese and pinyin search", tier => {
    expect(planBilingualQuery(`气锤(${tier})`)?.english).toBe(`JackHammer (${tier})`);
    const index = buildPinyinSearchIndex([`JackHammer (${tier})`]);
    expect(index.search("qichui").map(hit => hit.name)).toContain(`JackHammer (${tier})`);
  });

  it.each([
    ["Wrench", "扳手"],
    ["File", "锉"],
    ["Screwdriver", "螺丝刀"],
    ["Hammer", "锻造锤"],
    ["Soft Mallet", "软锤"],
    ["Wire Cutter", "剪线钳"],
    ["Pocket Multitool (File)", "万能工具(锉)"],
    ["Power", "发电"],
    ["Power (EU/t)", "电力（EU/t）"],
    ["3 recipes", "3 个配方"],
    ["0 recipes", "0 个配方"],
    ["Not consumed", "不消耗"],
    ["Water", "水"],
  ])("preserves the existing translation of %s", (source, expected) => {
    expect(translateGameLabel(source, "zh-CN")).toBe(expected);
    expect(translateGameLabel(source, "en")).toBe(source);
  });

  it("keeps unknown names, registry IDs and raw NBT safe", () => {
    for (const source of ["Xyzzyplugh", "gregtech:gt.metatool.01@120", 'NBT: {Name:"Wrench (LV)"}']) {
      expect(translateGameLabel(source, "zh-CN")).toBe(source);
    }
    expect(translateGameLabel("Xyzzyplugh (LV)", "zh-CN")).toBe("Xyzzyplugh（LV）");
  });
});

describe("input consumption labels", () => {
  it.each([
    ["Leaves (used up 10% of runs)", "树叶（每次运行有 10% 的概率消耗）"],
    ["Water (used up 12.5% of runs)", "水（每次运行有 12.5% 的概率消耗）"],
    ["Xyzzyplugh (used up 0.1% of runs)", "Xyzzyplugh（每次运行有 0.1% 的概率消耗）"],
  ])("translates the resource and the consumption note in %s", (source, expected) => {
    expect(translateGameLabel(source, "zh-CN")).toBe(expected);
    expect(translateGameLabel(source, "en")).toBe(source);
  });

  it("translates standalone probability values in game-label fields", () => {
    expect(translateGameLabel("10% of runs", "zh-CN")).toBe("每次运行有 10% 的概率");
    expect(translateGameLabel("10% of runs", "en")).toBe("10% of runs");
  });
});
