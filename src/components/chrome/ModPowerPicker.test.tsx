// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n/locale";
import { translateMessage } from "@/lib/i18n/messages";
import { useFactoryStore } from "@/store/factory-store";
import { ModPowerPicker } from "./ModPowerPicker";

vi.mock("@/lib/compact-view", () => ({ isCompactViewport: () => false }));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const added = { custom: vi.fn(), tank: vi.fn(), crop: vi.fn(), source: vi.fn() };
beforeEach(() => {
  for (const fn of Object.values(added)) fn.mockClear();
  useFactoryStore.setState({
    powerMenuOpen: true,
    addCustomRateNode: added.custom,
    addPowerSourceNode: added.source as never,
    addFluidTankNode: added.tank,
    addCropFarmNode: added.crop,
  } as never);
});
afterEach(() => {
  cleanup();
  useFactoryStore.setState({ powerMenuOpen: false });
  setLocale("en");
});

const titles = () => [...document.querySelectorAll(".mp-brass span")].map((element) => element.textContent);

describe("the non-recipe machines picker", () => {
  it("is the mod's sheet: title, search, the two filter keys and a close key", () => {
    render(<ModPowerPicker />);
    expect(screen.getByRole("dialog", { name: "Non-recipe machines" })).toBeTruthy();
    expect(document.querySelector(".mp-title")?.textContent).toBe("NON-RECIPE MACHINES");
    expect(screen.getByPlaceholderText("Machine, fuel, or product...")).toBeTruthy();
    expect([...document.querySelectorAll(".mp-head .ml-drop")].map((key) => key.textContent)).toEqual(["All types", "All tiers"]);
  });

  it("lists the planning cards first in an Other column, then the power groups in the mod's columns", () => {
    render(<ModPowerPicker />);
    const columns = [...document.querySelectorAll(".mp-col")].map((column) => [...column.querySelectorAll(".mp-brass span")].map((title) => title.textContent));
    expect(columns[0]).toEqual(["OTHER", "GENERATORS"]);
    expect(columns[1]).toEqual(["TURBINES"]);
    expect(columns[3]).toEqual(["ENGINES", "SOLAR"]);
    expect(columns[4]).toEqual(["REACTORS", "ENDGAME"]);
    const other = document.querySelector(".mp-col")!.querySelectorAll(".mp-group")[0];
    expect([...other.querySelectorAll(".mp-tile")].map((tile) => tile.getAttribute("data-source"))).toEqual(["custom-rate", "fluid-tank", "crop-farm", "railcraft-water-tank"]);
    expect(other.querySelector(".mp-brass i")?.textContent).toBe("4");
    // The Railcraft Boiler sits with the other boilers.
    const steam = [...document.querySelectorAll(".mp-group")].find((group) => group.querySelector(".mp-brass span")?.textContent === "BOILERS AND EXCHANGERS")!;
    expect(steam.querySelector('[data-source="railcraft-boiler"]')).toBeTruthy();
  });

  it("picking Custom Rate adds the custom rate card and closes the picker", () => {
    render(<ModPowerPicker />);
    fireEvent.click(document.querySelector('[data-source="custom-rate"]')!);
    expect(added.custom).toHaveBeenCalledTimes(1);
    expect(useFactoryStore.getState().powerMenuOpen).toBe(false);
  });

  it("picking Fluid Tank asks the store for a tank", () => {
    render(<ModPowerPicker />);
    fireEvent.click(document.querySelector('[data-source="fluid-tank"]')!);
    expect(added.tank).toHaveBeenCalledTimes(1);
  });

  it("picking Crop Farm asks the store for a crop farm and closes the picker", () => {
    render(<ModPowerPicker />);
    fireEvent.click(document.querySelector('[data-source="crop-farm"]')!);
    expect(added.crop).toHaveBeenCalledTimes(1);
    expect(useFactoryStore.getState().powerMenuOpen).toBe(false);
  });

  it("typing searches the machines and what they burn, laid out down the columns", () => {
    render(<ModPowerPicker />);
    fireEvent.change(screen.getByPlaceholderText("Machine, fuel, or product..."), { target: { value: "benzene" } });
    expect(document.querySelector(".mp-results")).toBeTruthy();
    expect(document.querySelectorAll(".mp-tile").length).toBeGreaterThan(0);
    expect(document.querySelector(".mp-via")?.textContent).toMatch(/^(Takes|Makes) /);
    const tile = document.querySelector(".mp-tile:not([data-source^='custom']):not([data-source^='fluid']):not([data-source^='crop'])")!;
    fireEvent.click(tile);
    expect(added.source).toHaveBeenCalledTimes(1);
  });

  it("a search nothing answers says so in the mod's words", () => {
    render(<ModPowerPicker />);
    fireEvent.change(screen.getByPlaceholderText("Machine, fuel, or product..."), { target: { value: "zzzzzz-nothing" } });
    expect(document.querySelector(".mp-none")?.textContent).toBe("No machine burns, makes or is named that.");
  });

  it("the type filter narrows to one group, and Other keeps the planning cards and the water tank", () => {
    render(<ModPowerPicker />);
    fireEvent.click(screen.getByText("All types"));
    fireEvent.click(screen.getByText("Other"));
    expect(titles()).toEqual(["OTHER"]);
    expect(document.querySelectorAll(".mp-tile")).toHaveLength(4);
  });

  it("Escape closes it", () => {
    render(<ModPowerPicker />);
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(useFactoryStore.getState().powerMenuOpen).toBe(false);
  });
});

