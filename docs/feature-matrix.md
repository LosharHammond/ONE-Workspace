# One Workspace feature matrix

Status key: **Working** (existed before and still works) · **New** (implemented in this change) · **Partial** (implemented with the limits noted) · **Deferred** (not built, with the reason).

"Verified" names how it was checked: **E2E** = automated acceptance test (`npm run test:e2e`), **Unit** = permission unit test (`npm run test:unit`), **Manual** = exercised in the browser against the built Worker, **API** = called directly during development.

## Four connected company-operating-system foundations (audit 2026-09-27)

This section uses the requested status vocabulary. “Newly implemented” means code was added in this pass; it is not marked verified until the named automated and runtime checks pass. Existing functionality elsewhere in this older matrix is not proof of the new acceptance scenarios below.

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Tenant-derived identity and workspace scoping | Existing and verified | Existing session/API model and SaaS tests; D1 has no RLS, so route/service query scoping remains the enforcement layer. Audit every new route. |
| Work Graph D1 node/relationship schema and source projections | Existing but incomplete | Migration 0014 and `app/server/graph.ts` cover many core modules. Not every entity/mutation in the request has projection or reliable event production. |
| Work Graph source-record permission rechecks and hidden-node traversal | Existing but incomplete | `visibleNodes`, context and path services use tenant-scoped reads and module visibility. Cross-company API regression is covered by the platform/SaaS E2E suite. |
| Work Graph authenticated API, browse/search and context screen | Newly implemented | `/api/graph` and `#/graph` added. Migration 0014 applied locally; background chunked bootstrap populated the current tenant graph. Browser check displayed 11 authorized records and correctly directed linked-record context. Latest isolated E2E: platform 12/12, SaaS 24/24, collaboration 20/20, including forged-source and cross-tenant search checks. Current view is a record list/context panel, not a graph canvas. |
| Project and asset 360 connected-work panels | Newly implemented (partial coverage) | Project overview visibly rendered 5 permission-checked connected records in the browser. Collaboration E2E verifies project context across team, budget, tasks, decision, file, PR/PO, and receipt-created asset, plus asset context through its purchase/project/work-order chain. The local asset register was empty during browser QA; no development business data was added. |
| Full graph explorer (visualization, timeline, saved views, filters, export, path explanation UI) | Deferred with a genuine reason | Core tenant-scoped traversal is being exposed first. A graph canvas over incomplete projections risks suggesting completeness or disclosing misleading paths; finish projection coverage and security tests before presenting richer path/timeline exports. |
| Domain event outbox and retryable background jobs | Existing but incomplete | Audit-triggered outbox and D1 job queue exist. Event processing reclaims expired leases and now distinguishes configured-but-unexecuted Studio automations as `deferred`; SaaS E2E verifies the deferred reason and admin Graph API count. A Work Graph source-type lookup was rewritten to avoid SQLite compound-select limits; the Studio event test verifies that graph projection now reaches the consumer result. Per-module event coverage, Cron configuration, consumer-specific run rows and operator retry/review UI remain incomplete. |
| Studio declarative schema, safe formulas and metadata validation | Newly implemented and verified | `/api/studio` validates app definitions against the allow-listed types/workflow rules in `app/studio-def.ts`; E2E covers valid and invalid test definitions. Validation is structural, not execution/security evaluation of actions. |
| Workspace Studio draft, publish and rollback lifecycle | Newly implemented and verified (partial capability) | Tenant-scoped create/save/list/detail, stale-draft conflict checking, immutable publish versions, rollback-as-new-version, and member-visible field filtering are E2E-tested. Browser verified starter table/form editor and creation flow. |
| Workspace Studio initial records and form submission | Newly implemented and verified (partial capability) | Published-app record API and basic list/create UI; typed/required validation, role-filtered fields/forms, workspace/table scope intersection, optimistic updates, soft-delete API, immutable record snapshots and audit rows. SaaS E2E verifies tenant isolation, required fields and own-scope filtering. No DB-enforced unique constraints, record edit/delete UI, file/relationship/repeating fields, dashboards or workflow/approval/automation execution. |
| ONE model/provider layer and assistant | Existing and verified | Existing AI/provider coverage is listed under AI below. This does not imply that the agent workforce requirements pass. |
| Governed agents, identity-bound runs, approvals, evaluations and Control Tower | Existing but incomplete | New `/api/agents` and `#/agents` support CRUD, immutable published versions, requester-bound read-only runs, source citations, workspace/private visibility, daily per-user limits and pause/kill/resume. Browser page renders. Event-triggered execution remains a no-op; approval-gated actions, evaluation gates and Control Tower are not implemented. |
| Connector management, encrypted credentials and selected provider operations | Existing and verified | See Connector Center and AI sections below; provider tests use mocks and are not live-provider certification. |
| Three-mode connector fabric (synced/federated/action) with permissions and lineage | Existing but incomplete | MCP action proposals are now encrypted, requester-bound, single-dispatch, cancellable and auditable; mock E2E covers these controls. Explicit mode contracts, permission/deletion-aware sync, federated retrieval, external result verification and provider-specific recovery remain incomplete end to end. |
| Connected end-to-end graph ↔ Studio ↔ agents ↔ connectors scenarios | Deferred with a genuine reason | Graph projection consumes the shared event outbox; Studio automation matches are explicitly deferred until an executor is available, agents remain manual-run only, and connector action/sync modes are not yet fully connected. Cross-system activation must wait for human-gated, tenant-scoped executors and acceptance tests; no UI-only integration is claimed. |

