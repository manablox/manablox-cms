CREATE TABLE "license_activations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"key_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_enc" text,
	"activation_id" text,
	"kind" text,
	"lease" text,
	"lease_exp" timestamp with time zone,
	"refresh_secret" text,
	"refreshed_at" timestamp with time zone,
	"last_error" jsonb,
	"failures" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"conflict_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "license_activations_key_hash_key" ON "license_activations" USING btree ("key_hash");