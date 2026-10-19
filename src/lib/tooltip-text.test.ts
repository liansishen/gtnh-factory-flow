import { describe, expect, it } from "vitest";
import { isNbtTooltipLine } from "./tooltip-text";

describe("NBT tooltip lines", () => {
  it("matches the exporter's NBT line, empty or not", () => {
    expect(isNbtTooltipLine("NBT:")).toBe(true);
    expect(isNbtTooltipLine("NBT: {}")).toBe(true);
    expect(isNbtTooltipLine('NBT: {Name:"Saccharomyces escherichia"}')).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(isNbtTooltipLine("nbt: {x}")).toBe(true);
    expect(isNbtTooltipLine("  NbT:  {x}")).toBe(true);
    expect(isNbtTooltipLine("\tNBT:\t")).toBe(true);
  });

  it("leaves ordinary descriptions, names and counts alone", () => {
    expect(isNbtTooltipLine("A sturdy plate")).toBe(false);
    expect(isNbtTooltipLine("Steel Plate")).toBe(false);
    expect(isNbtTooltipLine("3 recipes")).toBe(false);
    expect(isNbtTooltipLine("")).toBe(false);
  });

  it("reads the label only, never a brace or a percent", () => {
    expect(isNbtTooltipLine("Value: {x}")).toBe(false);
    expect(isNbtTooltipLine("100%")).toBe(false);
    expect(isNbtTooltipLine("Has {braces} and 50%")).toBe(false);
  });
});
