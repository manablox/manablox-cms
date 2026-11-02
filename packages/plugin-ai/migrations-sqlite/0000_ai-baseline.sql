CREATE TABLE `ai_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`provider_id` text,
	`provider_kind` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`prompt` text NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	`result` text,
	`asset_id` text,
	`error` text,
	`error_detail` text,
	`actor_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `ai_providers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_generations_space_idx` ON `ai_generations` (`space_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_generations_status_idx` ON `ai_generations` (`status`);--> statement-breakpoint
CREATE TABLE `ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`kind` text NOT NULL,
	`slug` text DEFAULT '' NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`api_key` text,
	`api_key_hint` text,
	`models` text DEFAULT '{}' NOT NULL,
	`system_prompt` text DEFAULT '' NOT NULL,
	`defaults` text DEFAULT '{}' NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_providers_space_kind_slug_key` ON `ai_providers` (`space_id`,`kind`,`slug`);