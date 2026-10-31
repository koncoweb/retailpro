import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// e2e does NOT load .env on its own.
try {
  process.loadEnvFile();
} catch {
  // no .env — fall back to the shell environment
}

// Same defaults the demo seed and `npm run e2e:users` use, read lazily so a
// shell variable still wins over .env.
const staffPassword = () => process.env.E2E_STAFF_PASSWORD ?? 'Thalia2026!';
const ownerPassword = () => process.env.DEMO_PASSWORD ?? 'Thalia2026!';

// SumoPod exposes an OpenAI-compatible API, so any of its models can drive the
// agent. Swapping providers only needs E2E_AI_BASE_URL / E2E_AI_MODEL.
const sumopod = createOpenAICompatible({
  name: 'sumopod',
  baseURL: process.env.E2E_AI_BASE_URL ?? 'https://ai.sumopod.com/v1',
  apiKey: process.env.E2E_AI_API_KEY,
});

export default {
  // The Vite dev server compiles routes on demand, so the defaults (5s/30s/120s)
  // are too tight for a cold first hit in this app.
  assertionTimeout: 60_000,
  timeout: 300_000,
  actionTimeout: 180_000,
  retries: 1,
  // Tests share one API/demo tenant; concurrent workers would overwrite each other.
  workers: 1,
  // The sign-in roster for `tests/**/*.e2e.ts`, resolved through
  // `credentials.user(name)` from `tests/support/accounts.ts`. The password
  // stays an opaque Secret: only `locator.fill` and `agent.act` params accept
  // it, so it never reaches a log, a screenshot or the model. Each password is
  // also overridable without editing this file via E2E_USER_<NAME>_PASSWORD.
  credentials: {
    owner: { username: 'owner@tokobahankue.com', password: ownerPassword },
    admin: { username: 'e2e.admin@tokobahankue.com', password: staffPassword },
    kasir: { username: 'e2e.kasir@tokobahankue.com', password: staffPassword },
    gudang: { username: 'e2e.gudang@tokobahankue.com', password: staffPassword },
  },
  agents: {
    default: {
      model: sumopod.chatModel(process.env.E2E_AI_MODEL ?? 'deepseek-v4.1-flash:netra'),
      system: 'You are a thorough QA agent. Verify every outcome.',
    },
  },
  targets: [{
    engine: web(),
    app: {
      // `npm run dev` (SPA, port 8080) — start `npm run dev:api` alongside it so
      // /api is proxied and auth/session behaviour matches production.
      url: process.env.APP_URL ?? 'http://localhost:8080',
    },
  }],
} satisfies E2EConfig;
