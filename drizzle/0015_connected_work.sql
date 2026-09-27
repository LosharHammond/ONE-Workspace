CREATE TABLE `connector_install_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`level` text DEFAULT 'company' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`requested_by` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`connector_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `connector_install_requests_status` ON `connector_install_requests` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `module_extensions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`fields_json` text DEFAULT '[]' NOT NULL,
	`stages_json` text DEFAULT '[]' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `module_extensions_type` ON `module_extensions` (`tenant_id`,`entity_type`);--> statement-breakpoint
CREATE TABLE `record_extensions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`stage` text DEFAULT '' NOT NULL,
	`data_json` text DEFAULT '{}' NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `record_extensions_entity` ON `record_extensions` (`tenant_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `studio_widgets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`base_type` text NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`visibility_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `work_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`number` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '' NOT NULL,
	`owner_id` text,
	`department` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`parent_id` text,
	`start_date` text,
	`end_date` text,
	`amount` real,
	`currency` text DEFAULT '' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`data_json` text DEFAULT '{}' NOT NULL,
	`visibility` text DEFAULT 'company' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `work_records_kind` ON `work_records` (`tenant_id`,`kind`,`status`);--> statement-breakpoint
CREATE INDEX `work_records_parent` ON `work_records` (`tenant_id`,`parent_id`);--> statement-breakpoint
ALTER TABLE `connectors` ADD `environment` text DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE `connectors` ADD `daily_call_limit` integer DEFAULT 0 NOT NULL;