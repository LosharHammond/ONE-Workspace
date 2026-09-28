# One Workspace company operating system architecture

Status: implementation audit and target architecture, updated 2026-09-28 with capabilities 5–8 (Universal Work Inbox, Request-to-Outcome lifecycle, Goals-to-Execution, Company Knowledge Intelligence). This document distinguishes deployed code from planned interfaces. It is not a certification of production readiness.

Latest verification on 2026-09-28 (isolated test database, local mocks for AI and connectors):

- e2e: platform 12/12, SaaS 24/24, collaboration 20/20, operating system 24/24, capabilities 5–8 21/21;
- unit tests 6/6;
- typecheck clean;
- lint 0 errors (304 warnings, none in the new capability files).

Migration 0016 was upgrade-tested on a copy of existing data.

## Current architecture

- One Workspace is a React application built through Vinext/Vite and served on Cloudflare Workers. API route handlers share server helpers in `app/server`; data is held in Cloudflare D1/SQLite and file objects use the existing file-storage integration. The production bindings and external provider registrations are environment-specific.
- A global identity may have memberships in several companies. `sessions` point to a membership; `requireUser` derives `tenantId` from that membership, or from an open, audited Platform Owner support session. Company APIs should bind every query and write to that value. The client must not select a tenant by sending an ID.
- Authorization combines page entitlements, role/action rules, record scopes, and module-specific checks. D1 does not provide row-level security; authorization is enforced by application services. Platform-level workspaces and connector settings use separate owner checks and platform audit records.
- The existing product has operating modules (people, projects, tasks, tickets, purchasing, assets, inventory, maintenance, files, spaces, messages and reports), a code-defined page/widget builder (`/api/app-pages`), a provider-backed ONE assistant, connector management and a D1 background-job queue. Workspace Studio is a separate proposed metadata application layer; it is not the existing page builder under a new name.
- Migrations are forward-only and ordered in `drizzle/`. Migration 0014 adds Work Graph, Studio, agent, connector-run and event-projection tables. Existing changes in this checkout are intentionally preserved; do not reset the database or rewrite migration history.

## Target connected architecture

```text
Source modules ──transactional audit/outbox──> Domain events
      │                                         ├──> Work Graph projections
      │                                         ├──> Studio workflow/automation runs
      │                                         └──> governed agent triggers (draft/approval)
      ├── authorized reads ──> connector fabric (sync | federated | action)
      └── authorized source records ──> AI retrieval with provenance

Every branch is scoped to the authenticated tenant and actor, permission-checked at execution,
idempotent where retried, observable, and recorded in the company audit trail.
```

The D1 implementation is deliberately an abstraction boundary: callers use `app/server/graph.ts`, not graph SQL. A dedicated graph store is not justified by the current workload and is not introduced.

## Data model and security boundaries

### Work Graph

Migration 0014 defines `graph_nodes` and `graph_edges`. Nodes contain tenant, source type/ID, display fields, owner, department/location, module/source URL, classification, search text, external provider/ID, sync mode, verification time and metadata. Edges contain tenant, source/target node IDs, relationship type, origin, creator, optional confidence, effective/expiry times, metadata and removal time. Unique source and edge indexes make projection upserts repeatable. Source records remain authoritative; graph rows are projections, never authorization grants.

`projectRecord` maps selected source tables to nodes and typed edges. `syncNode` retires stale event-derived edges and reprojects from the source. `visibleNodes` checks each candidate against the source module's current visibility rule; traversal omits inaccessible nodes and does not use them as stepping stones. `context`, `explainPath`, `searchNodes`, and `browseNodes` are the reusable query layer. The new `/api/graph` endpoint takes no tenant parameter and requires both graph-page entitlement and graph permission. The Work Graph screen is available at `#/graph`; it provides authorized search/browse, type filtering, depth control, and a linked-record context list. Project overview and asset context screens also expose permission-checked connected-work panels backed by the same graph API. Opening a source record reprojects its root from authoritative data; project and asset projections include the current direct relationship chains used by those panels.

Graph coverage is incomplete: the projector handles many key records, not every entity in the brief; event emission is not yet guaranteed for every module mutation; graph rendering is a list/context view rather than an interactive network, timeline, saved-view or export experience. Relationship editing, Graph-aware search across external sources, and a full repair/rebuild administration UI still need implementation and tests.

### Events and jobs

