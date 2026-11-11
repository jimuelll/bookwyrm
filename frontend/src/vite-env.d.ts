/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** e.g. https://abcd1234.supabase.co (Supabase dashboard → Project Settings → API) */
  readonly VITE_SUPABASE_URL?: string
  /** The publishable (anon) key. Safe in the browser; never put the secret/service_role key here. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** Our FastAPI backend, e.g. http://localhost:8000 */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
