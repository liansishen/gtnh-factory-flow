// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RecipeSummary } from "@/lib/datasets/types";
import { setLocale } from "@/lib/i18n/locale";
import { getPowerSource } from "@/lib/power/registry";
import { LookupPowerCard, LookupRecipeCard, type LookupHandlers } from "./lookup-card";

const recipe: RecipeSummary = {
  id: "alloy-smelter-steel-plate",
  name: "Steel Plate",
  recipeMap: "Alloy Smelter",
  machineType: "Alloy Smelter",
  minimumTier: "LV",
  durationTicks: 100,
  eut: 30,
  inputs: [
    { kind: "item", id: "gregtech:gt.metaitem.01@11305", displayName: "Steel Ingot", amount: 2 },
    { kind: "item", id: "gregtech:gt.metaitem.01@32301", displayName: "Shape (Plate)", amount: 1, consumed: false },
  ],
  outputs: [{ kind: "item", id: "gregtech:gt.metaitem.01@17305", displayName: "Steel Plate", amount: 1 }],
  slots: [],
};

function handlers(): LookupHandlers {
  return { onBrowseResource: vi.fn(), onChipMenu: vi.fn(), onHoverSlot: vi.fn() };
}

afterEach(() => { cleanup(); setLocale("en"); });

it("translates kept inputs and resource labels while actions receive the canonical recipe", () => {
  const onAdd = vi.fn();
  const events = handlers();
  const before = JSON.stringify(recipe);
  render(<LookupRecipeCard recipe={recipe} rateView="second" onSelectRecipe={vi.fn()} onAdd={onAdd} onCardMenu={vi.fn()} handlers={events} />);
  expect(screen.getByText("not used up")).toBeTruthy();
  act(() => setLocale("zh-CN"));
  expect(screen.getByText("不消耗")).toBeTruthy();
  const output = screen.getByRole("button", { name: "钢板" });
  fireEvent.click(output);
  expect(events.onBrowseResource).toHaveBeenCalledWith(expect.objectContaining({ id: "gregtech:gt.metaitem.01@17305", displayName: "Steel Plate" }), "recipes");
  fireEvent.mouseMove(output, { clientX: 100, clientY: 100 });
  expect(screen.getByText("0.2/s")).toBeTruthy();
  expect(document.body.textContent).not.toContain("I18nText");
  fireEvent.click(document.querySelector('[data-glyph="plus"]')!);
  expect(onAdd).toHaveBeenCalledWith(recipe, undefined, {});
  expect(JSON.stringify(recipe)).toBe(before);
  act(() => setLocale("en"));
  expect(screen.getByText("not used up")).toBeTruthy();
});

it("uses the real generator model and an interpolated add label in each locale", () => {
  const source = getPowerSource("large-combustion-engine")!;
  const onPlace = vi.fn();
  render(<LookupPowerCard hit={{ source, settings: { fuel: "Diesel", boost: "1" }, matches: [] }} rateView="second" onPlace={onPlace} onCardMenu={vi.fn()} handlers={handlers()} />);
  expect(screen.getByRole("button", { name: `Add ${source.name}` })).toBeTruthy();
  expect(document.body.textContent).not.toContain("I18nText");
  fireEvent.click(screen.getByRole("button", { name: `Add ${source.name}` }));
  expect(onPlace).toHaveBeenCalledOnce();
  act(() => setLocale("zh-CN"));
  const add = document.querySelector('[data-glyph="plus"]')!;
  expect(add.getAttribute("aria-label")).not.toContain("I18nText");
  expect(add.getAttribute("aria-label")).not.toContain("source.name");
  expect(document.body.textContent).not.toContain("I18nText");
});
