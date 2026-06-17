---
branch: claude/vigilant-brahmagupta-wyg237
---

# Instant Tasks ⇄ Code module switching (no SSR)

*2026-06-17T21:29:26.692Z*

Navigating *within* a module was already instant — every view renders from client stores seeded once at the layout, and the in-module nav switches views with the History API (no RSC round-trip). But the Tasks ⇄ Code switcher used `next/link`, so each module switch paid a full RSC server round-trip (~1s on Vercel): `(tasks)` and `(code)` were sibling route groups, each with its own layout that ran `requireUser()`, fetched its own data, and seeded its own providers.

ALF-27 lifts both modules under one shared shell route group. `app/(shell)/layout.tsx` runs the single auth gate, fetches **all** modules' data in parallel, and seeds **all** providers once. Every page renders one URL-deriving `ModuleRouter` (Code on `/code*`, Tasks elsewhere), the nav follows the URL (`ShellNav` / `ShellMobileNav`), and the switcher drives navigation with `history.pushState` via `ViewLink` — so switching modules is now a pure client-side URL change, exactly like switching views.

**The shared shell is the single place that gates, fetches, and seeds** — both per-module layouts are gone. The whole `(tasks)` and `(code)` route groups now live under `(shell)`, so all existing URLs (`/`, `/folders/[id]`, `/completed`, `/code`, `/code/[project-id]`) are unchanged and still deep-link / hard-load correctly:

```bash
git ls-files 'frontend/app/(shell)'
```

```output
frontend/app/(shell)/(code)/code/[project-id]/page.tsx
frontend/app/(shell)/(code)/code/page.tsx
frontend/app/(shell)/(tasks)/completed/page.tsx
frontend/app/(shell)/(tasks)/folders/[id]/page.tsx
frontend/app/(shell)/(tasks)/page.tsx
```

The no-round-trip guarantee for a **cross-module** switch is locked in by an e2e guard (`frontend/e2e/client-nav.spec.ts`): switching Tasks → Code → Tasks via the switcher must record zero document loads and zero RSC (`_rsc`) fetches, the URL / main content / sidebar / switcher highlight must all follow the new module, and an in-memory marker must survive (proving the document never reloaded):

```bash
grep -n 'Tasks ⇄ Code\|roundTrips\|aria-current\|survivedNav\|Software Factory' frontend/e2e/client-nav.spec.ts
```

```output
19:  __survivedNav?: boolean;
43:    (globalThis as MarkerWindow).__survivedNav = true;
47:  const roundTrips: string[] = [];
50:      roundTrips.push(request.url());
72:  expect(roundTrips).toEqual([]);
73:  expect(await page.evaluate(() => (globalThis as MarkerWindow).__survivedNav)).toBe(true);
78: * layout, so the Tasks ⇄ Code switcher is a History-API change, not an RSC navigation —
89:test('switches Tasks ⇄ Code client-side, with no document reload or RSC round-trip', async ({
102:    (globalThis as MarkerWindow).__survivedNav = true;
106:  const roundTrips: string[] = [];
109:      roundTrips.push(request.url());
116:  await expect(page.getByText('The Software Factory')).toBeVisible();
120:  await expect(page.getByRole('link', { name: 'Code' })).toHaveAttribute('aria-current', 'page');
128:  await expect(page.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
131:  expect(roundTrips).toEqual([]);
132:  expect(await page.evaluate(() => (globalThis as MarkerWindow).__survivedNav)).toBe(true);
144:  await expect(page.getByText('The Software Factory')).toBeVisible();
152:  await expect(page.getByText('The Software Factory')).toBeVisible();
```

One interaction the structural change forced: the Gate ("Send to Code module…" / "Convert to Code Story…"), reachable from Tasks, used to rely on the cross-group SSR **re-seeding** the board from the server. With the switch now client-side and `CodeProvider` seeded once at the shell, the Gate instead routes its project/epic creates and the gated story **through the code store** (`useCodeActions`), so a gate-from-Tasks story lands on the board with no refetch. The `code-gate` e2e proves it end-to-end:

```bash
grep -n 'useCodeActions\|useProjects\|useEpics\|convertTaskToCode' frontend/components/code/gate-dialog.tsx
```

```output
11:import { useCodeActions, useEpics, useProjects } from '@/lib/stores/code-store';
98: * `useCodeActions` — no local fetch, and the new story lands on the board with no refetch.
101:  const projects = useProjects();
102:  const epics = useEpics();
103:  const { createProject, createEpic, convertTaskToCode } = useCodeActions();
139:      const story = await convertTaskToCode(item, projectId, epicId);
279: * gated story through `useCodeActions`, so the new card lands on the board with no refetch
```
