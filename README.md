# One Workspace

A multi-tenant operating system for companies: people, assets, tickets, purchasing, files and department knowledge in one place. Each company is a **tenant** with strictly isolated data. The platform owner — **losharhammond@gmail.com, and nobody else** — provisions and suspends companies from the built-in Platform console.

One Workspace is independent: it has its own staff sign-in and no ChatGPT, OpenAI Sites or "Sign in with ChatGPT" integration.

Built with React 19 + [vinext](https://github.com/cloudflare/vinext) on Cloudflare Workers, D1 (SQLite) and R2 storage.

## Modules

| App | What it does |
|---|---|
| **Home** | Personal focus queue (approvals waiting on you, tickets assigned to you), company pulse, ticket and spend charts, announcements. |
| **Tickets** | Incidents and service requests with priorities, SLA due times, team queues, a drag-and-drop board, assignment, internal notes, @mentions and activity history. |
| **Purchasing** | Purchase requisitions → sequential approvals → purchase orders → issue to vendor (optional email) → goods receipt (partial/full, GRN numbers). Vendors, approval inbox, printable documents, configurable approval workflows. |
| **Assets** | IT and physical asset register with auto codes, assignment/return with hand-over notes, location tree, warranty tracking, linked tickets and full history. |
| **People** | Directory, org chart (from reporting managers), departments with heads, locations, and **Manage users** (bulk enable/disable, password reset, spreadsheet import). |
| **Spaces** | Intranet space per department plus a company space: Markdown pages, procedures, policies, research notes and announcements (announcements notify the space). |
| **Files** | Folders, versioned uploads up to 25 MB, company/department/private visibility, inline PDF and image preview. |
| **Operations** | Inventory, goods receipts and budgets registers, IT & CCTV (NVR) storage readings, consumer research recordings with AI transcripts. |
| **Admin** | Company settings and numbering, **Roles & permissions** (custom roles with a permission matrix and location scope), access overrides, data hub, activity log, platform console. |

Press **Ctrl + K** anywhere for the command palette (search across everything, jump, create). `g` then a letter jumps between apps; `?` lists shortcuts.

## Access model

- **Tenant isolation**: every business table carries `tenant_id`; every server query filters by the signed-in member's tenant. Suspended tenants cannot sign in.
- **Access levels**: Admin, Department Head, Standard User, Viewer (stored as `admin`/`manager`/`employee`/`viewer`).
- **Custom roles** (e.g. "PR User", "Purchase Head"): a role type plus a page × action matrix (`none`/`own`/`department`/`all`) and an optional asset location scope.
- **Overrides**: grant or deny one action for a person, an access level or a department. Precedence: person → custom role → access level in department → department → access level → defaults (`app/access-policy.ts`).
- All checks run on the server for every request; the browser only hides what you cannot do.

## Sequential approvals

`app/server/approvals.ts`. When a requisition or order is submitted, the most specific active workflow (department match, then highest minimum amount) is expanded into steps. Step approvers can be: the requester's reporting manager, the requesting department's head, the head of a named department, anyone with a custom role, any admin/department head, or a named person. Steps can apply only above an amount. Steps with nobody eligible are skipped and recorded; requesters can never approve their own documents; if no approver remains, administrators approve. Each transition notifies the next approver in-app (and by email when configured). Administrators can override a step; this is recorded.

## Configuration (site secrets)

| Secret | Purpose |
|---|---|
| `PLATFORM_SETUP_TOKEN` | Random secret (24+ characters) used once to set the platform owner's first password; remove it afterwards. |
| `RESEND_API_KEY`, `MAIL_FROM` | Optional email for approvals, assignments, comments and emailing POs to vendors. Without them, notifications are in-app only. |
| `ASSEMBLYAI_API_KEY`, `GROQ_API_KEY` | Research transcription and summaries. |
| `APP_ORIGIN` | Public origin for links in emails and webhook callbacks. |
| `DATA_IMPORT_TOKEN` | One-time bulk import endpoint (unchanged). |

## Upgrading from Procus One

Migration `drizzle/0006_one_workspace.sql` is additive:

- creates the `procus` tenant and assigns all existing rows to it;
- creates departments from existing staff, default PR/PO workflows, starter roles matching the AssetInfinity roles (PR User, PO User, Purchase Head, PR / Ticket Resolver, Technician, Jr. Admin, Stores, IT Employee) and a welcome announcement;

Migration `drizzle/0007_platform_owner.sql` creates the operator's own workspace ("One Workspace HQ") with the owner account **losharhammond@gmail.com** (no password yet) and clears any other owner flags. The owner is also hard-coded in `app/server/core.ts` (`PLATFORM_OWNER_EMAIL`), so no other account can reach the Platform console.

Existing sessions keep working (the old session cookie is still accepted). After deploying, an administrator can use **Admin → Data hub → Promote to live records** to turn the imported asset register, tickets, requisitions and purchase orders into live records, and **People → Manage users → Import** to load the AssetInfinity "List of users" export (roles, reporting managers, departments, locations). Imports never grant full Admin.

## Platform owner first sign-in

1. Add a `PLATFORM_SETUP_TOKEN` secret (24+ random characters) to the Worker.
2. Open the site, choose **Platform owner first-time setup** on the sign-in screen, enter the token and a password.
3. Sign in as losharhammond@gmail.com, then delete the `PLATFORM_SETUP_TOKEN` secret. Setup refuses to run once the owner has a password.

## Deploying (Cloudflare Workers)

```bash
npx wrangler login
npx wrangler d1 create one-workspace        # note the database_id
npx wrangler r2 bucket create one-workspace-files
D1_DATABASE_ID=<database_id> npm run build
npm run db:migrate:remote
npx wrangler secret put PLATFORM_SETUP_TOKEN --config dist/server/wrangler.json
npm run deploy
```

Set `APP_ORIGIN` to the public address once it is known. To keep the existing Procus data, export the current D1 database and import it into the new one before running the migrations.

## Local development

See `LOCAL-DEVELOPMENT.md`.