### Acceptance-test status for the supplied mission

| Acceptance area | Status | Evidence / next verification |
|---|---|---|
| Project/asset/person 360 context | Newly implemented (partial coverage) | Project connected-work panel visibly showed 5 authorized records. Collaboration E2E verified project/asset relationship chains; asset register is empty in development, so its rendered context panel was not visually exercised. Person context is present in the shared module pattern but the supplied scenarios do not exhaustively cover every source type. |
| Cross-company graph isolation / forged workspace ID | Newly implemented | Graph isolation cases passed in the platform/SaaS suites; the full isolated run was platform 12/12, SaaS 24/24, collaboration 20/20. Tenant A cannot fetch tenant B's ticket by forged source ID or discover it through graph search. |
| No-code Studio app create, validate, publish and rollback | Newly implemented (partial acceptance) | E2E verifies a table + form definition, validation, tenant isolation, member read-only access, immutable publishing, draft edits and rollback. Browser confirms the creation editor renders. The acceptance request’s dashboard/workflow content and runnable preview/runtime are not yet satisfied. |
| Natural-language workflow draft with human publication gate | Deferred with a genuine reason | No verified natural-language Studio workflow generator or executor exists. |
| Restricted governed agent, identity-bound read-only run and kill switch | Newly implemented | Verified in SaaS E2E: immutable published version, requester identity, unchanged ticket data, private visibility, workspace boundary and kill switch. Approval-gated mutations and evaluation gates remain deferred. |
| Synced, federated and action connector acceptance scenarios | Existing but incomplete | Selected provider integrations exist; the complete three-mode contracts and source lineage have not passed end-to-end verification. |
| Existing module regression, production migration upgrade and full build/test suite | Existing but incomplete | Latest typecheck/build passed; unit tests 6/6; full isolated local-mock E2E: platform 12/12, SaaS 24/24, collaboration 20/20. Repository lint reports 0 errors and 288 warnings. Local migration 0014 was applied forward-only with existing development records preserved; representative remote upgrade and deployment remain unverified. Build warns that one JavaScript chunk exceeds 500 kB. |

## Platform & multi-tenancy