`domain_events` is an outbox/dead-letter table. An audit insert trigger creates an event, `core.route` kicks the processor after writes, and the D1 jobs queue provides idempotency keys, locking, exponential retry and dead-letter status. Events are currently delivered with `waitUntil` and a traffic-driven sweep; no Worker Cron schedule is configured. Event claims now use a five-minute `processed_at` lease so an abandoned `processing` event can be reclaimed. Projections and consumers must remain idempotent because a worker can fail after an effect but before acknowledging its event.

Studio now inspects published app definitions when record-created/updated/status-changed events arrive. If an enabled matching automation exists, the outbox event is marked `deferred` with an explicit reason rather than falsely marked `done`; unrelated events complete normally. Admin Work Graph responses surface deferred and failed event counts. Agent event triggers are not part of the current agent definition, so the agent consumer explicitly reports no configured event work; agents remain manual-run only. Per-consumer durable run rows and an operator retry/review UI are still needed before deferred automation execution can be enabled.

### Workspace Studio

Migration 0014 defines tenant-owned app drafts, immutable version rows, records and record versions, templates, approvals and automation-run metadata. `app/studio-def.ts` defines allow-listed JSON metadata (field types, forms, workflows, triggers, conditions, reports) and safe formula/workflow validation; no arbitrary JavaScript is part of that definition. New `/api/studio` supports tenant-scoped app listing/detail, draft creation and optimistic-concurrency saves, metadata validation, immutable publish, immutable rollback-as-new-version, and archive/deprecate lifecycle. `/api/studio/records` now supports published-app record listing and form submission, typed required-field validation, role-filtered fields, table/workspace scope intersection, optimistic updates, soft deletion, record-version history, and audit rows. The Studio UI exposes the published table's recent records and basic form entry. This is an initial record runtime, not a complete Studio: unique constraints are not DB-enforced, edit/delete UX is absent, and relationship/file/repeating fields, approval runtime, workflow execution, automation execution and dashboards are not implemented. The existing visual page/widget builder (`app/ui/builder.tsx` and `/api/app-pages`) is separate and does not satisfy those missing Studio capabilities.

The implemented publication path validates metadata, saves immutable app-version rows and restores prior definitions as new versions. The current validation is structural; it is not a security evaluation of executable workflow actions because action/workflow execution is intentionally not active. Member-facing app definitions and record responses omit tables/fields blocked by role visibility metadata; record writes enforce field permissions and optimistic versions. The editor is an initial form/table-definition surface rather than a complete no-code builder. DB-enforced unique values, full multi-table form authoring, application approval policy, record editing UI and workflow/automation engines remain required before Studio can be described as enterprise-ready no-code development.

### Governed AI workforce

The existing `app/server/ai.ts` is a provider abstraction for the ONE assistant, with company provider selection before the platform Groq default, server-side secrets, and normalized provider requests. Permission-aware retrieval exists for supported source modules. The migration adds tenant-scoped `ai_agents`, versions, runs, tool calls, approval and evaluation rows, including a kill flag. `/api/agents` provides draft/publish, requester-bound read-only runs and a kill switch, but the runner has no tool gateway, human-gated mutations, evaluation gates or event-trigger definitions. Agent runs are manual only. The ONE assistant is not equivalent to a fully governed workforce.

Target agent runs must snapshot an immutable agent version and an explicit requesting-user or restricted service identity; resolve permissions again for each retrieval and tool call; enforce a tool allowlist, step/time/token/cost budgets and kill switch; redact sensitive values from logs; require a human gate before consequential effects; and store citations/provenance and an auditable run record. Platform Owner identity is never inherited by an agent.

### Connector fabric

`app/server/connectors.ts`, the connector catalog/capability registry, `/api/connectors`, OAuth routes, secrets service and `connector-jobs.ts` provide existing connector management and integrations. Connector secrets are encrypted server-side and are not intended for browser responses. The product currently supports selected Microsoft/Google OAuth surfaces, REST, webhooks and MCP operations, with tests using local provider mocks. MCP mutations now create encrypted, requester-bound proposals; the UI displays the exact arguments, explicit confirmation atomically claims the pending row for a single dispatch, cancellation is persisted, and the connector history distinguishes remote success from independent verification. SaaS E2E covers encryption, cancellation, confirmation and replay refusal. Migration 0014's action-run table and this partial action flow do not alone guarantee three-mode behavior.

