CREATE TABLE `announcement_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`page_id` text NOT NULL,
	`member_id` text NOT NULL,
	`read_at` text,
	`acked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `announcement_receipts_unique` ON `announcement_receipts` (`tenant_id`,`page_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `channel_members` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`member_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`last_read_at` text,
	`notify` text DEFAULT 'all' NOT NULL,
	`typing_until` text,
	`joined_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_members_unique` ON `channel_members` (`tenant_id`,`channel_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `channel_members_member` ON `channel_members` (`tenant_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`ref_id` text DEFAULT '' NOT NULL,
	`posting` text DEFAULT 'all' NOT NULL,
	`archived_at` text,
	`last_message_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `channels_tenant` ON `channels` (`tenant_id`,`kind`,`ref_id`);--> statement-breakpoint
CREATE TABLE `connector_links` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`external_type` text NOT NULL,
	`external_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `connector_links_entity` ON `connector_links` (`tenant_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `file_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`file_id` text NOT NULL,
	`file_version` integer NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`meta_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `file_artifacts_file` ON `file_artifacts` (`tenant_id`,`file_id`,`kind`);--> statement-breakpoint
CREATE TABLE `file_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`file_id` text NOT NULL,
	`member_id` text NOT NULL,
	`action` text NOT NULL,
	`ip` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `file_events_file` ON `file_events` (`tenant_id`,`file_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `file_favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`member_id` text NOT NULL,
	`file_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_favorites_unique` ON `file_favorites` (`tenant_id`,`member_id`,`file_id`);--> statement-breakpoint
CREATE TABLE `file_links` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`file_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_links_unique` ON `file_links` (`tenant_id`,`file_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `file_links_entity` ON `file_links` (`tenant_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `group_members` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`group_id` text NOT NULL,
	`member_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`added_by` text NOT NULL,
	`added_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_members_unique` ON `group_members` (`tenant_id`,`group_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `group_members_member` ON `group_members` (`tenant_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`type` text DEFAULT 'team' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`visibility` text DEFAULT 'company' NOT NULL,
	`membership_mode` text DEFAULT 'static' NOT NULL,
	`rules_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_code` ON `groups` (`tenant_id`,`code`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_keys_unique` ON `idempotency_keys` (`tenant_id`,`key`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`stage` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_after` text NOT NULL,
	`locked_until` text,
	`last_error` text DEFAULT '' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_due` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `jobs_ref` ON `jobs` (`tenant_id`,`kind`,`ref_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_idem` ON `jobs` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `message_bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`message_id` text NOT NULL,
	`member_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_bookmarks_unique` ON `message_bookmarks` (`tenant_id`,`message_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `message_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`message_id` text NOT NULL,
	`member_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `message_reports_tenant` ON `message_reports` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`thread_id` text,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`kind` text DEFAULT 'text' NOT NULL,
	`edited_at` text,
	`deleted_at` text,
	`deleted_by` text,
	`pinned` integer DEFAULT 0 NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_channel` ON `messages` (`tenant_id`,`channel_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_thread` ON `messages` (`tenant_id`,`thread_id`);--> statement-breakpoint
CREATE TABLE `page_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`page_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`acl_json` text,
	`edited_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `page_revisions_page` ON `page_revisions` (`tenant_id`,`page_id`,`version`);--> statement-breakpoint
CREATE TABLE `project_costs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'recorded' NOT NULL,
	`source_type` text DEFAULT '' NOT NULL,
	`source_id` text DEFAULT '' NOT NULL,
	`date` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_costs_project` ON `project_costs` (`tenant_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`project_id` text NOT NULL,
	`member_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`allocation` integer DEFAULT 100 NOT NULL,
	`added_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_unique` ON `project_members` (`tenant_id`,`project_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `project_members_member` ON `project_members` (`tenant_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `project_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`priority` text DEFAULT 'Medium' NOT NULL,
	`owner_id` text,
	`due_date` text,
	`parent_id` text,
	`data_json` text DEFAULT '{}' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`deleted_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_records_project` ON `project_records` (`tenant_id`,`project_id`,`kind`);--> statement-breakpoint
CREATE TABLE `project_stage_history` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`project_id` text NOT NULL,
	`from_stage` text NOT NULL,
	`to_stage` text NOT NULL,
	`actor` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_stage_history_project` ON `project_stage_history` (`tenant_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `project_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`project_type` text NOT NULL,
	`methodology` text DEFAULT 'waterfall' NOT NULL,
	`payload_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_templates_tenant` ON `project_templates` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `project_workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`project_type` text DEFAULT '' NOT NULL,
	`stages_json` text NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_workflows_tenant` ON `project_workflows` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'internal' NOT NULL,
	`methodology` text DEFAULT 'waterfall' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`business_case` text DEFAULT '' NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`owner_id` text,
	`manager_id` text,
	`sponsor_id` text,
	`start_date` text,
	`target_date` text,
	`actual_end` text,
	`priority` text DEFAULT 'Medium' NOT NULL,
	`stage` text DEFAULT 'request' NOT NULL,
	`workflow_id` text,
	`health` text DEFAULT 'green' NOT NULL,
	`currency` text DEFAULT 'GHS' NOT NULL,
	`approved_budget` real DEFAULT 0 NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`custom_json` text DEFAULT '{}' NOT NULL,
	`acl_json` text,
	`space_id` text,
	`approval_status` text DEFAULT 'none' NOT NULL,
	`archived_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_code` ON `projects` (`tenant_id`,`code`);--> statement-breakpoint
CREATE TABLE `reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`member_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reactions_unique` ON `reactions` (`tenant_id`,`entity_type`,`entity_id`,`member_id`,`emoji`);--> statement-breakpoint
CREATE TABLE `space_members` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`space_id` text NOT NULL,
	`member_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`added_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `space_members_unique` ON `space_members` (`tenant_id`,`space_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `space_members_member` ON `space_members` (`tenant_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`project_id` text,
	`description` text DEFAULT '' NOT NULL,
	`icon` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'company' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spaces_key` ON `spaces` (`tenant_id`,`key`);--> statement-breakpoint
CREATE TABLE `task_assignees` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`task_id` text NOT NULL,
	`member_id` text NOT NULL,
	`kind` text DEFAULT 'assignee' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_assignees_unique` ON `task_assignees` (`tenant_id`,`task_id`,`member_id`,`kind`);--> statement-breakpoint
CREATE INDEX `task_assignees_member` ON `task_assignees` (`tenant_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `task_checklist` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`task_id` text NOT NULL,
	`title` text NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `task_checklist_task` ON `task_checklist` (`tenant_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `task_deps` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`task_id` text NOT NULL,
	`depends_on` text NOT NULL,
	`kind` text DEFAULT 'finish-start' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_deps_unique` ON `task_deps` (`tenant_id`,`task_id`,`depends_on`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`number` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`type` text DEFAULT 'task' NOT NULL,
	`status` text DEFAULT 'To do' NOT NULL,
	`priority` text DEFAULT 'Medium' NOT NULL,
	`owner_id` text NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`project_id` text,
	`space_id` text,
	`parent_id` text,
	`phase_id` text,
	`sprint_id` text,
	`milestone` integer DEFAULT 0 NOT NULL,
	`start_date` text,
	`due_date` text,
	`baseline_start` text,
	`baseline_due` text,
	`completed_at` text,
	`estimate_min` integer DEFAULT 0 NOT NULL,
	`actual_min` integer DEFAULT 0 NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`custom_json` text DEFAULT '{}' NOT NULL,
	`acl_json` text,
	`recurrence` text DEFAULT '' NOT NULL,
	`reminder_at` text,
	`reminded_at` text,
	`approval_status` text DEFAULT 'none' NOT NULL,
	`approver_id` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`source_type` text DEFAULT '' NOT NULL,
	`source_id` text DEFAULT '' NOT NULL,
	`deleted_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_project` ON `tasks` (`tenant_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `tasks_owner` ON `tasks` (`tenant_id`,`owner_id`);--> statement-breakpoint
CREATE INDEX `tasks_due` ON `tasks` (`tenant_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`task_id` text NOT NULL,
	`project_id` text,
	`member_id` text NOT NULL,
	`minutes` integer NOT NULL,
	`date` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`rate` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `time_entries_task` ON `time_entries` (`tenant_id`,`task_id`);--> statement-breakpoint
CREATE INDEX `time_entries_project` ON `time_entries` (`tenant_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`member_id` text NOT NULL,
	`r2_upload_id` text NOT NULL,
	`file_key` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`parts_json` text DEFAULT '[]' NOT NULL,
	`meta_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `uploads_member` ON `uploads` (`tenant_id`,`member_id`);--> statement-breakpoint
ALTER TABLE `assets` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `budgets` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `connectors` ADD `owner_member_id` text;--> statement-breakpoint
ALTER TABLE `connectors` ADD `granted_scopes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `connectors` ADD `account_identity` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `connectors` ADD `paused` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `connectors` ADD `next_sync_at` text;--> statement-breakpoint
ALTER TABLE `connectors` ADD `conflict_rule` text DEFAULT 'remote-wins' NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `acl_json` text;--> statement-breakpoint
ALTER TABLE `files` ADD `space_id` text;--> statement-breakpoint
ALTER TABLE `files` ADD `owner_id` text;--> statement-breakpoint
ALTER TABLE `files` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `files` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `files` ADD `legal_hold` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `pinned` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `category` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `custom_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `processing_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `processing_error` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `processed_at` text;--> statement-breakpoint
ALTER TABLE `files` ADD `checksum` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `folders` ADD `acl_json` text;--> statement-breakpoint
ALTER TABLE `folders` ADD `space_id` text;--> statement-breakpoint
ALTER TABLE `folders` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `pages` ADD `acl_json` text;--> statement-breakpoint
ALTER TABLE `pages` ADD `space_id` text;--> statement-breakpoint
ALTER TABLE `pages` ADD `publish_at` text;--> statement-breakpoint
ALTER TABLE `pages` ADD `expires_at` text;--> statement-breakpoint
ALTER TABLE `pages` ADD `priority` text DEFAULT 'Normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `requires_ack` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `approval_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `pages` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `purchase_docs` ADD `project_id` text;