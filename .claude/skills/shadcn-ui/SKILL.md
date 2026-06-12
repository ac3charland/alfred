---
name: shadcn-ui
description: >
  Covers shadcn/ui components: adding a component via the CLI,
  customizing or theming an existing one, composing Radix primitives (Dialog, Dropdown,
  Popover, etc.), adding Lucide icons to buttons or headings, the cn() utility, CSS
  variables, Tailwind v4's @theme inline tokens, and deciding whether a component needs
  "use client" in the Next.js App Router. Use whenever you add, theme, compose, or debug
  a UI component. For raw Tailwind utility classes or theme-token edits (rather than
  component scaffolding) use the tailwindcss skill.
---

# shadcn/ui Skill

> Base source: first-party SKILL.md at `shadcn-ui/ui` repo (`skills/shadcn/SKILL.md`) plus
> CLI reference (`skills/shadcn/cli.md`), shadcn/ui changelog, Radix UI docs, and lucide.dev.
> Verified against live docs June 2026.

---

## Mental Model

shadcn/ui is **not a component library you install** — it is a CLI that **copies source files into
your repo**. Running `npx shadcn@latest add dialog` writes `components/ui/dialog.tsx` directly into
the codebase. You own that file completely: rename it, extend it, delete parts of it. There is no
upstream package to update with `npm update`; you update by re-running the CLI and merging diffs.

Each copied component is a thin composition of two layers:

1. **Radix UI primitive** — handles all behavior (focus traps, ARIA, keyboard, portal rendering).
   Radix is headless/unstyled; it only adds `data-state`, `data-side`, `aria-*` attributes to DOM
   elements for you to hook into.
2. **Tailwind classes + CSS variables** — all visual style. Colors are CSS variables (`--primary`,
   `--accent`, etc.) mapped via `@theme inline` in `globals.css`. Every visual decision in a
   component refers to a token, never a raw color value.

**For alfred specifically:** the dark palette defined in §5.4 of SPEC.md (`--bg`, `--surface`,
`--border`, `--text`, `--accent-teal`, etc.) lives in `globals.css` under `:root` (and `.dark` if
needed). Components inherit those tokens automatically — you theme an entire component by changing
one variable, not by hunting down Tailwind color classes across a file.

The `cn()` utility (from `lib/utils.ts`) merges Tailwind classes safely via `clsx` + `tailwind-merge`.
Always use `cn()` for conditional or override classes — raw string concatenation causes Tailwind
class conflicts that are silent and hard to debug.

> Source: shadcn/ui first-party SKILL.md (`shadcn-ui/ui` repo, March 2026);
> Vercel Academy — "What are Radix Primitives?" and "Anatomy of a Primitive".

---

## Decision Tree

**Do you need a new UI element that likely exists in shadcn?**
→ Run `npx shadcn@latest search -q "<description>"` first.
→ Found it → `npx shadcn@latest add <name>`. Done.
→ Not found → check third-party registries (`@magicui/`, `owner/repo/item`) or build from a Radix primitive directly (see Pattern Table row "style a bare Radix primitive").

**Do you need to customize an existing component?**
→ It lives in your repo — edit the file. No upstream to ask.
→ Before editing, run `npx shadcn@latest add <name> --diff` to see if there are upstream changes
  you should merge in first.

**Is this a presentational/layout component (no interactivity, no hooks)?**
→ Can be a React Server Component (RSC). No `"use client"` needed.
→ Any component using `useState`, `useEffect`, event handlers, `useRef`, or any Radix primitive
  (they all use context internally) **must have `"use client"` at the top of the file**.

**Are you adding an icon to a button?**
→ Use `<IconName data-icon="inline-start" />` or `data-icon="inline-end"` — the component's
  built-in spacing handles the gap. Do not add sizing classes to the icon element.

---

## Plain-English → Pattern Table

