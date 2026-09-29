CREATE TABLE `notes_items` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `space_environments`(`id`) ON UPDATE no action ON DELETE cascade
);
