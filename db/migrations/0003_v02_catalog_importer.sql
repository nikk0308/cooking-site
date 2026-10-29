CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "catalog_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace" varchar(128) NOT NULL,
	"file_hash" varchar(64) NOT NULL,
	"plan_hash" varchar(64) NOT NULL,
	"batch" varchar(256),
	"row_count" integer NOT NULL,
	"report" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_revision" (
	"id" integer PRIMARY KEY NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "catalog_revision_singleton" CHECK ("catalog_revision"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "catalog_source_records" (
	"namespace" varchar(128) NOT NULL,
	"external_id" varchar(256) NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"mode" varchar(16) NOT NULL,
	"applied_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_source_records_namespace_external_id_pk" PRIMARY KEY("namespace","external_id"),
	CONSTRAINT "catalog_source_mode" CHECK ("catalog_source_records"."mode" IN ('SOURCE','LINK_ONLY'))
);
--> statement-breakpoint
ALTER TABLE "catalog_source_records" ADD CONSTRAINT "catalog_source_records_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_source_ingredient_unique" ON "catalog_source_records" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "ingredients_name_trgm_idx" ON "ingredients" USING gin ("normalized_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ingredients_name_prefix_idx" ON "ingredients" USING btree ("normalized_name" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "ingredient_aliases_name_trgm_idx" ON "ingredient_aliases" USING gin ("normalized_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ingredient_aliases_name_prefix_idx" ON "ingredient_aliases" USING btree ("normalized_name" text_pattern_ops);
--> statement-breakpoint
INSERT INTO catalog_revision (id, revision) VALUES (1, 0);
--> statement-breakpoint
CREATE FUNCTION bump_catalog_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE catalog_revision SET revision = revision + 1 WHERE id = 1; RETURN NULL; END $$;
--> statement-breakpoint
CREATE TRIGGER ingredients_catalog_revision AFTER INSERT OR UPDATE OR DELETE ON ingredients FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_revision();
--> statement-breakpoint
CREATE TRIGGER ingredient_categories_catalog_revision AFTER INSERT OR UPDATE OR DELETE ON ingredient_categories FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_revision();
--> statement-breakpoint
CREATE TRIGGER ingredient_aliases_catalog_revision AFTER INSERT OR UPDATE OR DELETE ON ingredient_aliases FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_revision();
--> statement-breakpoint
CREATE TRIGGER ingredient_nutrition_catalog_revision AFTER INSERT OR UPDATE OR DELETE ON ingredient_nutrition FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_revision();
--> statement-breakpoint
CREATE TRIGGER catalog_source_records_catalog_revision AFTER INSERT OR UPDATE OR DELETE ON catalog_source_records FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_revision();
--> statement-breakpoint
CREATE TRIGGER units_catalog_revision AFTER INSERT OR UPDATE OR DELETE ON units FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_revision();
