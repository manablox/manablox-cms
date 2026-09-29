CREATE TABLE "workflows_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"version" integer,
	"test" boolean DEFAULT false NOT NULL,
	"definition" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"context" jsonb NOT NULL,
	"state" jsonb DEFAULT '{"outputs":{},"fired":[],"dead":[],"ready":[],"done":[]}'::jsonb NOT NULL,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"error_key" text,
	"error_params" jsonb,
	"abort" jsonb,
	"resume_at" timestamp with time zone,
	"step_count" integer DEFAULT 0 NOT NULL,
	"failed_step" jsonb,
	"document_id" text,
	"document_title" text,
	"document_count" integer DEFAULT 0 NOT NULL,
	"caller" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" jsonb NOT NULL,
	"abort_triggers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"published_by" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'runtime' NOT NULL,
	"source_ref" text,
	"description" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"trigger" jsonb NOT NULL,
	"abort_triggers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_version" integer,
	"trigger_kind" text,
	"published_at" timestamp with time zone,
	"draft_changed" boolean DEFAULT false NOT NULL,
	"last_scheduled_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflows_runs" ADD CONSTRAINT "workflows_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_runs" ADD CONSTRAINT "workflows_runs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_versions" ADD CONSTRAINT "workflows_versions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_environment_id_space_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."space_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflows_runs_workflow_idx" ON "workflows_runs" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "workflows_runs_resume_idx" ON "workflows_runs" USING btree ("status","resume_at");--> statement-breakpoint
CREATE INDEX "workflows_runs_space_idx" ON "workflows_runs" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_versions_workflow_version_key" ON "workflows_versions" USING btree ("workflow_id","version");--> statement-breakpoint
CREATE INDEX "workflows_space_idx" ON "workflows" USING btree ("space_id","enabled","trigger_kind");--> statement-breakpoint
CREATE INDEX "workflows_trigger_kind_idx" ON "workflows" USING btree ("trigger_kind","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_environment_slug_key" ON "workflows" USING btree ("environment_id","slug") WHERE "workflows"."slug" <> '';