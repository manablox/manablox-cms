CREATE TABLE `website_design_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`design_id` text NOT NULL,
	`space_id` text NOT NULL,
	`version` integer NOT NULL,
	`label` text,
	`data` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`design_id`) REFERENCES `website_designs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `website_design_versions_design_idx` ON `website_design_versions` (`design_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `website_design_versions_space_idx` ON `website_design_versions` (`space_id`);--> statement-breakpoint
CREATE TABLE `website_designs` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`draft` text NOT NULL,
	`published` text,
	`version` integer DEFAULT 1 NOT NULL,
	`published_version` integer,
	`published_at` integer,
	`published_by` text,
	`source` text DEFAULT 'runtime' NOT NULL,
	`source_ref` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`updated_by` text,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `space_environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `website_designs_environment_kind_key_key` ON `website_designs` (`environment_id`,`kind`,`key`);--> statement-breakpoint
CREATE TABLE `website_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`hostname` text NOT NULL,
	`locale` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`redirect_to_primary` integer DEFAULT false NOT NULL,
	`verified_at` integer,
	`verification_token` text,
	`verification_started_at` integer,
	`verification_checked_at` integer,
	`verification_failed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `space_environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `website_domains_hostname_key` ON `website_domains` (`hostname`);--> statement-breakpoint
CREATE INDEX `website_domains_space_idx` ON `website_domains` (`space_id`);