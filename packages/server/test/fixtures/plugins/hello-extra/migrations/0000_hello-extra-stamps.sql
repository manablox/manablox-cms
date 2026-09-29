CREATE TABLE "hello_extra_stamps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"greeting_id" uuid,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hello_extra_stamps" ADD CONSTRAINT "hello_extra_stamps_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hello_extra_stamps" ADD CONSTRAINT "hello_extra_stamps_environment_id_space_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."space_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hello_extra_stamps_environment_idx" ON "hello_extra_stamps" USING btree ("environment_id","created_at");