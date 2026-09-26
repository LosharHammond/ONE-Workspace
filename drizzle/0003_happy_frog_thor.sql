CREATE TABLE `it_nvr_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`nvr_id` text NOT NULL,
	`reading_date` text NOT NULL,
	`disk_no` integer NOT NULL,
	`capacity_gb` real NOT NULL,
	`remaining_gb` real NOT NULL,
	`status` text NOT NULL,
	`attribute` text NOT NULL,
	`storage_type` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`nvr_id`) REFERENCES `it_nvrs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nvr_disk_day` ON `it_nvr_readings` (`nvr_id`,`reading_date`,`disk_no`);--> statement-breakpoint
CREATE TABLE `it_nvrs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `it_nvrs_address_unique` ON `it_nvrs` (`address`);