declare namespace Cloudflare {
  interface Env {
    ASSEMBLYAI_API_KEY?: string;
    GROQ_API_KEY?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
    APP_ORIGIN?: string;
    DATA_IMPORT_TOKEN?: string;
    // One-time secret that lets the platform owner set their first password (see /api/platform/claim).
    PLATFORM_SETUP_TOKEN?: string;
    // Optional transactional email (https://resend.com). Without it, notifications stay in-app.
    RESEND_API_KEY?: string;
    MAIL_FROM?: string;
    // 32+ random characters; encrypts connector and AI provider secrets at rest.
    SECRETS_KEY?: string;
    // Development/testing only: point the platform Groq provider at an OpenAI-compatible endpoint.
    AI_GROQ_BASE_URL?: string;
    // Optional: Workers AI (embeddings) and Vectorize (vector index), bound when D1/AI setup is done.
    AI?: unknown;
    VECTORIZE?: unknown;
  }
}
