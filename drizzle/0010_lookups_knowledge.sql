CREATE TABLE `knowledge_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`chunks` integer DEFAULT 0 NOT NULL,
	`indexed_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_documents_source` ON `knowledge_documents` (`tenant_id`,`source_type`,`source_id`);--> statement-breakpoint
CREATE TABLE `lookups` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`list` text NOT NULL,
	`value` text NOT NULL,
	`parent` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lookups_value` ON `lookups` (`tenant_id`,`list`,`parent`,`value`);--> statement-breakpoint
CREATE INDEX `lookups_list` ON `lookups` (`tenant_id`,`list`,`sort`);