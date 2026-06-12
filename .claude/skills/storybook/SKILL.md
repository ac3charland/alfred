---
name: storybook
description: >
  Covers Storybook stories in the alfred frontend/ package: writing and modifying
  stories, configuring .storybook/preview.ts or main.ts, play functions for interaction
  tests, wiring the test-runner for snapshot/a11y testing in CI/pre-push, and mocking
  Next.js internals (useRouter, next/image, next/navigation) inside stories. Use on any
  mention of "write a story", "add a story", "interaction test", "play function",
  "test-runner", "storyshots", "snapshot test", "story controls", "argTypes", "autodocs",
  "storybook decorator", "preview.ts", or "test-storybook". For end-to-end flows that
  span pages or run against the real dev server, use a Playwright spec (playwright skill),
  not a play function.
---

# Storybook Skill (alfred / Next.js + Tailwind v4 + TypeScript)

> Current stable as of June 2026: **Storybook 10.4.x** (released October 2025).
> alfred uses the **@storybook/nextjs** (Webpack) framework — note that @storybook/nextjs-vite
> is now the recommended default for new projects; use nextjs-vite only if performance
> becomes a bottleneck and custom Webpack config is not needed.
>
> Sources consulted: Storybook official releases page (storybook.js.org/releases),
> Storybook GitHub test-runner README (storybookjs/test-runner), Storybook blog
> "Component Story Format 3 is here" (Michael Shilman, Storybook org), eslint-plugin-storybook
> GitHub README (storybookjs/eslint-plugin-storybook), Storybook GitHub PR #30742 confirming
> import path move to `storybook/test` (merged March 2025, targeted for v9), and
> GitHub discussion #33195 (November 2025) confirming the current path.

---

## 1. Mental Model: Stories as the Source of Truth

A Storybook story is not a test file — it is a **runnable specification of a component state**.
The story declares inputs (args) and the component renders against them. Tests run *against* that
rendered story; they do not duplicate it. This distinction matters for alfred because the same story
file serves three purposes simultaneously:

1. **Visual development** — instant feedback while building the component.
2. **Documentation** — autodocs generates an interactive prop reference from the same file.
3. **Automated testing** — the test-runner snapshot-tests every story; play functions add
   interaction assertions on top.

**Component Story Format 3 (CSF3)** is the current standard. A story file has:
- One **default export** (`meta`) — the component reference, title, decorators, argTypes, tags.
- One or more **named exports** — each is a story object (`{ args, play, decorators, ... }`).

CSF3 stories are objects, not functions. Storybook infers a default render function from the
`component` field in meta, so most stories only need `args`. The `render` prop overrides this
when props alone can't express what's needed.

**Args are the single source of truth for inputs.** They flow to: the component render, the
Controls panel, the Actions panel (spy fns via `fn()`), and the `play` function context. Never
hardcode values in the render function that should be controllable.

**The decorator stack** wraps every story render. alfred requires a global decorator in
`preview.ts` that applies the dark theme CSS class and imports `globals.css`. This ensures
all stories render under the real CSS variables — stories that skip this look broken.

---

## 2. Decision Tree: Which Story Pattern to Use

**Does the story need to verify user interaction or assert on DOM/callbacks?**
→ Yes → Write a `play` function. Import `{ userEvent, expect, within, fn }` from `'storybook/test'`.
→ No → A plain args-only story is sufficient. No `play` needed.

**Does the component accept no props / can't be driven by args alone (e.g. needs a provider, a context value, or complex JSX children)?**
→ Yes → Add a `render` function to the story object alongside `args`.
→ No, args cover everything → Omit `render`; let Storybook use the default.

**Does the component call Next.js navigation (useRouter, usePathname, etc.) or render next/image?**
→ Yes → These are auto-mocked by `@storybook/nextjs`. Set `parameters.nextjs.appDirectory: true`
  if the component is in the `app/` directory. Override navigation values with
  `parameters.nextjs.navigation` if the story depends on a specific route.
→ No → No extra setup needed.

**Does the story need to assert on a callback function (e.g. onClick, onSubmit)?**
→ Yes → Set the arg value to `fn()` (from `'storybook/test'`) in the story's `args`. Then assert
  with `await expect(args.onClick).toHaveBeenCalledWith(...)` inside `play`.
→ No → Omit the spy.

**Is this a new component that needs auto-generated prop documentation?**
→ Yes → Add `tags: ['autodocs']` to the meta object. The Controls panel populates automatically
  from TypeScript types via react-docgen; you only need `argTypes` if you want to override labels,
  descriptions, or control types.

---

