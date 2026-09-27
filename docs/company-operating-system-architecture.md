# One Workspace company operating system architecture

Status: implementation audit and target architecture, updated 2026-09-27. This document distinguishes deployed code from planned interfaces; it is not a certification that the full mission in the supplied brief is complete.

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

## Migration and operations strategy

- Preserve D1 data. Add schema only through a new, forward-only numbered migration and update `db/schema.ts` plus Drizzle metadata; never reset a company database to make tests pass.
- Apply local migrations to a disposable test database first, then verify upgrades against a copy of representative existing data. Remote migration/deployment requires a separate operator checkpoint.
- Queue long operations through the existing D1 job abstraction; use idempotency keys, bounded batches, leases, exponential backoff, observable dead letters and a documented retry path. Add Cron only as a deployment configuration change with owner approval.
- Keep provider credentials in the existing encrypted-secret boundary or platform secret manager. Add required environment variables to deployment documentation without committing values.
- Required checks: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build`, and `npm run test:e2e` against an isolated test database plus local mock services. Browser verification must exercise at least one real path per foundation and a negative cross-tenant/permission case.

## Known limitations and next phases

1. Complete and independently acknowledge graph/event consumers; add domain event producers for each source mutation and tests for retries, duplicate delivery, and stale-worker recovery.
2. Extend Workspace Studio's initial secure record API into DB-enforced constraints, full form authoring, preview/test execution, approval engine, workflow/automation executor, and complete record editing UI.
3. Implement governed agent lifecycle, tool policies, identity-scoped runner, approval inbox, kill switch and eval gates; wire events only after the authorization/approval path is test-covered.
4. Complete connector modes, provider manifests, source permission lineage, scheduled full/incremental sync and action verification.
5. Run full regression, security, accessibility, performance and migration-upgrade tests; perform a route-by-route tenant/authorization review before making enterprise-readiness claims.
