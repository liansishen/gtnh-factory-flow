import { isCustomRateRecipe } from "@/lib/model/custom-rate";
import { isFluidTankRecipe } from "@/lib/model/fluid-tank";
import { ownsItsRecipe } from "@/lib/model/owns-recipe";
import { isCropFarmRecipe } from "@/lib/model/passive-production";
import { isSharedMachineNode } from "@/lib/model/shared-machine";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { useBoardView } from "../../board-view";

/** Which recipe rows a card's menu offers. */
export interface CardRecipeRows {
  /** "Add another recipe": the search pinned to the card's machine; the pick joins the card (`browseMachineRecipes`). */
  addRecipe: boolean;
  /** "Replace the recipe": the search seeded with the card's inputs and outputs; the pick replaces it in place. */
  replace: boolean;
}

const NONE: CardRecipeRows = { addRecipe: false, replace: false };

/**
 * The classic card's rules. Nothing while the board is locked (read-only, checklist) or calm. Another recipe only on a
 * machine that can share (`ownsItsRecipe`); a shared card takes one more section. Replace on every card that has a
 * recipe to search from, except the holders (custom rate, fluid tank), an empty crop farm and a shared card, whose
 * sections each need the machine the replacement might not run.
 */
export function cardRecipeRows(
  recipe: Recipe | undefined,
  node: FactoryNode | undefined,
  { calm, locked }: { calm: boolean; locked: boolean },
): CardRecipeRows {
  if (!recipe || !node || calm || locked) return NONE;
  const emptyCropFarm = isCropFarmRecipe(recipe) && recipe.outputs.length === 0;
  return {
    addRecipe: !ownsItsRecipe(recipe),
    replace:
      !isSharedMachineNode(node) &&
      !isCustomRateRecipe(recipe) &&
      !isFluidTankRecipe(recipe) &&
      !emptyCropFarm,
  };
}

/** The rows for a card on the board. Mounted only while its menu is open. */
export function useCardRecipeRows(nodeId: string): CardRecipeRows {
  const { calmMode } = useBoardView();
  const locked = useFactoryStore((state) => state.isReadOnly || state.checklistMode);
  const node = useFactoryStore((state) => state.project.nodes.find((entry) => entry.id === nodeId));
  const recipe = useFactoryStore((state) =>
    node ? state.project.recipes.find((entry) => entry.id === node.recipeId) : undefined,
  );
  return cardRecipeRows(recipe, node, { calm: calmMode, locked });
}