| Feature | Status | Verified | Notes |
|---|---|---|---|
| Workspace key on every company record (`tenant_id`) | Working | E2E | Kept the established `tenant_id` name rather than renaming every table to `workspace_id`. Legacy tables default existing rows to the Procus workspace (non-null). |
| Global identities + per-workspace memberships | New | E2E | `identities` + `credentials`; `members` is the membership (role, department, locations, manager, status, preferences). Migration 0008 backfills. |
| Active workspace decided on the server | New | E2E | From the session's membership or an open support session; body/query workspace ids are ignored (forged-id test). |
| Isolation of queries, search, exports, uploads, reports, notifications, storage paths | New/Working | E2E | Central in the API layer (D1 has no row-level security). R2 keys are prefixed with the workspace id. |
| Composite / workspace-aware foreign keys | Partial | — | New tables use composite indexes and workspace-scoped lookups; SQLite cannot add constraints to existing tables without rebuilding them, so isolation is enforced in the service layer instead. |
| Workspace switcher | New | Manual | Only active memberships in active workspaces; switching reloads the app so no previous-workspace data remains. |
| Platform Owner boundary | New | E2E | Single owner `losharhammond@gmail.com`, fixed in code; no workspace role can grant it. |
| Platform Console: list, create, edit, suspend, reactivate, archive | New | E2E + Manual | Creation is one D1 batch (all-or-nothing); duplicate slugs/domains rejected. |
| Workspace detail tabs (Overview, Profile, Administrators, Modules, Usage & limits, Security, Audit, Data tools, Danger zone) | New | Manual | |
| Choose defaults at creation | New | E2E | Departments, locations, roles, workflows, folders, welcome page. Numbering, categories and statuses always configured. |
| Admin invitation / reset link from the console | New | E2E | Owner never sees passwords. |
| Audited support sessions (enter/exit, reason, IP, user agent, every request) | New | E2E + Manual | Banner with "Exit workspace"; mutations tagged with the support session id; company admins see sessions in their activity log. |
| Suspended workspace: members locked out, owner not | New | E2E | |
| Module switches (navigation + API) | New | E2E | Disabled modules resolve to "none" even for Company Admins. |
| Plan limits (people, storage) | New | API | Enforced on invite/reactivate and on upload. |
| Platform audit log | New | E2E + Manual | |
| `PLATFORM_SETUP_TOKEN` one-time owner setup | Working (hardened) | E2E | Server secret only, rate limited, generic errors, refuses once a password exists, never stored. |

## Accounts & security

| Feature | Status | Verified | Notes |
|---|---|---|---|
| Invitation / password-reset links instead of temporary passwords | New | E2E | 32-byte tokens, SHA-256 hash stored, single use, 7-day invite / 2-hour reset. Shown once when email is not configured. |
| Forgot-password (self service) | New | API | Generic response; only sends when email is configured. |
| Rate limits: login (per account + IP), setup, activation, reset, password change | New | E2E (setup) | |
| No plaintext passwords/tokens stored | New | E2E | Test scans every relevant table for every password and token used. |
| CSRF | Working | E2E | Same-origin check on every write + SameSite=Lax HttpOnly `__Host-` cookie. |
| Mass assignment / IDOR / privilege escalation | New | E2E | Explicit field lists; every lookup includes the workspace; owner status cannot be granted. |
| File type and size validation | Working | — | Allow-list of extensions, 25 MB, storage limit. |

## Company administration

| Feature | Status | Verified | Notes |
|---|---|---|---|
| Departments: code (unique per workspace), head, description, cost centre, status, hierarchy, created/modified | New | E2E | Enable/disable, filter, search, paginate, CSV export, import with preview & error report, history. |
| Manage users: all listed fields, statuses (Active/Invited/Disabled), last active, metadata | New | E2E + Manual | Invite, edit, disable, reactivate, resend invitation, reset link, bulk actions, import/export, activity report. |
| Roles: baselines (Company Admin, Department Head, Standard User, Technician, Approver, Purchasing User, Viewer, Custom + Asset Manager, Storekeeper) | New | Manual | Templates when creating a role; provisioned for new workspaces. |
| Actions incl. Delete, Import, Configure | New | Unit | |
| Scopes: None / Own / Department / Selected departments / Selected locations / Asset categories / Statuses / All | New | E2E + Unit | Selected departments extend "Dept"; location/category/status scopes filter assets. |
| Vendor access, allotted-assets-only, default landing screen, grouped permission tree, permission preview | New | Manual | |
| Deny by default, View before other actions, API enforcement | New | Unit + E2E | Built-in baselines are explicit presets per access level. |
| Roles with members cannot be deleted; permission changes audited | New | E2E | |
| Company settings, numbering, categories | Working (extended) | Manual | Work-order prefix, inventory categories added; modules/limits read-only for company admins. |
| Custom fields | Deferred | — | Not previously supported in the codebase. |
| Security log (admins only) | New | Manual | Filtered view of sign-ins, invitations, password, access, role and support events. |

