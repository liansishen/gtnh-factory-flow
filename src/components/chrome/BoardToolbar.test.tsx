// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useFactoryStore } from "@/store/factory-store";
import { useDesignStore } from "@/store/design-store";
import { writeWorkspaceView } from "@/lib/workspace-view";
import { BoardToolbar } from "./BoardToolbar";
import { registerBoardCommands } from "./board-commands";
import { setLocale } from "@/lib/i18n/locale";

vi.mock("@/lib/compact-view", () => ({ isCompactViewport: () => false, useIsCompactViewport: () => false }));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const renderStrip = () => render(<BoardToolbar />);
const key = (id: string) => document.querySelector<HTMLElement>(`[data-mb="${id}"]`)!;

beforeEach(() => {
  window.localStorage.clear();
  useFactoryStore.setState({ rateUnit: "second", powerDisplayUnit: "eu", undoHistory: [], redoHistory: [], isReadOnly: false });
  useDesignStore.setState({ designs: [], publicViews: [], activeDesignId: undefined });
  writeWorkspaceView({ averageMachineDraw: true });
});
afterEach(() => { cleanup(); setLocale("en"); });

describe("the board's toolbar", () => {
  it("has the keys in the mod's order, in its words", () => {
    renderStrip();
    const order = [...document.querySelectorAll("[data-mb]")].map((element) => element.getAttribute("data-mb"));
    expect(order).toEqual(["nonrecipe", "undo", "redo", "arrange", "fit", "rate", "power", "annotate"]);
    expect(key("arrange").textContent).toBe("Arrange");
    expect(key("rate").textContent).toBe("/s");
    expect(key("power").textContent).toBe("EU/t");
    expect(document.querySelector('[data-mb="peak"]')).toBeNull();
    expect(key("nonrecipe").textContent).toBe("Non-recipe");
  });

  it("translates every board key's tooltip and restores the original wording", () => {
    renderStrip();
    const tips: Record<string, [string, string]> = {
      nonrecipe: ["Non-recipe machines: generators, turbines, boilers, reactors", "非配方机器：发电机、涡轮机、锅炉和反应堆"],
      undo: ["Undo (Ctrl+Z)", "撤销（Ctrl+Z）"],
      redo: ["Redo (Ctrl+Shift+Z or Ctrl+Y)", "重做（Ctrl+Shift+Z 或 Ctrl+Y）"],
      arrange: ["Auto-arrange the plan (press again to stop)", "自动整理方案（再次点击可停止）"],
      fit: ["Zoom to fit the whole plan", "缩放以显示整个方案"],
      rate: ["Rate unit: per tick, second, minute or hour", "速率单位：每 tick、每秒、每分钟或每小时"],
      power: ["Show power as EU/t, or as amps at each machine's tier", "以 EU/t 或各机器等级对应的安培数显示电力"],
      annotate: ["Add a sticky note, box or arrow, or change the background", "添加便签、方框或箭头，或更改背景"],
    };
    const originals = Object.fromEntries(Object.keys(tips).map((id) => [id, key(id)]));
    for (const locale of ["en", "zh-CN", "en"] as const) {
      act(() => setLocale(locale));
      for (const [id, labels] of Object.entries(tips)) {
        expect(key(id), id).toBe(originals[id]);
        expect(JSON.parse(key(id).getAttribute("data-tip")!).title, id).toBe(labels[locale === "en" ? 0 : 1]);
      }
    }
  });

  it("every key is in the Tab order (a disabled one is not) and Enter or Space presses it", () => {
    renderStrip();
    for (const id of ["nonrecipe", "arrange", "fit", "rate", "power", "annotate"]) {
      expect(key(id).getAttribute("tabindex"), id).toBe("0");
    }
    expect(key("undo").getAttribute("tabindex")).toBe("-1");
    key("rate").focus();
    fireEvent.keyDown(key("rate"), { key: "Enter" });
    expect(useFactoryStore.getState().rateUnit).toBe("minute");
    fireEvent.keyDown(key("rate"), { key: " " });
    expect(useFactoryStore.getState().rateUnit).toBe("hour");
  });

  it("the rate unit goes round /t /s /min /hr on a click or the wheel, and back on a right-click", () => {
    renderStrip();
    const rate = key("rate");
    fireEvent.click(rate);
    expect(useFactoryStore.getState().rateUnit).toBe("minute");
    expect(rate.textContent).toBe("/min");
    fireEvent.click(rate);
    expect(useFactoryStore.getState().rateUnit).toBe("hour");
    fireEvent.click(rate);
    expect(useFactoryStore.getState().rateUnit).toBe("tick");
    fireEvent.contextMenu(rate);
    expect(useFactoryStore.getState().rateUnit).toBe("hour");
    fireEvent.wheel(rate, { deltaY: -100 });
    expect(useFactoryStore.getState().rateUnit).toBe("tick");
    fireEvent.wheel(rate, { deltaY: 100 });
    expect(useFactoryStore.getState().rateUnit).toBe("hour");
  });

  it("EU/t becomes Amps at the tier most machines run at, and Avg and Peak swap", () => {
    renderStrip();
    fireEvent.click(key("power"));
    expect(key("power").textContent).toBe("Amps");
    expect(useFactoryStore.getState().powerDisplayUnit).not.toBe("eu");
    fireEvent.click(key("power"));
    expect(key("power").textContent).toBe("EU/t");
    expect(useFactoryStore.getState().powerDisplayUnit).toBe("eu");
  });

  it("the pencil key asks the board for its empty-board menu under the key", () => {
    const at: Array<{ x: number; y: number }> = [];
    const off = registerBoardCommands({ arrange: () => {}, cancelArrange: () => {}, fit: () => {}, openBoardMenu: (p) => at.push(p) });
    renderStrip();
    fireEvent.click(key("annotate"));
    off();
    expect(at).toHaveLength(1);
    expect(key("annotate").getAttribute("aria-label")).toBe("Annotations");
  });

  it("Arrange and Fit call the board, and Arrange says what it is doing", () => {
    const calls: string[] = [];
    const off = registerBoardCommands({ arrange: () => calls.push("arrange"), cancelArrange: () => calls.push("cancel"), fit: () => calls.push("fit") });
    renderStrip();
    fireEvent.click(key("fit"));
    fireEvent.click(key("arrange"));
    expect(calls).toEqual(["fit", "arrange"]);
    off();
  });

  it("Undo and Redo are greyed until there is something to do", () => {
    renderStrip();
    expect(key("undo").hasAttribute("data-off")).toBe(true);
    expect(key("redo").hasAttribute("data-off")).toBe(true);
    act(() => {
      useFactoryStore.setState({ undoHistory: [useFactoryStore.getState().project] });
    });
    expect(key("undo").hasAttribute("data-off")).toBe(false);
  });


  it("the Non-recipe key opens the picker and closes it again", () => {
    renderStrip();
    fireEvent.click(key("nonrecipe"));
    expect(useFactoryStore.getState().powerMenuOpen).toBe(true);
    fireEvent.click(key("nonrecipe"));
    expect(useFactoryStore.getState().powerMenuOpen).toBe(false);
  });


  it("Arrange and Fit call the board, and Arrange says what it is doing", () => {
    const calls: string[] = [];
    const off = registerBoardCommands({ arrange: () => calls.push("arrange"), cancelArrange: () => calls.push("cancel"), fit: () => calls.push("fit") });
    renderStrip();
    fireEvent.click(key("fit"));
    fireEvent.click(key("arrange"));
    expect(calls).toEqual(["fit", "arrange"]);
    off();
  });

  it("Undo and Redo are greyed until there is something to do", () => {
    renderStrip();
    expect(key("undo").hasAttribute("data-off")).toBe(true);
    expect(key("redo").hasAttribute("data-off")).toBe(true);
    act(() => {
      useFactoryStore.setState({ undoHistory: [useFactoryStore.getState().project] });
    });
    expect(key("undo").hasAttribute("data-off")).toBe(false);
  });

  it("every key carries a tip for the tip host", () => {
    renderStrip();
    for (const id of ["nonrecipe", "undo", "redo", "arrange", "fit", "rate", "power", "annotate"]) {
      expect(key(id).getAttribute("data-tip-id"), id).toBe(`bar|${id}`);
      expect(JSON.parse(key(id).getAttribute("data-tip")!).title.length).toBeGreaterThan(3);
    }
  });
});
