import { z } from "zod";

export const uuid = z.uuid().transform((value) => value.toLowerCase());
export const recipeReference = z
  .object({ kind: z.enum(["PUBLIC", "LOCAL"]), id: uuid })
  .strict();
export type RecipeReference = z.infer<typeof recipeReference>;
export function recipeKey(raw: RecipeReference): string {
  const ref = recipeReference.parse(raw);
  return `${ref.kind}:${ref.id}`;
}
export function parseRecipeKey(value: string): RecipeReference {
  const [kind, id, extra] = value.split(":");
  if (extra !== undefined) throw new Error("Invalid recipe reference");
  return recipeReference.parse({ kind, id });
}
