# One Workspace feature matrix

Status key: **Working** (existed before and still works) · **New** (implemented in this change) · **Partial** (implemented with the limits noted) · **Deferred** (not built, with the reason).

"Verified" names how it was checked: **E2E** = automated acceptance test (`npm run test:e2e`), **Unit** = permission unit test (`npm run test:unit`), **Manual** = exercised in the browser against the built Worker, **API** = called directly during development.

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

## Deferred / limitations

- **Row-level security**: D1 (SQLite) has none; isolation is enforced centrally in the API layer and covered by tests.
- **Background jobs**: Workers cron is not configured, so maintenance work orders and reorder alerts are generated on activity, not on a timer.
- **Stock concurrency**: two simultaneous issues of the last units could both pass the availability check.
- **Custom fields** were not supported before and are not added.
- **Email delivery** needs `RESEND_API_KEY` + `MAIL_FROM`; without it, links are shown once to the inviter.
- **Visual QA**: screenshots of the in-app browser were unreliable at emulated sizes; layout at 375 px was verified programmatically (no horizontal overflow on 10 main screens), desktop visually.
