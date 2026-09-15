CREATE TYPE "public"."measurement_dimension" AS ENUM('MASS', 'VOLUME', 'COUNT', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."recipe_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(256) NOT NULL,
	"slug" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredients_name_not_empty" CHECK (length(trim("ingredients"."name")) > 0),
	CONSTRAINT "ingredients_slug_format" CHECK ("ingredients"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "ingredient_nutrition" (
	"ingredient_id" uuid PRIMARY KEY NOT NULL,
	"basis_quantity" numeric(18, 6) NOT NULL,
	"basis_unit_id" uuid NOT NULL,
	"calories_kcal" numeric(18, 6) NOT NULL,
	"protein_g" numeric(18, 6) NOT NULL,
	"fat_g" numeric(18, 6) NOT NULL,
	"carbohydrates_g" numeric(18, 6) NOT NULL,
	"source_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredient_nutrition_basis_positive" CHECK ("ingredient_nutrition"."basis_quantity" > 0),
	CONSTRAINT "ingredient_nutrition_calories_non_negative" CHECK ("ingredient_nutrition"."calories_kcal" >= 0),
	CONSTRAINT "ingredient_nutrition_protein_non_negative" CHECK ("ingredient_nutrition"."protein_g" >= 0),
	CONSTRAINT "ingredient_nutrition_fat_non_negative" CHECK ("ingredient_nutrition"."fat_g" >= 0),
	CONSTRAINT "ingredient_nutrition_carbohydrates_non_negative" CHECK ("ingredient_nutrition"."carbohydrates_g" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"unit_id" uuid NOT NULL,
	"note" text,
	"group_label" varchar(128),
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_ingredients_quantity_positive" CHECK ("recipe_ingredients"."quantity" > 0),
	CONSTRAINT "recipe_ingredients_position_positive" CHECK ("recipe_ingredients"."position" > 0),
	CONSTRAINT "recipe_ingredients_group_not_empty" CHECK ("recipe_ingredients"."group_label" IS NULL OR length(trim("recipe_ingredients"."group_label")) > 0)
);
--> statement-breakpoint
CREATE TABLE "recipe_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"instruction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_steps_position_positive" CHECK ("recipe_steps"."position" > 0),
	CONSTRAINT "recipe_steps_instruction_not_empty" CHECK (length(trim("recipe_steps"."instruction")) > 0)
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(256) NOT NULL,
	"slug" varchar(256) NOT NULL,
	"description" text,
	"base_servings" integer NOT NULL,
	"status" "recipe_status" DEFAULT 'DRAFT' NOT NULL,
	"prep_time_minutes" integer,
	"cook_time_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "recipes_title_not_empty" CHECK (length(trim("recipes"."title")) > 0),
	CONSTRAINT "recipes_slug_format" CHECK ("recipes"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "recipes_base_servings_positive" CHECK ("recipes"."base_servings" > 0),
	CONSTRAINT "recipes_prep_time_non_negative" CHECK ("recipes"."prep_time_minutes" IS NULL OR "recipes"."prep_time_minutes" >= 0),
	CONSTRAINT "recipes_cook_time_non_negative" CHECK ("recipes"."cook_time_minutes" IS NULL OR "recipes"."cook_time_minutes" >= 0),
	CONSTRAINT "recipes_published_at_required" CHECK ("recipes"."status" <> 'PUBLISHED' OR "recipes"."published_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(128) NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"dimension" "measurement_dimension" NOT NULL,
	"factor_to_base" numeric(24, 12),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_code_not_empty" CHECK (length(trim("units"."code")) > 0),
	CONSTRAINT "units_name_not_empty" CHECK (length(trim("units"."name")) > 0),
	CONSTRAINT "units_symbol_not_empty" CHECK (length(trim("units"."symbol")) > 0),
	CONSTRAINT "units_factor_contract" CHECK (("units"."dimension" = 'CUSTOM' AND "units"."factor_to_base" IS NULL) OR ("units"."dimension" <> 'CUSTOM' AND "units"."factor_to_base" IS NOT NULL AND "units"."factor_to_base" > 0))
);
--> statement-breakpoint
ALTER TABLE "ingredient_nutrition" ADD CONSTRAINT "ingredient_nutrition_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_nutrition" ADD CONSTRAINT "ingredient_nutrition_basis_unit_id_units_id_fk" FOREIGN KEY ("basis_unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_steps" ADD CONSTRAINT "recipe_steps_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingredients_slug_unique" ON "ingredients" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ingredient_nutrition_basis_unit_idx" ON "ingredient_nutrition" USING btree ("basis_unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_ingredients_recipe_position_unique" ON "recipe_ingredients" USING btree ("recipe_id","position");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_ingredient_idx" ON "recipe_ingredients" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_unit_idx" ON "recipe_ingredients" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_steps_recipe_position_unique" ON "recipe_steps" USING btree ("recipe_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_slug_unique" ON "recipes" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "units_code_unique" ON "units" USING btree ("code");
--> statement-breakpoint
INSERT INTO "units" ("id", "code", "name", "symbol", "dimension", "factor_to_base") VALUES
	('10000000-0000-4000-8000-000000000001', 'g', 'грамм', 'г', 'MASS', '1'),
	('10000000-0000-4000-8000-000000000002', 'kg', 'килограмм', 'кг', 'MASS', '1000'),
	('10000000-0000-4000-8000-000000000003', 'ml', 'миллилитр', 'мл', 'VOLUME', '1'),
	('10000000-0000-4000-8000-000000000004', 'l', 'литр', 'л', 'VOLUME', '1000'),
	('10000000-0000-4000-8000-000000000005', 'tsp', 'чайная ложка', 'ч. л.', 'VOLUME', '5'),
	('10000000-0000-4000-8000-000000000006', 'tbsp', 'столовая ложка', 'ст. л.', 'VOLUME', '15'),
	('10000000-0000-4000-8000-000000000007', 'pcs', 'штука', 'шт.', 'COUNT', '1')
ON CONFLICT ("code") DO NOTHING;