## 3. Plain-English → Pattern Table

| When the user says... | Use this pattern | Key things to know |
|---|---|---|
| "write a story for this button with variants" | Args-only CSF3 story per variant; each export is one state | Name exports in PascalCase (`Primary`, `Disabled`). Use `args` for the variant, not a render function. eslint rule `prefer-pascal-case` is an error in alfred. |
| "a story that renders against the dark theme" | Global decorator in `.storybook/preview.ts` wraps all stories | The decorator must add the dark-mode CSS class to a wrapper div **and** `globals.css` must be imported at the top of `preview.ts`. Per-story decorators can override, but almost never need to. |
| "an interaction test that clicks a button and asserts something" | `play` function with `userEvent.click` + `expect` from `'storybook/test'` | `play` is async; always await userEvent calls. Use `canvas.getByRole(...)` or `within(canvasElement).getByRole(...)` — not document queries. |
| "controls for these props" | Add `component` to meta; TypeScript types auto-infer controls | `argTypes` is only needed to override the inferred control (e.g. change a string to a `select` control). Never duplicate types — use `satisfies Meta<typeof Button>`. |
| "mock the onClick callback so I can assert it was called" | Set arg to `fn()` from `'storybook/test'`; assert in `play` | `fn()` wraps Vitest's `vi.fn()` — it works in both browser (test-runner) and node (portable stories). |
| "render a story that uses useRouter or usePathname" | No extra setup needed; `@storybook/nextjs` mocks these automatically | Set `parameters: { nextjs: { appDirectory: true } }` for App Router components. Override pathname via `parameters.nextjs.navigation.pathname`. |
| "mock next/image in a story" | No setup needed — `@storybook/nextjs` auto-mocks it | The mocked implementation renders without optimization; actual alt/src props still render in the DOM. |
| "snapshot test all stories in pre-push" | `test-storybook` command wired into `check:slow` | Build Storybook first, then run `test-storybook --url <served-url>`. Snapshots live in `__snapshots__/`. Update with `test-storybook -u`. |
| "a story for a component that needs a React context or provider" | `decorators` array on the story (or component-level in meta) | `decorators: [(Story) => <MyProvider><Story /></MyProvider>]`. The global decorator in `preview.ts` handles the theme; component-level decorators handle domain context. |
| "generate autodocs for this component" | Add `tags: ['autodocs']` to meta | Autodocs uses the `component` field to infer props. Description comes from JSDoc comments on the component. The primary story (first export) is shown prominently. |
| "write a play function that types into an input and checks the value" | `userEvent.type(el, 'text')` + `expect(el).toHaveValue('text')` | Always `await` userEvent. Use `canvas.getByRole('textbox', { name: /label/i })` to find inputs — accessible role + name is more resilient than test-ids. |
| "a story that opens a modal and confirms cascade delete" | Compose: args set initial state; `play` opens modal, clicks confirm, asserts callback | If the modal is portal-rendered, query from `document.body` using `within(document.body).getByRole('dialog')` rather than `canvas`. |
| "run a11y checks for every story" | `@storybook/addon-a11y` in addons; in Storybook 9+, built-in test-runner a11y integration | In Storybook 9+, the test-runner has native a11y support without needing `axe-playwright` manually. For Storybook 8 and earlier, you needed the `postVisit` hook with `axe-playwright`. |
| "configure the test-runner in CI" | `test-storybook --ci` against a built and served Storybook | In CI: `storybook build` → `npx http-server storybook-static` + `wait-on` → `test-storybook --ci --url http://localhost:6006`. The `--ci` flag fails on new snapshots instead of writing them. |

---

## 4. Play Functions and Decorator Lifecycle

**Execution order per story render:**
1. Global decorators (outermost) → component-level decorators → story decorators
2. `loaders` (async data fetch, result injected into `context.loaded`)
3. `beforeEach` (setup; returned cleanup runs after the story unloads)
4. Story renders
5. `play` function runs
6. `afterEach` / loader cleanup

**play function signature:**
```typescript
import type { Meta, StoryObj } from '@storybook/nextjs';
import { within, userEvent, expect, fn } from 'storybook/test';

type Story = StoryObj<typeof meta>;

export const FilledForm: Story = {
  args: { onSubmit: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: /title/i }), 'Buy milk');
    await userEvent.click(canvas.getByRole('button', { name: /save/i }));
    await expect(args.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Buy milk' })
    );
  },
};
```

**Decorator signature (for the global theme decorator):**
```typescript
// .storybook/preview.ts
import '../src/globals.css';
import type { Preview } from '@storybook/nextjs';

const preview: Preview = {
  decorators: [
    (Story) => (
      <div className="dark min-h-screen bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
};
export default preview;
```

