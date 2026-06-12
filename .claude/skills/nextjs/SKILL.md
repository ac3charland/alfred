---
name: nextjs
description: >
  Covers Next.js App Router development (deployed to Vercel):
  routing decisions (route groups, layouts, dynamic segments), the Server vs Client Component
  boundary ("use client"), data-fetching patterns (async Server Components, fetch caching,
  Server Actions, Route Handlers), API route handlers under app/api/, environment variables,
  and Vercel deployment. Use when creating or modifying pages/layouts/routes, fetching or
  mutating data, adding API endpoints, wiring env vars, or deploying to Vercel. Do NOT use for
  Cloudflare Workers (workers/ package — use the cloudflare-workers skill) or Supabase schema
  migrations (database/ package — use the supabase skill).
---

# Next.js App Router Skill (alfred project)

> Sources: Next.js official docs (nextjs.org, canary branch); Vercel deployment docs
> (vercel.com/docs); Next.js GitHub discussions (vercel/next.js); makerkit.dev
> (MakerKit engineering, Server Actions vs Route Handlers guidance, 2024); Next.js 15
> upgrade guide (nextjs.org/docs/app/guides/upgrading/version-15).

---

## Mental Model

The App Router is a **server-first React tree**. Every file under `app/` renders as a
React Server Component (RSC) by default — no JavaScript is sent to the browser unless you
opt in with `"use client"`. Think of the app as a tree of components where the server
renders as much as possible, and `"use client"` draws a line: below this line, the subtree
ships a JS bundle and executes in the browser.

Three things are not obvious but are critical to debug correctly:

1. **"use client" marks a boundary, not a component type.** A Client Component is
   pre-rendered on the server too (for the initial HTML), then hydrated. It is not a
   "client-only" component — it is a component whose subtree owns a JS bundle.

2. **Server Components can be passed *into* Client Components as children/props.** A
   `<Sidebar>{serverComponent}</Sidebar>` works because the Server Component is already
   rendered before the Client Component receives it. The rule is: a Server Component
   *cannot be imported by* a Client Component file; it *can be passed as a prop* from a
   parent Server Component.

3. **Layouts are persistent; pages rerender.** When navigating between routes that share a
   layout, the layout component is *not* remounted — it keeps its state. Pages always
   rerender. This is why the root `app/layout.tsx` is the right place for auth guards and
   global providers.

**Alfred's topology:**
```
app/
  layout.tsx            ← root shell + auth gate (Server Component)
  (tasks)/
    layout.tsx          ← tasks module shell
    page.tsx            ← /  (tasks list)
    [id]/page.tsx       ← /abc-123
  (reader)/
    layout.tsx          ← reader module shell
    page.tsx            ← /reader
  api/
    items/route.ts      ← GET /api/items, POST /api/items
    items/[id]/route.ts ← GET/PATCH/DELETE /api/items/[id]
    tasks/[id]/
      complete/route.ts ← POST /api/tasks/:id/complete
    folders/route.ts
    ingest/route.ts     ← API-key-protected ingress endpoint
components/             ← shared UI (outside app/, no routing)
lib/                    ← Supabase client, shared hooks, utils
```

---

## Choosing the Right Approach

**Where does this logic live?**

```
Is it shared UI used by multiple routes?
  → components/ (plain React, no routing concerns)

Is it data fetching with no interactivity?
  → async Server Component — fetch directly, no route handler needed

Does it need useState / useEffect / browser APIs / event handlers?
  → "use client" Client Component

Is it a mutation triggered by a user action inside your own UI?
  → Generic Next.js: a Server Action ("use server").
  → In alfred: an optimistic store action → lib/api-client → a Route Handler (see the
    data-flow skill). alfred routes UI mutations through the same app/api/** endpoints as
    external ingress, not Server Actions — keep that path. (signOut is the auth exception.)

Is it an endpoint called by an external caller (webhook, Cloudflare Worker, API key client)?
  → Route Handler (app/api/.../route.ts)
  → This is the seam designed to later re-point at the Cloudflare Workers layer

Is it a data read needed on every request with no caching?
  → Server Component with fetch({ cache: 'no-store' }) or direct Supabase call

Is it a data read that can be cached / ISR?
  → Server Component with fetch({ cache: 'force-cache', next: { revalidate: N } })
```

