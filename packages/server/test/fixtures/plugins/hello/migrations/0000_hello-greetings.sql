CREATE TABLE "hello_greetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hello_greetings" ADD CONSTRAINT "hello_greetings_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hello_greetings" ADD CONSTRAINT "hello_greetings_environment_id_space_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."space_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hello_greetings_environment_idx" ON "hello_greetings" USING btree ("environment_id","created_at");