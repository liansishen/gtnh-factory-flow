import { describe, expect, it } from "vitest";
import { bilingualSearch, matchesGameNameFilter, planBilingualQuery } from "./game-search";
import { getChineseNameIndex } from "./game-names";

describe("bilingual query planning", () => {
  it("maps a whole Chinese name to its canonical English name", () => {
    expect(planBilingualQuery("钢板")).toMatchObject({ kind: "exact", english: "Steel Plate" });
    expect(planBilingualQuery("研磨")).toMatchObject({ kind: "exact", english: "Macerator" });
  });

  it("maps a Chinese fragment to the English word the dataset uses", () => {
    expect(planBilingualQuery("钢")).toMatchObject({ kind: "tokens", english: "steel" });
    expect(planBilingualQuery("研磨机")).toMatchObject({ kind: "tokens", english: "macerator" });
  });

  it("keeps Latin modifiers and units while translating the Chinese part", () => {
    expect(planBilingualQuery("gt 钢板")).toMatchObject({ english: "gt steel plate" });
    expect(planBilingualQuery("HV 研磨机")).toMatchObject({ english: "HV macerator" });
    const units = planBilingualQuery("512 EU/t 钢板");
    expect(units?.english).toContain("512");
    expect(units?.english.toLowerCase()).toContain("eu");
  });

  it("offers looser readings to try when the strict one finds nothing", () => {
    expect(planBilingualQuery("gt 钢板")?.alternatives).toContain("steel plate");
    expect(planBilingualQuery("HV 研磨机")?.alternatives).toContain("macerator");
    expect(planBilingualQuery("铂线")?.alternatives).toContain("platinum");
  });

  it("leaves English queries untouched", () => {
    expect(planBilingualQuery("Steel Plate")).toBeUndefined();
    expect(planBilingualQuery("")).toBeUndefined();
  });

  it("does not turn an unknown Chinese word into a blank query", () => {
    const plan = planBilingualQuery("不存在的词");
    expect(plan).toMatchObject({ kind: "none", english: "", unresolved: true });
    expect(bilingualSearch("不存在的词")).toEqual({
      text: "",
      alternatives: [],
      unresolved: true,
    });
  });

  it("folds full-width characters and drops spaces between Chinese words", () => {
    expect(planBilingualQuery("钢 板")).toMatchObject({ english: "Steel Plate" });
  });
});

describe("Chinese in in-page filters", () => {
  it("matches a name the query names exactly", () => {
    expect(matchesGameNameFilter("钢板", "Steel Plate")).toBe(true);
    expect(matchesGameNameFilter("钢板", "Steel Ingot")).toBe(false);
  });

  it("matches every name a fragment covers", () => {
    expect(matchesGameNameFilter("钢", "Steel Ingot")).toBe(true);
    expect(matchesGameNameFilter("研磨机", "Basic Macerator")).toBe(true);
  });

  it("matches a mixed query against the resource the Chinese part names", () => {
    expect(matchesGameNameFilter("HV 研磨机", "Basic Macerator")).toBe(true);
  });

  it("shows nothing, not everything, for an unknown Chinese word", () => {
    expect(matchesGameNameFilter("不存在的词", "Steel Plate")).toBe(false);
  });

  it("keeps plain English filtering", () => {
    expect(matchesGameNameFilter("steel", "Steel Plate")).toBe(true);
    expect(matchesGameNameFilter("", "Steel Plate")).toBe(true);
  });
});

