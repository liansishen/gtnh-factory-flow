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
