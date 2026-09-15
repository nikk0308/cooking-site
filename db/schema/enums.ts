import { pgEnum } from "drizzle-orm/pg-core";

export const measurementDimensions = [
  "MASS",
  "VOLUME",
  "COUNT",
  "CUSTOM",
] as const;
export type MeasurementDimension = (typeof measurementDimensions)[number];
export const measurementDimensionEnum = pgEnum(
  "measurement_dimension",
  measurementDimensions,
);

export const recipeStatuses = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type RecipeStatus = (typeof recipeStatuses)[number];
export const recipeStatusEnum = pgEnum("recipe_status", recipeStatuses);
