CREATE TABLE `ai_action_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`run_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`tool` text NOT NULL,
	`target` text DEFAULT '' NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`effect` text DEFAULT '' NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`risk` text DEFAULT 'medium' NOT NULL,
	`requested_by` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`result_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_action_approvals_status` ON `ai_action_approvals` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `ai_agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`agent_version` integer NOT NULL,
	`run_as` text NOT NULL,
	`run_as_member` text,
	`requested_by` text NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`input_text` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`steps` integer DEFAULT 0 NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`output_text` text DEFAULT '' NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `ai_agent_runs_agent` ON `ai_agent_runs` (`tenant_id`,`agent_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `ai_agent_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`version` integer NOT NULL,
	`definition_json` text NOT NULL,
	`eval_status` text DEFAULT 'not_run' NOT NULL,
	`eval_run_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_agent_versions_unique` ON `ai_agent_versions` (`tenant_id`,`agent_id`,`version`);--> statement-breakpoint
CREATE TABLE `ai_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`template` text DEFAULT 'custom' NOT NULL,
	`owner_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`killed` integer DEFAULT 0 NOT NULL,
	`published_version` integer,
	`draft_json` text DEFAULT '{}' NOT NULL,
	`draft_version` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_eval_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`agent_version` integer NOT NULL,
	`results_json` text NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`critical_failed` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_eval_runs_agent` ON `ai_eval_runs` (`tenant_id`,`agent_id`);--> statement-breakpoint
CREATE TABLE `ai_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`run_id` text NOT NULL,
	`step` integer NOT NULL,
	`tool` text NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`output_summary` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_tool_calls_run` ON `ai_tool_calls` (`tenant_id`,`run_id`);--> statement-breakpoint
CREATE TABLE `connector_action_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`action` text NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`origin` text DEFAULT 'user' NOT NULL,
	`requested_by` text NOT NULL,
	`confirmed_by` text,
	`result_json` text DEFAULT '{}' NOT NULL,
	`external_id` text,
	`verified` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_action_runs_key` ON `connector_action_runs` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `connector_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`source_id` text NOT NULL,
	`kind` text DEFAULT 'record' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`source_updated_at` text,
	`permissions_json` text DEFAULT '{}' NOT NULL,
	`content_hash` text DEFAULT '' NOT NULL,
	`deleted_at` text,
	`last_verified_at` text,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_records_source` ON `connector_records` (`tenant_id`,`connector_id`,`source_id`);--> statement-breakpoint
CREATE TABLE `connector_sync_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`cursor` text DEFAULT '' NOT NULL,
	`last_full_at` text,
	`last_incremental_at` text,
	`stats_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_sync_checkpoints_unique` ON `connector_sync_checkpoints` (`tenant_id`,`connector_id`);--> statement-breakpoint
CREATE TABLE `domain_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`type` text NOT NULL,
	`entity_id` text DEFAULT '' NOT NULL,
	`action` text DEFAULT '' NOT NULL,
	`actor` text DEFAULT '' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`processed_at` text
);
--> statement-breakpoint
CREATE INDEX `domain_events_pending` ON `domain_events` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `domain_events_entity` ON `domain_events` (`tenant_id`,`entity_id`);--> statement-breakpoint
CREATE TABLE `goods_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`po_id` text NOT NULL,
	`number` text NOT NULL,
	`lines_json` text DEFAULT '[]' NOT NULL,
	`received_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `goods_receipts_po` ON `goods_receipts` (`tenant_id`,`po_id`);--> statement-breakpoint
CREATE TABLE `graph_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`src_id` text NOT NULL,
	`dst_id` text NOT NULL,
	`type` text NOT NULL,
	`origin` text DEFAULT 'event' NOT NULL,
	`created_by` text DEFAULT 'system' NOT NULL,
	`confidence` real,
	`effective_at` text,
	`expires_at` text,
	`meta_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`removed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graph_edges_unique` ON `graph_edges` (`tenant_id`,`src_id`,`dst_id`,`type`);--> statement-breakpoint
