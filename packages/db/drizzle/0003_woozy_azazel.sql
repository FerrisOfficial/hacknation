ALTER TABLE "materials" ADD COLUMN "platform" "platform" DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "materials_platform_idx" ON "materials" USING btree ("platform");