The target contract makes mode explicit per installed connector: (1) synced, with incremental/full synchronization, checkpoint, source ACL mapping, deletion propagation and lineage; (2) federated, with live source checks, explicit no-index behavior and citations; and (3) action, with validated declared operations, remote idempotency, approval, result verification and recovery guidance. The current MCP proposal supports a local one-dispatch guard, not a remote idempotency guarantee; remote outcome verification and safe recovery are still required. Reference provider coverage and permissions must be documented per operation. Do not claim a provider supports an operation solely because OAuth or an MCP tool can connect.

## Capabilities 5–8 (migration 0016, 2026-09-28)

Migration `0016_request_to_outcome.sql` is forward-only (35 tables, new nullable columns, two ledger triggers, and data fixes that only fill new columns). It was applied to a copy of the development database holding existing tenants, members, purchase documents, assets, projects and files; row counts were identical before and after.

### 5. Universal Work Inbox

- **Projection, not a copy of authority.** `app/server/inbox.ts` holds one adapter per source type (PR/PO, task, ticket, project stage, project record, work order, page acknowledgement, Studio record approval, AI approval, connector action and health, automation failure, invoice exception, vendor, stock, maintenance plan, contract renewal, decision review, check-in, business request, lifecycle stage, service delivery, outcome review, knowledge review, question, AI suggestion). Each adapter computes the desired items for a source record; `syncSource` upserts on `(tenant, recipient, dedupe_key)` and closes items that no longer apply. Notifications (mentions, messages, comments, alerts) become informational items.
- **Delivery.** The domain-event consumer calls `inbox.onDomainEvent`. Sources that do not write audit rows emit `inbox` events. Background jobs: `inbox.rebuild`, `inbox.sync`, and the hourly `inbox.sweep`, which runs SLA escalation, reminders, retention and a 06:00 UTC digest.
- **Read-time authorisation.** Every listed item is re-checked against its source through Work Graph `visibleNodes` or the module's own rule. Delegated items are also checked against an active delegation. Counts use the same filtered set, so hidden work never affects a number.
- **Actions go through the source module.** Approve, reject, request changes, complete, acknowledge, assign, delegate, escalate, comment, follow up and retry are dispatched to the owning module's POST handler (`app/server/dispatch.ts`) with the caller's own session. Before dispatch, an optimistic version check compares the source version the user saw with the current one; after dispatch the item is re-projected and the action is audited. Read, snooze, remind and dismiss are personal and never change the source.
- **Delegation** (`app/server/delegation.ts`):
  - date-bounded, and the end must be in the future;
  - scoped by module, item type or a single record;
  - no chains and no circular delegation;
  - company policy (switch, maximum days) is read from `inbox_rules`;
  - `actingFor` is honoured by purchasing, Studio, lifecycle, decision and knowledge-review approvals, and records "on behalf of" in the audit;
  - a requester still cannot approve their own request through a delegation.
- **AI** (`ai-prioritize`, `ai-draft`) ranks only the viewer's authorised items and drops any id the model invents. Each item carries its rule-based evidence. The AI never acts: the response states that nothing was approved, sent or changed, and drafts are returned for the user to edit.

### 6. Request-to-Outcome lifecycle

- **Templates and requests.** `lifecycle_templates` holds versioned stage definitions (8 built-in: physical project, service delivery, IT project, procurement, asset acquisition, maintenance, internal improvement, custom). Each request copies its template's stages, so editing a template never changes requests already in flight.
- **Stage kinds.** Intake, business case, review, approval, goal, project, budget, requisition, RFQ, quotations, evaluation, order, receipt, asset, deployment, service, measurement, outcome and closure. Automatic stages complete when their linked record reaches the required state (`evaluate`, re-run from domain events).
- **Approval gates:**
  - any / all / quorum modes, with conditional steps;
  - a finance step above a threshold;
  - request changes (returns the stage) and reject;
  - delegation-aware decisions;
  - the requester can never approve.
- **Business case figures** (total cost, net benefit, ROI, payback) are computed only from entered cost lines and annual benefit. Each figure shows its formula and lists missing inputs; nothing is estimated.
- **Linked records are created by their owning modules** through dispatch: project, budget and requisition. Services, benefits and measurements, and outcome reviews (expected vs actual, ledger result, follow-up tasks, key-result lineage) are also supported.
- **Purchasing additions:**
  - partial conversion of a PR into several POs (`ordered_qty` per line);
  - change orders, where increases go back through approval;
  - vendor invoices with a three-way match against the tenant tolerance (`invoiceTolerancePct`, default 2 %), with exceptions routed to the inbox;
  - exception approval and payment recording (no money is moved);
  - per-unit asset details on receipt (serial, custodian, location, warranty, maintenance plan) and service acceptance.
