CREATE TABLE "ai_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"provider_id" uuid,
	"provider_kind" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"asset_id" uuid,
	"error" text,
	"error_detail" jsonb,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"slug" text DEFAULT '' NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"api_key" text,
	"api_key_hint" text,
	"models" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_providers_space_kind_slug_key" UNIQUE("space_id","kind","slug")
);
--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_generations_space_idx" ON "ai_generations" USING btree ("space_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_generations_status_idx" ON "ai_generations" USING btree ("status");