## Business modules

| Feature | Status | Verified | Notes |
|---|---|---|---|
| Asset register, categories/subcategories, statuses, departments/cost centres | New/Working | E2E | |
| Check-out (due back) / check-in (condition), custody history, transfers | New | API | |
| Barcode / QR labels | New | Manual | Rendered locally (no external service); printable label. |
| Photos & attachments | New | E2E | Attachments follow the parent record's visibility. |
| Depreciation (straight line), disposal/retirement workflow | New | API | Disposal needs the Delete permission and records method, proceeds, reason. |
| Asset audits / stock verification | New | API | Scan-or-type check-off per location. |
| Asset import/export, maintenance history | New | API | |
| Inventory items, stores, receipts/issues/transfers/adjustments/returns, batch/serial, reorder alerts, audit trail, import/export | New | API + E2E (module) | Stock can't go negative on a single request; concurrent issues are not serialised (see limitations). |
| Preventive plans, recurring schedules, work orders, technician assignment, parts & costs, due/overdue, completion evidence, reminders, history by asset | New | API | Work orders are generated when the plan list is opened (no background scheduler). |
| Tickets: requester/affected user, categories/subcategories, priority/impact/urgency, SLA & overdue, assignment, comments/internal notes/attachments, approval, escalation, views, export | New/Working | E2E | Assignment "groups" are departments. |
| Purchasing: PR, approval inbox, multi-step workflows, vendors, quotations, PO, goods receipt (partial), returns, budgets, stock updates, asset creation from receipts, cost-centre, audit | New/Working | E2E (PR/isolation) + earlier API run | |
| Home, announcements, notifications, search/palette, directory, spaces, files/versions, comments, IT/CCTV, research | Working | E2E (routes) | Unchanged behaviour, now workspace-scoped. |
| Reports & CSV export | New | E2E | 10 reports, scoped to the workspace and the person's access. |
| Saved views, configurable columns, filters, pagination on management tables | New | Manual | Saved views stored per person per workspace. |
| Imports with validation preview and error report | New | E2E (people/departments) | People, departments, assets, inventory. |

## Page catalog, entitlements and role pages (migration 0009)

| Feature | Status | Verified | Notes |
|---|---|---|---|
| Central page catalog (id, name, description, icon, route, module, actions, plan, status, version, dependencies, connectors, flags, core/company/platform) | New | E2E + Manual | `app/page-catalog.ts`; owner overrides (status, plan, platform-only, dependencies) in `platform_settings`. |
| Per-company page entitlements, packages (Starter/Business/Enterprise, editable), beta pages, dependencies added automatically, plan check | New | E2E | Removing a page hides it, blocks direct links (403 page) and refuses its API; data kept; audited in both logs. |
| Platform-only pages refused in every company | New | E2E (refused on assign) | Enforced when loading access. |
| Company preview of what a company sees | New | Manual | Pages & modules tab. |
| Roles limited to a subset of entitled pages (deny by default) | New | E2E | `roles.pages_json`; Home always included. |
| Role cannot receive pages the company lacks, permissions beyond the creator's own, or actions without View | New | E2E | 400/403 from `/api/roles`. |
| Department role templates (IT, Human Resources, Finance, Procurement) | New | E2E (seeded) | Provisioned for new workspaces. |
| Role people count, delete refused while assigned, permission changes audited with before/after | New/Working | E2E | |
| Preview as role | New | Manual | Server-computed preview; navigation and buttons follow the role; data still uses the admin's access (stated in the banner). |
| Platform Owner: disable, reactivate, remove company administrators | New | E2E | The last active admin cannot be disabled or removed. |

## Page and widget builder

