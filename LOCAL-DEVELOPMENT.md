# Developing One Workspace locally

Requires Node.js 22.13+. On Windows, if PowerShell blocks `npm.ps1`, use `npm.cmd`.

```bash
npm ci
npm run build
npm run db:migrate:local   # applies new drizzle/*.sql migrations to .wrangler/state (never resets it)
npm run seed:local         # optional, idempotent: sample people and records
npm run dev
```

Open http://localhost:5173.

**Platform Owner.** losharhammond@gmail.com has no password. Create `.dev.vars` (git-ignored) containing `PLATFORM_SETUP_TOKEN=<32+ random characters>`, restart `npm run dev`, and use **Platform Owner setup** on the sign-in screen.

**AI and connectors.** Add to `.dev.vars` (never commit it):

```
SECRETS_KEY=<32+ random characters, keep it stable>
GROQ_API_KEY=<your Groq key, optional>
```

Without `GROQ_API_KEY` the assistant shows "AI is not configured" unless a company connects its own provider in Admin › AI settings. Without `SECRETS_KEY`, saving connector credentials or AI keys is refused.

**Sample data.** The seed adds Procus test people (`admin@onews.test`, department heads, a buyer, staff) and a second company, **"Acme Foods (sample)"** (`admin@acme.test`), to check isolation. Sample accounts share the password `TEST_PASSWORD` from `scripts/seed-local.mjs`; the Platform Owner never gets one. Re-running the seed only adds what is missing: it never resets passwords, overwrites records or recreates a company you removed.

## Checks and tests

```bash
npm run typecheck
npm run lint
npm run test:unit          # permission rules (app/access-policy.ts)
npm run build
npm run test:e2e           # acceptance tests against the built Worker
```

`test:e2e` builds a throwaway database in `.wrangler/test-state`, starts local mock services (`tests/mock-services.mjs`: a Groq-compatible model, a company AI provider, a REST API and an MCP server) on port 8797 and the Worker on port 8799 with random `PLATFORM_SETUP_TOKEN`, `SECRETS_KEY` and test `GROQ_API_KEY`, then runs `tests/platform.test.mjs` and `tests/saas.test.mjs`. Nothing is sent to real external services. Your development database in `.wrangler/state` is never touched. On failure the Worker log is saved to `.wrangler/test-server.log`.

After adding a new icon name in `app/ui`, run `npm run icons`.

## Where things live

- `app/ui/` — the client: `shell.tsx` (navigation, sign-in, activation, workspace switcher, support banner), `platform.tsx` (Platform Console), `kit.tsx` (UI kit, grids, saved views, attachments, QR), one file per app.
- `app/access-policy.ts`, `app/role-templates.ts`, `app/modules.ts` — permissions, role baselines, module switches and plan limits (shared by browser and server).
- `app/server/core.ts` — sessions, workspace resolution, support sessions, `route()` wrapper, audit; `auth.ts` — rate limits, sessions, one-time tokens; `policy.ts`/`entities.ts` — record visibility; `tenancy.ts` — workspace provisioning; `stock.ts` — inventory movements.
- `app/api/` — route handlers; every query is filtered by the server-side workspace.
- `db/schema.ts`, `drizzle/` — schema and migrations.
- `tests/` — acceptance (`platform.test.mjs`) and unit tests; `scripts/test-e2e.mjs` runs them.
- `docs/feature-matrix.md` — feature status.

Never commit `.env*`, `.dev.vars` or `scripts/nvr/private`.
