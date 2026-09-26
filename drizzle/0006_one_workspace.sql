CREATE TABLE `approval_workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`name` text NOT NULL,
	`department` text DEFAULT '*' NOT NULL,
	`min_amount` real DEFAULT 0 NOT NULL,
	`steps_json` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflows_tenant` ON `approval_workflows` (`tenant_id`,`doc_type`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`doc_id` text NOT NULL,
	`step_no` integer NOT NULL,
	`step_name` text NOT NULL,
	`approver_ids` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`comment` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `approvals_doc` ON `approvals` (`tenant_id`,`doc_id`);--> statement-breakpoint
CREATE INDEX `approvals_status` ON `approvals` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'Physical' NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`serial` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'In store' NOT NULL,
	`condition` text DEFAULT 'Good' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`assigned_to` text,
	`purchase_date` text,
	`purchase_cost` real DEFAULT 0 NOT NULL,
	`warranty_until` text,
	`vendor` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`source_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_tenant_code` ON `assets` (`tenant_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `assets_tenant_source` ON `assets` (`tenant_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `assets_tenant_status` ON `assets` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`internal` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `comments_entity` ON `comments` (`tenant_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `counters` (
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`value` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`head_id` text,
	`description` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `departments_tenant_name` ON `departments` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `file_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`file_id` text NOT NULL,
	`version` integer NOT NULL,
	`file_key` text NOT NULL,
	`bytes` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `file_versions_file` ON `file_versions` (`tenant_id`,`file_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`folder_id` text,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`file_key` text NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'company' NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `files_tenant_folder` ON `files` (`tenant_id`,`folder_id`);--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'company' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `folders_tenant` ON `folders` (`tenant_id`,`parent_id`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`path` text NOT NULL,
	`kind` text DEFAULT 'Site' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `locations_tenant_path` ON `locations` (`tenant_id`,`path`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`member_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`link` text DEFAULT '' NOT NULL,
	`read_at` text,
	`email_status` text DEFAULT 'none' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_member` ON `notifications` (`member_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`parent_id` text,
	`kind` text DEFAULT 'page' NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`icon` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`author_id` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pages_tenant_space` ON `pages` (`tenant_id`,`department`);--> statement-breakpoint
CREATE TABLE `purchase_docs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`number` text NOT NULL,
	`title` text NOT NULL,
	`justification` text DEFAULT '' NOT NULL,
	`department` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`requester_id` text NOT NULL,
	`vendor_id` text,
	`pr_id` text,
	`needed_by` text,
	`currency` text DEFAULT 'GHS' NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`tax` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`terms` text DEFAULT '' NOT NULL,
	`source_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`submitted_at` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_docs_number` ON `purchase_docs` (`tenant_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_docs_source` ON `purchase_docs` (`tenant_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `purchase_docs_kind` ON `purchase_docs` (`tenant_id`,`kind`,`status`);--> statement-breakpoint
CREATE TABLE `purchase_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`doc_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`description` text NOT NULL,
	`item_code` text DEFAULT '' NOT NULL,
	`qty` real NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`unit_price` real NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`received_qty` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `purchase_lines_doc` ON `purchase_lines` (`tenant_id`,`doc_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`base` text DEFAULT 'employee' NOT NULL,
	`permissions_json` text DEFAULT '{}' NOT NULL,
	`locations_json` text DEFAULT '[]' NOT NULL,
	`default_screen` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_tenant_name` ON `roles` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`legal_name` text DEFAULT '' NOT NULL,
	`domains` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`plan` text DEFAULT 'business' NOT NULL,
	`brand_color` text DEFAULT '#6D5EF8' NOT NULL,
	`currency` text DEFAULT 'GHS' NOT NULL,
	`timezone` text DEFAULT 'Africa/Accra' NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_unique` ON `tenants` (`slug`);--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`number` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`type` text DEFAULT 'Incident' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'Medium' NOT NULL,
	`status` text DEFAULT 'New' NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`assignee_id` text,
	`requester_id` text NOT NULL,
	`asset_id` text,
	`location` text DEFAULT '' NOT NULL,
	`due_at` text,
	`resolved_at` text,
	`source_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_tenant_number` ON `tickets` (`tenant_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_tenant_source` ON `tickets` (`tenant_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `tickets_tenant_status` ON `tickets` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`tax_id` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendors_tenant_name` ON `vendors` (`tenant_id`,`name`);--> statement-breakpoint
DROP INDEX `access_rule_subject_action`;--> statement-breakpoint
ALTER TABLE `access_rules` ADD `tenant_id` text DEFAULT 'procus' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `access_rule_subject_action` ON `access_rules` (`tenant_id`,`subject_type`,`subject_id`,`department`,`page`,`action`);--> statement-breakpoint
DROP INDEX `it_nvrs_address_unique`;--> statement-breakpoint
ALTER TABLE `it_nvrs` ADD `tenant_id` text DEFAULT 'procus' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `it_nvrs_address_unique` ON `it_nvrs` (`tenant_id`,`address`);--> statement-breakpoint
ALTER TABLE `audit` ADD `tenant_id` text DEFAULT 'procus' NOT NULL;--> statement-breakpoint
CREATE INDEX `audit_tenant_time` ON `audit` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_tenant_record` ON `audit` (`tenant_id`,`record_id`);--> statement-breakpoint
ALTER TABLE `import_batches` ADD `tenant_id` text DEFAULT 'procus' NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `tenant_id` text DEFAULT 'procus' NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `manager_id` text;--> statement-breakpoint
ALTER TABLE `members` ADD `location` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `role_id` text;--> statement-breakpoint
ALTER TABLE `members` ADD `employee_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `platform_role` text;--> statement-breakpoint
ALTER TABLE `members` ADD `last_seen_at` text;--> statement-breakpoint
ALTER TABLE `members` ADD `notify_email` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `members_tenant` ON `members` (`tenant_id`,`name`);--> statement-breakpoint
ALTER TABLE `records` ADD `tenant_id` text DEFAULT 'procus' NOT NULL;--> statement-breakpoint
CREATE INDEX `records_tenant` ON `records` (`tenant_id`,`module`);--> statement-breakpoint
ALTER TABLE `research_recordings` ADD `tenant_id` text DEFAULT 'procus' NOT NULL;--> statement-breakpoint
CREATE INDEX `research_tenant` ON `research_recordings` (`tenant_id`,`created_at`);--> statement-breakpoint
INSERT OR IGNORE INTO `tenants` (`id`,`slug`,`name`,`legal_name`,`domains`,`status`,`plan`,`brand_color`,`currency`,`timezone`,`settings_json`,`created_at`) VALUES ('procus','procus-ghana','Procus Ghana','Procus Ghana Limited','procusghana.com','active','business','#6D5EF8','GHS','Africa/Accra','{"prPrefix":"PR","poPrefix":"PO","ticketPrefix":"TKT","assetPrefix":"AST"}',strftime('%Y-%m-%dT%H:%M:%fZ','now'));--> statement-breakpoint
INSERT OR IGNORE INTO `departments` (`id`,`tenant_id`,`name`,`created_at`) SELECT lower(hex(randomblob(16))),'procus',d,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM (SELECT DISTINCT trim(`department`) AS d FROM `members` WHERE trim(`department`)!='' AND lower(trim(`department`))!='unassigned');--> statement-breakpoint
INSERT OR IGNORE INTO `departments` (`id`,`tenant_id`,`name`,`created_at`) VALUES (lower(hex(randomblob(16))),'procus','Procurement',strftime('%Y-%m-%dT%H:%M:%fZ','now')),(lower(hex(randomblob(16))),'procus','Finance',strftime('%Y-%m-%dT%H:%M:%fZ','now')),(lower(hex(randomblob(16))),'procus','IT',strftime('%Y-%m-%dT%H:%M:%fZ','now'));--> statement-breakpoint
INSERT INTO `approval_workflows` (`id`,`tenant_id`,`doc_type`,`name`,`department`,`min_amount`,`steps_json`,`active`,`created_at`,`updated_at`) VALUES (lower(hex(randomblob(16))),'procus','PR','Standard requisition approval','*',0,'[{"name":"Reporting manager","type":"manager"},{"name":"Department head","type":"department_head"},{"name":"Purchase head review","type":"role","ref":"Purchase Head"},{"name":"Finance approval","type":"department","ref":"Finance","minAmount":10000}]',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),(lower(hex(randomblob(16))),'procus','PO','Standard purchase order approval','*',0,'[{"name":"Purchase head","type":"role","ref":"Purchase Head"},{"name":"Management approval","type":"access","ref":"admin","minAmount":50000}]',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));--> statement-breakpoint
INSERT OR IGNORE INTO `roles` (`id`,`tenant_id`,`name`,`description`,`base`,`permissions_json`,`created_by`,`created_at`,`updated_by`,`updated_at`) VALUES
(lower(hex(randomblob(16))),'procus','PR User','Raises purchase requisitions and tickets.','employee','{"requests":{"view":"own","create":"own","update":"own"}}','system',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
(lower(hex(randomblob(16))),'procus','PO User','Converts approved requisitions into purchase orders.','employee','{"requests":{"view":"all"},"procurement":{"view":"all","create":"all","update":"all","export":"all"},"suppliers":{"view":"all","create":"all","update":"all"},"receipts":{"view":"all","create":"all"}}','system',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
(lower(hex(randomblob(16))),'procus','Purchase Head','Approves requisitions and purchase orders company-wide.','manager','{"requests":{"view":"all","approve":"all","export":"all"},"procurement":{"view":"all","create":"all","update":"all","approve":"all","export":"all"},"suppliers":{"view":"all","create":"all","update":"all","export":"all"},"receipts":{"view":"all","create":"all","export":"all"},"budgets":{"view":"all"}}','system',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
(lower(hex(randomblob(16))),'procus','PR / Ticket Resolver','Resolves tickets and raises requisitions.','employee','{"maintenance":{"view":"all","create":"all","update":"all","assign":"all"},"requests":{"view":"own","create":"own","update":"own"},"assets":{"view":"all"}}','system',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
(lower(hex(randomblob(16))),'procus','Technician','Works assigned maintenance tickets.','employee','{"maintenance":{"view":"all","update":"all"},"assets":{"view":"all"}}','system',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
(lower(hex(randomblob(16))),'procus','Jr. Admin','Manages people, assets and tickets without platform settings.','manager','{"people":{"view":"all","create":"all","update":"all","export":"all"},"assets":{"view":"all","create":"all","update":"all","assign":"all","export":"all"},"maintenance":{"view":"all","create":"all","update":"all","assign":"all","export":"all"},"locations":{"view":"all","create":"all","update":"all"}}','system',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
(lower(hex(randomblob(16))),'procus','Stores','Receives goods and manages stock.','employee','{"inventory":{"view":"all","create":"all","update":"all","export":"all"},"receipts":{"view":"all","create":"all","export":"all"},"procurement":{"view":"all"},"assets":{"view":"all"}}','system',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
(lower(hex(randomblob(16))),'procus','IT Employee','IT asset, ticket and CCTV storage work.','employee','{"it":{"view":"all","create":"all","export":"all"},"assets":{"view":"all","create":"all","update":"all","assign":"all","export":"all"},"maintenance":{"view":"all","create":"all","update":"all","assign":"all"}}','system',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system',strftime('%Y-%m-%dT%H:%M:%fZ','now'));--> statement-breakpoint
INSERT INTO `pages` (`id`,`tenant_id`,`department`,`kind`,`title`,`body`,`icon`,`status`,`pinned`,`author_id`,`updated_by`,`created_at`,`updated_at`) SELECT lower(hex(randomblob(16))),'procus','','announcement','Welcome to One Workspace','Procus One is now **One Workspace** — one place for people, assets, tickets, purchasing, files and department knowledge.

## What is new
- **Tickets** with priorities, SLAs, a board view and comments
- **Purchase requisitions and orders** with sequential approvals and email notifications
- **Assets** with assignment history
- **Department spaces** for procedures, announcements and research notes
- Press **Ctrl + K** anywhere to search or jump.','sparkles','Published',1,m.id,m.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM `members` m WHERE m.role='admin' ORDER BY m.created_at LIMIT 1;