| Feature | Status | Verified | Notes |
|---|---|---|---|
| Sections, rows/columns (12-col spans), tabs, drag-and-drop from palette and between columns, keyboard reordering | New | Manual | `app/ui/builder.tsx`. |
| 22 widget types (heading, text, image, button, links, request form, table, list, KPI, chart, calendar, kanban, tickets, assets, people, approvals, files, search, report, AI answer, connector data) | New | E2E (data) + Manual | Controlled registry `app/widgets.ts`; no HTML/JS; links limited to `#/…` and https. |
| Per-widget data source, filters, sorting, limit, role/department/location visibility, width, refresh interval, empty/error states | New | E2E | Server validates configs; unknown filters rejected. |
| Draft, preview, publish, version history, compare, rollback, duplicate, save as template (platform templates owner-only), archive/restore/delete | New | E2E | Every save is an immutable version; stale saves refused (409). |
| Widget data resolved server-side with the viewer's permissions | New | E2E | Cannot read another company's records. |
| Home page customization (page address `home`) | New | Manual | Shown above the Home dashboard. |
| Editing hard-coded module pages (Tickets, Assets…) with the builder | Deferred | — | Those pages are code; companies build custom pages and Home widgets instead. |

## Connector Center

| Feature | Status | Verified | Notes |
|---|---|---|---|
| Company and platform connector centers | New | E2E | Platform connectors: owner only, outside support sessions. |
| Microsoft 365 / Entra / Outlook / Teams / SharePoint / OneDrive / Excel, Google Workspace / Gmail / Calendar / Drive (OAuth 2.0 + PKCE, refresh) | New (unverified) | — | Implemented but not exercised: needs real Microsoft/Google app registrations. |
| Generic REST (API key / bearer / basic), OAuth 2.0 service, database/file-storage/custom HTTP APIs | New | E2E (REST) | |
| Incoming webhooks with HMAC-SHA256 signatures and 5-minute replay window | New | E2E | |
| MCP servers: discovery of tools/resources, allow-list, read-only vs mutating, persisted confirmation, timeout/cancellation, action history | New | E2E (mock MCP) | Mutating arguments are sealed at rest in a pending proposal; the requester reviews the exact payload, and a conditional state transition permits one dispatch. Cancellation and replay refusal are tested. A successful remote response is not independent verification; sync/federated modes and provider-specific recovery remain incomplete. Tools not declared read-only default to "changes data". |
| Test, reconnect, disable/enable, rotate credentials, disconnect with typed confirmation, field mapping, page/role restrictions, logs, audit | New | E2E | |
| Secrets encrypted at rest (AES-256-GCM, HKDF per workspace/platform, bound to record id) and never returned | New | E2E | Needs `SECRETS_KEY`. |
| Scheduled sync | Deferred | — | Needs a Cron Trigger; "Sync now" and widget reads update the last sync time. |

## AI

