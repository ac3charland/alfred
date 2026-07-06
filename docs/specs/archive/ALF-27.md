# ALF-27 — Don't require a SSR for navigation between Tasks and Code modules (or modules in general)

## Context / problem

Navigating **within** a module is already instant and server-free. Every view renders
from a client store seeded once at the module layout, and `ViewLink`
(`components/tasks/view-link.tsx`) switches views with the History API
(`window.history.pushState`) instead of a `<Link>` navigation — no document reload, no RSC
payload. The `client-nav.spec.ts` e2e guards this for the tasks views (inbox ⇄ folder ⇄
completed), and the code module does the same internally via `CodeView`.

Navigating **between** modules does not. The Tasks ⇄ Code switcher
(`components/shell/view-switcher.tsx`) uses `next/link`, so each switch pays a full RSC
server round-trip (≈1s on Vercel): it must unmount one module layout and server-render the
other. This is structural, not a switcher bug — `(tasks)` and `(code)` are **sibling route
groups** (`app/(tasks)/layout.tsx`, `app/(code)/layout.tsx`), each its own layout that runs
`requireUser()`, fetches its own data, and seeds its own providers:

- `(tasks)/layout.tsx` → `getFolders()` + `getAllItems()` → `FoldersProvider`,
  `TasksProvider`, `TaskDndProvider`, `ActiveEditorProvider`, `ExpansionProvider`; nav =
  `FolderNav` / tasks `MobileNavClient`.
- `(code)/layout.tsx` → `getProjects()` + `getEpics()` + `getCodeStories()` →
  `CodeProvider`; nav = `ProjectNav` / code `CodeMobileNavClient`.

Because the two layouts share no parent segment except the root `app/layout.tsx` (html/body
+ fonts only), crossing groups remounts the layout and re-renders on the server. The nextjs
skill spells out the constraint: the `pushState` trick "works only _within_ a route group …
switching modules (the Tasks ⇄ Code switcher across `(tasks)` ⇄ `(code)`) must use real
`<Link>`/`router.push`". The `ViewSwitcher`'s own doc comment notes the same: it can't use
`ViewLink` today because the target module's layout + providers aren't mounted.

The owner wants module switching to feel like view switching: **no SSR / RSC round-trip when
moving between Tasks and Code**, and a structure that generalizes so future modules (Reader,
Firewall, Knowledge) plug into the same client-side switch without a redesign.

## Proposed change

Lift the per-module layouts into **one shared shell layout** that seeds every module's
providers once, and make the module switch a client-side History-API change — the exact
pattern the in-module view switch already uses, raised one level to span modules.

### 1. Shared shell route group

Introduce a parent route group (e.g. `app/(shell)/`) whose `layout.tsx` absorbs everything
the two module layouts duplicate, and move both modules' routes under it. Route groups add no
URL segment, so all existing URLs (`/`, `/folders/[id]`, `/completed`, `/code`,
`/code/[project-id]`) are unchanged.

```
app/
  layout.tsx                     # root: html/body/fonts (unchanged)
  (shell)/
    layout.tsx                   # NEW shared shell — see below
    (tasks)/ …                   # moved from app/(tasks)
    (code)/  …                   # moved from app/(code)
```

`app/(shell)/layout.tsx` (Server Component) does, once for the whole shell:

- `await requireUser()` — the single auth gate (was duplicated in both layouts).
- Fetch **all** modules' data in parallel: `getFolders()`, `getAllItems()`, `getProjects()`,
  `getEpics()`, `getCodeStories()`.
- Seed **all** providers, nesting the existing trees: `FoldersProvider` → `TasksProvider` →
  `TaskDndProvider` → `ActiveEditorProvider` → `ExpansionProvider` → `CodeProvider` (order
  not significant beyond existing nesting; tasks coordination stores stay together).
- Render a single `AppShell`. The two old `(tasks)/layout.tsx` and `(code)/layout.tsx`
  files are deleted (their content now lives here).

This keeps the "fetch-all, seed-once at the layout" convention from the data-flow skill —
now spanning both modules. At MVP scale (hundreds of rows total) the extra eager fetch of the
other module's data is acceptable and matches the existing tradeoff; see open questions for
the future-revisit note.

### 2. One URL-deriving router mounted on every page

