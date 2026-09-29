CREATE INDEX `contents_list_idx` ON `contents` (`environment_id`,`position`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `published_contents_localization_idx` ON `published_contents` (`localization_id`);--> statement-breakpoint
CREATE INDEX `published_contents_list_idx` ON `published_contents` (`environment_id`,`locale`,`position`,`created_at`,`id`);