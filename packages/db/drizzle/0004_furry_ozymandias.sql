CREATE TYPE "public"."scrape_trigger" AS ENUM('schedule', 'manual', 'api');--> statement-breakpoint
CREATE TABLE "module_settings" (
	"module" "analysis_module" PRIMARY KEY NOT NULL,
	"threshold" real NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_results" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "analysis_results" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "analyzed_hash" text;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "analyzed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD COLUMN "trigger" "scrape_trigger" DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD COLUMN "queue_job_id" text;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD COLUMN "materials_count" integer;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD COLUMN "analysis_queued" integer;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "config" jsonb DEFAULT '{"kind":"web_page"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "interval_minutes" integer;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_scraped_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_results_material_module_idx" ON "analysis_results" USING btree ("material_id","module");