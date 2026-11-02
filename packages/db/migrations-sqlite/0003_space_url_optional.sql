PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`machine_name` text NOT NULL,
	`description` text,
	`url` text,
	`default_locale` text DEFAULT 'en' NOT NULL,
	`locales` text DEFAULT '["en"]' NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`import_status` text,
	`import_progress` text,
	`group_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `space_groups`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_spaces`("id", "name", "machine_name", "description", "url", "default_locale", "locales", "settings", "import_status", "import_progress", "group_id", "created_at", "updated_at") SELECT "id", "name", "machine_name", "description", "url", "default_locale", "locales", "settings", "import_status", "import_progress", "group_id", "created_at", "updated_at" FROM `spaces`;--> statement-breakpoint
DROP TABLE `spaces`;--> statement-breakpoint
ALTER TABLE `__new_spaces` RENAME TO `spaces`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `spaces_machine_name_key` ON `spaces` (`machine_name`);--> statement-breakpoint
CREATE INDEX `spaces_group_idx` ON `spaces` (`group_id`);