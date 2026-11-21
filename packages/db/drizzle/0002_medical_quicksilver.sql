CREATE TYPE "public"."analysis_module" AS ENUM('finfluencer', 'risk_disclosure', 'unauthorized_advisory');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('web', 'facebook', 'instagram', 'tiktok', 'youtube', 'x', 'linkedin', 'telegram');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('new', 'in_review', 'confirmed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."scrape_job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "analysis_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"module" "analysis_module" NOT NULL,
	"score" real NOT NULL,
	"label" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model" text NOT NULL,
	"status" "review_status" DEFAULT 'new' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"job_id" uuid,
	"url" text NOT NULL,
	"title" text,
	"author" text,
	"raw_html" text,
	"content_ref" text,
	"text" text NOT NULL,
	"content_hash" text NOT NULL,
	"language" text,
	"published_at" timestamp with time zone,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "materials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scrape_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "scrape_job_status" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scrape_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform" DEFAULT 'web' NOT NULL,
	"url" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_job_id_scrape_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."scrape_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_results_material_id_idx" ON "analysis_results" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "analysis_results_module_score_idx" ON "analysis_results" USING btree ("module","score");--> statement-breakpoint
CREATE INDEX "analysis_results_status_idx" ON "analysis_results" USING btree ("status");--> statement-breakpoint
CREATE INDEX "analysis_results_created_at_idx" ON "analysis_results" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "materials_url_idx" ON "materials" USING btree ("url");--> statement-breakpoint
CREATE INDEX "materials_content_hash_idx" ON "materials" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "materials_source_id_idx" ON "materials" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "materials_scraped_at_idx" ON "materials" USING btree ("scraped_at");--> statement-breakpoint
CREATE INDEX "scrape_jobs_source_id_idx" ON "scrape_jobs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "scrape_jobs_status_idx" ON "scrape_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scrape_jobs_created_at_idx" ON "scrape_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_url_idx" ON "sources" USING btree ("url");--> statement-breakpoint
CREATE INDEX "sources_platform_idx" ON "sources" USING btree ("platform");