CREATE INDEX `graph_edges_dst` ON `graph_edges` (`tenant_id`,`dst_id`);--> statement-breakpoint
CREATE TABLE `graph_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`type` text NOT NULL,
	`source_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '' NOT NULL,
	`owner_id` text,
	`department` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`module` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`classification` text DEFAULT 'internal' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`provider` text,
	`external_id` text,
	`sync_mode` text,
	`last_verified_at` text,
	`meta_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graph_nodes_source` ON `graph_nodes` (`tenant_id`,`type`,`source_id`);--> statement-breakpoint
CREATE INDEX `graph_nodes_type` ON `graph_nodes` (`tenant_id`,`type`,`updated_at`);--> statement-breakpoint
CREATE TABLE `studio_app_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`app_id` text NOT NULL,
	`version` integer NOT NULL,
	`definition_json` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`test_report_json` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_app_versions_unique` ON `studio_app_versions` (`tenant_id`,`app_id`,`version`);--> statement-breakpoint
CREATE TABLE `studio_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`app_id` text NOT NULL,
	`record_id` text NOT NULL,
	`transition_id` text NOT NULL,
	`stage` integer DEFAULT 0 NOT NULL,
	`stage_name` text DEFAULT '' NOT NULL,
	`approver_ids` text DEFAULT '[]' NOT NULL,
	`mode` text DEFAULT 'any' NOT NULL,
	`quorum` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decisions_json` text DEFAULT '[]' NOT NULL,
	`due_at` text,
	`escalated_at` text,
	`created_at` text NOT NULL,
	`decided_at` text
);
--> statement-breakpoint
CREATE INDEX `studio_approvals_record` ON `studio_approvals` (`tenant_id`,`record_id`);--> statement-breakpoint
CREATE INDEX `studio_approvals_status` ON `studio_approvals` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `studio_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`icon` text DEFAULT 'AppWindow' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`draft_json` text DEFAULT '{}' NOT NULL,
	`draft_version` integer DEFAULT 0 NOT NULL,
	`published_version` integer,
	`approval_status` text DEFAULT 'none' NOT NULL,
	`paused_json` text DEFAULT '[]' NOT NULL,
	`platform_disabled_reason` text,
	`template_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_apps_slug` ON `studio_apps` (`tenant_id`,`slug`);--> statement-breakpoint
CREATE TABLE `studio_automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`app_id` text NOT NULL,
	`automation_id` text NOT NULL,
	`app_version` integer DEFAULT 0 NOT NULL,
	`trigger` text NOT NULL,
	`event_id` text,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`dry_run` integer DEFAULT 0 NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`output_json` text DEFAULT '{}' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_automation_runs_key` ON `studio_automation_runs` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `studio_automation_runs_app` ON `studio_automation_runs` (`tenant_id`,`app_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `studio_record_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`record_id` text NOT NULL,
	`version` integer NOT NULL,
	`data_json` text NOT NULL,
	`status` text DEFAULT '' NOT NULL,
	`edited_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `studio_record_versions_record` ON `studio_record_versions` (`tenant_id`,`record_id`);--> statement-breakpoint
CREATE TABLE `studio_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`app_id` text NOT NULL,
	`table_key` text NOT NULL,
	`number` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '' NOT NULL,
	`data_json` text DEFAULT '{}' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`owner_id` text NOT NULL,
	`is_draft` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`app_version` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `studio_records_table` ON `studio_records` (`tenant_id`,`app_id`,`table_key`,`status`);--> statement-breakpoint
CREATE TABLE `studio_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`definition_json` text NOT NULL,
	`target_tenants_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `assets` ADD `purchase_doc_id` text;--> statement-breakpoint
ALTER TABLE `connectors` ADD `policy_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- Transactional outbox: every audited change also records a domain event in the same transaction.
CREATE TRIGGER `audit_domain_event` AFTER INSERT ON `audit` WHEN NEW.tenant_id IS NOT NULL BEGIN INSERT INTO domain_events(id,tenant_id,type,entity_id,action,actor,payload_json,status,attempts,error,created_at) VALUES(lower(hex(randomblob(16))),NEW.tenant_id,'audit',NEW.record_id,NEW.action,NEW.actor,'{}','pending',0,'',NEW.created_at); END;
--> statement-breakpoint
CREATE INDEX `assets_purchase_doc` ON `assets` (`tenant_id`,`purchase_doc_id`);
