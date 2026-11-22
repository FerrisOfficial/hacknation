CREATE TYPE "public"."incident_event_kind" AS ENUM('flagged', 'alert', 'reanalyzed', 'status');--> statement-breakpoint
ALTER TYPE "public"."review_status" ADD VALUE 'postponed' BEFORE 'confirmed';--> statement-breakpoint
CREATE TABLE "incident_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"kind" "incident_event_kind" NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"status" "review_status",
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviewers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_result_id_analysis_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."analysis_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_actor_id_reviewers_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."reviewers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incident_events_result_at_idx" ON "incident_events" USING btree ("result_id","at");--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_reviewed_by_reviewers_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."reviewers"("id") ON DELETE set null ON UPDATE no action;