// Ambient augmentation of process.env.
//
// Typing these keys lets us use dot-access (`process.env.NEXT_PUBLIC_SUPABASE_URL`)
// which is required for (a) Next.js build-time inlining of NEXT_PUBLIC_* vars into
// the browser bundle, and (b) passing the strict `noPropertyAccessFromIndexSignature`
// tsconfig rule (dot-access on an index signature is otherwise an error).
//
// The interface MUST be named `ProcessEnv` to merge with Node's `NodeJS.ProcessEnv`;
// `unicorn/prevent-abbreviations` is scoped off for `**/*.d.ts` so it doesn't try to
// rename this external/ambient contract. Not `readonly` — process.env is mutable and
// tests toggle vars. `INGEST_API_KEY` is optional (the ingress key may be unset).

declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_SUPABASE_URL: string;
    NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    SUPABASE_SERVICE_ROLE_JWT?: string;
    INGEST_API_KEY?: string;
    BASE_URL?: string;
  }
}
