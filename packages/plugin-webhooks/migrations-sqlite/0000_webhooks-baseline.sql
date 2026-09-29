CREATE TABLE `webhooks_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`space_id` text,
	`direction` text DEFAULT 'outgoing' NOT NULL,
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`headers` text DEFAULT '{}' NOT NULL,
	`status` integer,
	`error` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`ms` integer,
	`run_ids` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhooks_deliveries_webhook_idx` ON `webhooks_deliveries` (`webhook_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`direction` text DEFAULT 'outgoing' NOT NULL,
	`name` text NOT NULL,
	`slug` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'runtime' NOT NULL,
	`source_ref` text,
	`description` text,
	`url` text DEFAULT '' NOT NULL,
	`events` text DEFAULT '[]' NOT NULL,
	`headers` text DEFAULT '[]' NOT NULL,
	`methods` text DEFAULT '[]' NOT NULL,
	`auth_mode` text DEFAULT 'none' NOT NULL,
	`credential_id` text,
	`signature_header` text DEFAULT 'x-manablox-signature' NOT NULL,
	`algorithm` text DEFAULT 'sha256' NOT NULL,
	`signature_format` text DEFAULT 'prefixed' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `space_environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `webhooks_space_idx` ON `webhooks` (`space_id`,`direction`,`enabled`);--> statement-breakpoint
CREATE UNIQUE INDEX `webhooks_environment_direction_slug_key` ON `webhooks` (`environment_id`,`direction`,`slug`);