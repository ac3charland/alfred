// Ambient augmentation of process.env.
//
// Typing these keys lets us use dot-access (`process.env.NEXT_PUBLIC_SUPABASE_URL`)
// which is required for (a) Next.js build-time inlining of NEXT_PUBLIC_* vars into
// the browser bundle, and (b) passing the strict `noPropertyAccessFromIndexSignature`
// tsconfig rule (dot-access on an index signature is otherwise an error).
//
// The interface MUST be named `ProcessEnv` to merge with Node's `NodeJS.ProcessEnv`;
// `unicorn/prevent-abbreviations` is scoped off for `**/*.d.ts` so it doesn't try to
// rename this external/ambient contract.

declare namespace NodeJS {
  interface ProcessEnv {
    readonly NEXT_PUBLIC_SUPABASE_URL: string;
    readonly NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
    readonly SUPABASE_SERVICE_ROLE_KEY: string;
    readonly SUPABASE_SERVICE_ROLE_JWT?: string;
    readonly INGEST_API_KEY: string;
    readonly BASE_URL?: string;
  }
}
