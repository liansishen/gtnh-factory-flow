// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it } from "vitest";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import { setLocale } from "@/lib/i18n/locale";
import { useFactoryStore } from "@/store/factory-store";
import { PowerFactsPanel, PowerGuide } from "./PowerInputPanel";
import { OptionListMenu } from "./OptionListMenu";
import { SettingsSheet } from "./SettingsSheet";
import type { SettingControl } from "./settings-model";
import { StripChip } from "../CleanCard";
import { SpecialSheet } from "../special/SpecialSheets";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  setLocale("en");
});

const ANCHOR = { left: 0, top: 0, bottom: 0 };

/** A machine whose only setting is the heating coil, so the sheet draws one label, one value and the formulas. */
function coilRecipe(): Recipe {
  return {
    id: "r1",
    name: "Smelt",
    machineType: "Mock Furnace",
    minimumTier: "LV",
    eut: 120,
    durationTicks: 200,
    inputs: [],
    outputs: [],
    machineConfigControls: [
      {
        id: "heatingCoil",
        label: "Heating Coil",
        minimumKey: "kanthal",
        defaultKey: "kanthal",
        tiers: [
          { key: "kanthal", label: "Kanthal", heat: 2701, resource: { kind: "item", id: "b1", amount: 1, displayName: "Kanthal Coil Block" } },
          { key: "nichrome", label: "Nichrome", heat: 3601, resource: { kind: "item", id: "b2", amount: 1, displayName: "Nichrome Coil Block" } },
        ],
      },
    ],
  } as unknown as Recipe;
}

function coilNode(recipeId: string): FactoryNode {
  return {
    id: "n1",
    recipeId,
    machineCount: 1,
    parallel: 1,
    position: { x: 0, y: 0 },
    enabled: true,
    overclockTier: "EV",
    hatchVoltageTier: "EV",
    hatchAmps: 1,
  } as unknown as FactoryNode;
}

function load(recipe: Recipe, node: FactoryNode) {
  act(() => {
    const project = useFactoryStore.getState().project;
    useFactoryStore.setState({ project: { ...project, recipes: [recipe], nodes: [node] } });
  });
}

it("translates the machine settings sheet in place and never touches the plan", () => {
  load(coilRecipe(), coilNode("r1"));
  const before = JSON.stringify(useFactoryStore.getState().project);
  render(<SettingsSheet nodeId="n1" anchor={ANCHOR} onClose={() => {}} />);

  // English first: the sheet is the source copy.
  expect(screen.getByText("Heating Coil")).toBeTruthy();
  expect(screen.getByText("Kanthal")).toBeTruthy();
  // The pin's accessible name composes from the catalog and the setting's own label.
  expect(screen.getByRole("button", { name: "Unpin Heating Coil from the card" })).toBeTruthy();

  act(() => setLocale("zh-CN"));
  expect(screen.getByText("设置")).toBeTruthy();
  expect(screen.getByText("公式")).toBeTruthy();
  // The setting's label and its value are the game's own names.
  expect(screen.getByText("加热线圈")).toBeTruthy();
  expect(screen.getByText("坎塔尔合金")).toBeTruthy();
  // The formula row labels are app copy from the new catalog.
  expect(screen.getByText("供给")).toBeTruthy();
  expect(screen.getByText("超频次数")).toBeTruthy();
  // The sheet's accessible name is translated too.
  expect(screen.getByRole("menu").getAttribute("aria-label")).toBe("机器设置");
  expect(screen.getByRole("button", { name: "取消固定 加热线圈 从卡片" })).toBeTruthy();

  // Switching the display language is presentation only.
  expect(JSON.stringify(useFactoryStore.getState().project)).toBe(before);

  act(() => setLocale("en"));
  expect(screen.getByText("Heating Coil")).toBeTruthy();
  expect(JSON.stringify(useFactoryStore.getState().project)).toBe(before);
});

