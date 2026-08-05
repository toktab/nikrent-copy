/// <reference types="vite/client" />

/**
 * Declared so a typo in an env var name is a compile error rather than a
 * silent `undefined` at runtime. Both are optional: the app falls back to its
 * localStorage-only mode when they are absent.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
