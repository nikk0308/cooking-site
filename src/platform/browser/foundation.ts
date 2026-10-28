// Browser-only composition surface: no fetch, server repository or automatic sync.
export { exportBrowserData, prepareImport } from "./portability";
export { openBrowserRepository } from "./repository";
export {
  BrowserStorageError,
  openBrowserDatabase,
  browserDatabaseVersion,
} from "./database";
export { recipeKey, parseRecipeKey } from "@/modules/recipes/reference";
export { resolveFavorites } from "@/modules/favorites/document";
export {
  resolveShopping,
  documentNutrition,
} from "@/modules/shopping/calculation";
