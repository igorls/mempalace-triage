CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`maintainer_id` integer,
	`action` text NOT NULL,
	`item_number` integer,
	`before` text,
	`after` text,
	FOREIGN KEY (`maintainer_id`) REFERENCES `maintainers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `activity_ts_idx` ON `activity_log` (`ts`);--> statement-breakpoint
CREATE INDEX `activity_item_idx` ON `activity_log` (`item_number`);--> statement-breakpoint
CREATE TABLE `agent_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`maintainer_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`maintainer_id`) REFERENCES `maintainers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_tokens_hash_uniq` ON `agent_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `agent_tokens_maintainer_idx` ON `agent_tokens` (`maintainer_id`);--> statement-breakpoint
CREATE TABLE `claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_number` integer NOT NULL,
	`maintainer_id` integer NOT NULL,
	`intent` text NOT NULL,
	`claimed_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`heartbeat_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`released_at` integer,
	`note` text,
	FOREIGN KEY (`item_number`) REFERENCES `triage_items`(`number`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`maintainer_id`) REFERENCES `maintainers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claims_active_uniq` ON `claims` (`item_number`) WHERE "claims"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX `claims_maintainer_idx` ON `claims` (`maintainer_id`);--> statement-breakpoint
CREATE TABLE `clusters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`canonical_item_number` integer NOT NULL,
	`summary` text NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `maintainers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `maintainers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`github_login` text NOT NULL,
	`github_id` integer,
	`display_name` text,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_seen_at` integer,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `maintainers_login_uniq` ON `maintainers` (`github_login`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_number` integer NOT NULL,
	`maintainer_id` integer NOT NULL,
	`body` text NOT NULL,
	`visibility` text DEFAULT 'maintainers' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`item_number`) REFERENCES `triage_items`(`number`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`maintainer_id`) REFERENCES `maintainers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notes_item_idx` ON `notes` (`item_number`);--> statement-breakpoint
CREATE TABLE `tags` (
	`item_number` integer NOT NULL,
	`tag` text NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`item_number`, `tag`),
	FOREIGN KEY (`item_number`) REFERENCES `triage_items`(`number`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `maintainers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `triage_items` (
	`number` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`github_state` text NOT NULL,
	`github_title` text NOT NULL,
	`github_author` text NOT NULL,
	`github_body` text DEFAULT '' NOT NULL,
	`github_labels` text DEFAULT '[]' NOT NULL,
	`github_created_at` text NOT NULL,
	`github_closed_at` text,
	`github_merged_at` text,
	`pr_branch` text,
	`pr_additions` integer,
	`pr_deletions` integer,
	`pr_files` text,
	`pr_linked_issues` text,
	`priority` text DEFAULT 'none' NOT NULL,
	`triage_status` text DEFAULT 'untriaged' NOT NULL,
	`severity_assessed` text,
	`severity_heuristic` text DEFAULT 'normal' NOT NULL,
	`modules` text DEFAULT '[]' NOT NULL,
	`is_noise` integer DEFAULT false NOT NULL,
	`noise_reason` text,
	`is_suspicious` integer DEFAULT false NOT NULL,
	`suspicious_flags` text DEFAULT '[]' NOT NULL,
	`suspicious_context` text DEFAULT '[]' NOT NULL,
	`first_time_author` integer DEFAULT false NOT NULL,
	`cluster_id` integer,
	`last_synced_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `triage_items_status_idx` ON `triage_items` (`triage_status`);--> statement-breakpoint
CREATE INDEX `triage_items_priority_idx` ON `triage_items` (`priority`);--> statement-breakpoint
CREATE INDEX `triage_items_kind_state_idx` ON `triage_items` (`kind`,`github_state`);