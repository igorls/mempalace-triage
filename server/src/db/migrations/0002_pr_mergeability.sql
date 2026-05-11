ALTER TABLE `triage_items` ADD `pr_mergeable` text;--> statement-breakpoint
ALTER TABLE `triage_items` ADD `pr_merge_state` text;--> statement-breakpoint
ALTER TABLE `triage_items` ADD `pr_review_decision` text;--> statement-breakpoint
ALTER TABLE `triage_items` ADD `pr_checks_conclusion` text;--> statement-breakpoint
ALTER TABLE `triage_items` ADD `pr_checks` text;--> statement-breakpoint
CREATE INDEX `triage_items_merge_ready_idx` ON `triage_items` (`pr_merge_state`,`pr_checks_conclusion`);
