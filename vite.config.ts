import vinext from "vinext";
import { defineConfig } from "vite";

// Cloudflare bindings used by the app: D1 database `DB` and R2 bucket `BUCKET`.
// Local development uses Miniflare storage in .wrangler/state. For a real deployment set
// D1_DATABASE_ID (from `wrangler d1 create one-workspace`) and optionally the names below.
const localBindingConfig = {
  name: process.env.WORKER_NAME || "one-workspace",
  main: "vinext/server/fetch-handler",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: [
    {
      binding: "DB",
      database_name: process.env.D1_DATABASE_NAME || "one-workspace",
      database_id: process.env.D1_DATABASE_ID || "00000000-0000-4000-8000-000000000000",
      // Resolved relative to the generated dist/server/wrangler.json.
      migrations_dir: "../../drizzle",
    },
  ],
  r2_buckets: [
    {
      binding: "BUCKET",
      bucket_name: process.env.R2_BUCKET_NAME || "one-workspace-files",
    },
  ],
};

export default defineConfig(async () => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
