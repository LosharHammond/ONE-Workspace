CREATE TABLE `research_cloud_jobs` (
	`recording_id` text PRIMARY KEY NOT NULL,
	`provider_id` text,
	`token_hash` text NOT NULL,
	`state` text NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `research_recordings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_cloud_jobs_provider_id_unique` ON `research_cloud_jobs` (`provider_id`);