| When you need to... | Pattern to use | Key things to know |
|---|---|---|
| **Add a standard component** (button, card, input, badge) | `npx shadcn@latest add <name>` — then import from `@/components/ui/<name>` | Check `npx shadcn@latest info` first for the resolved alias; never hard-code `@/` |
| **Build a modal / confirmation dialog** (e.g. the cascade-completion confirm) | `Dialog` component (wraps `@radix-ui/react-dialog` or `radix-ui` Dialog primitive) with `open` + `onOpenChange` for controlled state | File **must** have `"use client"`. Always include `<DialogTitle>` — use `className="sr-only"` if visually hidden. Manage `open` state in the parent that triggers the action. |
| **Controlled open/close from code** (async op closes the dialog) | Pass `open={isOpen}` + `onOpenChange={setIsOpen}` to `<Dialog>` root | In uncontrolled mode, Radix manages state internally. In controlled mode, **you** must call `setIsOpen(false)` — Radix will not close it for you. |
| **Dropdown menu or context menu** | `DropdownMenu` + `DropdownMenuTrigger` + `DropdownMenuContent` + `DropdownMenuItem` | `DropdownMenuTrigger` needs `asChild` when the trigger is a custom element (e.g. `<Button asChild>`). Requires `"use client"`. |
| **Floating tooltip or popover with content** | `Popover` / `Tooltip` — both are Radix portal-based | `Tooltip` wraps a single trigger; `Popover` can hold richer content. Never manually set `z-index` on either — Radix handles stacking via portals. |
| **Variant-aware button** (destructive, outline, ghost, custom) | `Button` component with `variant="..."` prop — powered by `cva()` inside the file | To add a new variant, edit `buttonVariants` in `button.tsx` — add an entry to the `variants.variant` object. Use `cn(buttonVariants({ variant }), className)` at the call site. |
| **Icon button with Lucide** | Import from `lucide-react`; add `data-icon="inline-start"` or `data-icon="inline-end"` attribute on the icon element | Do not add `size-4` or `w-4 h-4` to icons inside shadcn buttons — the component's built-in spacing already handles it. |
| **Apply the alfred dark theme** to a component | Define tokens in `globals.css` under `:root` (and optionally `.dark`), then expose with `@theme inline { --color-... }`. Use semantic class names (`bg-primary`, `text-muted-foreground`) in components — never raw hex | Tailwind v4: tokens go in `@theme inline` inside `globals.css`, not in `tailwind.config.ts`. v3: tokens go in `theme.extend.colors` in `tailwind.config.ts`. alfred uses Tailwind v4 (confirm with `npx shadcn@latest info`). |
| **Extend or restyle an existing component** | Edit the copied `.tsx` file directly. For conditional classes use `cn()` from `@/lib/utils` | Never override component colors via `className` on the consumer side — extend inside the component file itself so variants stay consistent. |
| **Style a bare Radix primitive** (no shadcn wrapper exists yet) | Import `{ ComponentName as ComponentNamePrimitive } from "radix-ui"` (unified package, Feb 2026+). Apply Tailwind classes to each sub-part. | Check the Radix docs for `data-state` and `data-side` attribute hooks — they are the styling handles for open/closed, active/inactive states. |
| **Build a select / combobox** | `Select` for simple lists; `Command` + `Popover` (the Combobox pattern) for searchable | `SelectItem` must be inside `SelectGroup`. `Command` is powered by `cmdk` — fetch its docs with `npx shadcn@latest docs command`. |
| **Form fields with validation** | `Form` (wraps React Hook Form) + `FieldGroup` + `Field` + `Input` | Validation state uses `data-invalid` on `Field` and `aria-invalid` on the control — not custom CSS classes. Always pair `FormLabel` + `FormControl` + `FormMessage`. |
| **Toast notifications** | `sonner` (not the old `Toast` component) | `sonner` is the current recommended toast library. Add `<Toaster />` once in the root layout; call `toast("message")` anywhere in client code. |
| **Check if a component is up to date vs upstream** | `npx shadcn@latest add <name> --diff` | Shows a file-by-file diff against the registry. Use `--diff globals.css` to see CSS-only changes. Never manually fetch component source from GitHub. |

---

## Callback / Lifecycle: Radix Controlled vs. Uncontrolled State

Radix primitives (Dialog, Popover, DropdownMenu, Select, etc.) support two modes. Agents frequently
mix them up, causing components that never open or never close.