> Source: Next.js GitHub discussion #72919 (vercel/next.js, 2024): "Server Actions are
> designed for mutations that update server-side state; they are not recommended for data
> fetching."

---

## Plain-English → Pattern Table

| When you say... | Pattern to use | Key things to know |
|---|---|---|
| "Add a new page/screen for the tasks module" | `app/(tasks)/page.tsx` — default export async Server Component | Route group `(tasks)` is transparent in the URL; `/` maps here. Keep `app/(tasks)/layout.tsx` for module-level chrome. |
| "Add a new future module (reader, etc.)" | `app/(reader)/layout.tsx` + `app/(reader)/page.tsx` | Each route group gets its own layout without affecting URLs. Root `app/layout.tsx` wraps all modules — put only truly global things (fonts, auth check) there. |
| "Show shared nav or persistent sidebar" | `app/layout.tsx` (root) or the module's `layout.tsx` | Layouts survive navigation — state is preserved. Use layout, not a per-page import, for anything that must not remount. |
| "Fetch data to render this page" | `async function Page() { const items = await getAllItems() }` — call a **server-only `lib/data/*`** reader, then seed it into a store | In alfred, Server Components read through `lib/data/*` (which wraps `lib/supabase/server.ts`), **not** inline `supabase.from(...)`. One home for read queries. See the data-flow skill. |
| "This component needs a click handler / useState / useEffect" | Add `"use client"` at the top of the file | Only add at the lowest subtree that needs it. The parent can remain a Server Component and pass data as props. Never add `"use client"` to a layout — it severs the server subtree for all routes. |
| "Pass server-fetched data into an interactive component" | Fetch in Server Component parent, pass as props to `"use client"` child | Server Components can import and render Client Components. Client Components cannot import Server Components (but can receive them as `children`). |
| "Add a GET/POST endpoint for the Supabase data layer (later re-pointed at Cloudflare)" | `app/api/items/route.ts` with named exports `GET`, `POST` using Web `Request`/`Response` | Route Handlers use the Fetch API (`Request`, `Response`, `NextResponse`), not Express-style `(req, res)`. Export named HTTP method functions only. |
| "Validate an API key on the ingest endpoint" | Read `Authorization` header in the Route Handler; compare to `process.env.INGEST_API_KEY` | Never use `NEXT_PUBLIC_` prefix for secrets. Server-only env vars are available in Route Handlers and Server Components with no prefix. |
| "Mutate data from a form or button in the UI" | An **optimistic store action** (`useFolderActions` / `useTaskActions`) → `lib/api-client` → Route Handler | alfred fronts its shared Route Handlers with an optimistic Context store — no `router.refresh()`, no Server Action for app data. See the data-flow skill. (`signOut` in `lib/auth/actions.ts` is a Server Action; auth is the exception.) |
| "Show a loading skeleton while the page fetches" | `app/(tasks)/loading.tsx` — automatic Suspense wrapper | `loading.tsx` wraps the page in `<Suspense>` automatically. For finer-grained streaming, use explicit `<Suspense fallback={<Skeleton />}>` around slow sub-components. |
| "Handle a 404 for a task that doesn't exist" | Call `notFound()` from `next/navigation` in the Server Component; add `app/(tasks)/not-found.tsx` for the UI | `notFound()` throws internally — call it after a null check on the fetched data. `error.tsx` must be `"use client"` and handles thrown errors; `not-found.tsx` handles explicit 404s. |
| "Redirect unauthenticated users to login" | Check session in `app/layout.tsx` (Server Component), call `redirect('/login')` from `next/navigation` | **Never rely on middleware alone** — always re-verify auth in Server Components / Route Handlers before touching data. The `x-middleware-subrequest` CVE-2025-29927 (CVSS 9.1, March 2025) proved middleware can be bypassed. |
| "Set metadata (title, og:image) per route" | Export `metadata` const or `generateMetadata` async function from the page/layout | `generateMetadata` can be async and fetch data. It runs before streaming — the `<head>` is always complete in the initial HTML even for streaming routes. |
| "Add environment variable for Supabase keys" | Server-only: `SUPABASE_SERVICE_ROLE_KEY` (no prefix). Client-safe: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Set all three in Vercel Dashboard → Project → Settings → Environment Variables. `NEXT_PUBLIC_` values are inlined into the browser bundle at build time — never put secrets there. |
| "Deploy to Vercel" | Push to main; Vercel auto-detects Next.js, zero config needed | Vercel adds no security headers by default — add `Content-Security-Policy`, `X-Frame-Options`, etc. via `next.config.ts` `headers()`. Serverless function timeout is 10s on free tier. |

