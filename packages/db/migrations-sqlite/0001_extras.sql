-- What drizzle-kit cannot express for SQLite: expression indexes, triggers and full-text
-- search. Not tracked by drizzle-kit: `pnpm db:generate` neither sees nor removes them.

-- SQLite treats NULLs as distinct in a unique index, so NULL parents, environments and
-- locales are compared as ''. Root documents then collide on slug, and global content types
-- on name.
CREATE UNIQUE INDEX `contents_sibling_slug_key` ON `contents` (`environment_id`, coalesce(`parent_id`, ''), `locale`, `slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `content_types_environment_name_key` ON `content_types` (coalesce(`environment_id`, ''), `name`);--> statement-breakpoint
CREATE UNIQUE INDEX `redirects_environment_locale_from_key` ON `redirects` (`environment_id`, coalesce(`locale`, ''), `from_path`);--> statement-breakpoint

-- The audit log is append-only. Deletes pass only while the prune sets `active` inside its
-- transaction; `audit.pruned` anchors never pass.
CREATE TABLE `audit_prune_guard` (
	`id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
	`active` integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
INSERT INTO `audit_prune_guard` (`id`, `active`) VALUES (1, 0);--> statement-breakpoint
CREATE TRIGGER `audit_entries_no_update` BEFORE UPDATE ON `audit_entries`
BEGIN
  SELECT RAISE(ABORT, 'audit_entries is append-only: UPDATE refused');
END;--> statement-breakpoint
CREATE TRIGGER `audit_entries_no_delete` BEFORE DELETE ON `audit_entries`
WHEN old.action = 'audit.pruned' OR coalesce((SELECT `active` FROM `audit_prune_guard` WHERE `id` = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'audit_entries is append-only: DELETE refused');
END;--> statement-breakpoint

-- Word search over `search` (title plus field text), as Postgres' `simple` tsvector does:
-- lower-cased, split on anything but letters and digits, accents kept. Rows are found by
-- `content_id` rather than rowid, which VACUUM may renumber.
CREATE VIRTUAL TABLE `contents_search` USING fts5(search, content_id, tokenize = 'unicode61 remove_diacritics 0');--> statement-breakpoint
CREATE TRIGGER `contents_search_insert` AFTER INSERT ON `contents`
BEGIN
  INSERT INTO contents_search (search, content_id) VALUES (new.search, new.id);
END;--> statement-breakpoint
CREATE TRIGGER `contents_search_delete` AFTER DELETE ON `contents`
BEGIN
  DELETE FROM contents_search WHERE rowid IN (
    SELECT rowid FROM contents_search WHERE contents_search MATCH 'content_id:"' || old.id || '"'
  );
END;--> statement-breakpoint
CREATE TRIGGER `contents_search_update` AFTER UPDATE OF title, search_text ON `contents`
BEGIN
  DELETE FROM contents_search WHERE rowid IN (
    SELECT rowid FROM contents_search WHERE contents_search MATCH 'content_id:"' || old.id || '"'
  );
  INSERT INTO contents_search (search, content_id) VALUES (new.search, new.id);
END;--> statement-breakpoint
CREATE VIRTUAL TABLE `published_contents_search` USING fts5(search, content_id, tokenize = 'unicode61 remove_diacritics 0');--> statement-breakpoint
CREATE TRIGGER `published_contents_search_insert` AFTER INSERT ON `published_contents`
BEGIN
  INSERT INTO published_contents_search (search, content_id) VALUES (new.search, new.id);
END;--> statement-breakpoint
CREATE TRIGGER `published_contents_search_delete` AFTER DELETE ON `published_contents`
BEGIN
  DELETE FROM published_contents_search WHERE rowid IN (
    SELECT rowid FROM published_contents_search WHERE published_contents_search MATCH 'content_id:"' || old.id || '"'
  );
END;--> statement-breakpoint
CREATE TRIGGER `published_contents_search_update` AFTER UPDATE OF title, search_text ON `published_contents`
BEGIN
  DELETE FROM published_contents_search WHERE rowid IN (
    SELECT rowid FROM published_contents_search WHERE published_contents_search MATCH 'content_id:"' || old.id || '"'
  );
  INSERT INTO published_contents_search (search, content_id) VALUES (new.search, new.id);
END;
