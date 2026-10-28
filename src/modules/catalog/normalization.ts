export function normalizeIngredientName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/\s+/gu, " ")
    .trim();
}