- **Traceability.** `trace` walks from a request to every connected record, each filtered through Work Graph permissions (hidden records are only counted). `rootOf` starts from any asset, PO, PR, project, budget or service. `assetLineage` answers:
  - why the asset was bought;
  - funding and approvers;
  - vendor and PO, and who received it;
  - custodian and location;
  - tickets and maintenance;
  - warranty days left;
  - lifetime cost;
  - a replacement recommendation with its stated reasons.

### Financial traceability model

`financial_events` is an append-only ledger; UPDATE and DELETE triggers abort. `app/server/finance.ts` reconciles each source into signed deltas per (source, measure, project, budget, request, line, currency), so re-running a reconcile is idempotent and corrections are new rows.

- **Measures:** proposed, budget, contingency, requested, committed, ordered, received, invoiced, paid, expense and forecast adjustment.
- **Derived figures:** actual = received + expenses + labour; forecast = actual + committed + adjustments.
- **No double counting.** A requisition counts once as *requested*. Its POs count as *ordered*; the unreceived part of an order counts as *committed*. A document linked through both a project and a request is still one source. `measureSources` lists the records behind any figure. `projectFinance` in collaboration now reads from the ledger with the same output shape.

### 7. Goals-to-Execution

- **Hierarchy.** Strategy records are Work records of kinds strategy, theme, goal, objective, key result, initiative and programme. They support multiple parents, versions (`work_record_versions`), publication and acknowledgement. Projects, milestones and tasks attach through initiative `projects` references.
- **Visibility** adds leadership, groups, confidential and partner audiences (`acl_json`), enforced in `canSeeWork`. It therefore applies to the tree, item pages, rollups (hidden contributors are counted as missing), review packs (re-filtered for the reader), the Work Graph, knowledge search and agent tools.
- **Rollups** (`app/server/strategy.ts`) return:
  - progress, the calculation method and the source records with weights;
  - missing data;
  - any manual override with its reason;
  - confidence, health and the health basis;
  - last-updated time.

  Key results take values manually or from project, purchasing (ledger), asset, report, Studio and connector sources, read with the owner's permissions. Every value is stored in `progress_updates` with its lineage. AI recommendations stay drafts until the owner accepts them.
- **Check-ins, review packs and planning:**
  - AI-drafted check-ins cite authorised evidence and remain drafts;
  - review packs: weekly, monthly, QBR, executive and department;
  - portfolio filters and views;
  - privacy-aware capacity.
- **Scenarios** are private drafts. They move to submitted, then approved by another planner or an administrator, then applied. Applying uses dispatch to the owning modules, and evaluation never writes to live records.

### 8. Company Knowledge Intelligence

- **Sources and pipeline.** `knowledge_sources` registers files, pages, projects, tasks, tickets, messages, work records (meetings, decisions, contracts, strategy), purchase documents, assets, requests, Studio records and connector records. The `knowledge.process` job moves each through security scan, extracting, OCR/transcribing, classifying, summarizing, embedding and indexing, ending ready, partial, failed, retrying, unsupported, expired or removed.
  - Idempotent by content hash, with duplicate detection.
  - Per-stage history and cost in `knowledge_jobs`, with retries and backoff.
  - Manual reprocess and administrator rebuild.
  - Password-protected PDF and Office files are reported as unsupported rather than guessed at.
- **Grounded extraction.** Key points, decisions, action items, dates, risks and obligations must each carry a quote that appears verbatim in the source text; anything else is dropped and the drop is reported. Human corrections are kept in `artifact_versions` next to the machine version. Decisions, action items, relationships and tags become `knowledge_suggestions` that a person approves; approval creates the record through its module.
- **Query-time permissions.**
  - Search, autocomplete, facets and related items are computed over `visibleSources`. That uses the Work Graph node check, with a direct file, page and work-record check for items not yet projected.
  - Counts and facets only include permitted results.
  - Natural-language questions fall back to ranked any-term matching (stop words removed).
  - AI answers are built only from the asker's visible results. Citations are re-checked for each reader.
