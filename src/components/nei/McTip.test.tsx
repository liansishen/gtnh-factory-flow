// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n/locale";
import { itemTipLines, McFloatingTip, McTipLines, modDisplayName } from "./McTip";
import { TOOLTIP_PANEL_CLASS } from "./tooltip-style";

beforeEach(() => { setLocale("en"); });
afterEach(() => {
  cleanup();
  setLocale("en");
});

describe("Minecraft's tooltip", () => {
  it("writes an item as the game does: name, grey lines, the mod last", () => {
    expect(
      itemTipLines({ name: "Sodium Dust", id: "gregtech:gt.metaitem.01:2017", tooltip: ["Na", "Sodium Dust"], extra: ["274 recipes"] }),
    ).toEqual([
      { text: "Sodium Dust", tone: "name" },
      { text: "Na" },
      { text: "274 recipes" },
      { text: "GregTech", tone: "mod" },
    ]);
  });

  it("names no mod for a bare fluid id", () => {
    expect(itemTipLines({ name: "Water", id: "water" })).toEqual([{ text: "Water", tone: "name" }]);
  });

  it("names mods as NEI does, and keeps an unknown prefix", () => {
    expect(modDisplayName("bartworks")).toBe("BartWorks");
    expect(modDisplayName("IC2")).toBe("IndustrialCraft 2");
    expect(modDisplayName("someMod")).toBe("SomeMod");
  });

  it("draws in Minecraft's box with the tones on the lines", () => {
    render(<McFloatingTip x={100} y={100} lines={itemTipLines({ name: "Salt", id: "gregtech:salt" })} />);
    const panel = document.querySelector("[data-minecraft-tooltip]")!;
    expect(panel.classList.contains("mc-tip")).toBe(true);
    const lines = [...panel.querySelectorAll(".mc-tip-line")];
    expect(lines.map((line) => line.getAttribute("data-tone"))).toEqual(["name", "mod"]);
    expect(lines.map((line) => line.textContent)).toEqual(["Salt", "GregTech"]);
  });

  it("every panel tooltip wears the same box", () => {
    expect(TOOLTIP_PANEL_CLASS.split(" ")).toContain("mc-tip");
  });

  it("leaves NBT lines out of the tip and keeps the dataset array untouched", () => {
    const tooltip = ['NBT: {Name:"Saccharomyces escherichia"}', "A fermented starter", "Steel Plate"];
    const item = { name: "Steel Plate", id: "gregtech:gt.metaitem.01@17305", tooltip, extra: ["3 recipes"] };
    const before = JSON.stringify(item);

    expect(itemTipLines(item)).toEqual([
      { text: "Steel Plate", tone: "name" },
      { text: "A fermented starter" },
      { text: "3 recipes" },
      { text: "GregTech", tone: "mod" },
    ]);
    expect(JSON.stringify(item)).toBe(before);
  });

  it("keeps a description that merely carries braces or a percent", () => {
    expect(itemTipLines({ name: "Odd", id: "gregtech:odd", tooltip: ["50% of {this}"] })).toEqual([
      { text: "Odd", tone: "name" },
      { text: "50% of {this}" },
      { text: "GregTech", tone: "mod" },
    ]);
  });

  it("drops the NBT line in both languages and translates only the name", () => {
    const lines = itemTipLines({
      name: "Steel Plate",
      id: "gregtech:gt.metaitem.01@17305",
      tooltip: ['NBT: {Name:"Saccharomyces escherichia"}', "A fermented starter"],
    });
    render(<McTipLines lines={lines} />);
    expect(screen.getByText("Steel Plate")).toBeTruthy();
    expect(screen.queryByText(/NBT:/)).toBeNull();

    act(() => setLocale("zh-CN"));
    expect(screen.getByText("钢板")).toBeTruthy();
    expect(screen.queryByText(/NBT:/)).toBeNull();

    act(() => setLocale("en"));
    expect(screen.getByText("Steel Plate")).toBeTruthy();
  });

  it("keeps an NBT line verbatim even when it reaches the tip as text", () => {
    render(<McTipLines lines={[{ text: 'NBT: {Name:"Steel Plate"}' }]} />);
    act(() => setLocale("zh-CN"));
    expect(screen.getByText('NBT: {Name:"Steel Plate"}')).toBeTruthy();
    expect(screen.queryByText("钢板")).toBeNull();
  });
});