it("says a machine has no settings in the player's language", () => {
  const empty = { ...coilRecipe(), id: "r2", machineConfigControls: [] } as unknown as Recipe;
  load(empty, coilNode("r2"));
  render(<SettingsSheet nodeId="n1" anchor={ANCHOR} onClose={() => {}} />);
  act(() => setLocale("zh-CN"));
  expect(screen.getByText("此机器没有可设置项。")).toBeTruthy();
});

it("translates a setting's option list, keeping the option keys canonical", () => {
  const control: SettingControl = {
    id: "heatingCoil",
    group: "Machine",
    label: "Heating Coil",
    value: "Kanthal",
    warn: false,
    options: [
      { key: "kanthal", label: "Kanthal" },
      { key: "nichrome", label: "Nichrome" },
    ],
    currentKey: "kanthal",
    pinDefault: true,
  };
  act(() => setLocale("zh-CN"));
  render(<OptionListMenu anchor={ANCHOR} control={control} onPick={() => {}} onClose={() => {}} />);
  expect(screen.getByText("坎塔尔合金")).toBeTruthy();
  expect(screen.getByText("镍铬合金")).toBeTruthy();
  expect(screen.getByPlaceholderText("筛选…")).toBeTruthy();
  expect(screen.getByLabelText("筛选选项 加热线圈")).toBeTruthy();
});

it("translates the power input panel and its guide", () => {
  act(() => setLocale("zh-CN"));
  render(
    <PowerFactsPanel
      facts={{
        amps: 1,
        tier: "EV",
        volt: 2048,
        now: { duration: 120, eut: 2048, parallels: 1, runsPerSecond: 0.1667 },
        overclocks: 0,
        perfect: 0,
        demand: 2048,
        shared: false,
      }}
    />,
  );
  expect(screen.getByText("电力输入")).toBeTruthy();
  expect(screen.getByText("下一项优化")).toBeTruthy();
  expect(screen.getByText("无")).toBeTruthy();
  expect(screen.getByText("每次配方耗时")).toBeTruthy();
  expect(screen.getByText("每秒配方数")).toBeTruthy();
  expect(screen.getByText("每次配方能耗")).toBeTruthy();
  expect(document.body.textContent).toContain("能源仓");
  expect(document.body.textContent).toContain("(1A/个)");
  cleanup();
  render(<PowerGuide part="amps" />);
  expect(screen.getByText("输入安培数")).toBeTruthy();
  expect(screen.getByText("Ctrl+滚轮")).toBeTruthy();
  expect(screen.getByText("点击或滚轮向上")).toBeTruthy();
});

it("shows a pinned setting chip's canonical value in the player's language", () => {
  act(() => setLocale("zh-CN"));
  render(
    <StripChip
      chip={{ id: "heatingCoil", label: "Coil", value: "Nichrome", x: 0, y: 0, width: 80, title: "" }}
      nodeId="n1"
      onStep={() => {}}
      onOpen={() => {}}
      wasClick={() => true}
    />,
  );
  expect(screen.getByText("镍铬合金")).toBeTruthy();
});

it("translates the special settings sheet's pin and number accessible names", () => {
  act(() => setLocale("zh-CN"));
  render(
    <SpecialSheet
      anchor={ANCHOR}
      rows={[
        { id: "mode", label: "Mode", value: "Supply", enabled: true, pinned: false, onPin: () => {}, onStep: () => {} },
        { id: "rate", label: "Rate", value: "1", number: { text: "1", commit: () => {} }, enabled: true, onStep: () => {} },
      ]}
      readings={[{ label: "Needs", value: "Open sky" }]}
      locked={false}
      onClose={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "固定 模式 到卡片" })).toBeTruthy();
  expect(screen.getByText("露天")).toBeTruthy();
  fireEvent.click(document.querySelectorAll(".cs-well")[1]!);
  expect(screen.getByLabelText("速率")).toBeTruthy();
});
