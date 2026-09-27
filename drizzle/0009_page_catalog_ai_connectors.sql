CREATE TABLE `ai_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`member_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`page` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_conversations_member` ON `ai_conversations` (`tenant_id`,`member_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`feedback` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_messages_conversation` ON `ai_messages` (`tenant_id`,`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`model` text NOT NULL,
	`base_url` text DEFAULT '' NOT NULL,
	`secret_enc` text,
	`secret_hint` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`fallback` text DEFAULT 'platform' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_providers_tenant` ON `ai_providers` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`member_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`kind` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`ok` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_usage_tenant` ON `ai_usage` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `app_page_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`page_id` text NOT NULL,
	`version` integer NOT NULL,
	`layout_json` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_page_versions_page` ON `app_page_versions` (`tenant_id`,`page_id`,`version`);--> statement-breakpoint
CREATE TABLE `app_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`icon` text DEFAULT 'LayoutGrid' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`draft_json` text NOT NULL,
	`draft_version` integer DEFAULT 1 NOT NULL,
	`published_version` integer,
	`visibility_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_pages_slug` ON `app_pages` (`tenant_id`,`slug`);--> statement-breakpoint
CREATE TABLE `connector_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`actor` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`detail_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `connector_logs_connector` ON `connector_logs` (`tenant_id`,`connector_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`scope` text DEFAULT 'company' NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`auth_type` text NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`secret_enc` text,
	`secret_hint` text DEFAULT '' NOT NULL,
	`webhook_secret_enc` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`health` text DEFAULT 'unknown' NOT NULL,
	`last_ok_at` text,
	`last_sync_at` text,
	`last_error` text DEFAULT '' NOT NULL,
	`sync_minutes` integer DEFAULT 0 NOT NULL,
	`pages_json` text DEFAULT '[]' NOT NULL,
	`roles_json` text DEFAULT '[]' NOT NULL,
	`allowed_tools_json` text DEFAULT '[]' NOT NULL,
	`mutating_tools_json` text DEFAULT '[]' NOT NULL,
	`tools_json` text DEFAULT '[]' NOT NULL,
	`resources_json` text DEFAULT '[]' NOT NULL,
	`field_map_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `connectors_tenant` ON `connectors` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`member_id` text NOT NULL,
	`verifier_enc` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `page_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`scope` text DEFAULT 'company' NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`layout_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `page_templates_tenant` ON `page_templates` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `roles` ADD `pages_json` text;