describe("dictionary keys and queries share one normalization", () => {
  it("answers a name written with the full-width punctuation the dictionary uses", () => {
    for (const query of ["提示方块：1号", "提示方块:1号"]) {
      expect(planBilingualQuery(query)).toMatchObject({ kind: "exact", english: "Hint 1 dot" });
    }
    for (const query of ["铸件（螺栓）", "铸件(螺栓)"]) {
      expect(planBilingualQuery(query)).toMatchObject({
        kind: "exact",
        english: "Casting Form (Bolt Mold)",
      });
    }
  });

  it("keeps every English candidate of a known but ambiguous name", () => {
    expect(planBilingualQuery("甜菜")).toMatchObject({
      kind: "candidates",
      english: "Beet",
      candidates: ["Beet", "Beetroot", "Beet Crop", "Sugar Beet"],
      unresolved: false,
    });
    expect(planBilingualQuery("番茄")).toMatchObject({
      kind: "candidates",
      english: "Tomato",
      candidates: ["Tomato", "Sapphirum", "Tomato Crop"],
      unresolved: false,
    });
    expect(planBilingualQuery("蜂蜡")).toMatchObject({
      kind: "candidates",
      english: "Beeswax",
      candidates: ["Beeswax", "Magic Wax", "Amnesic Wax", "Soulful Wax"],
      unresolved: false,
    });
  });

  it("round-trips every dictionary name through the planner", () => {
    const failures: string[] = [];
    for (const [chinese, englishNames] of getChineseNameIndex()) {
      const plan = planBilingualQuery(chinese);
      if (!plan || plan.unresolved) {
        failures.push(`unresolved ${chinese}`);
      } else if (
        englishNames.length === 1 &&
        (plan.kind !== "exact" || plan.english !== englishNames[0])
      ) {
        failures.push(`${chinese}: ${plan.kind} ${plan.english}, expected ${englishNames[0]}`);
      }
    }
    expect(failures.slice(0, 20)).toEqual([]);
  });
});

describe("punctuated and ambiguous Chinese names in an in-page filter", () => {
  it("matches a name whose dictionary key carries full-width punctuation", () => {
    expect(matchesGameNameFilter("提示方块：1号", "Hint 1 dot")).toBe(true);
    expect(matchesGameNameFilter("提示方块:1号", "Hint 1 dot")).toBe(true);
    expect(matchesGameNameFilter("铸件（螺栓）", "Casting Form (Bolt Mold)")).toBe(true);
    expect(matchesGameNameFilter("铸件(螺栓)", "Casting Form (Bolt Mold)")).toBe(true);
  });

  it("matches every candidate of a known but ambiguous name", () => {
    expect(matchesGameNameFilter("甜菜", "Beet")).toBe(true);
    expect(matchesGameNameFilter("甜菜", "Beetroot")).toBe(true);
    expect(matchesGameNameFilter("番茄", "Tomato")).toBe(true);
    expect(matchesGameNameFilter("蜂蜡", "Beeswax")).toBe(true);
  });

  it("still shows nothing for unknown Chinese", () => {
    expect(matchesGameNameFilter("不存在的词", "Hint 1 dot")).toBe(false);
  });
});

describe("pinyin local-filter precision", () => {
  it("requires the full inline mixed reading", () => {
    expect(matchesGameNameFilter("钢ban", "Steel Plate")).toBe(true);
    expect(matchesGameNameFilter("钢ban", "Steel Ingot")).toBe(false);
    expect(matchesGameNameFilter("钢plate", "Steel Plate")).toBe(true);
    expect(matchesGameNameFilter("钢plate", "Steel Ingot")).toBe(false);
    expect(matchesGameNameFilter("ben酚", "Phenol")).toBe(true);
    expect(matchesGameNameFilter("ben酚", "Benzene")).toBe(false);
    expect(planBilingualQuery("ben酚")?.unresolved).toBe(true);
    expect(matchesGameNameFilter("gangban", "Steel Plate gregtech:gt.metaitem.01@17305")).toBe(true);
    expect(matchesGameNameFilter("gb", "Steel Plate gregtech:gt.metaitem.01@17305")).toBe(true);
    expect(matchesGameNameFilter("HV研磨机", "Basic Macerator")).toBe(true);
    expect(matchesGameNameFilter("gt钢板", "Steel Plate")).toBe(true);
    expect(matchesGameNameFilter("钢板gt", "Steel Plate")).toBe(true);
  });
  it("preserves the existing whole-form English substring rule", () => {
    expect(matchesGameNameFilter("steel plate", "Steel Small Plate")).toBe(false);
    expect(matchesGameNameFilter("small steel", "Steel Small Plate")).toBe(false);
    expect(matchesGameNameFilter("double gangban", "Double Steel Plate")).toBe(true);
  });
});