**Important pairing rule:** Decorators always run regardless of whether the story renders
successfully. A failing `play` function does not prevent decorator cleanup. `beforeEach`
cleanup (the returned function) always runs when navigating away — use this for mock resets.

---

## 5. Common Pitfalls

- **Always import from `'storybook/test'`, never from `'@storybook/test'`.** The scoped package
  (`@storybook/test`) was the correct import in Storybook 8; it was consolidated into the core
  `storybook` package for v9+. Storybook 9+ requires `import { ... } from 'storybook/test'`.
  The ESLint rule `use-storybook-testing-library` enforces this and runs as an error in alfred.

- **Never use `expect` from Jest/Vitest directly in a play function.** The Storybook `expect`
  from `'storybook/test'` is browser-compatible and extends jest-dom matchers. Using Node's
  `expect` will throw in the browser context. The ESLint rule `use-storybook-expect` enforces
  this.

- **Never write a story as a function export in CSF3.** `export const Primary = () => <Button />`
  is CSF2. It still works but loses type inference, Controls integration, and satisfies-based
  TypeScript checking. The ESLint rule `no-stories-of` flags the older `storiesOf()` pattern
  and the rule `story-exports` flags files with no named story exports.

- **Always add `component` to the meta object.** Without it, Controls don't infer, autodocs
  doesn't generate prop tables, and react-docgen can't extract types. The ESLint rule
  `csf-component` runs as an error in alfred.

- **Always await userEvent calls in play functions.** `userEvent.click(el)` is async; skipping
  `await` causes the assertion to run before the interaction completes, producing flaky tests.
  The ESLint rule `await-interactions` enforces this.

- **Never query from `document` in play functions unless the element is portal-rendered.**
  Use `within(canvasElement).getBy*` for everything inside the story root. Portals (modals,
  dropdowns via Radix) render outside `canvasElement` — use `within(document.body).getBy*`.

- **Always import `globals.css` in `.storybook/preview.ts`.** Without this, Tailwind utility
  classes and CSS custom properties (dark theme variables) are absent — the component renders
  with broken styles. The import must be a side-effect import at the top of the file.

- **Never use Tailwind v3 `tailwind.config.js` patterns.** alfred uses Tailwind v4 (CSS-first).
  Styles come from `globals.css` via `@import 'tailwindcss'`. No `content` array config needed
  in the preview — the CSS import is sufficient.

- **Set `parameters.nextjs.appDirectory: true` for any component that imports from
  `next/navigation`.** Without it, the App Router context is not mocked and the story throws
  "invariant expected app router to be mounted".

---

## 6. Version Gotchas

### Storybook 9.0 (June 2025) — Breaking changes agents get wrong

- **`@storybook/testing-library` is gone.** Agents trained before mid-2025 will write
  `import { userEvent, within } from '@storybook/testing-library'`. This package was deprecated
  in Storybook 8.0 and removed entirely in 9.0. The correct import is
  `import { userEvent, within, expect, fn } from 'storybook/test'`.

- **`storiesOf()` API is removed.** `storiesOf('Button', module).add(...)` was the pre-CSF
  pattern. It no longer works in Storybook 8+ (Story Store v7 requires static analysis).
  Rewrite as a default-export meta + named story objects.

