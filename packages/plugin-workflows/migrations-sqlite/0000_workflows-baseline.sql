CREATE TABLE `workflows_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`space_id` text NOT NULL,
	`trigger` text NOT NULL,
	`version` integer,
	`test` integer DEFAULT false NOT NULL,
	`definition` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`context` text NOT NULL,
	`state` text DEFAULT '{"outputs":{},"fired":[],"dead":[],"ready":[],"done":[]}' NOT NULL,
	`log` text DEFAULT '[]' NOT NULL,
	`error` text,
	`error_key` text,
	`error_params` text,
	`abort` text,
	`resume_at` integer,
	`step_count` integer DEFAULT 0 NOT NULL,
	`failed_step` text,
	`document_id` text,
	`document_title` text,
	`document_count` integer DEFAULT 0 NOT NULL,
	`caller` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workflows_runs_workflow_idx` ON `workflows_runs` (`workflow_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflows_runs_resume_idx` ON `workflows_runs` (`status`,`resume_at`);--> statement-breakpoint
CREATE INDEX `workflows_runs_space_idx` ON `workflows_runs` (`space_id`);--> statement-breakpoint
CREATE TABLE `workflows_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`trigger` text NOT NULL,
	`abort_triggers` text DEFAULT '[]' NOT NULL,
	`nodes` text DEFAULT '[]' NOT NULL,
	`edges` text DEFAULT '[]' NOT NULL,
	`note` text,
	`published_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflows_versions_workflow_version_key` ON `workflows_versions` (`workflow_id`,`version`);--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'runtime' NOT NULL,
	`source_ref` text,
	`description` text,
	`enabled` integer DEFAULT false NOT NULL,
	`trigger` text NOT NULL,
	`abort_triggers` text DEFAULT '[]' NOT NULL,
	`nodes` text DEFAULT '[]' NOT NULL,
	`edges` text DEFAULT '[]' NOT NULL,
	`published_version` integer,
	`trigger_kind` text,
	`published_at` integer,
	`draft_changed` integer DEFAULT false NOT NULL,
	`last_scheduled_at` integer,
	`last_run_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `space_environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workflows_space_idx` ON `workflows` (`space_id`,`enabled`,`trigger_kind`);--> statement-breakpoint
CREATE INDEX `workflows_trigger_kind_idx` ON `workflows` (`trigger_kind`,`enabled`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflows_environment_slug_key` ON `workflows` (`environment_id`,`slug`) WHERE "workflows"."slug" <> '';