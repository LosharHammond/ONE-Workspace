-- One Workspace has exactly one platform owner: losharhammond@gmail.com (enforced in app/server/core.ts).
-- Clear any owner flags stored by earlier builds.
UPDATE `members` SET `platform_role`=NULL WHERE `platform_role` IS NOT NULL;--> statement-breakpoint
-- The operator's own workspace, separate from every customer company.
INSERT OR IGNORE INTO `tenants` (`id`,`slug`,`name`,`legal_name`,`domains`,`status`,`plan`,`brand_color`,`currency`,`timezone`,`settings_json`,`created_at`) VALUES ('one-workspace','one-workspace-hq','One Workspace HQ','One Workspace','','active','enterprise','#6D5EF8','GHS','Africa/Accra','{"prPrefix":"PR","poPrefix":"PO","ticketPrefix":"TKT","assetPrefix":"AST"}',strftime('%Y-%m-%dT%H:%M:%fZ','now'));--> statement-breakpoint
INSERT OR IGNORE INTO `departments` (`id`,`tenant_id`,`name`,`created_at`) VALUES (lower(hex(randomblob(16))),'one-workspace','Administration',strftime('%Y-%m-%dT%H:%M:%fZ','now'));--> statement-breakpoint
-- The owner account has no password yet: it is set once through /api/platform/claim with PLATFORM_SETUP_TOKEN.
INSERT INTO `members` (`id`,`name`,`email`,`role`,`department`,`active`,`created_at`,`tenant_id`,`title`) SELECT 'platform-owner','Loshar Hammond','losharhammond@gmail.com','admin','Administration',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'one-workspace','Platform owner' WHERE NOT EXISTS (SELECT 1 FROM `members` WHERE lower(`email`)='losharhammond@gmail.com');