**Uncontrolled (Radix manages state):**
```tsx
<Dialog>
  <DialogTrigger>Open</DialogTrigger>
  <DialogContent>...</DialogContent>
</Dialog>
```
Radix handles `open`/`close` internally. Use this for simple cases with no async or external
triggers.

**Controlled (you manage state):**
```tsx
const [open, setOpen] = useState(false)

<Dialog open={open} onOpenChange={setOpen}>
  {/* No DialogTrigger required */}
  <DialogContent>...</DialogContent>
</Dialog>
```
Use this when:
- You need to open the dialog from code (e.g. after an API call)
- You need to prevent closing (e.g. while a save is in progress)
- The dialog is triggered by something outside the component tree
- The cascade-completion modal in alfred — triggered by a button click in a task row

**Rules:**
- In controlled mode, calling `setOpen(false)` is the only way to close the dialog — Radix will not
  close it automatically when the overlay is clicked unless `onOpenChange` is wired.
- `onOpenChange` receives the next desired state as a boolean. To block closing: ignore the `false`
  call while async work is in flight.
- `DialogTrigger` is optional in controlled mode. Omitting it is fine.

> Source: Radix UI primitives docs — Dialog component; shadcn/ui Dialog docs (ui.shadcn.com).

---

## Common Pitfalls

- **Never** use `npx shadcn-ui@latest` — the package was renamed to `shadcn`. The correct command
  is `npx shadcn@latest add <component>`. The old `shadcn-ui` package is deprecated.

- **Never** import Radix sub-packages individually if the project was initialized with new-york
  style post-February 2026. Imports should be `import { Dialog as DialogPrimitive } from "radix-ui"`
  (unified), not `import * as DialogPrimitive from "@radix-ui/react-dialog"`. Mixing both causes
  duplicate instances and broken state.

- **Always** add `"use client"` to any file that uses a Radix-based shadcn component, `useState`,
  `useEffect`, event handlers, or browser APIs. In alfred's Next.js App Router context (`isRSC: true`),
  this is most UI component files. Forgetting it produces a hydration mismatch or a runtime error.

- **Never** override `z-index` manually on overlay components (Dialog, Popover, Tooltip, Sheet,
  Drawer). Radix renders them into a portal and manages stacking context. Adding `z-index` breaks
  the stacking order.

- **Never** use `space-x-*` or `space-y-*` Tailwind utilities. Use `flex gap-*` instead. The
  `space-*` utilities use a lobotomized-owl selector (`* + *`) that breaks with conditional rendering
  and React fragment children.

- **Always** use `cn()` from `@/lib/utils` for merging Tailwind classes. Raw string concatenation
  (`"base " + conditionalClass`) causes last-writer-wins conflicts; `tailwind-merge` inside `cn()`
  resolves them correctly.

- **Never** hard-code raw color values or `dark:` overrides in className. Use the alfred CSS
  variable tokens (`bg-surface`, `text-muted`, `border-border`, etc.) so the dark theme applies
  uniformly.

- **Always** include `<DialogTitle>` (or `<SheetTitle>`, `<DrawerTitle>`) in every overlay
  component. If it should not be visible, use `className="sr-only"`. Omitting it fails the Radix
  accessibility check and breaks screen readers.

- **In a reusable `<label>` atom, pull `htmlFor` out of the props and apply it explicitly** —
  `({ htmlFor, ...properties }) => <label htmlFor={htmlFor} {...properties} />`. If `htmlFor`
  only reaches the element through the `{...properties}` spread, `jsx-a11y/label-has-associated-control`
  can't see it statically and errors with "A form label must be associated with a control", even
  though every caller passes `htmlFor`. Destructuring it so the attribute is literally present on
  the JSX satisfies the rule (and is the correct contract for a field label).

- **Never** fetch component source files from GitHub raw URLs. Always use
  `npx shadcn@latest add <name> --dry-run` or `--view` to inspect what will change. The CLI
  resolves the correct registry, file paths, and CSS diffs automatically.

- When writing custom CVA variants for components, put the `cva()` definition **inside the
  component file**, not in a shared variants file, unless multiple components genuinely share the
  same variant set.

---

## Version Gotchas

### CLI package name (agents trained pre-2023 get this wrong)
The npm package was `shadcn-ui`. It was renamed to `shadcn`. The current correct CLI invocation is:
```
npx shadcn@latest add button
```
Not `npx shadcn-ui@latest add button`. The old package still exists on npm but is unmaintained.

