CREATE TABLE `license_activations` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`key_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_enc` text,
	`activation_id` text,
	`kind` text,
	`lease` text,
	`lease_exp` integer,
	`refresh_secret` text,
	`refreshed_at` integer,
	`last_error` text,
	`failures` integer DEFAULT 0 NOT NULL,
	`retry_at` integer,
	`conflict_at` integer,
	`deactivated_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `license_activations_key_hash_key` ON `license_activations` (`key_hash`);