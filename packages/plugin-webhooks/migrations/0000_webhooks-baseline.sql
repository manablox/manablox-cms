CREATE TABLE "webhooks_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"space_id" uuid,
	"direction" text DEFAULT 'outgoing' NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" integer,
	"error" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"ms" integer,
	"run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"direction" text DEFAULT 'outgoing' NOT NULL,
	"name" text NOT NULL,
	"slug" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'runtime' NOT NULL,
	"source_ref" text,
	"description" text,
	"url" text DEFAULT '' NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"methods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auth_mode" text DEFAULT 'none' NOT NULL,
	"credential_id" uuid,
	"signature_header" text DEFAULT 'x-manablox-signature' NOT NULL,
	"algorithm" text DEFAULT 'sha256' NOT NULL,
	"signature_format" text DEFAULT 'prefixed' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhooks_environment_direction_slug_key" UNIQUE("environment_id","direction","slug")
);
--> statement-breakpoint
ALTER TABLE "webhooks_deliveries" ADD CONSTRAINT "webhooks_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks_deliveries" ADD CONSTRAINT "webhooks_deliveries_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_environment_id_space_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."space_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhooks_deliveries_webhook_idx" ON "webhooks_deliveries" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE INDEX "webhooks_space_idx" ON "webhooks" USING btree ("space_id","direction","enabled");