### CLI v4 (March 2026) — new commands agents may not know
- `npx shadcn@latest docs <component>` — fetches documentation URLs + example source for a
  component directly from the registry. Prefer this over googling.
- `npx shadcn@latest search -q "<query>"` — fuzzy search across all configured registries.
- `npx shadcn@latest info` — dumps project context (framework, Tailwind version, aliases, RSC flag,
  icon library). Run this first in any new session before adding components.
- `npx shadcn@latest apply <preset-code>` — applies a design preset. Do not decode preset codes
  manually; pass them opaquely to the CLI.
- `--dry-run` / `--diff` / `--view` flags on `add` — preview changes without writing files. Use
  `--diff globals.css` to see only CSS changes.

### Radix unified package (February 2026)
Components added with new-york style now import from the unified `radix-ui` package:
```ts
// New (post-Feb 2026, new-york style)
import { Dialog as DialogPrimitive } from "radix-ui"

// Old (pre-Feb 2026, or default style)
import * as DialogPrimitive from "@radix-ui/react-dialog"
```
If you run `npx shadcn@latest migrate radix`, the CLI rewrites all imports automatically. Do not
mix the two import styles in the same project — it creates duplicate component instances.

> Source: shadcn/ui changelog — "February 2026 - Unified Radix UI Package"
> (ui.shadcn.com/docs/changelog/2026-02-radix-ui).

### Tailwind v4: `@theme inline` replaces `tailwind.config.ts` colors
In Tailwind v4 projects (what alfred targets), CSS variable tokens are declared in `globals.css`:
```css
:root {
  --bg: #0A0E17;
  --accent-teal: #4FD1E0;
}

@theme inline {
  --color-bg: var(--bg);
  --color-accent-teal: var(--accent-teal);
}
```
Do **not** add color tokens to `tailwind.config.ts` in a v4 project. The `@theme inline` block is
the Tailwind v4 way to expose CSS variables as utility classes (`bg-bg`, `text-accent-teal`, etc.).

### `tailwindcss-animate` deprecated (March 2025)
New shadcn projects use `tw-animate-css` instead of `tailwindcss-animate`. If you see
`@plugin "tailwindcss-animate"` in a project's CSS, that project predates March 2025. New
components from the registry use `tw-animate-css` animations — install it with your package manager
and add `@import "tw-animate-css"` to `globals.css`.

### `base` field: Radix vs. Base UI (January 2026+)
`components.json` now has a `base` field: `"radix"` or `"base"`. alfred uses Radix (`"base": "radix"`).
Base UI components use a `render` prop instead of `asChild` for custom triggers — if you see
`render={<MyElement />}` patterns in docs, those are Base UI, not Radix. Confirm with
`npx shadcn@latest info` → `base` field.

---

## What Was Deliberately Left Out

- **Base UI component patterns** — alfred's `components.json` uses `base: "radix"`. Base UI's
  `render` prop composition pattern is a different API; including it would cause agents to mix up
  the two.

- **`shadcn diff` command** — deprecated in CLI v4. The replacement is `npx shadcn@latest add <name> --diff`.
  Documenting the old command would cause agents to use a no-op.

- **Preset system internals** — named presets (`nova`, `vega`, `maia`, etc.) and preset codes are
  opaque to agents. The rule is: pass them to the CLI unchanged, never decode or reconstruct them.
  Deep documentation would create false confidence in manual preset manipulation.

- **Custom registry authoring** (`npx shadcn@latest build`) — alfred is a consumer, not a registry
  publisher. Out of scope.

- **Storybook / component snapshot testing integration** — relevant to the alfred testing stack
  (see SPEC.md §9) but belongs in the Storybook skill, not here.

- **React Hook Form full API** — covered in the RHF docs and alfred's testing skill. This skill
  only covers the shadcn `Form` wrapper layer.

- **Lower-level `@radix-ui/react-*` individual package docs** — superseded by the unified `radix-ui`
  package in new-york style. Agents should use `npx shadcn@latest docs <component>` to get
  current API docs, not look up individual Radix packages directly.
