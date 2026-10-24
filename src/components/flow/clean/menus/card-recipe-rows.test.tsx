// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryNode, type Recipe } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { CardRows } from "./CardActionsMenu";
import { cardRecipeRows } from "./card-recipe-rows";

/**
 * The card menu's recipe rows: "Add another recipe" opens the search pinned to the card's machine, "Replace the
 * recipe" the refactor search. The exam pins the rows' order and the classic card's gating.
 */

const recipe = (id: string, extra: Partial<Recipe> = {}): Recipe => ({
  id,
  name: id,
  machineType: "Large Chemical Reactor",
  minimumTier: "LV",
  durationTicks: 20,
  eut: 30,
  inputs: [{ kind: "fluid", id: "water", amount: 1000 }],
  outputs: [{ kind: "fluid", id: "hydrogen", amount: 2000 }],
  ...extra,
});

const node = (id: string, recipeId: string, extra: Partial<FactoryNode> = {}): FactoryNode => ({
  id,
  recipeId,
  machineCount: 1,
  parallel: 1,
  overclockTier: "LV",
  enabled: true,
  position: { x: 0, y: 0 },
  ...extra,
});

const open = { calm: false, locked: false };

describe("cardRecipeRows", () => {
  it("offers both rows on a plain machine card", () => {
    expect(cardRecipeRows(recipe("a"), node("n", "a"), open)).toEqual({ addRecipe: true, replace: true });
  });

  it("offers one more section on a shared card, and no replace", () => {
    const shared = node("n", "a", { extraRecipes: [{ recipeId: "b" }] });
    expect(cardRecipeRows(recipe("a"), shared, open)).toEqual({ addRecipe: true, replace: false });
  });

  it("never shares a card that owns its recipe", () => {
    const generator = recipe("gen", { power: { sourceId: "steam-turbine" } } as Partial<Recipe>);
    expect(cardRecipeRows(generator, node("n", "gen"), open)).toEqual({ addRecipe: false, replace: true });
    const eec = recipe("zombie", {
      machineType: "Extreme Entity Crusher",
      metadata: { eec: { mob: "zombie", maxHealth: 20, baseEut: 1920, outputs: [] } },
    });
    expect(cardRecipeRows(eec, node("n", "zombie"), open)).toEqual({ addRecipe: false, replace: true });
    const farm = recipe("farm", { machineType: "Crop Farm", name: "Crop Farm: Wheat" });
    expect(cardRecipeRows(farm, node("n", "farm"), open)).toEqual({ addRecipe: false, replace: true });
  });

  it("offers neither on a holder or an empty crop farm", () => {
    const customRate = recipe("rate", { machineType: "Custom Rate", inputs: [], outputs: [] });
    expect(cardRecipeRows(customRate, node("n", "rate"), open)).toEqual({ addRecipe: false, replace: false });
    const tank = recipe("tank", { machineType: "Tank", source: { recipeMap: "Tank" } } as Partial<Recipe>);
    expect(cardRecipeRows(tank, node("n", "tank"), open)).toEqual({ addRecipe: false, replace: false });
    const emptyFarm = recipe("farm", { machineType: "Crop Farm", name: "Crop Farm", outputs: [] });
    expect(cardRecipeRows(emptyFarm, node("n", "farm"), open)).toEqual({ addRecipe: false, replace: false });
  });

  it("offers neither while the board is calm or locked", () => {
    expect(cardRecipeRows(recipe("a"), node("n", "a"), { calm: true, locked: false })).toEqual({
      addRecipe: false,
      replace: false,
    });
    expect(cardRecipeRows(recipe("a"), node("n", "a"), { calm: false, locked: true })).toEqual({
      addRecipe: false,
      replace: false,
    });
  });
});

describe("CardRows", () => {
  beforeEach(() => {
    useFactoryStore.getState().setProject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "card-rows",
      name: "Card rows",
      fuelProfiles: [],
      recipes: [recipe("electrolysis"), recipe("custom", { machineType: "Custom Rate", inputs: [], outputs: [] })],
      nodes: [node("lcr", "electrolysis"), node("holder", "custom")],
      edges: [],
    });
  });
  afterEach(() => {
    useFactoryStore.getState().clearResourceBrowser();
    cleanup();
  });

  const rows = (nodeId: string, close = vi.fn()) => {
    render(<CardRows nodeId={nodeId} onClone={vi.fn()} onDelete={vi.fn()} close={close} />);
    return screen.getAllByRole("menuitem").map((row) => row.textContent);
  };

  it("lists the mod's order: clone, another recipe, replace, then delete last", () => {
    expect(rows("lcr")).toEqual(["Clone node", "Add another recipe", "Replace the recipe", "Delete node"]);
    expect(screen.getByText("Delete node").closest("[data-danger]")).not.toBeNull();
  });

  it("leaves both recipe rows off a holder", () => {
    expect(rows("holder")).toEqual(["Clone node", "Delete node"]);
  });

  it("opens the search pinned to the card's machine", () => {
    const close = vi.fn();
    rows("lcr", close);
    fireEvent.click(screen.getByText("Add another recipe"));
    const state = useFactoryStore.getState();
    expect(close).toHaveBeenCalled();
    expect(state.recipeBrowserMachinePin).toEqual(
      expect.objectContaining({ nodeId: "lcr", recipeMaps: ["Large Chemical Reactor"] }),
    );
    expect(state.recipeBrowserRefactorNodeId).toBeUndefined();
  });

  it("opens the refactor search seeded with the card's inputs and outputs", () => {
    rows("lcr");
    fireEvent.click(screen.getByText("Replace the recipe"));
    const state = useFactoryStore.getState();
    expect(state.recipeBrowserRefactorNodeId).toBe("lcr");
    expect(state.recipeBrowserMachinePin).toBeUndefined();
    expect(state.recipeBrowserSeed?.map((clause) => `${clause.role}:${clause.id}`)).toEqual([
      "takes:water",
      "makes:hydrogen",
    ]);
  });
});
