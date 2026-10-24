import { isEecRecipe } from "@/lib/machines/extreme-entity-crusher";
import { isPowerRecipe } from "@/lib/power/power-recipe";
import type { Recipe } from "./types";
import { isCustomRateRecipe } from "./custom-rate";
import { isFluidTankRecipe } from "./fluid-tank";
import { isCropFarmRecipe } from "./passive-production";

/**
 * A card that runs only its own recipe and never shares its machine (shared-machine.ts): a generator, a crop farm,
 * a custom rate card, a fluid tank, an Extreme Entity Crusher (its controller holds one spawner). `addRecipeToNode`
 * refuses these on either side, and the card menu offers no "Add another recipe" on them.
 */
export function ownsItsRecipe(recipe: Recipe): boolean {
  return (
    isPowerRecipe(recipe) ||
    isCropFarmRecipe(recipe) ||
    isCustomRateRecipe(recipe) ||
    isFluidTankRecipe(recipe) ||
    isEecRecipe(recipe)
  );
}
