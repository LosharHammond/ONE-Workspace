# One Workspace

A multi-tenant SaaS for companies: people, assets, inventory, maintenance, help desk, purchasing, files, department spaces and reports in one place. Each company is a **workspace** with strictly isolated data. The **Platform Owner** — **losharhammond@gmail.com, and nobody else** — creates, suspends, reactivates and archives workspaces from the Platform Console, and can enter a workspace only through an audited support session.

One Workspace is independent: it has its own sign-in and no ChatGPT, OpenAI Sites or "Sign in with ChatGPT" integration.

Built with React 19 + [vinext](https://github.com/cloudflare/vinext) on Cloudflare Workers, D1 (SQLite) and R2 storage.

See [`docs/feature-matrix.md`](docs/feature-matrix.md) for the status of every feature and how it was verified.

## Modules

| App | What it does |
|---|---|
| **Home** | Focus queue (approvals and tickets waiting on you), company pulse, charts, announcements. |
| **Help desk** | Incidents and service requests: categories/subcategories, impact × urgency → priority, SLA, assignment, approval, escalation, internal notes, attachments, board and saved views. |
| **Purchasing** | Requisitions → sequential approvals → purchase orders, vendors, quotations, budgets and cost centres, partial goods receipt (into stock or as new assets), returns. |
| **Assets** | Register with QR labels, check-out/check-in, custody history, transfers, depreciation, disposal, attachments, audits (stock verification), import/export. |
| **Inventory** | Items, stores, receipts/issues/transfers/adjustments/returns, batch/serial, reorder alerts. |
| **Maintenance** | Preventive plans, recurring schedules, work orders, technicians, parts and costs, completion evidence. |
| **People** | Directory, org chart, departments (codes, heads, cost centres, hierarchy, history, import), **Manage users** (invitations, statuses, bulk actions, import, activity report). |
| **Spaces / Files** | Department and company spaces, versioned files with visibility. |
| **Reports** | Ten workspace-scoped reports with CSV export. |
| **Admin** | Company settings and numbering, **Roles & permissions** (templates, actions, scopes, preview), access overrides, activity and security log. |
| **Platform** | Platform Owner only: workspaces, provisioning, modules, limits, support sessions, platform audit. |

## Accounts and access

- **Identities and memberships.** A person has one global sign-in (`identities` + `credentials`) and a membership (`members`) in each workspace they belong to. The active workspace is chosen on the server from the session; people with several memberships switch with the workspace switcher.
- **No temporary passwords.** Administrators invite people; the invitee receives a one-time activation link and sets their own password. Resets work the same way. Only SHA-256 hashes of links are stored, and they expire (7 days / 2 hours). Without email configured, the link is shown once to the person who created it.
- **Roles.** Baselines: Company Admin, Department Head, Standard User, Technician, Approver, Purchasing User, Asset Manager, Storekeeper, Viewer, plus custom roles. Each role is a page × action (view, create, update, delete, approve, export, import, configure…) matrix with a scope (none, own, department, selected departments, all) and optional location, asset-category and status limits. Everything not granted is denied, and every check runs on the server.
- **Platform Owner.** Fixed in code (`PLATFORM_OWNER_EMAIL` in `app/server/core.ts`); no workspace role — including Company Admin — can grant it. Support sessions require a reason, show a banner with **Exit workspace**, and log every request to the platform audit and the workspace's activity log.

## Configuration (secrets)

| Secret | Purpose |
|---|---|
| `PLATFORM_SETUP_TOKEN` | Random secret (32+ characters) used once to set the Platform Owner's first password. Remove it afterwards. |
| `RESEND_API_KEY`, `MAIL_FROM` | Email for invitations, resets and notifications. Without them, links are shown once in the UI and notifications stay in-app. |
| `APP_ORIGIN` | Public origin used in links. |
| `GROQ_API_KEY` | The platform's default AI provider (assistant, AI actions, research summaries). Companies without their own provider use it. The Platform Owner picks the model in **Platform › Connectors & AI**. |
| `SECRETS_KEY` | 32+ random characters. Encrypts connector credentials and company AI keys at rest (AES-256-GCM). Required before anyone can save a connector or AI key. Keep it stable: changing it makes stored secrets unreadable (re-enter them). |
| `ASSEMBLYAI_API_KEY` | Research transcription (optional). |
| `DATA_IMPORT_TOKEN` | One-time bulk import endpoint (optional). |

`AI_GROQ_BASE_URL` exists only for local tests (it points the Groq default at a mock); never set it in production.

Set secrets with `wrangler secret put` (production) or `.dev.vars` (local; git-ignored). Never put them in source files.

## Migrations

All schema changes are additive migrations in `drizzle/`; nothing is dropped or reset.

- `0006_one_workspace.sql` — multi-tenancy; existing Procus data becomes the `procus` workspace.
- `0007_platform_owner.sql` — the operator's own workspace ("One Workspace HQ") and the owner membership, **without a password**.
- `0008_saas_platform.sql` — identities, credentials, one-time tokens, support sessions, platform audit, saved views, asset audits, inventory, maintenance, quotations, budgets, and new columns; backfills identities and credentials from existing members.
- `0009_page_catalog_ai_connectors.sql` — `roles.pages_json` (role page lists), `platform_settings` (catalog overrides, packages, AI default), `ai_providers`, `ai_conversations`, `ai_messages`, `ai_usage`, `connectors`, `connector_logs`, `oauth_states`, `app_pages`, `app_page_versions`, `page_templates`. Additive only.

## Pages, roles, AI and connectors

- **Page catalog** (`app/page-catalog.ts`): every page has a stable id. The Platform Owner gives each company pages (or a package) in **Platform › Workspaces › Pages & modules** and edits packages, beta status, required plan and platform-only flags in **Platform › Page catalog**. A page a company lacks is hidden, blocked by direct link and refused by its API.
- **Roles**: Company Admins limit each role to a subset of their company's pages (Admin › Roles & permissions › Pages), set actions and record scopes, and can **Preview as this role**.
- **Page builder** (Pages app): drag-and-drop sections, rows, columns and tabs of approved widgets; draft → preview → publish, version history, compare, rollback, templates. A page with the address `home` appears on Home.
- **Connector Center** (Admin › Connectors; Platform › Connectors & AI for global app registrations): REST, OAuth 2.0 (Microsoft, Google, generic), signed webhooks and MCP servers, restricted by page and role.
- **AI**: Groq by default; a company can connect its own provider in Admin › AI settings. The floating assistant (Ctrl+J) and AI actions retrieve only what the person asking can open in the current workspace, cite sources, and never change data without a preview and confirmation.

## Platform Owner first sign-in

1. Add `PLATFORM_SETUP_TOKEN` (see below).
2. Open the site → **Platform Owner setup** on the sign-in screen → enter the token and a new password.
3. Sign in as losharhammond@gmail.com, then delete the secret. Setup refuses to run once the owner has a password, is rate limited, and returns the same error for every failure.

## Deploying (Cloudflare Workers)

```bash
npx wrangler login
D1_DATABASE_ID=<existing database_id> npm run build
npm run db:migrate:remote        # applies only migrations not yet applied
npx wrangler secret put PLATFORM_SETUP_TOKEN --config dist/server/wrangler.json   # first deploy only
npx wrangler secret put SECRETS_KEY --config dist/server/wrangler.json            # once; keep it stable
npx wrangler secret put GROQ_API_KEY --config dist/server/wrangler.json           # default AI provider
npm run deploy
```

For a new installation, first run `npx wrangler d1 create one-workspace` and `npx wrangler r2 bucket create one-workspace-files`. Back up production before migrating: `npx wrangler d1 export DB --remote --config dist/server/wrangler.json --output backup.sql`.

## Local development and tests

See [`LOCAL-DEVELOPMENT.md`](LOCAL-DEVELOPMENT.md).
