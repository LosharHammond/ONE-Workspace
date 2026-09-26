# Developing One Workspace locally

Requires Node.js 22.13+. On Windows, if PowerShell blocks `npm.ps1`, use `npm.cmd`.

```bash
npm ci
npm run build
npm run db:migrate:local   # applies drizzle/*.sql to the local database in .wrangler/state
npm run seed:local         # optional: test people and sample records (local only)
npm run dev
```

Open http://localhost:5173. The seed creates a Procus Ghana admin (`admin@onews.test`), department heads, a buyer and staff so you can walk a requisition through every approval step, plus a second company (`admin@acme.test`) to check tenant isolation, and gives the platform owner account (losharhammond@gmail.com) a local password. The shared test password is `TEST_PASSWORD` in `scripts/seed-local.mjs`.

## Checks

```bash
npm run typecheck
npm run build
```

After adding a new icon name in `app/ui`, run `npm run icons` to refresh `app/ui/icons.ts`.

## Where things live

- `app/ui/` — the client app: `shell.tsx` (dock, rail, command palette, notifications, sign-in), `kit.tsx` (UI kit, data grid, markdown), one file per app.
- `app/globals.css` — the design system (light and dark themes, brand accent from company settings).
- `app/access-policy.ts` — roles, custom-role rules, scopes (shared by browser and server).
- `app/server/` — session and tenant helpers (`core.ts`, including `PLATFORM_OWNER_EMAIL`), approval engine, notifications/email, visibility rules (`entities.ts`), tenant seeding.
- `app/api/` — route handlers; each filters by the signed-in member's tenant.
- `db/schema.ts`, `drizzle/` — schema and migrations (`0006` adds multi-tenancy and the new modules, `0007` the platform owner).
- `scripts/nvr/` — the local CCTV/NVR storage collector (`Setup-NvrCollector.ps1 -Portal https://<your address>`).

## Hosting

One Workspace is not connected to ChatGPT or OpenAI Sites. It deploys to your own Cloudflare account with Wrangler; see "Deploying" in `README.md`.

Never commit `.env*`, `.dev.vars` or `scripts/nvr/private`.