| Feature | Status | Verified | Notes |
|---|---|---|---|
| Provider layer: Groq, OpenAI, Anthropic, Gemini, Azure OpenAI, OpenAI-compatible; chat, streaming, structured output, embeddings (where offered), tool calling (OpenAI-style), error normalization, usage, fallback policy | New | E2E (Groq-compatible mock, OpenAI-compatible mock) | Real provider APIs not called in tests. |
| Groq default via `GROQ_API_KEY`; model set by the Platform Owner | New | E2E | Key never stored or sent to the browser. |
| Company provider overrides Groq for that company only | New | E2E | |
| Floating assistant: workspace badge, streaming, citations, history, suggested prompts, page-aware context, feedback, stop, retention, usage limits | New | E2E + Manual | Ctrl+J. |
| Assistant named **ONE**; voice input (push-to-talk, stop on silence) transcribed with Whisper (Groq by default, or the company provider); voice mode reads answers aloud; “Hello ONE” wake phrase (opt-in) | New | E2E (Whisper endpoint via mocks) + Manual | Wake phrase uses the browser’s speech recognition (Chrome/Edge/Safari; not Firefox). Audio is never stored. |
| Permission-aware retrieval (keyword search over live records with each module's visibility rules) | New | E2E | Minimum snippets; no whole tables. |
| Vector search: embeddings (Workers AI for Groq companies, or the company provider), Vectorize namespace per workspace or per-company D1 store, incremental and rebuildable index, hybrid with keyword search, permission re-check of every hit | New | E2E (company-provider embeddings + D1 store); Workers AI + Vectorize unverified (needs `wrangler login`) | Opt-in bindings: `CF_WORKERS_AI=1`, `VECTORIZE_INDEX=…` at build time. |
| AI actions on Home, Tickets, Assets, Purchasing, Spaces and the builder | New | E2E (triage, drafts, layout) | Suggestions are previews; applying uses the normal API after confirmation. |
| AI activity log and usage (no prompt text stored in logs) | New | E2E | |

## Company lists (migration 0010)

| Feature | Status | Verified | Notes |
|---|---|---|---|
| Admin › Lists: ticket/asset categories and subcategories, inventory categories, units, brands, vendor categories, cost centres, job titles — add, edit, deactivate, delete, reorder, import/export, audit | New | E2E | Seeded from the old comma-separated settings on first use. |
| Forms pick from lists (tickets, assets, inventory, purchasing, vendors, people) with inline “Add new” for admins; locations picked from the location tree with inline add | New | E2E (session) + Manual | Existing records keep values that are no longer in a list (shown as “not in list”). The server does not reject values outside a list (imports keep working). |
| Left navigation scrolls on short screens | Fixed | Manual | Compact tiles below 820 px height, labels hidden below 640 px. |

## Collaboration: Spaces, Files, processing, projects, tasks, messaging, groups, connectors (migration 0012)

| Feature | Status | Verified | Notes |
|---|---|---|---|
| Content access model (`acl_json`): only me, department(s), people, roles, groups, locations, project team, space members, company; editors; owner | New | E2E | One checker (`app/server/acl.ts`) used by lists, detail, download/preview, signed links, artifacts, search, AI context, notifications, messaging attachments and connector saves. Legacy rows map from their old visibility. Company Admins see everything in their company only. |
| Staff uploads default to their department (private without one); audience shown before upload | New | E2E + Manual | |
| Company-wide publishing policy (everyone / administrators approve) with an approval request | New | E2E | Files and announcements. |
| Short-lived signed download links (HMAC, 5 min, issued only after the access check) | New | E2E | Tampered links refused. |
| Files: folders, drag-and-drop, multi-file, resumable (R2 multipart), progress, previews, versions (view/restore/replace), metadata, tags, category, custom fields, search, filters, columns, bulk move/visibility/archive/download/delete/restore, image thumbnails, archive (migration 0013), favorites, recent, shared with me, department/project/company views, recycle bin, legal hold, purge with typed confirmation | New | E2E (versions, recycle bin, audiences) + Manual | Storage keys are `<workspace>/files/<file>/…`. |
| File links to spaces, departments, projects, tasks, tickets, assets, PRs, POs, vendors, people, messages, pages, work orders | New | API | |
| Background jobs: D1 queue with idempotency keys, claim locks, retries with exponential backoff, dead-lettering, admin retry | New | E2E | No Cron Trigger: due jobs run right after the request that queues them and from a throttled sweep (every 30 s of traffic). |
| File processing: Uploaded → Queued → Scanning → Extracting/Transcribing → Summarizing → Ready / Partially processed / Failed / Retrying / Unsupported | New | E2E | Scan: EICAR, executables, scripts, extension/magic mismatch → quarantined to the recycle bin. |
| Audio/video: Whisper transcript with timestamps, VTT/SRT, editable transcript (original kept), short and detailed summary, key points, decisions, action items, questions, chapters, entities | New | E2E (mock Whisper) | Whisper has no speaker labels; they can be added when editing. Recordings over 25 MB are stored but not transcribed. |
| Documents: text/HTML/EML/CSV, DOCX/XLSX/PPTX, PDF text; summary with section citations, classification and tags; OCR via Workers AI when bound | Partial | E2E (text) | Scanned PDFs/images need the Workers AI binding; failures are reported, never fabricated. |
| Generated artifacts inherit the file's access | New | E2E | |
| Spaces as hubs at `#/spaces/:spaceId/:tab`: Overview, Announcements, Files, Pages, Projects, Tasks, Messages, Members, Calendar, Activity; company, department, project and custom spaces | New | E2E (hub API) + Manual | |
| Announcements: audience targeting, rich text and media, draft/publish, scheduling, expiry, pinning, priority, mandatory acknowledgement, read receipts, comments, reactions, notifications, version history and restore, approval, archive/restore, recycle bin | New | E2E | |
| Custom groups (Admin › Groups): create, edit, archive, restore, delete (refused while referenced), replace everywhere, owners, static members, dynamic rules, export, activity | New | E2E | Usable as audiences for files, pages, announcements, tasks, projects and channels. |
| Projects: types, templates, lifecycle builder (stages, transitions, required fields, approval gates), team and roles, plan records, WBS tasks, milestones, dependencies, critical path, baselines, Gantt/timeline, Kanban, list, calendar, risks, issues, decisions, changes, lessons, meetings, files, discussion, activity | New | E2E + Manual | |
| IT delivery records (requirements, epics, features, stories, bugs, sprints, releases, environments, tests, deployments) and site/service records (inspections, reports, defects, contractors, materials, equipment, certificates, handover, obligations, SLAs, RFQs) | New | E2E | Structured records with type-specific fields; no separate sprint board. |
| Project finance from linked records only (PRs, POs, receipts, returns, invoices, payments, expenses, forecasts, logged time) | New | E2E (exact figures) | Requisitions carry a project; conversion and receipt keep it; assets created at receipt are linked. |
| Tasks: personal, department, project, space, ticket and purchasing sources; subtasks, checklists, assignees, watchers, recurrence, reminders, approvals, dependencies with loop check, time tracking, workload, list/Kanban/calendar/timeline, bulk actions, CSV import/export | New | E2E + Manual | Task templates (personal, or shared by people who manage tasks) and server-side saved filters (migration 0013). |
| Messaging: company, department, project, space, group, custom, announcement-only channels, DMs and group DMs; threads, mentions, reactions, edit, soft delete, attachments via Files, voice notes, search, pins, bookmarks, read receipts, typing, unread counts, notification levels, moderation, reports, retention, export, audit | New | E2E + Manual | Near-real-time by polling (4 s open conversation, 15 s channel list). Presence (active in the last 3 minutes) and read receipts can each be switched off by administrators. |
| Connector levels: platform, company, department, personal; capability registry from granted scopes; least-privilege scope requests; pause/resume, conflict rule, background sync with retry/backoff/dead letter, logs, calls per hour | New | E2E (Microsoft mocks) | |
| Outlook / Microsoft 365 and Gmail / Google mailbox: inbox, folders, search, read, drafts, send/reply/forward, move/categorise/delete, calendar view and meetings, contacts, save attachments to Files, link to records, create task/ticket from an email | New | E2E (Outlook via local Graph mocks) | Real Microsoft/Google tenants were not available here. Consequential actions need confirmation, carry idempotency keys and are audited. |
| AI: summarize a space, file, thread; action items → draft tasks; project status, risks, finance, report, plan; related Outlook emails; overdue tasks; citations; permission-aware | New | E2E | Draft tasks are created only after the person confirms. |
| Offline banner while the browser has no connection | New | Manual | Requests made while offline fail with a clear message; nothing is queued. |

## Deferred / limitations

- **Row-level security**: D1 (SQLite) has none; isolation is enforced centrally in the API layer and covered by tests.
- **Background jobs**: Workers cron is not configured. File processing, scheduled announcements, reminders and connector syncs use the D1 job queue, which runs right after requests and from a throttled sweep driven by traffic; with no traffic, due jobs wait until the next request.
- **Real-time messaging** uses short polling, not WebSockets/Durable Objects.
- **OCR** for scanned PDFs and images needs a Workers AI binding (`AI`); without it those files are marked unsupported.
- **Speaker identification**: Whisper does not label speakers; labels can be added in the transcript editor.
- **Microsoft/Google** were verified against local mocks of their token and Graph endpoints, not against real tenants.
- **Stock concurrency**: two simultaneous issues of the last units could both pass the availability check.
- **Custom fields** were not supported before and are not added.
- **Email delivery** needs `RESEND_API_KEY` + `MAIL_FROM`; without it, links are shown once to the inviter.
- **Visual QA**: screenshots of the in-app browser were unreliable at emulated sizes; layout at 375 px was verified programmatically (no horizontal overflow on 10 main screens), desktop visually.
