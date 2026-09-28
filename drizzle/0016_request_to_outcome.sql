CREATE TABLE `artifact_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`file_id` text NOT NULL,
	`kind` text NOT NULL,
	`origin` text NOT NULL,
	`content` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`edited_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `artifact_versions_file` ON `artifact_versions` (`tenant_id`,`file_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `benefit_measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`benefit_id` text NOT NULL,
	`value` real NOT NULL,
	`measured_at` text NOT NULL,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_ref` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`actor` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `benefit_measurements_benefit` ON `benefit_measurements` (`tenant_id`,`benefit_id`,`measured_at`);--> statement-breakpoint
CREATE TABLE `benefits` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`request_id` text,
	`project_id` text,
	`key_result_id` text,
	`name` text NOT NULL,
	`kind` text DEFAULT 'operational' NOT NULL,
	`measure` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`baseline` real DEFAULT 0 NOT NULL,
	`expected` real NOT NULL,
	`owner_id` text,
	`review_date` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `benefits_request` ON `benefits` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `business_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`request_id` text NOT NULL,
	`problem` text DEFAULT '' NOT NULL,
	`solution` text DEFAULT '' NOT NULL,
	`alternatives_json` text DEFAULT '[]' NOT NULL,
	`benefits` text DEFAULT '' NOT NULL,
	`costs_json` text DEFAULT '[]' NOT NULL,
	`assumptions` text DEFAULT '' NOT NULL,
	`risks` text DEFAULT '' NOT NULL,
	`dependencies` text DEFAULT '' NOT NULL,
	`impacted_departments_json` text DEFAULT '[]' NOT NULL,
	`approach` text DEFAULT '' NOT NULL,
	`annual_benefit` real,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`decision` text DEFAULT '' NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_cases_request` ON `business_cases` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `business_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`number` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`request_type` text NOT NULL,
	`requester_id` text NOT NULL,
	`department` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`business_need` text DEFAULT '' NOT NULL,
	`expected_outcome` text DEFAULT '' NOT NULL,
	`estimated_cost` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'GHS' NOT NULL,
	`priority` text DEFAULT 'Medium' NOT NULL,
	`risk` text DEFAULT 'Medium' NOT NULL,
	`required_date` text,
	`goal_id` text,
	`project_id` text,
	`budget_id` text,
	`template_id` text NOT NULL,
	`template_version` integer DEFAULT 1 NOT NULL,
	`stages_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`current_stage` text DEFAULT '' NOT NULL,
	`files_json` text DEFAULT '[]' NOT NULL,
	`visibility` text DEFAULT 'department' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`closed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_requests_number` ON `business_requests` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `business_requests_status` ON `business_requests` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `capacity_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`member_id` text NOT NULL,
	`hours_per_week` real DEFAULT 40 NOT NULL,
	`skills_json` text DEFAULT '[]' NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capacity_profiles_member` ON `capacity_profiles` (`tenant_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `financial_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`event_type` text NOT NULL,
	`measure` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`project_id` text,
	`budget_id` text,
	`request_id` text,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`source_line_id` text,
	`memo` text DEFAULT '' NOT NULL,
	`actor` text NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_events_dedupe` ON `financial_events` (`tenant_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `financial_events_project` ON `financial_events` (`tenant_id`,`project_id`,`measure`);--> statement-breakpoint
CREATE INDEX `financial_events_budget` ON `financial_events` (`tenant_id`,`budget_id`,`measure`);--> statement-breakpoint
CREATE INDEX `financial_events_source` ON `financial_events` (`tenant_id`,`source_type`,`source_id`);--> statement-breakpoint
CREATE TABLE `inbox_delegations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`delegator_id` text NOT NULL,
	`delegate_id` text NOT NULL,
	`modules_json` text DEFAULT '[]' NOT NULL,
	`item_types_json` text DEFAULT '[]' NOT NULL,
	`source_type` text,
	`source_id` text,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`out_of_office` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`ended_at` text
);
--> statement-breakpoint
CREATE INDEX `inbox_delegations_active` ON `inbox_delegations` (`tenant_id`,`delegator_id`,`status`);--> statement-breakpoint
CREATE TABLE `inbox_item_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`item_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inbox_item_actions_item` ON `inbox_item_actions` (`tenant_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `inbox_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`source_module` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`source_version` text DEFAULT '' NOT NULL,
	`item_type` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`impact_score` integer DEFAULT 0 NOT NULL,
	`business_impact` text DEFAULT '' NOT NULL,
	`financial_amount` real,
	`currency` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`due_at` text,
	`sla_at` text,
	`assigner_id` text,
	`actions_json` text DEFAULT '[]' NOT NULL,
	`required_page` text DEFAULT '' NOT NULL,
	`required_action` text DEFAULT 'view' NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`project_id` text,
	`location` text DEFAULT '' NOT NULL,
	`group_id` text,
	`read_at` text,
	`snoozed_until` text,
	`delegated_from` text,
	`escalated_from` text,
	`escalation_level` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	`completed_by` text,
	`completion_json` text DEFAULT '{}' NOT NULL,
	`graph_node_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_items_dedupe` ON `inbox_items` (`tenant_id`,`recipient_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `inbox_items_recipient` ON `inbox_items` (`tenant_id`,`recipient_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `inbox_items_source` ON `inbox_items` (`tenant_id`,`source_type`,`source_id`);--> statement-breakpoint
CREATE TABLE `inbox_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inbox_rules_kind` ON `inbox_rules` (`tenant_id`,`kind`);--> statement-breakpoint
CREATE TABLE `knowledge_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`question_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`confidence` real,
	`author_id` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`helpful` integer DEFAULT 0 NOT NULL,
	`not_helpful` integer DEFAULT 0 NOT NULL,
	`corrections_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `knowledge_answers_question` ON `knowledge_answers` (`tenant_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `knowledge_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`knowledge_id` text NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `knowledge_jobs_source` ON `knowledge_jobs` (`tenant_id`,`knowledge_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `knowledge_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`asker_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'unanswered' NOT NULL,
	`accepted_answer_id` text,
	`escalated_to` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'company' NOT NULL,
	`article_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `knowledge_questions_status` ON `knowledge_questions` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `knowledge_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`knowledge_id` text NOT NULL,
	`reason` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`assignee_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`due_at` text,
	`outcome` text DEFAULT '' NOT NULL,
	`resolved_by` text,
	`resolved_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `knowledge_reviews_open` ON `knowledge_reviews` (`tenant_id`,`status`,`assignee_id`);--> statement-breakpoint
CREATE TABLE `knowledge_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`member_id` text NOT NULL,
	`query` text NOT NULL,
	`filters_json` text DEFAULT '{}' NOT NULL,
	`saved` integer DEFAULT 0 NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `knowledge_searches_member` ON `knowledge_searches` (`tenant_id`,`member_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `knowledge_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`title` text NOT NULL,
	`owner_id` text,
	`department` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`classification` text DEFAULT 'internal' NOT NULL,
	`retention_class` text DEFAULT '' NOT NULL,
	`source_version` text DEFAULT '' NOT NULL,
	`content_hash` text DEFAULT '' NOT NULL,
	`connector_id` text,
	`lineage_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`stage` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`topics_json` text DEFAULT '[]' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`entities_json` text DEFAULT '{}' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'record' NOT NULL,
	`verified` integer DEFAULT 0 NOT NULL,
	`ai_generated` integer DEFAULT 0 NOT NULL,
	`last_reviewed_at` text,
	`next_review_at` text,
	`expires_at` text,
	`superseded_by` text,
	`duplicate_of` text,
	`source_created_at` text,
	`source_updated_at` text,
	`processed_at` text,
	`removed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_sources_ref` ON `knowledge_sources` (`tenant_id`,`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `knowledge_sources_status` ON `knowledge_sources` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `knowledge_sources_review` ON `knowledge_sources` (`tenant_id`,`next_review_at`);--> statement-breakpoint
CREATE TABLE `knowledge_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`knowledge_id` text,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`confidence` real,
	`status` text DEFAULT 'pending' NOT NULL,
	`origin` text DEFAULT 'ai' NOT NULL,
	`created_by` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`result_type` text,
	`result_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `knowledge_suggestions_status` ON `knowledge_suggestions` (`tenant_id`,`status`,`kind`);--> statement-breakpoint
CREATE TABLE `knowledge_taxonomy` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`definition` text DEFAULT '' NOT NULL,
	`parent_id` text,
	`synonyms_json` text DEFAULT '[]' NOT NULL,
	`retention_days` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`origin` text DEFAULT 'human' NOT NULL,
	`proposed_by` text NOT NULL,
	`approved_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_taxonomy_name` ON `knowledge_taxonomy` (`tenant_id`,`kind`,`name`);--> statement-breakpoint
CREATE TABLE `lifecycle_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`request_id` text NOT NULL,
	`stage_key` text NOT NULL,
	`stage` integer NOT NULL,
	`name` text NOT NULL,
	`mode` text DEFAULT 'any' NOT NULL,
	`quorum` integer DEFAULT 1 NOT NULL,
	`approver_ids_json` text NOT NULL,
	`decisions_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`delegable` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`decided_at` text
);
--> statement-breakpoint
CREATE INDEX `lifecycle_approvals_request` ON `lifecycle_approvals` (`tenant_id`,`request_id`,`status`);--> statement-breakpoint
CREATE TABLE `lifecycle_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`request_id` text NOT NULL,
	`stage_key` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`required` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`owner_id` text,
	`due_at` text,
	`started_at` text,
	`completed_at` text,
	`completed_by` text,
	`outcome` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`linked_type` text,
	`linked_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lifecycle_stages_key` ON `lifecycle_stages` (`tenant_id`,`request_id`,`stage_key`);--> statement-breakpoint
CREATE TABLE `lifecycle_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'custom' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`request_types_json` text DEFAULT '[]' NOT NULL,
	`stages_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lifecycle_templates_tenant` ON `lifecycle_templates` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `outcome_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`request_id` text,
	`project_id` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'Scheduled' NOT NULL,
	`review_date` text,
	`owner_id` text,
	`outcome_status` text DEFAULT '' NOT NULL,
	`lessons_learned` text DEFAULT '' NOT NULL,
	`feedback` text DEFAULT '' NOT NULL,
	`financial_result` text DEFAULT '' NOT NULL,
	`operational_result` text DEFAULT '' NOT NULL,
	`results_json` text DEFAULT '{}' NOT NULL,
	`follow_up_json` text DEFAULT '[]' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `outcome_reviews_request` ON `outcome_reviews` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `planning_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'quarter' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `planning_periods_tenant` ON `planning_periods` (`tenant_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `planning_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`owner_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`submitted_at` text,
	`decided_by` text,
	`decided_at` text,
	`applied_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `planning_scenarios_owner` ON `planning_scenarios` (`tenant_id`,`owner_id`);--> statement-breakpoint
CREATE TABLE `progress_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`target_id` text NOT NULL,
	`value` real,
	`previous_value` real,
	`progress` integer,
	`confidence` integer,
	`health` text DEFAULT '' NOT NULL,
	`source_kind` text DEFAULT 'manual' NOT NULL,
	`source_ref` text DEFAULT '' NOT NULL,
	`lineage_json` text DEFAULT '{}' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'applied' NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `progress_updates_target` ON `progress_updates` (`tenant_id`,`target_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `purchase_change_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`po_id` text NOT NULL,
	`number` text NOT NULL,
	`reason` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`delta` real NOT NULL,
	`status` text DEFAULT 'Applied' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `purchase_change_orders_po` ON `purchase_change_orders` (`tenant_id`,`po_id`);--> statement-breakpoint
CREATE TABLE `purchase_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`po_id` text NOT NULL,
	`number` text NOT NULL,
	`vendor_invoice_no` text NOT NULL,
	`amount` real NOT NULL,
	`tax` real DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`invoice_date` text NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'Received' NOT NULL,
	`match_json` text DEFAULT '{}' NOT NULL,
	`paid_amount` real DEFAULT 0 NOT NULL,
	`paid_at` text,
	`file_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `purchase_invoices_po` ON `purchase_invoices` (`tenant_id`,`po_id`);--> statement-breakpoint
CREATE TABLE `scenario_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`scenario_id` text NOT NULL,
	`change_type` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`params_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scenario_changes_scenario` ON `scenario_changes` (`tenant_id`,`scenario_id`);--> statement-breakpoint
CREATE TABLE `service_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`number` text NOT NULL,
	`title` text NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`provider_kind` text DEFAULT 'vendor' NOT NULL,
	`vendor_id` text,
	`provider_department` text DEFAULT '' NOT NULL,
	`contract_id` text,
	`po_id` text,
	`request_id` text,
	`project_id` text,
	`owner_id` text NOT NULL,
	`deliverables_json` text DEFAULT '[]' NOT NULL,
	`milestones_json` text DEFAULT '[]' NOT NULL,
	`acceptance_criteria` text DEFAULT '' NOT NULL,
	`sla_target_hours` real,
	`due_at` text,
	`delivered_at` text,
	`status` text DEFAULT 'Planned' NOT NULL,
	`sla_met` integer,
	`quality_score` integer,
	`rating` integer,
	`review_notes` text DEFAULT '' NOT NULL,
	`payment_eligible` integer DEFAULT 0 NOT NULL,
	`renewal_decision` text DEFAULT '' NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`accepted_by` text,
	`accepted_at` text,
	`department` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `service_deliveries_status` ON `service_deliveries` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `strategy_acks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`record_id` text NOT NULL,
	`version` integer NOT NULL,
	`member_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `strategy_acks_member` ON `strategy_acks` (`tenant_id`,`record_id`,`version`,`member_id`);--> statement-breakpoint
CREATE TABLE `strategy_check_ins` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`target_id` text NOT NULL,
	`cadence` text DEFAULT 'weekly' NOT NULL,
	`period_label` text DEFAULT '' NOT NULL,
	`progress` integer,
	`confidence` integer,
	`health` text DEFAULT '' NOT NULL,
	`achievements` text DEFAULT '' NOT NULL,
	`problems` text DEFAULT '' NOT NULL,
	`risks` text DEFAULT '' NOT NULL,
	`decisions_needed` text DEFAULT '' NOT NULL,
	`next_steps` text DEFAULT '' NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`forecast` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`ai_drafted` integer DEFAULT 0 NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`author_id` text NOT NULL,
	`due_at` text,
	`submitted_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `strategy_check_ins_target` ON `strategy_check_ins` (`tenant_id`,`target_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `strategy_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`period_id` text,
	`department` text DEFAULT '' NOT NULL,
	`content_json` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `strategy_reviews_tenant` ON `strategy_reviews` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `time_off` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`member_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`kind` text DEFAULT 'Leave' NOT NULL,
	`status` text DEFAULT 'Approved' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `time_off_member` ON `time_off` (`tenant_id`,`member_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `work_record_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`record_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`edited_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_record_versions_v` ON `work_record_versions` (`tenant_id`,`record_id`,`version`);--> statement-breakpoint
ALTER TABLE `budgets` ADD `request_id` text;--> statement-breakpoint
ALTER TABLE `budgets` ADD `contingency` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `budgets` ADD `funding_source` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `goods_receipts` ADD `kind` text DEFAULT 'goods' NOT NULL;--> statement-breakpoint
ALTER TABLE `goods_receipts` ADD `acceptance_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `goods_receipts` ADD `store_location` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `request_id` text;--> statement-breakpoint
ALTER TABLE `purchase_docs` ADD `request_id` text;--> statement-breakpoint
ALTER TABLE `purchase_lines` ADD `ordered_qty` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_lines` ADD `pr_line_id` text;--> statement-breakpoint
ALTER TABLE `purchase_lines` ADD `line_kind` text DEFAULT 'goods' NOT NULL;--> statement-breakpoint
ALTER TABLE `work_records` ADD `acl_json` text;--> statement-breakpoint
ALTER TABLE `work_records` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE TRIGGER `financial_events_immutable_update` BEFORE UPDATE ON `financial_events` BEGIN SELECT RAISE(ABORT,'financial events are immutable; record a reversing event instead'); END;
--> statement-breakpoint
CREATE TRIGGER `financial_events_immutable_delete` BEFORE DELETE ON `financial_events` BEGIN SELECT RAISE(ABORT,'financial events are immutable; record a reversing event instead'); END;
--> statement-breakpoint
UPDATE `purchase_lines` SET `ordered_qty`=`qty` WHERE `doc_id` IN (SELECT `id` FROM `purchase_docs` WHERE `kind`='PR' AND `status`='Converted');
--> statement-breakpoint
UPDATE `work_records` SET `status`='Approved' WHERE `kind`='decision' AND `status`='Decided';
--> statement-breakpoint
UPDATE `work_records` SET `status`='Superseded' WHERE `kind`='decision' AND `status`='Reversed';
