/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NEON_AUTH_URL: string;
  readonly VITE_DATABASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

