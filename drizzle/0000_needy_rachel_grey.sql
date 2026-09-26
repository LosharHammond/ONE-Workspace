CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`record_id` text NOT NULL,
	`department` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_department_time` ON `audit` (`department`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_flows` (
	`state` text PRIMARY KEY NOT NULL,
	`verifier` text NOT NULL,
	`nonce` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`dataset` text NOT NULL,
	`filename` text NOT NULL,
	`sha256` text NOT NULL,
	`imported_at` text NOT NULL,
	`row_count` integer NOT NULL,
	`headers_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`department` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quality_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`kind` text NOT NULL,
	`detail_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`module` text NOT NULL,
	`title` text NOT NULL,
	`department` text NOT NULL,
	`status` text NOT NULL,
	`owner` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`updated` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`file_key` text,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_records_department_module` ON `records` (`department`,`module`);--> statement-breakpoint
CREATE INDEX `idx_records_creator` ON `records` (`created_by`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `links` (
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`kind` text NOT NULL,
	PRIMARY KEY(`from_id`, `to_id`, `kind`),
	FOREIGN KEY (`from_id`) REFERENCES `source_rows`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_id`) REFERENCES `source_rows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `source_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`source_key` text,
	`sheet` text NOT NULL,
	`row_number` integer NOT NULL,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `source_rows_batch` ON `source_rows` (`batch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_rows_position` ON `source_rows` (`batch_id`,`sheet`,`row_number`);