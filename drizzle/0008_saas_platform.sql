CREATE TABLE `asset_audit_items` (
	`audit_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`result` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`checked_by` text NOT NULL,
	`checked_at` text NOT NULL,
	PRIMARY KEY(`audit_id`, `asset_id`)
);
--> statement-breakpoint
CREATE TABLE `asset_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`closed_at` text
);
--> statement-breakpoint
CREATE INDEX `asset_audits_tenant` ON `asset_audits` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`member_id` text,
	`tenant_id` text,
	`purpose` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`expires` integer NOT NULL,
	`used_at` text,
	FOREIGN KEY (`identity_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_tokens_identity` ON `auth_tokens` (`identity_id`,`purpose`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`cost_centre` text DEFAULT '' NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `budgets_tenant` ON `budgets` (`tenant_id`,`period_end`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`identity_id` text PRIMARY KEY NOT NULL,
	`salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`iterations` integer NOT NULL,
	`must_change` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`username` text,
	`name` text NOT NULL,
	`last_member_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identities_email_unique` ON `identities` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `identities_username_unique` ON `identities` (`username`);--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`min_stock` real DEFAULT 0 NOT NULL,
	`reorder_qty` real DEFAULT 0 NOT NULL,
	`tracking` text DEFAULT 'none' NOT NULL,
	`unit_cost` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_sku` ON `inventory_items` (`tenant_id`,`sku`);--> statement-breakpoint
CREATE TABLE `maintenance_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`asset_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`interval_value` integer NOT NULL,
	`interval_unit` text NOT NULL,
	`next_due` text NOT NULL,
	`assignee_id` text,
	`department` text DEFAULT '' NOT NULL,
	`checklist` text DEFAULT '' NOT NULL,
	`estimated_cost` real DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `maintenance_plans_tenant` ON `maintenance_plans` (`tenant_id`,`next_due`);--> statement-breakpoint
CREATE TABLE `platform_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_identity_id` text NOT NULL,
	`tenant_id` text,
	`support_session_id` text,
	`action` text NOT NULL,
	`method` text DEFAULT '' NOT NULL,
	`path` text DEFAULT '' NOT NULL,
	`detail_json` text,
	`ip` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `platform_audit_time` ON `platform_audit` (`created_at`);--> statement-breakpoint
CREATE INDEX `platform_audit_tenant` ON `platform_audit` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `quotations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`doc_id` text NOT NULL,
	`vendor_id` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`valid_until` text,
	`notes` text DEFAULT '' NOT NULL,
	`file_id` text,
	`selected` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quotations_doc` ON `quotations` (`tenant_id`,`doc_id`);--> statement-breakpoint
CREATE TABLE `saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`member_id` text NOT NULL,
	`grid_id` text NOT NULL,
	`name` text NOT NULL,
	`state_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `saved_views_member` ON `saved_views` (`tenant_id`,`member_id`,`grid_id`);--> statement-breakpoint
CREATE TABLE `stock_levels` (
	`tenant_id` text NOT NULL,
	`item_id` text NOT NULL,
	`location` text NOT NULL,
	`qty` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`tenant_id`, `item_id`, `location`)
);
--> statement-breakpoint
CREATE TABLE `stock_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`item_id` text NOT NULL,
	`type` text NOT NULL,
	`qty` real NOT NULL,
	`from_location` text,
	`to_location` text,
	`batch` text DEFAULT '' NOT NULL,
	`serial` text DEFAULT '' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`unit_cost` real DEFAULT 0 NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stock_moves_item` ON `stock_moves` (`tenant_id`,`item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `support_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_identity_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`reason` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`ip` text DEFAULT '' NOT NULL,
	`user_agent` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `support_sessions_tenant` ON `support_sessions` (`tenant_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `work_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`number` text NOT NULL,
	`plan_id` text,
	`asset_id` text,
	`ticket_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`priority` text DEFAULT 'Medium' NOT NULL,
	`assignee_id` text,
	`department` text DEFAULT '' NOT NULL,
	`due_at` text,
	`parts_json` text DEFAULT '[]' NOT NULL,
	`parts_cost` real DEFAULT 0 NOT NULL,
	`labor_cost` real DEFAULT 0 NOT NULL,
	`completion_notes` text DEFAULT '' NOT NULL,
	`evidence_file_id` text,
	`completed_at` text,
	`completed_by` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_orders_number` ON `work_orders` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `work_orders_status` ON `work_orders` (`tenant_id`,`status`);--> statement-breakpoint
ALTER TABLE `assets` ADD `subcategory` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `cost_centre` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `barcode` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `useful_life_months` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `salvage_value` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `due_back` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `disposal_date` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `disposal_method` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `disposal_value` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `disposal_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit` ADD `support_session_id` text;--> statement-breakpoint
ALTER TABLE `departments` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `departments` ADD `cost_centre` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `departments` ADD `status` text DEFAULT 'Active' NOT NULL;--> statement-breakpoint
ALTER TABLE `departments` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `departments` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `departments` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `files` ADD `entity_type` text;--> statement-breakpoint
ALTER TABLE `files` ADD `entity_id` text;--> statement-breakpoint
CREATE INDEX `files_entity` ON `files` (`tenant_id`,`entity_type`,`entity_id`);--> statement-breakpoint
ALTER TABLE `members` ADD `identity_id` text;--> statement-breakpoint
ALTER TABLE `members` ADD `additional_locations` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `invited_at` text;--> statement-breakpoint
ALTER TABLE `members` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `members` ADD `updated_by` text;--> statement-breakpoint
ALTER TABLE `members` ADD `preferences_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `members_identity` ON `members` (`identity_id`);--> statement-breakpoint
ALTER TABLE `purchase_docs` ADD `cost_centre` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_docs` ADD `budget_id` text;--> statement-breakpoint
ALTER TABLE `purchase_lines` ADD `returned_qty` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_lines` ADD `inventory_item_id` text;--> statement-breakpoint
ALTER TABLE `roles` ADD `scope_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `roles` ADD `vendor_access` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `roles` ADD `assigned_only` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `roles` ADD `template` text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `identity_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `support_session_id` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `subcategory` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tickets` ADD `impact` text DEFAULT 'Medium' NOT NULL;--> statement-breakpoint
ALTER TABLE `tickets` ADD `urgency` text DEFAULT 'Medium' NOT NULL;--> statement-breakpoint
ALTER TABLE `tickets` ADD `affected_user_id` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `approval_status` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tickets` ADD `approver_id` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `escalated_at` text;--> statement-breakpoint
-- Backfill: one global identity per distinct login email (members keep their workspace-specific rows).
INSERT OR IGNORE INTO `identities` (`id`,`email`,`username`,`name`,`created_at`) SELECT m.`id`, coalesce(nullif(lower(trim(m.`email`)),''),(SELECT lower(p.`username`) FROM `passwords` p WHERE p.`member_id`=m.`id`),m.`id`||'@no-email.invalid'), (SELECT p.`username` FROM `passwords` p WHERE p.`member_id`=m.`id`), m.`name`, m.`created_at` FROM `members` m ORDER BY m.`active` DESC, m.`created_at`;--> statement-breakpoint
UPDATE `members` SET `identity_id`=(SELECT i.`id` FROM `identities` i WHERE i.`email`=coalesce(nullif(lower(trim(`members`.`email`)),''),(SELECT lower(p.`username`) FROM `passwords` p WHERE p.`member_id`=`members`.`id`),`members`.`id`||'@no-email.invalid')) WHERE `identity_id` IS NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `credentials` (`identity_id`,`salt`,`password_hash`,`iterations`,`must_change`,`updated_at`) SELECT m.`identity_id`,p.`salt`,p.`password_hash`,p.`iterations`,p.`must_change`,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM `passwords` p JOIN `members` m ON m.`id`=p.`member_id` WHERE m.`identity_id` IS NOT NULL ORDER BY m.`active` DESC;--> statement-breakpoint
UPDATE `sessions` SET `identity_id`=(SELECT m.`identity_id` FROM `members` m WHERE m.`id`=`sessions`.`member_id`) WHERE `identity_id` IS NULL;--> statement-breakpoint
UPDATE `members` SET `invited_at`=`created_at` WHERE `identity_id` NOT IN (SELECT `identity_id` FROM `credentials`);--> statement-breakpoint
UPDATE `roles` SET `template`=CASE `base` WHEN 'admin' THEN 'company_admin' WHEN 'manager' THEN 'department_head' WHEN 'viewer' THEN 'viewer' ELSE 'custom' END;--> statement-breakpoint
CREATE UNIQUE INDEX `departments_tenant_code` ON `departments` (`tenant_id`,`code`) WHERE `code`<>'';