- **`@storybook/test` (scoped) → `storybook/test` (unscoped).** The package was consolidated
  into the core `storybook` package (PR #30742, merged March 2025, shipped in v9). The scoped
  `@storybook/test` still resolves as a re-export shim in some setups but should not be relied on.

- **`@storybook/addon-interactions` is no longer needed as a standalone install.** Interaction
  testing is part of core essentials in Storybook 9+.

- **`@storybook/addon-storyshots` (Storyshots) is removed.** This addon is dead. The migration
  path is the **test-runner** (for browser-side DOM snapshots) or **portable stories +
  `composeStories`** (for Jest/JSDOM snapshots). alfred uses the test-runner.

### `eslint-plugin-storybook` flat config: `flat/recommended` is an array, not an object

`storybookPlugin.configs['flat/recommended']` exports an **array of three config objects**:
one for plugins, one for story file rules, one for main/preview rules. It is NOT a single
config object.

**WRONG — causes "Unexpected key '0'" ConfigError:**
```js
// This tries to merge an array into an object — numeric keys become invalid ESLint config keys
{ files: ['**/*.stories.tsx'], ...storybookPlugin.configs['flat/recommended'] }
```

**CORRECT — spread the array directly into defineConfig:**
```js
// Each element already carries its own internal `files` globs — no need to wrap in files:
...storybookPlugin.configs['flat/recommended'],
```

The internal config objects in the array already scope themselves to `*.stories.*` and
`.storybook/` files via their own `files` keys. Spreading directly is the right pattern.

### `@storybook/addon-docs` must be installed separately

`@storybook/addon-docs` is listed as an addon in `.storybook/main.ts` but is NOT
automatically installed by `@storybook/nextjs`. It must be added explicitly:
```
npm install --save-dev @storybook/addon-docs
```
ESLint's `storybook/no-uninstalled-addons` rule will catch missing addons at lint time.

### Storybook 10.0 (October 2025) — Breaking changes and new defaults

- **ESM-only.** `main.ts`, `preview.ts`, and any preset files must be valid ESM. CommonJS
  `require()` in these files breaks. Next.js projects using `@storybook/nextjs` (Webpack) still
  work; the ESM-only constraint applies to config files, not the component code.

- **`@storybook/nextjs-vite` is now the recommended framework** for new Next.js projects.
  It is faster and has better native Vitest integration. `@storybook/nextjs` (Webpack) is still
  supported but is the legacy path. alfred currently uses `@storybook/nextjs`; switching to
  `nextjs-vite` is safe if no custom Webpack config is in use.

- **`@storybook/experimental-nextjs-vite` is renamed to `@storybook/nextjs-vite`.** Any
  existing reference to the experimental name breaks.

- **CSF Factories** are in Preview status (not yet default). CSF3 (`Meta`/`StoryObj`) is still
  fully supported and is the correct pattern for alfred. Do not convert to CSF Factories until
  they are the default in Storybook 11.

- **`storiesOf`, CSF2 function stories, `@storybook/jest`** — all gone. These were removed in v8
  or v9 and are confirmed absent in v10. Agents trained on Storybook 6/7 material will suggest
  all three.

### What agents trained on Storybook 6/7 get wrong (summary)

| Old (wrong) | Current (correct) |
|---|---|
| `import { render } from '@testing-library/react'` in a story | `play` function with `'storybook/test'` utilities |
| `import { userEvent } from '@storybook/testing-library'` | `import { userEvent } from 'storybook/test'` |
| `storiesOf('Button', module).add(...)` | Default export meta + named story objects |
| `export const Primary = () => <Button label="Click" />` | `export const Primary: Story = { args: { label: 'Click' } }` |
| `import { action } from '@storybook/addon-actions'` | `import { fn } from 'storybook/test'` and set as arg value |
| `@storybook/addon-storyshots` for snapshots | `@storybook/test-runner` running `test-storybook` |
| `parameters.actions.argTypesRegex` for auto-actions | `argTypes: { onClick: { action: 'clicked' } }` or `fn()` in args |

---

## 7. What Was Deliberately Left Out

- **CSF Factories** (`definePreview` / `meta.story()` chain): Preview-status in Storybook 10,
  not yet the default. Including it would cause agents to use it prematurely. Revisit when
  Storybook 11 ships.

- **Vitest addon (`@storybook/addon-vitest` / `@storybook/vitest-plugin`)**: alfred's test
  architecture runs the **test-runner** (Jest + Playwright) as part of `check:slow`. The Vitest
  addon is an alternative testing path (Vite-native, faster) but requires `@storybook/nextjs-vite`
  and a Vitest config in the project. Do not add the Vitest addon without first migrating the
  framework. See the Playwright skill for Playwright-specific details.

- **MDX stories and custom Docs pages**: alfred writes stories in `.tsx` files only. MDX is valid
  but adds authoring overhead with no benefit for this use case.

- **Chromatic visual diffing**: alfred does not use Chromatic. Visual regression is out of scope.

- **`composeStories` portable stories in Jest**: alfred uses the test-runner for story-based
  testing. The portable stories / JSDOM path is the migration route from Storyshots and is
  documented at `storybook.js.org/docs/api/portable-stories/portable-stories-jest`. Do not
  mix both approaches — test-runner is the single source of truth for story tests in alfred.

- **Story loaders for remote data fetching**: Loaders exist and work, but alfred components are
  driven by synchronous props/args. Use `beforeEach` only if mock state reset is needed between
  stories; do not introduce async loaders unless a component genuinely requires live data.

- **`@storybook/addon-themes` with `withThemeByClassName`**: alfred's dark theme is always-on
  (no toggle needed). A hand-written decorator wrapping stories in a `div.dark` is sufficient
  and avoids the addon dependency. Use `addon-themes` only if a light/dark toggle is added to
  the UI.
