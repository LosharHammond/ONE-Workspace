CREATE TABLE `task_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`shared` integer DEFAULT 0 NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_templates_tenant` ON `task_templates` (`tenant_id`,`owner_id`);--> statement-breakpoint
ALTER TABLE `files` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `files` ADD `archived_by` text;