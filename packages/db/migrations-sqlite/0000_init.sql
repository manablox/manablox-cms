CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`issuer` text DEFAULT '' NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_provider_account_key` ON `accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `accounts_user_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `apikeys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`start` text,
	`prefix` text,
	`key` text NOT NULL,
	`user_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`expires_at` integer,
	`last_request` integer,
	`permissions` text,
	`space_ids` text,
	`environment_ids` text,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `apikeys_user_idx` ON `apikeys` (`user_id`);--> statement-breakpoint
CREATE INDEX `apikeys_prefix_idx` ON `apikeys` (`prefix`);--> statement-breakpoint
CREATE TABLE `asset_spaces` (
	`asset_id` text NOT NULL,
	`space_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`asset_id`, `space_id`),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `asset_spaces_space_idx` ON `asset_spaces` (`space_id`,`asset_id`);--> statement-breakpoint
CREATE TABLE `asset_tags` (
	`tag_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`tag_id`, `asset_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `asset_tags_asset_idx` ON `asset_tags` (`asset_id`);--> statement-breakpoint
CREATE TABLE `asset_usages` (
	`asset_id` text NOT NULL,
	`content_id` text NOT NULL,
	`space_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`asset_id`, `content_id`),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `space_environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `asset_usages_published_idx` ON `asset_usages` (`asset_id`,`published`);--> statement-breakpoint
CREATE INDEX `asset_usages_content_idx` ON `asset_usages` (`content_id`);--> statement-breakpoint
CREATE INDEX `asset_usages_space_idx` ON `asset_usages` (`space_id`);--> statement-breakpoint
CREATE TABLE `asset_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`preset` text NOT NULL,
	`format` text NOT NULL,
	`key` text NOT NULL,
	`width` integer,
	`height` integer,
	`size` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_variants_asset_preset_format_key` ON `asset_variants` (`asset_id`,`preset`,`format`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`driver` text DEFAULT 'local' NOT NULL,
	`key` text NOT NULL,
	`filename` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`duration` integer,
	`checksum` text,
	`alt` text,
	`title` text,
	`publish_at` integer,
	`unpublish_at` integer,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_driver_key_key` ON `assets` (`driver`,`key`);--> statement-breakpoint
CREATE INDEX `assets_created_idx` ON `assets` (`created_at`);--> statement-breakpoint
CREATE INDEX `assets_checksum_idx` ON `assets` (`checksum`);--> statement-breakpoint
CREATE INDEX `assets_schedule_idx` ON `assets` (`publish_at`,`unpublish_at`) WHERE publish_at is not null or unpublish_at is not null;--> statement-breakpoint
CREATE TABLE `audit_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`space_id` text,
	`actor_kind` text NOT NULL,
	`actor_id` text,
	`actor_label` text NOT NULL,
	`actor_detail` text,
	`action` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text,
	`target_label` text,
	`changes` text DEFAULT '[]' NOT NULL,
	`meta` text,
	`prev_hash` text,
	`hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_entries_seq_idx` ON `audit_entries` (`seq`);--> statement-breakpoint
CREATE INDEX `audit_entries_space_at_idx` ON `audit_entries` (`space_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_entries_target_idx` ON `audit_entries` (`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `audit_entries_actor_idx` ON `audit_entries` (`actor_kind`,`actor_id`);--> statement-breakpoint
CREATE INDEX `audit_entries_action_idx` ON `audit_entries` (`action`);--> statement-breakpoint
CREATE TABLE `content_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`content_id` text NOT NULL,
	`type_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_by` text,
	`requested_by_label` text DEFAULT '' NOT NULL,
	`request_note` text,
	`content_version` integer,
	`requested_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`decided_by` text,
	`decided_by_label` text,
	`decision_note` text,
	`decided_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `space_environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `content_approvals_content_idx` ON `content_approvals` (`content_id`,`requested_at`);--> statement-breakpoint
CREATE INDEX `content_approvals_space_status_idx` ON `content_approvals` (`space_id`,`status`,`requested_at`);--> statement-breakpoint
CREATE TABLE `content_tags` (
	`tag_id` text NOT NULL,
	`localization_id` text NOT NULL,
	`space_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`tag_id`, `localization_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `space_environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `content_tags_localization_idx` ON `content_tags` (`localization_id`);--> statement-breakpoint
CREATE INDEX `content_tags_space_idx` ON `content_tags` (`space_id`);--> statement-breakpoint
CREATE TABLE `content_types` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text,
	`environment_id` text,
	`name` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`icon` text,
	`kind` text DEFAULT 'content' NOT NULL,
	`has_slug` integer DEFAULT true NOT NULL,
	`is_publishable` integer DEFAULT true NOT NULL,
	`is_visible_in_tree` integer DEFAULT true NOT NULL,
	`can_be_visible_in_menu` integer DEFAULT true NOT NULL,
	`requires_approval` integer DEFAULT false NOT NULL,
	`fields` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `space_environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `content_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`version` integer NOT NULL,
	`label` text,
	`snapshot` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_versions_content_version_key` ON `content_versions` (`content_id`,`version`);--> statement-breakpoint
CREATE INDEX `content_versions_content_idx` ON `content_versions` (`content_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `content_versions_created_idx` ON `content_versions` (`created_at`);--> statement-breakpoint
CREATE TABLE `contents` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`type_id` text NOT NULL,
	`locale` text NOT NULL,
	`localization_id` text NOT NULL,
	`parent_id` text,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`path` text NOT NULL,
	`permalink` text,
	`permalink_path` text DEFAULT '' NOT NULL,
	`permalink_segment` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`source` text DEFAULT 'runtime' NOT NULL,
	`source_ref` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`updated_by` text,
	`published_at` integer,
	`publish_at` integer,
	`unpublish_at` integer,
	`search` text GENERATED ALWAYS AS (coalesce(title, '') || ' ' || coalesce(search_text, '')) VIRTUAL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `space_environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contents_path_idx` ON `contents` (`path`);--> statement-breakpoint
CREATE INDEX `contents_parent_idx` ON `contents` (`parent_id`);--> statement-breakpoint
CREATE INDEX `contents_space_type_idx` ON `contents` (`space_id`,`type_id`);--> statement-breakpoint
CREATE INDEX `contents_localization_idx` ON `contents` (`localization_id`);--> statement-breakpoint
CREATE INDEX `contents_status_idx` ON `contents` (`space_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `contents_permalink_key` ON `contents` (`environment_id`,`locale`,`permalink`) WHERE permalink is not null;--> statement-breakpoint
CREATE INDEX `contents_publish_at_idx` ON `contents` (`publish_at`) WHERE publish_at is not null;--> statement-breakpoint
CREATE INDEX `contents_unpublish_at_idx` ON `contents` (`unpublish_at`) WHERE unpublish_at is not null;--> statement-breakpoint
CREATE TABLE `control_events` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_id` text DEFAULT '' NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`delivered_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `control_events_seq_key` ON `control_events` (`seq`);--> statement-breakpoint
CREATE INDEX `control_events_created_idx` ON `control_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `control_events_undelivered_idx` ON `control_events` (`seq`) WHERE delivered_at is null;--> statement-breakpoint
CREATE TABLE `control_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_id` text DEFAULT '' NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `control_settings_scope_key_key` ON `control_settings` (`scope_kind`,`scope_id`,`key`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`kind` text NOT NULL,
	`source` text DEFAULT 'runtime' NOT NULL,
	`source_ref` text,
	`provider` text DEFAULT '' NOT NULL,
	`data` text,
	`hint` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_space_slug_key` ON `credentials` (`space_id`,`slug`);--> statement-breakpoint
CREATE TABLE `instance_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`grants` text DEFAULT '[]' NOT NULL,
	`invited_by` text,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by` text,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_key` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitations_email_idx` ON `invitations` (`email`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`user_id` text NOT NULL,
	`space_id` text NOT NULL,
	`role` text DEFAULT 'editor' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `space_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memberships_space_idx` ON `memberships` (`space_id`);--> statement-breakpoint
CREATE TABLE `menu_items` (
	`id` text PRIMARY KEY NOT NULL,
	`menu_id` text NOT NULL,
	`parent_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`localization_id` text,
	`label` text,
	`url` text,
	`target` text DEFAULT '_self' NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `menus`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `menu_items_menu_idx` ON `menu_items` (`menu_id`,`parent_id`,`position`);--> statement-breakpoint
CREATE INDEX `menu_items_localization_idx` ON `menu_items` (`localization_id`);--> statement-breakpoint
CREATE TABLE `menus` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`name` text NOT NULL,
	`machine_name` text NOT NULL,
	`description` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `space_environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menus_environment_machine_name_key` ON `menus` (`environment_id`,`machine_name`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`space_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`url` text,
	`target_kind` text,
	`target_id` text,
	`actor_id` text,
	`actor_label` text,
	`meta` text,
	`read_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_created_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_user_unread_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notifications_target_idx` ON `notifications` (`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `notifications_space_idx` ON `notifications` (`space_id`);--> statement-breakpoint
CREATE INDEX `notifications_created_idx` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE TABLE `published_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`type_id` text NOT NULL,
	`locale` text NOT NULL,
	`localization_id` text NOT NULL,
	`parent_id` text,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`path` text NOT NULL,
	`permalink` text,
	`permalink_path` text DEFAULT '' NOT NULL,
	`permalink_segment` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`source` text DEFAULT 'runtime' NOT NULL,
	`source_ref` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`updated_by` text,
	`published_at` integer,
	`publish_at` integer,
	`unpublish_at` integer,
	`source_version` integer DEFAULT 1 NOT NULL,
	`search` text GENERATED ALWAYS AS (coalesce(title, '') || ' ' || coalesce(search_text, '')) VIRTUAL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `space_environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `published_contents_path_idx` ON `published_contents` (`path`);--> statement-breakpoint
CREATE INDEX `published_contents_parent_idx` ON `published_contents` (`parent_id`);--> statement-breakpoint
CREATE INDEX `published_contents_space_type_idx` ON `published_contents` (`space_id`,`type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `published_contents_permalink_key` ON `published_contents` (`environment_id`,`locale`,`permalink`) WHERE permalink is not null;--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`keys` text NOT NULL,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_key` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE TABLE `redirects` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`locale` text,
	`from_path` text NOT NULL,
	`to_path` text,
	`to_content_id` text,
	`status` integer DEFAULT 301 NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `space_environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `redirects_target_idx` ON `redirects` (`space_id`,`to_content_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`name` text NOT NULL,
	`machine_name` text NOT NULL,
	`description` text,
	`permissions` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_space_machine_name_key` ON `roles` (`space_id`,`machine_name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`sso_provider_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_key` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `space_api_hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`hostname` text NOT NULL,
	`verified_at` integer,
	`verification_token` text,
	`verification_started_at` integer,
	`verification_checked_at` integer,
	`verification_failed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `space_environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `space_api_hosts_hostname_key` ON `space_api_hosts` (`hostname`);--> statement-breakpoint
CREATE INDEX `space_api_hosts_space_idx` ON `space_api_hosts` (`space_id`);--> statement-breakpoint
CREATE TABLE `space_environments` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`machine_name` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`created_from` text,
	`created_mode` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_from`) REFERENCES `space_environments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `space_environments_space_machine_name_key` ON `space_environments` (`space_id`,`machine_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `space_environments_production_key` ON `space_environments` (`space_id`) WHERE kind = 'production';--> statement-breakpoint
CREATE TABLE `space_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `space_groups_external_id_key` ON `space_groups` (`external_id`);--> statement-breakpoint
CREATE TABLE `space_plugin_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`plugin` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `space_environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `space_plugin_settings_environment_plugin_key` ON `space_plugin_settings` (`environment_id`,`plugin`);--> statement-breakpoint
CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`machine_name` text NOT NULL,
	`description` text,
	`url` text NOT NULL,
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
CREATE UNIQUE INDEX `spaces_machine_name_key` ON `spaces` (`machine_name`);--> statement-breakpoint
CREATE INDEX `spaces_group_idx` ON `spaces` (`group_id`);--> statement-breakpoint
CREATE TABLE `sso_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`issuer` text NOT NULL,
	`domain` text NOT NULL,
	`oidc_config` text,
	`saml_config` text,
	`user_id` text,
	`organization_id` text,
	`require_sso` integer DEFAULT false NOT NULL,
	`show_on_sign_in` integer DEFAULT false NOT NULL,
	`create_accounts` integer DEFAULT true NOT NULL,
	`default_grants` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sso_providers_provider_id_key` ON `sso_providers` (`provider_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` text,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_space_slug_key` ON `tags` (`space_id`,`slug`);--> statement-breakpoint
CREATE INDEX `tags_space_name_idx` ON `tags` (`space_id`,`name`);--> statement-breakpoint
CREATE TABLE `two_factors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`verified` integer DEFAULT true NOT NULL,
	`failed_verification_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `two_factors_user_key` ON `two_factors` (`user_id`);--> statement-breakpoint
CREATE TABLE `usage_counters` (
	`scope_kind` text NOT NULL,
	`scope_id` text DEFAULT '' NOT NULL,
	`metric` text NOT NULL,
	`period` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`scope_kind`, `scope_id`, `metric`, `period`)
);
--> statement-breakpoint
CREATE INDEX `usage_counters_metric_idx` ON `usage_counters` (`scope_kind`,`metric`,`period`);--> statement-breakpoint
CREATE TABLE `usage_external` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`space_id` text NOT NULL,
	`metric` text NOT NULL,
	`period` text NOT NULL,
	`value` integer NOT NULL,
	`mode` text NOT NULL,
	`received_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `usage_external_space_metric_idx` ON `usage_external` (`space_id`,`metric`,`period`,`seq`);--> statement-breakpoint
CREATE TABLE `usage_flushes` (
	`id` text PRIMARY KEY NOT NULL,
	`flushed_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_flushes_flushed_idx` ON `usage_flushes` (`flushed_at`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text DEFAULT 'editor' NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`ban_reason` text,
	`two_factor_enabled` integer DEFAULT false NOT NULL,
	`notification_preferences` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_key` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);