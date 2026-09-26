CREATE TABLE `access_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`department` text NOT NULL,
	`page` text NOT NULL,
	`action` text NOT NULL,
	`effect` text NOT NULL,
	`scope` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_rule_subject_action` ON `access_rules` (`subject_type`,`subject_id`,`department`,`page`,`action`);