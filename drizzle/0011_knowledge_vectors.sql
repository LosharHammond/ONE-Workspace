CREATE TABLE `knowledge_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`chunk_no` integer NOT NULL,
	`model` text NOT NULL,
	`embedding` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `knowledge_chunks_tenant` ON `knowledge_chunks` (`tenant_id`,`model`);--> statement-breakpoint
CREATE INDEX `knowledge_chunks_source` ON `knowledge_chunks` (`tenant_id`,`source_type`,`source_id`);--> statement-breakpoint
ALTER TABLE `ai_providers` ADD `embedding_model` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD `model` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD `store` text DEFAULT '' NOT NULL;