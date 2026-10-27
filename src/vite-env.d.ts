/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Only needed when the SPA and the `api/` routes are served from different
   * origins (e.g. `npm run dev:spa` against `npm run dev:api`). In production
   * and under `vercel dev` both share one origin, so this stays empty.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