Per the nextjs skill, a cross-segment `pushState` only works if the mounted page renders the
**same URL-deriving component** for both URLs. So every page under `(shell)` renders a single
**module router** client component that derives the active module from the URL (`usePathname`:
`/code*` → Code, everything else → Tasks) and renders the existing `CodeView` or `TaskViews`
accordingly. Each page Server Component stays a thin shell that renders this one router (the
same way today's pages render `TaskViews` / `CodeView`):

- `(tasks)/page.tsx`, `(tasks)/folders/[id]/page.tsx`, `(tasks)/completed/page.tsx`
- `(code)/code/page.tsx`, `(code)/code/[project-id]/page.tsx`

Because all pages render the same router, it doesn't matter which server route is mounted
after a `pushState` — the view follows the URL. A hard load / deep link / refresh of any path
still renders the right module server-side (the matching page is mounted normally on first
load).

### 3. Module-aware nav in the shell

`AppShell` currently takes `nav` and `mobileNav` props (a different pair per module layout).
With one shared layout the nav must switch client-side with the URL. Replace the per-module
props with a client nav component (mounted inside `AppShell`) that derives the active module
from the URL and renders the matching desktop nav (`FolderNav` vs `ProjectNav`) and mobile
drawer. `AppShell` keeps owning the module-agnostic chrome (wordmark, `ViewSwitcher`,
sign-out, sidebar/header frame).

### 4. Switcher uses the History API, not `<Link>`

With both modules mounted under one shell, the switch no longer needs an RSC navigation.
Change `ViewSwitcher` (`components/shell/view-switcher.tsx`) to drive navigation with
`window.history.pushState` on a plain primary click — reuse `ViewLink` (or its mechanism) so
modified/middle clicks and hard loads still navigate natively and keyboard users get real
links. The active-segment derivation (`/code*` → Code active) is unchanged. The
`prefetch={false}` concern disappears with `<Link>`.

> The active-module derivation in the router (2), the nav (3), and the switcher (4) must use
> the **same rule** (`pathname === '/code' || pathname.startsWith('/code/')` → Code) so URL,
> content, sidebar, and switcher highlight never disagree mid-switch.

### 5. Behavior to preserve

- The wordmark `AlfredLink` still goes to `/` and fires the capture-focus event.
- Optimistic state in **both** modules' stores survives a module switch (providers never
  unmount), exactly as it survives a view switch today.
- Deep links, refresh, and browser back/forward keep working for every path, across modules.

## Acceptance criteria

- [ ] Switching Tasks → Code → Tasks via the switcher does **no** server round-trip: no
      document reload and no `?_rsc=` request fires on the switch (extend the
      `client-nav.spec.ts` pattern — the planted in-memory marker survives, the round-trip
      list stays empty — to cover a cross-module switch).
- [ ] After the switch the URL, main content, sidebar nav, and switcher highlight all reflect
      the new module (e.g. `/code` shows the code board + `ProjectNav` + Code highlighted;
      `/` shows the inbox + `FolderNav` + Tasks highlighted).
- [ ] Optimistic state survives a module switch: a not-yet-reconciled change made in one
      module (or a still-mounted store value) is still present after switching to the other
      module and back, with no re-seed/refetch.
- [ ] Hard-loading or refreshing any path — `/`, `/folders/[id]`, `/completed`, `/code`,
      `/code/[project-id]` — server-renders the correct module's view (deep links intact).
- [ ] Browser back/forward moves across a module switch correctly (e.g. Tasks → Code, Back →
      Tasks), with no document reload.
- [ ] Modified/middle clicks on a switcher segment still open the target in a new tab/window
      (native navigation), and the segments remain real, keyboard-focusable links.
- [ ] `requireUser()` still gates the shell: an unauthenticated visit to any module path
      redirects to `/login` (auth behavior unchanged; now enforced once in the shared layout).
- [ ] The two per-module layout files are gone; the shared `(shell)` layout is the single
      place that runs the auth gate, fetches module data, and seeds providers.
- [ ] All existing tasks **and** code e2e/unit/Storybook suites stay green; the change is
      covered by at least one test (the new cross-module no-round-trip assertion).
- [ ] A demo doc under `docs/demos/` captures the instant Tasks ⇄ Code switch with the
      no-round-trip evidence.

## Out of scope / open questions

- **Eager vs lazy module data.** This spec eagerly fetches every module's data at the shared
  layout, consistent with the current "fetch-all, seed-once" convention and fine at
  hundreds-of-rows scale. As more modules land (Reader, Firewall, Knowledge), eagerly
  fetching all of them on first paint may not pay off. A lazy/per-module client fetch that
  still avoids a full SSR (fetch a module's data once on first visit via `lib/api-client`,
  cache it in its provider) is the natural future revisit — **deferred**, not built here. The
  data-flow skill's "revisit when the dataset grows large" note already flags this seam.
- **Future modules' wiring.** Building Reader/Firewall/Knowledge route groups is out of
  scope; this change only needs to make adding them a "new group under `(shell)` + a switcher
  segment + a branch in the module router/nav" change, not a relayout.
- **Switcher visual/UX redesign.** No change to how the switcher looks or where it sits
  (sidebar on desktop, hamburger on mobile) — only its navigation mechanism changes.
- **Prefetching / loading skeletons.** With everything seeded at the shell there's nothing to
  prefetch on a switch; loading/streaming UI for module switches is not needed and not in
  scope.
- **Open question — page-shell shape.** Whether the two modules keep separate page files that
  each render the shared module router, or collapse to fewer page files, is an
  implementation detail to settle during build; the constraint that matters is that every
  mounted page renders the **same** URL-deriving router so `pushState` resolves correctly.
