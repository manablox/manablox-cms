CREATE TABLE "website_design_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"label" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "website_designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"draft" jsonb NOT NULL,
	"published" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"published_version" integer,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"source" text DEFAULT 'runtime' NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "website_designs_environment_kind_key_key" UNIQUE("environment_id","kind","key")
);
--> statement-breakpoint
CREATE TABLE "website_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"locale" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"redirect_to_primary" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"verification_token" text,
	"verification_started_at" timestamp with time zone,
	"verification_checked_at" timestamp with time zone,
	"verification_failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "website_design_versions" ADD CONSTRAINT "website_design_versions_design_id_website_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."website_designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_design_versions" ADD CONSTRAINT "website_design_versions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_designs" ADD CONSTRAINT "website_designs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_designs" ADD CONSTRAINT "website_designs_environment_id_space_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."space_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_domains" ADD CONSTRAINT "website_domains_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_domains" ADD CONSTRAINT "website_domains_environment_id_space_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."space_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "website_design_versions_design_idx" ON "website_design_versions" USING btree ("design_id","created_at");--> statement-breakpoint
CREATE INDEX "website_design_versions_space_idx" ON "website_design_versions" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "website_domains_hostname_key" ON "website_domains" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "website_domains_space_idx" ON "website_domains" USING btree ("space_id");