/** The Chinese words the shared dictionaries already answer, read through the same function the app uses. */
const zh = (source: string) => translateMessage(source, "zh-CN");

describe("the non-recipe machines picker in Chinese", () => {
  const searchBox = () => screen.getByPlaceholderText(zh("Machine, fuel, or product..."));

  beforeEach(() => setLocale("zh-CN"));

  it("translates the sheet, its groups, its machines and its filter keys", () => {
    render(<ModPowerPicker />);
    expect(screen.getByRole("dialog", { name: "非配方机器" })).toBeTruthy();
    expect(document.querySelector(".mp-title")?.textContent).toBe("非配方机器");
    expect(titles()).toEqual(expect.arrayContaining(["其他", "发电机", "涡轮机", "反应堆", "终局"]));
    const gasTurbine = document.querySelector('[data-source="gas-turbine"]')!;
    expect(gasTurbine.textContent).toContain("燃气涡轮");
    // The tier tag is a canonical label, not copy: it stays the game's own.
    expect(gasTurbine.querySelector(".mp-tier")?.textContent).toBe("LV");
    expect([...document.querySelectorAll(".mp-head .ml-drop")].map((key) => key.textContent)).toEqual([
      zh("All types"),
      zh("All tiers"),
    ]);
  });

  it("shows the type menu in Chinese and still narrows the board", () => {
    render(<ModPowerPicker />);
    fireEvent.click(screen.getByText(zh("All types")));
    const menu = screen.getByRole("menu", { name: zh("Type") });
    const rows = [...menu.querySelectorAll(".mm-row")];
    expect(rows.map((row) => row.textContent)).toEqual(
      expect.arrayContaining(["其他", "涡轮机", "反应堆"]),
    );
    fireEvent.click(rows.find((row) => row.textContent === "涡轮机")!);
    expect(titles()).toEqual(["涡轮机"]);
  });

  it("finds a machine by the Chinese name it is shown under", () => {
    render(<ModPowerPicker />);
    fireEvent.change(searchBox(), { target: { value: "固体氧化物燃料电池" } });
    expect(document.querySelector('[data-source="solid-oxide-fuel-cell-1"]')).toBeTruthy();
    expect(document.querySelector('[data-source="solid-oxide-fuel-cell-1"]')?.textContent).toContain(
      "固体氧化物燃料电池 Mk I",
    );
  });

  it("finds a fuel by its Chinese name and places the canonical setting", () => {
    render(<ModPowerPicker />);
    fireEvent.change(searchBox(), { target: { value: "苯酚" } });
    const tile = document.querySelector('[data-source="universal-chemical-fuel-engine"]')!;
    const via = tile.querySelector(".mp-via")!;
    expect(via.textContent).toContain("苯酚");
    expect(via.textContent).not.toMatch(/Takes|Makes|Phenol/);
    fireEvent.click(tile);
    expect(added.source).toHaveBeenCalledWith("universal-chemical-fuel-engine", { fuel: "Phenol" });
  });

  it("translates the planning cards and finds them by their Chinese names", () => {
    render(<ModPowerPicker />);
    fireEvent.change(searchBox(), { target: { value: "流体储罐" } });
    const tile = document.querySelector('[data-source="fluid-tank"]')!;
    expect(tile.textContent).toContain("流体储罐");
  });

  it("says nothing matched, in Chinese", () => {
    render(<ModPowerPicker />);
    fireEvent.change(searchBox(), { target: { value: "zzzz-nothing" } });
    expect(document.querySelector(".mp-none")?.textContent).toBe(zh("No machine burns, makes or is named that."));
  });

  it("translates the preview of the machine the mouse rests on", () => {
    vi.useFakeTimers();
    try {
      render(<ModPowerPicker />);
      fireEvent.mouseEnter(document.querySelector('[data-source="gas-turbine"]')!);
      act(() => {
        vi.advanceTimersByTime(800);
      });
      const preview = document.querySelector(".mp-preview")!;
      expect(preview.querySelector(".mp-preview-name")?.textContent).toBe("燃气涡轮");
      expect(preview.querySelector(".mp-preview-kind")?.textContent).toBe("发电机，解锁于 LV");
      expect(preview.querySelector(".mp-preview-blurb")?.textContent).toBe("燃烧苯及其他气体燃料。");
    } finally {
      vi.useRealTimers();
    }
  });

  it("translates the preview of a planning card", () => {
    vi.useFakeTimers();
    try {
      render(<ModPowerPicker />);
      fireEvent.mouseEnter(document.querySelector('[data-source="custom-rate"]')!);
      act(() => {
        vi.advanceTimersByTime(800);
      });
      const preview = document.querySelector(".mp-preview")!;
      expect(preview.querySelector(".mp-preview-name")?.textContent).toBe(zh("Custom Rate"));
      expect(preview.querySelector(".mp-preview-kind")?.textContent).toBe("其他");
      expect(preview.querySelector(".mp-preview-blurb")?.textContent).toBe(
        "自定义速率：用旋钮供给或消耗任意资源。",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes back to the English words when the language does", () => {
    render(<ModPowerPicker />);
    expect(document.querySelector(".mp-title")?.textContent).toBe("非配方机器");
    act(() => setLocale("en"));
    expect(document.querySelector(".mp-title")?.textContent).toBe("NON-RECIPE MACHINES");
    expect(titles()).toContain("GENERATORS");
    act(() => setLocale("zh-CN"));
    expect(document.querySelector(".mp-title")?.textContent).toBe("非配方机器");
  });
});
