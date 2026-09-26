CREATE TABLE `research_access` (
	`member_id` text PRIMARY KEY NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `research_recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`file_key` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`status` text DEFAULT 'Uploaded' NOT NULL,
	`transcript` text,
	`summary` text,
	`error` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`transcription_model` text,
	`summary_model` text,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `research_created` ON `research_recordings` (`created_at`);