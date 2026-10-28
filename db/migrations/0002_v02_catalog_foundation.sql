CREATE TABLE "ingredient_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(256) NOT NULL,
	"slug" varchar(256) NOT NULL,
	"normalized_name" text GENERATED ALWAYS AS (trim(regexp_replace(replace(lower(normalize("name", NFKC)), 'ё', 'е'), '[[:space:]]+', ' ', 'g'))) STORED,
	CONSTRAINT "ingredient_categories_name_not_empty" CHECK (length(trim("ingredient_categories"."name")) > 0),
	CONSTRAINT "ingredient_categories_slug_format" CHECK ("ingredient_categories"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "ingredient_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"name" varchar(256) NOT NULL,
	"normalized_name" text GENERATED ALWAYS AS (trim(regexp_replace(replace(lower(normalize("name", NFKC)), 'ё', 'е'), '[[:space:]]+', ' ', 'g'))) STORED,
	CONSTRAINT "ingredient_aliases_name_not_empty" CHECK (length(trim("ingredient_aliases"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "normalized_name" text GENERATED ALWAYS AS (trim(regexp_replace(replace(lower(normalize("name", NFKC)), 'ё', 'е'), '[[:space:]]+', ' ', 'g'))) STORED;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "ingredient_nutrition" ADD COLUMN "source_kind" varchar(24) DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredient_nutrition" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "ingredient_nutrition" ADD COLUMN "source_identifier" varchar(256);--> statement-breakpoint
ALTER TABLE "ingredient_aliases" ADD CONSTRAINT "ingredient_aliases_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_categories_slug_unique" ON "ingredient_categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_categories_name_unique" ON "ingredient_categories" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_aliases_identity_unique" ON "ingredient_aliases" USING btree ("ingredient_id","normalized_name");--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_category_id_ingredient_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ingredient_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingredients_normalized_name_idx" ON "ingredients" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "ingredients_category_idx" ON "ingredients" USING btree ("category_id");--> statement-breakpoint
ALTER TABLE "ingredient_nutrition" ADD CONSTRAINT "ingredient_nutrition_source_kind" CHECK ("ingredient_nutrition"."source_kind" IN ('UNKNOWN', 'MANUAL', 'REFERENCE', 'IMPORT'));--> statement-breakpoint
ALTER TABLE "ingredient_nutrition" ADD CONSTRAINT "ingredient_nutrition_source_url" CHECK ("ingredient_nutrition"."source_url" IS NULL OR "ingredient_nutrition"."source_url" ~ '^https?://');