- **Freshness** (`knowledge.sweep`) creates owner-assigned reviews for items that are due for review, expiring or expired, stale policies, unverified AI content, broken links and conflicts. Each review also appears in the owner's inbox.
- **Decision Register.** Decisions are Work records (Proposed → Under review → Approved/Rejected → Implemented/Superseded/Expired). The dossier answers why the decision was made, who approved it, what evidence supported it, which work it affected, whether it was implemented and whether it was later changed.
- **Questions** carry the labels Verified answer, AI-generated answer, Expert answer or Unanswered. They support accept, verify, escalate, feedback, correction requests and conversion to a draft article.

### Integration with the Work Graph, Studio, AI and connectors

- **Work Graph:** node types request, service delivery and outcome review; strategy kinds; relationships `requested_by` and `superseded_by`; files linked to work records.
- **Studio:** actions `create_request` and `record_progress`. Triggers: `request_submitted`, `lifecycle_stage_changed`, `key_result_updated`, `decision_approved`, `knowledge_review_due` and `inbox_escalated`. A failed automation creates an inbox item.
- **Agent tools:**
  - read tools: `inbox_summary`, `trace_record`, `analyze_objective`, `search_company_knowledge`, `detect_stale_knowledge`;
  - approval-gated mutations: `draft_decision`, `draft_check_in`;
  - connector tools require the connector's `allowAgents` policy.