---

## Client-side view switching without an RSC round-trip

When every view already renders from a client store (see the data-flow skill), navigating
between them with `<Link>` still pays a full RSC server round-trip per switch — there's nothing
to fetch, yet the page Server Component re-runs and the payload streams back (≈1s on Vercel).
To keep real URLs but make switching instant, drive navigation with the **native History API**:

- Next.js patches `window.history.pushState`/`replaceState` to sync `usePathname` /
  `useSearchParams` — it dispatches an internal `ACTION_RESTORE`, **not** a fetch (see
  `next/dist/client/components/app-router.js`). So `window.history.pushState(null, '',
  '/folders/abc')` updates the URL and every URL-deriving component with zero server work.
- Nav links stay real `<a href>` but intercept only a **plain primary click** and call
  `pushState`; modified/middle clicks and a hard load navigate natively (alfred's `ViewLink`,
  `components/tasks/view-link.tsx`).
- **One client component derives the view from the URL** (`usePathname` + a `?view` param) and
  renders it from the store (alfred's `TaskViews`), which *every* page in the module renders.
  Because all routes render that same URL-deriving component, it doesn't matter which server
  route is actually mounted after a `pushState` — the view follows the URL, and a hard load /
  deep link / refresh of any path still renders the right view server-side.
- A missing dynamic segment (e.g. an unknown folder id) becomes a **client-side** not-found
  rendered from the store, since the page no longer fetches it server-side.

---

## Callback / Lifecycle — Server Actions & Route Handlers

**Server Actions:**
- Defined with `"use server"` directive, either inline in a Server Component or in a
  separate `lib/actions.ts` file.
- Called from Client Components like regular async functions; Next.js generates a hidden
  POST endpoint automatically.
- Return values flow back to the component; throw an `Error` to surface as an error state.
- Use `revalidatePath('/path')` or `revalidateTag('tag')` inside an action to bust the
  Next.js cache after a mutation.
- Do not use Server Actions for reads — they send a POST and cannot be cached.

**Route Handlers (`app/api/.../route.ts`):**
- Export named HTTP method functions: `export async function GET(request: Request)`,
  `POST`, `PATCH`, `DELETE`.
- Return a `Response` object (Web Fetch API) or `NextResponse` from `next/server`.
- In Next.js 15, `GET` handlers are **not cached by default**. To cache: `export const
  dynamic = 'force-static'` or return `Response` with explicit `Cache-Control` header.
- To access `cookies()` or `headers()` inside a Route Handler in Next.js 15, `await` them:
  `const cookieStore = await cookies()`.

---

## Common Pitfalls

- **Never import a Server Component file from a Client Component file.** The `"use client"`
  boundary means everything imported by that file is treated as client-side code. Passing
  server output as `children` is fine; importing is not.

- **Never add `"use client"` to `app/layout.tsx`.** It would force the entire app tree
  client-side, defeating RSC. If you need a context provider, create a thin `"use client"`
  wrapper and render it inside the (Server Component) layout, seeded with server-fetched data
  as props — exactly how `app/(tasks)/layout.tsx` mounts `FoldersProvider` (see data-flow).

- **Never read server-only env vars in Client Components.** Variables without `NEXT_PUBLIC_`
  are replaced with `undefined` in the browser bundle — silently, with no build error.
  Always keep `SUPABASE_SERVICE_ROLE_KEY` and `INGEST_API_KEY` out of any `"use client"`
  file.

- **Never call `useRouter`, `usePathname`, `useSearchParams` in a Server Component.** These
  hooks are from `next/navigation` and are Client-Component-only. In Server Components, use
  `redirect()` for navigation and read params from the `params`/`searchParams` props passed
  to page/layout functions.

- **Always await `cookies()`, `headers()`, and `params`/`searchParams` in Next.js 15.**
  These are now async APIs. Accessing them synchronously emits a warning in v15 and will
  break in v16. (`const cookieStore = await cookies()`)

- **Always verify auth in Server Components and Route Handlers, not just in middleware.**
  Middleware can be bypassed (CVE-2025-29927). The layout-level auth check in
  `app/layout.tsx` is the real gate.

- **Never co-locate a `route.ts` and a `page.tsx` in the same directory.** A directory can
  be either a page route or a Route Handler, not both. Use a subdirectory (e.g.,
  `app/api/items/route.ts` vs `app/(tasks)/page.tsx`).

- **Always use the server-side Supabase client (from `lib/supabase/server.ts`) in Server
  Components and Route Handlers.** The browser client (`lib/supabase/client.ts`) uses
  `NEXT_PUBLIC_` keys and must only appear in `"use client"` files. Mixing them leaks
  service-role permissions or breaks cookie-based auth.

- **Never put business logic in `middleware.ts`.** Middleware runs at the edge with
  restricted APIs (no Node.js builtins, no file system). Use it only for early redirects,
  header injection, and A/B routing. Real auth logic belongs in Server Components.

---

## Version Gotchas (Next.js 16 — alfred's installed version)

alfred is scaffolded on **Next.js 16** (React 19) via `create-next-app@latest`. Hard-won
notes from the Phase 0 + feature bootstrap:

- **The `middleware` file convention is DEPRECATED → use `proxy`.** Next 16 prints
  `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead`
  (nextjs.org/docs/messages/middleware-to-proxy). More importantly, **`export const config
  = { matcher: [...] }` in `middleware.ts` now hard-FAILS `next build`** with `⨯ Invalid
  segment configuration export detected`. Two fixes: (a) migrate to `proxy.ts` (the new
  convention), or (b) keep `middleware.ts` (still functional, just deprecated) but DROP the
  `export const config` and do static-asset exclusion *inside* the middleware function
  (early-return on `/_next/static`, `/_next/image`, `favicon.ico`, image extensions). alfred
  currently does (b) — see `frontend/middleware.ts`. `tsc` and ESLint do NOT catch this; only
  `next build` (i.e. `check:slow`) does, so always run a build before pushing middleware changes.
- **`create-next-app` writes an `AGENTS.md` warning that "This is NOT the Next.js you
  know."** Next 16 has breaking changes vs. pre-16 training data. The authoritative,
  version-exact docs are **bundled in `node_modules/next/dist/docs/`** after install — read
  the relevant guide there before writing non-trivial Next code, rather than trusting memory.
- **Tailwind v4 is the default** in the `app-tw` template (CSS-first `@import "tailwindcss"`
  + `@theme inline` in `globals.css`, `@tailwindcss/postcss` in `postcss.config.mjs`). No
  `tailwind.config.js` is generated — see the tailwindcss skill.
- **Turbopack is the default bundler** for `next dev` and `next build` in 16. For Playwright's
  `webServer`, `next dev` works; a production smoke can use `next build && next start`.
- **The generated ESLint config is `eslint.config.mjs`** using `eslint-config-next/core-web-vitals`
  + `eslint-config-next/typescript` (flat). alfred replaces this with the aggressive flat
  config from the eslint skill (which uses `@next/eslint-plugin-next` directly).
- **`create-next-app` also drops a `CLAUDE.md` that just `@import`s `AGENTS.md`.** alfred
  removes both to keep governance centralized in the root `CLAUDE.md` + skills; the key
  insight (read bundled docs) is recorded here instead.

## Version Gotchas (Next.js 15 vs 13/14)

Agents trained on content before Next.js 15 (released Oct 2024) will confidently write
several patterns that are now wrong or deprecated:

- **Fetch is no longer cached by default.** In Next.js 13/14, `fetch()` in Server
  Components defaulted to `cache: 'force-cache'` (equivalent to `getStaticProps`). In
  Next.js 15, the default is `cache: 'no-store'`. To cache, explicitly pass
  `{ cache: 'force-cache' }` or `{ next: { revalidate: 60 } }`.
  > Source: Next.js 15 blog post (nextjs.org/blog/next-15, Oct 2024)

- **GET Route Handlers are no longer cached by default.** Previously they were statically
  cached; now they are dynamic. If your Route Handler accesses `cookies()`, `headers()`,
  or `request.url`, it was always dynamic — but previously you had to opt in; now dynamic
  is the default.

- **`cookies()`, `headers()`, `params`, and `searchParams` are now async.** In Next.js 14
  and earlier, `cookies()` returned a synchronous `ReadonlyRequestCookies`. In Next.js 15
  it returns a `Promise`. All call sites must be awaited.
  > Source: Next.js 15 upgrade guide (nextjs.org/docs/app/guides/upgrading/version-15)

- **`getServerSideProps` and `getStaticProps` do not exist in App Router.** Agents
  frequently generate these from Pages Router training. Equivalents:
  - `getServerSideProps` → async Server Component with `fetch({ cache: 'no-store' })` or
    direct DB call
  - `getStaticProps` → async Server Component with `fetch({ cache: 'force-cache' })` or
    `export const revalidate = N`
  - `getStaticPaths` → `generateStaticParams()` exported from the page

- **`useRouter().push()` for programmatic navigation in Server Components is wrong.**
  `useRouter` is client-only. In Server Components, use `redirect()` from `next/navigation`.

- **The Pages Router `pages/api/` convention does not exist in App Router.** All API
  endpoints live under `app/api/` as Route Handlers (`route.ts`), not as default-export
  functions receiving `(req: NextApiRequest, res: NextApiResponse)`.

---

## What Was Deliberately Left Out

- **Middleware (`middleware.ts`)** — covered only at the "use it for early redirects, not
  auth logic" level. The full matcher config, geolocation, and A/B routing patterns are
  omitted; alfred has no A/B requirement and the security gotcha is more important than the
  feature surface.

- **Parallel Routes and Intercepting Routes** — `@slot` and `(.)intercept` conventions.
  Alfred's route group pattern doesn't need them in the MVP. Including them would invite
  over-engineering.

- **Internationalization (i18n)** — alfred is a single-user, single-language app.

- **Static Export (`output: 'export'`)** — alfred uses Vercel dynamic rendering and
  Supabase at runtime; static export removes server-side features and is incompatible with
  this stack.

- **Image Optimization (`next/image`)** — alfred is a dense text UI (productivity app); no
  current image use case. Add when needed.

- **`generateStaticParams` / ISR at scale** — alfred's data is user-specific and always
  dynamic. Static generation of task pages provides no benefit and would be misleading to
  include.

- **Edge Runtime for Route Handlers** — `export const runtime = 'edge'` in Route Handlers.
  Alfred's Route Handlers call Supabase (Node.js client), which is incompatible with the
  Edge runtime. Keep default Node.js runtime.

- **`next/font`** — `next/font/google` downloads fonts at build time from `fonts.googleapis.com`.
  In air-gapped environments (CI sandboxes, Docker without Google access) this fails the build.
  Solution: use `next/font/local` with font files committed to `public/fonts/`. Geist Sans and
  Geist Mono woff2 files are bundled inside `next/dist/next-devtools/server/font/` and can be
  copied to `public/fonts/` at project setup time. The `--font-sans` and `--font-mono` CSS
  variables still work; Instrument Serif can fall back to Georgia/serif via CSS:
  `var(--font-instrument-serif, Georgia, 'Times New Roman', serif)`.
