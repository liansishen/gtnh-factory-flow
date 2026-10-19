// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { queryBoardResourceResults } from "./ResourceIndexPane";

// Resource IDs and English labels follow the published GTNH 2.9.0-RC-2 catalog.
const resources = [
  { kind: "item" as const, id: "gregtech:gt.metaitem.01@17305", displayName: "Steel Plate", recipeCount: 0 },
  { kind: "item" as const, id: "gregtech:gt.metaitem.01@17306", displayName: "Stainless Steel Plate", recipeCount: 0 },
  { kind: "item" as const, id: "minecraft:iron_ingot", displayName: "Iron Ingot", recipeCount: 0 },
];
const request = { mod: "", sort: "relevance" as const, offset: 0, limit: 20 };
const ids = (query: string) => queryBoardResourceResults(resources, { ...request, query }).resources.map(item => item.id);

describe("the board's own resource search", () => {
  it("uses the same canonical resources for Chinese and English names", () => {
    expect(ids("钢板")).toEqual(ids("steel plate"));
    expect(ids("钢板")[0]).toBe("gregtech:gt.metaitem.01@17305");
  });
  it("keeps Chinese fragments and mixed registry/name searches meaningful", () => {
    expect(ids("钢")).toContain("gregtech:gt.metaitem.01@17305");
    expect(ids("gregtech 钢板")).toContain("gregtech:gt.metaitem.01@17305");
    expect(ids("龘靐齉")).toEqual([]);
  });
  it("preserves pagination, mod filters and the input objects", () => {
    const before = JSON.stringify(resources);
    const whole = queryBoardResourceResults(resources, { ...request, query: "钢板" });
    const second = queryBoardResourceResults(resources, { ...request, query: "钢板", offset: 1, limit: 1 });
    expect(second.total).toBe(whole.total);
    expect(second.resources.map(item => item.id)).toEqual(whole.resources.slice(1, 2).map(item => item.id));
    const filtered = queryBoardResourceResults(resources, { ...request, query: "钢板", mod: "minecraft" });
    expect(filtered.total).toBe(0);
    expect(JSON.stringify(resources)).toBe(before);
  });
});

const STEEL_PLATE = "gregtech:gt.metaitem.01@17305";
const IRON_INGOT = "minecraft:iron_ingot";

// Every reading of 钢板 the shared phonetic planner must answer.
const STEEL_PLATE_PINYIN = ["gangban", "gang ban", "gb", "gangb", "gban", "钢ban", "gang板"];

describe("the board's own resource search in pinyin", () => {
  it("reads every pinyin form of 钢板 as Steel Plate", () => {
    for (const reading of STEEL_PLATE_PINYIN) {
      expect(ids(reading), reading).toContain(STEEL_PLATE);
    }
  });

  it("finds the same candidates as the Chinese reading", () => {
    expect(new Set(ids("gangban"))).toEqual(new Set(ids("钢板")));
    expect(new Set(ids("gang ban"))).toEqual(new Set(ids("钢板")));
    expect(ids("gangban")[0]).toBe(STEEL_PLATE);
    expect(ids("gang ban")[0]).toBe(STEEL_PLATE);
  });

  it("keeps a Latin modifier meaningful beside pinyin", () => {
    expect(ids("gt gangban")).toContain(STEEL_PLATE);
    expect(ids("gregtech gangban")).toContain(STEEL_PLATE);
  });

  it("shows nothing, not everything, for unknown pinyin", () => {
    expect(ids("zzzzzqpyn")).toEqual([]);
  });

  it("preserves pagination and mod filters on a pinyin query", () => {
    const before = JSON.stringify(resources);
    const whole = queryBoardResourceResults(resources, { ...request, query: "gangban" });
    const second = queryBoardResourceResults(resources, { ...request, query: "gangban", offset: 1, limit: 1 });
    expect(second.total).toBe(whole.total);
    expect(second.resources.map((item) => item.id)).toEqual(whole.resources.slice(1, 2).map((item) => item.id));

    const gregtech = queryBoardResourceResults(resources, { ...request, query: "gangban", mod: "gregtech" });
    expect(gregtech.resources.map((item) => item.id)).toContain(STEEL_PLATE);

    const minecraft = queryBoardResourceResults(resources, { ...request, query: "gangban", mod: "minecraft" });
    expect(minecraft.total).toBe(0);

    expect(JSON.stringify(resources)).toBe(before);
  });

  it("keeps registry ids and plain acronyms meaningful", () => {
    expect(ids("gregtech:gt.metaitem.01@17305")).toContain(STEEL_PLATE);
    expect(ids("minecraft:iron_ingot")).toContain(IRON_INGOT);
    expect(ids("ebf")).toEqual([]);
  });
});