- **Widgets:** requests, objectives, decisions and knowledge reviews.
- **Connectors:** synced records can be marked for action (they enter the person's inbox) and can feed key results.

## Permission, tenant and audit model

1. Resolve the session to one active company membership or a live Platform Owner support session on the server.
2. Check page entitlement and page/action permission; then apply record, department, location, group, project/space, content ACL and connector-source rules appropriate to the source.
3. Bind every SQL statement, object path, graph query, job, connector call and AI retrieval namespace to the resolved tenant. Reject or ignore browser-supplied tenant IDs; never use them to expand authority.
4. Authorize graph nodes against their source records at read time. A visible edge cannot disclose a hidden endpoint or permit traversal through it.
5. Record actor, tenant, support-session context, action and outcome. Never log provider credentials, raw authentication tokens, or full sensitive payloads.
6. Consequential AI and connector mutations require a persisted human decision tied to the exact proposed action/input before dispatch.

These rules are the design contract, not proof that every current route satisfies all six. Route-by-route audits and cross-tenant tests remain required, especially for new Studio/agent/connector executors.

## Implementation status

| Foundation | Present in checkout | Verified now | Main remaining work |
|---|---|---|---|
| Tenant/auth/permissions | Membership-derived tenant, owner/support-session model, access policy and existing per-module APIs | Typecheck/build and full isolated E2E: platform 12/12, SaaS 24/24, collaboration 20/20; unit tests 6/6 | Route-by-route audit; DB constraints where safe; feature-specific scope tests |
| Work Graph | Migration 0014 schema, projections, source authorization, traversal, search, new API/explorer and chunked initial bootstrap | Typecheck/build; browser visibly showed 5 authorized connected project records; isolated E2E verified project and asset relationship chains plus cross-tenant search/source-ID denial | Broader emit coverage, full entity matrix, visualization/timeline/saved views/export, graph rebuild/runbook |
| Workspace Studio | Forward migration/schema, declarative definition validator, tenant-scoped app lifecycle, initial metadata-backed record API and basic published table/form UI | Typecheck/build; SaaS E2E covers app/record tenant isolation, required-field checks, own-scope filtering, hidden fields, immutable publish, draft edit and rollback-as-new-version | DB-enforced unique constraints, richer form and record editing UX, file/relationship/repeating fields, preview/test execution, dashboards, workflow/approvals/automation engines, natural-language workflow authoring, connector binding |
| Governed AI workforce | ONE/provider layer and agent API/UI, immutable versions, identity-bound read-only runner, citations and kill switch | Browser page renders; SaaS E2E passed agent test covering tenant/private visibility, requester identity, read-only behavior, immutable version and kill-switch | Approval-gated actions, tool gateway, evaluations, event-triggered execution, Control Tower |
| Connector fabric | Connector management, encrypted secrets, selected providers, webhooks/MCP and persisted requester-bound action confirmation | Typecheck/build and mock SaaS E2E cover proposal sealing, exact UI review, cancellation and replay refusal; no live tenant provider verification | Explicit three-mode manifest/runtime, ACL/deletion-aware sync, federated retrieval, external result verification/recovery and reference-provider limits |
| Universal Work Inbox | Source adapters, projection, delegation, SLA/escalation/digest sweep, source-module actions with version check, AI ranking (no actions) | `tests/ops.test.mjs` scenarios 1–5; browser run | Per-user notification channel preferences beyond email/in-app; very large inboxes use offset paging |
| Request-to-Outcome lifecycle and financial ledger | Templates, stage engine, approval gates, business case, partial conversion, change orders, invoices/three-way match, receipts with asset details, services, benefits, outcome reviews, trace and asset lineage; immutable ledger | ops scenarios 6–14; collaboration finance figures unchanged; browser run | Payments are recorded, not executed; no multi-currency conversion (figures are per currency) |
| Goals-to-Execution | Strategy hierarchy, extended visibility, explained rollups, KR data sources with lineage, check-ins (AI drafts cited), review packs, portfolio, capacity, scenarios | ops scenarios 15–18; browser run | Connector KR values need an agreed numeric resource per provider |
| Company Knowledge Intelligence | Pipeline with job history and cost, grounded extraction, query-time permission search/facets/autocomplete, freshness reviews, Decision Register, questions and cited answers, taxonomy and retention | ops scenarios 19–27; browser run | OCR/transcription quality depends on the configured provider; semantic ranking needs an embedding provider (keyword search otherwise) |

## Migration and operations strategy

- Preserve D1 data. Add schema only through a new, forward-only numbered migration and update `db/schema.ts` plus Drizzle metadata; never reset a company database to make tests pass.
- Apply local migrations to a disposable test database first, then verify upgrades against a copy of representative existing data. Remote migration/deployment requires a separate operator checkpoint.
- Queue long operations through the existing D1 job abstraction; use idempotency keys, bounded batches, leases, exponential backoff, observable dead letters and a documented retry path. Add Cron only as a deployment configuration change with owner approval.
- Keep provider credentials in the existing encrypted-secret boundary or platform secret manager. Add required environment variables to deployment documentation without committing values.
- Required checks: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build`, and `npm run test:e2e` against an isolated test database plus local mock services. Browser verification must exercise at least one real path per foundation and a negative cross-tenant/permission case.

## Known limitations and next phases

Capabilities 5–8 (verified 2026-09-28):

- **Scheduling.** Sweeps (inbox SLA/digest, strategy key-result sync and check-in reminders, knowledge freshness and retention) are hourly keyed jobs. Requests enqueue them, and each job re-schedules itself. No Worker Cron trigger is configured, so an idle company is swept on its next request; adding a Cron trigger is a deployment change.
- **Money.** Payments are recorded against invoices; nothing is transferred. Ledger figures are per currency, with no FX conversion. Invoice matching is at document level (ordered/received/invoiced totals within the tolerance), not per line.
- **Semantic search** needs an embedding provider. Without one, search is keyword-based (the item is noted, not marked partial). OCR and transcription quality depend on the configured provider.
- **Connector key results** need a numeric value from the connector record's metadata; there is no per-provider metric mapping yet.
- **Local dev sign-out.** After `POST /api/auth/logout` the local wrangler/workerd dev server stops answering. This reproduces on the previous commit too, so it is not a regression from this work; tracked separately.
- **Runtime fixes made during browser verification:**
  - the decision dossier attributed records reached through a person;
  - strategy child rows showed stale stored progress;
  - search excerpts were lower-cased;
  - work-record text included raw record ids;
  - question labels ignored answers;
  - a missing embedding provider marked every item "partial".

  All are fixed and re-tested.

Earlier foundations:

1. Complete and independently acknowledge graph/event consumers; add domain event producers for each source mutation and tests for retries, duplicate delivery, and stale-worker recovery.
2. Extend Workspace Studio's initial secure record API into DB-enforced constraints, full form authoring, preview/test execution, approval engine, workflow/automation executor, and complete record editing UI.
3. Implement governed agent lifecycle, tool policies, identity-scoped runner, approval inbox, kill switch and eval gates; wire events only after the authorization/approval path is test-covered.
4. Complete connector modes, provider manifests, source permission lineage, scheduled full/incremental sync and action verification.
5. Run full regression, security, accessibility, performance and migration-upgrade tests; perform a route-by-route tenant/authorization review before making enterprise-readiness claims.
