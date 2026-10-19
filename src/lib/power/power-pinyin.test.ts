import { describe, expect, it } from "vitest";
import {
  hitPlacementSettings,
  POWER_EU_CLAUSE_ID,
  searchPowerSources,
  searchPowerSourcesForStencil,
} from "./power-search";
import { resolvePowerResource } from "./planner-data";

describe("power search pinyin", () => {
  it("finds the gas turbine family by the full pinyin of its Chinese name", () => {
    const hits = searchPowerSources("ranqiwolun");
    const ids = hits.map((hit) => hit.source.id);
    expect(ids).toEqual(["gas-turbine", "large-gas-turbine", "xl-turbo-gas-turbine"]);
    expect(hits[0].via).toBeUndefined();
  });

  it("finds it by initials and by a mixed pinyin/Chinese name", () => {
    const initials = searchPowerSources("rqwl").map((hit) => hit.source.id);
    expect(initials).toContain("gas-turbine");
    expect(initials).toContain("xl-turbo-gas-turbine");

    // "ranqi涡轮" mixes pinyin and the literal Chinese of 涡轮 (turbine).
    const mixed = searchPowerSources("ranqi涡轮").map((hit) => hit.source.id);
    expect(mixed).toEqual(["gas-turbine", "large-gas-turbine", "xl-turbo-gas-turbine"]);
    expect(searchPowerSources("ＲＡＮＱＩＷＯＬＵＮ").map(hit => hit.source.id)).toEqual(mixed);
  });

  it("finds a fuel by the pinyin of its Chinese name", () => {
    // 苯 -> "ben": the gas turbine burns benzene by default.
    const gasTurbine = searchPowerSources("ben").find((hit) => hit.source.id === "gas-turbine");
    expect(gasTurbine?.via?.direction).toBe("takes");
    expect(gasTurbine?.via?.name).toBe("Benzene");
    expect(hitPlacementSettings(gasTurbine!)).toBeUndefined();
    expect(searchPowerSources("ben").some((hit) => hit.source.id === "solid-oxide-fuel-cell-1")).toBe(true);

    // 苯酚 -> "benfen" is Phenol, which no English spelling contains "ben" in:
    // this hit can only come from the phonetic index.
    const phenol = searchPowerSources("benfen").find(
      (hit) => hit.source.id === "universal-chemical-fuel-engine",
    );
    expect(phenol?.via?.name).toBe("Phenol");
    const mixed = searchPowerSources("ben酚");
    expect(mixed.length).toBeGreaterThan(0);
    expect(mixed.every(hit => hit.via?.name === "Phenol")).toBe(true);
  });

  it("dials a pinyin fuel into the placement settings", () => {
    // Phenol is not the gas turbine's default fuel.
    const gasTurbine = searchPowerSources("benfen").find((hit) => hit.source.id === "gas-turbine");
    expect(gasTurbine?.via?.direction).toBe("takes");
    expect(hitPlacementSettings(gasTurbine!)).toEqual({ fuel: "Phenol" });
  });

  it("answers nothing, not everything, for pinyin that spells no name", () => {
    expect(searchPowerSources("zzzzzqpyn")).toEqual([]);
    expect(searchPowerSourcesForStencil([], "all", "all", "zzzzzqpyn")).toEqual([]);
  });

  it("keeps voltage and unit tokens canonical", () => {
    // Reserved tokens never reach the engine: "lv" must not read as 铝.
    expect(
      searchPowerSources("lv").some((hit) => hit.via?.name.toLowerCase().includes("aluminium")),
    ).toBe(false);
    // EU still answers as the makes-power keyword.
    const eu = searchPowerSources("eu").find((hit) => hit.source.id === "gas-turbine");
    expect(eu?.via?.direction).toBe("makes");
    expect(eu?.via?.name).toBe("EU");
    expect(searchPowerSources("512 EU/t")).toEqual([]);
  });

  it("keeps the power keyword listing every generator in the stencil", () => {
    for (const query of ["power", "energy", "eu"]) {
      expect(searchPowerSourcesForStencil([], "all", "all", query).length).toBeGreaterThan(20);
    }
  });

  it("narrows the stencil by a pinyin name and keeps dialed placement settings", () => {
    const nitro = resolvePowerResource("Nitrobenzene")!;
    const hits = searchPowerSourcesForStencil(
      [{ role: "takes", kind: nitro.kind, id: nitro.id }],
      "all",
      "all",
      "ranqiwolun",
    );
    expect(hits.every((hit) => hit.source.name.toLowerCase().includes("gas turbine"))).toBe(true);
    const gasTurbine = hits.find((hit) => hit.source.id === "gas-turbine");
    expect(gasTurbine?.settings).toEqual({ fuel: "Nitrobenzene" });

    const power = searchPowerSourcesForStencil(
      [{ role: "makes", kind: "fluid", id: POWER_EU_CLAUSE_ID }],
      "all",
      "all",
      "rqwl",
    );
    expect(power.map((hit) => hit.source.id)).toEqual([
      "gas-turbine",
      "large-gas-turbine",
      "xl-turbo-gas-turbine",
    ]);
  });
});
