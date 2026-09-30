// Ambient augmentation of process.env.
//
// Typing these keys lets us use dot-access (`process.env.NEXT_PUBLIC_SUPABASE_URL`)
// which is required for (a) Next.js build-time inlining of NEXT_PUBLIC_* vars into
// the browser bundle, and (b) passing the strict `noPropertyAccessFromIndexSignature`
// tsconfig rule (dot-access on an index signature is otherwise an error).
//
// The interface MUST be named `ProcessEnv` to merge with Node's `NodeJS.ProcessEnv`.
// Not `readonly` — process.env is mutable and tests toggle vars. `INGEST_API_KEY` is
// optional (the ingress key may be unset).

declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_SUPABASE_URL: string;
    NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    SUPABASE_SERVICE_ROLE_JWT?: string;
    INGEST_API_KEY?: string;
    // The session-ledger key — accepted only by the two ledger routes; unset rejects every keyed call.
    LEDGER_API_KEY?: string;
    BASE_URL?: string;
    // The Code Dashboard's GitHub measurements (over the projects' repos) — optional and
    // server-only; an unset token simply turns the feature off.
    GITHUB_TOKEN?: string;
    PR_RATIO_AUTHORS?: string;
    // Instapaper — all optional and server-only; any credential unset turns the Send verb off.
    INSTAPAPER_CONSUMER_KEY?: string;
    INSTAPAPER_CONSUMER_SECRET?: string;
    INSTAPAPER_ACCESS_TOKEN?: string;
    INSTAPAPER_ACCESS_TOKEN_SECRET?: string;
    INSTAPAPER_API_URL?: string;
    // The wiki writer — server-only; unset leaves the deployment read-only (every send
    // affordance hidden, the send routes answering 501). Never NEXT_PUBLIC_.
    WIKI_GITHUB_TOKEN?: string;
    WIKI_REPO?: string;
    WIKI_GITHUB_API_URL?: string;
    // Research — server-only; any of the three unset turns the feature off (no Research in the
    // Inbox, the research routes answering 501). Never NEXT_PUBLIC_.
    RESEARCH_ROUTINE_FIRE_URL?: string;
    RESEARCH_ROUTINE_FIRE_TOKEN?: string;
    RESEARCH_DELIVERY_KEY?: string;
  }
}
