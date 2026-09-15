export type MeasurementDimension = "MASS" | "VOLUME" | "COUNT" | "CUSTOM";

export type UnitDefinition = Readonly<{
  code: string;
  name: string;
  symbol: string;
  dimension: MeasurementDimension;
  factorToBase: string | null;
}>;

export const standardUnits = {
  g: {
    code: "g",
    name: "грамм",
    symbol: "г",
    dimension: "MASS",
    factorToBase: "1",
  },
  kg: {
    code: "kg",
    name: "килограмм",
    symbol: "кг",
    dimension: "MASS",
    factorToBase: "1000",
  },
  ml: {
    code: "ml",
    name: "миллилитр",
    symbol: "мл",
    dimension: "VOLUME",
    factorToBase: "1",
  },
  l: {
    code: "l",
    name: "литр",
    symbol: "л",
    dimension: "VOLUME",
    factorToBase: "1000",
  },
  tsp: {
    code: "tsp",
    name: "чайная ложка",
    symbol: "ч. л.",
    dimension: "VOLUME",
    factorToBase: "5",
  },
  tbsp: {
    code: "tbsp",
    name: "столовая ложка",
    symbol: "ст. л.",
    dimension: "VOLUME",
    factorToBase: "15",
  },
  pcs: {
    code: "pcs",
    name: "штука",
    symbol: "шт.",
    dimension: "COUNT",
    factorToBase: "1",
  },
} as const satisfies Record<string, UnitDefinition>;
