---
name: tailwindcss
description: >
  Use this skill whenever you are writing or editing Tailwind CSS classes, configuring the
  Tailwind theme, wiring up dark-mode tokens, or translating a design description into utility
  classes for the alfred project (Next.js + shadcn/ui + lucide-react, dark dense productivity
  UI). Covers Tailwind v4 (CSS-first @theme config) as the primary target with explicit v3
  gotchas for agents trained on the old tailwind.config.js pattern. For scaffolding or
  composing shadcn/ui components use the shadcn-ui skill; for animation and transition
  tokens use the motion skill.
---

# Tailwind CSS Skill — alfred project

> Source: Tailwind CSS official CHANGELOG (tailwindlabs/tailwindcss), v4.0–v4.3 (retrieved 2026-06-09).
> Source: shadcn/ui official docs, "Tailwind v4" page (ui.shadcn.com, retrieved 2026-06-09).
> Source: Tailwind CSS team blog post "Tailwind CSS v4.0" (tailwindcss.com/blog/tailwindcss-v4, retrieved 2026-06-09).

---

## Mental Model

Tailwind v4 is a **CSS-first** framework. The entire configuration surface has moved from a JavaScript object (`tailwind.config.js`) into your stylesheet. A single `@import "tailwindcss"` replaces the three `@tailwind` directives, and the `@theme` at-rule replaces the `theme: {}` config block.

The critical insight for the alfred project: **design tokens and utility classes are the same thing**. Every CSS custom property you declare inside `@theme` (e.g. `--color-accent-teal: #4FD1E0`) automatically generates a full set of color utilities (`text-accent-teal`, `bg-accent-teal`, `border-accent-teal`, etc.). You do not register tokens in one place and class names in another — they are produced together.

**Two kinds of CSS variables**:
- `@theme { --color-*: value; }` — a **design token**: Tailwind reads it and emits utility classes. Also emitted as a native CSS variable at `:root` so you can use it in plain CSS.
- `:root { --my-var: value; }` — a **plain CSS variable**: available in CSS / `var()` calls but does NOT generate utility classes.

**shadcn/ui bridge pattern**: shadcn defines semantic variables (e.g. `--background`, `--border`) in `:root` and `.dark`. To make Tailwind utilities track them, re-map inside `@theme inline`:
```css
@theme inline {
  --color-background: var(--background);
  --color-border: var(--border);
}
```
The `inline` keyword tells Tailwind to resolve the variable at use-time, not at build-time — required for variables that change with `.dark` toggling.

**Dark mode in v4**: not a config key. Use `@custom-variant` in CSS:
```css
@custom-variant dark (&:where(.dark, .dark *));
```
Then toggle a `.dark` class on `<html>` with JavaScript (e.g. `next-themes`). The `dark:` modifier is then driven by that class.

---

## Decision Tree

**"Where do I put this color/token?"**

```
Is this a brand/palette value that needs utility classes (bg-*, text-*, border-*)?
  YES → Put it in @theme { --color-<name>: <value>; }
  NO, it's a semantic alias that maps to a shadcn variable that changes with dark mode?
    → Put it in @theme inline { --color-<name>: var(--shadcn-var); }
  NO, it's a one-off layout constant (e.g. sidebar width)?
    → Put it in :root { --sidebar-width: 240px; } and reference via arbitrary value: w-(--sidebar-width)
```

**"Do I need tailwind.config.js?"**

```
Am I on v4 with a fresh setup?
  → No. All config lives in globals.css. Do NOT create tailwind.config.js.
Am I on v4 but have a legacy tailwind.config.js?
  → Explicitly load it: add @config "./tailwind.config.js" after @import "tailwindcss".
Am I on v3 (confirmed by package.json)?
  → tailwind.config.js is required. See Version Gotchas.
```

**"CSS variable in a utility class: bracket or parens?"**

```
v4?
  → Use parens shorthand: bg-(--my-color), text-(--my-var)
  → Bracket also works: bg-[var(--my-color)] — but is longer
  → Ambiguous utility (text- = size OR color)? Add type hint: text-(color:--my-var)
v3?
  → Must use bracket: bg-[var(--my-color)]  (no parens shorthand in v3)
```

---

## Plain-English → Pattern Table

| When you need to... | Use this pattern | Key things to know |
|---|---|---|
| **Define the full dark palette once** | `@theme { --color-bg: #0A0E17; --color-surface: #0F1626; ... }` in `globals.css` | Every `--color-*` token auto-generates `bg-*`, `text-*`, `border-*`, `ring-*`, `shadow-*` utilities. No JS file needed. |
| **Wire up shadcn CSS vars as Tailwind utilities** | `@theme inline { --color-background: var(--background); --color-border: var(--border); }` | Must use `inline` keyword so dark-mode overrides on `.dark` selector are respected at runtime. Without `inline`, the value is baked at build time. |
| **Apply a multi-accent glow shadow** | `shadow-[0_0_16px_2px_var(--color-accent-teal)] border border-(--color-accent-teal)` | Arbitrary shadow values: replace spaces with `_`. Glow = large blur, small spread, color at low opacity. Layer with `shadow-[..._rgba(79,209,224,0.15)]` for subtlety. |
| **Card with 1px accent border + soft glow** | `rounded-2xl border border-accent-teal shadow-[0_0_20px_0_rgba(79,209,224,0.12)] bg-surface` | All three parts are needed: border for the line, shadow for the bloom, bg-surface for the layering. Utility `border-accent-teal` works because `--color-accent-teal` is in `@theme`. |
| **Pill / chip (outlined, rounded-full)** | `rounded-full border border-accent-green text-accent-green px-3 py-0.5 text-xs` | For a filled variant swap `bg-accent-green/10` in. The `/10` slash gives 10% alpha via `color-mix()` — no extra class needed. |
| **Eyebrow / small-caps label** | `text-xs font-semibold tracking-widest uppercase text-text-muted` | `tracking-widest` is the Tailwind token for `letter-spacing: 0.1em`. Combine with `uppercase` for true small-caps feel without the `font-variant-smallcaps` browser variance. |
| **Hover lift on a card/row** | `transition-transform duration-150 ease-out hover:-translate-y-0.5 motion-reduce:hover:translate-y-0` | Always add `motion-reduce:hover:translate-y-0` (or `motion-reduce:transition-none`) to cancel for users who opt out of motion. |
| **Restrained entry animation** | `animate-in fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none` | `animate-in` requires `tailwindcss-animate` (bundled with shadcn/ui). The `motion-reduce:animate-none` guard is a hard requirement for accessibility. |
| **Reusable fade in/out (project token)** | `animate-fade-in motion-reduce:animate-none` / `animate-fade-out motion-reduce:animate-none` | Project motion tokens defined in `globals.css` (`--animate-fade-in` / `--animate-fade-out`). For the mount→fade-in / fade-out→unmount toggle pattern and reduced-motion handling, see the **motion** skill. |
| **Define a reusable animation token** | `@theme { --animate-<name>: <name> 200ms ease-out; @keyframes <name> { ... } }` | Each `--animate-*` emits an `animate-<name>` utility; keyframes live **inside** `@theme`. Use plain `@theme` (not `inline`) when the animation doesn't depend on dark-mode vars. |
| **Visible keyboard focus ring** | `focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-bg` | Use `focus-visible:` not `focus:` — the latter fires on mouse click too. `ring-offset-bg` sets the gap color to your page background so the double-ring reads clearly on dark. |
| **Dark-mode text/bg via semantic token** | `bg-background text-foreground` (after `@theme inline` maps them) | Works because shadcn toggles `--background` / `--foreground` values under `.dark`. No `dark:` prefix needed when using semantic tokens this way. For palette overrides use `dark:bg-surface`. |
| **Responsive hamburger / mobile layout** | `hidden md:flex` (desktop nav) + `flex md:hidden` (burger button) | Tailwind v4 breakpoints are unchanged: `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px, `2xl` 1536px. Min-width by default. |
| **Accent color at low opacity (soft tint bg)** | `bg-accent-amber/10` or `bg-[var(--color-accent-amber)]/10` | Slash modifier works on any `bg-*` color including arbitrary. The value is `color-mix(in srgb, ... 10%)` under the hood — no separate opacity class. |
| **Custom type scale once** | `@theme { --text-xs: 0.75rem; --text-sm: 0.875rem; --text-base: 1rem; ... }` | Token names map to `text-xs`, `text-sm`, etc. Pair with `--leading-*` for line-height tokens. Do NOT define both `--font-size-*` (v3 name) and `--text-*` (v4 name) — use v4 names only. |
| **Arbitrary CSS property not in Tailwind** | `[letter-spacing:0.08em]` or `[scrollbar-width:thin]` | Square-bracket arbitrary property syntax. Usable with variants: `hover:[box-shadow:0_0_10px_var(--color-accent-teal)]`. |
| **Utility that needs to work with all variants** | Define with `@utility` in CSS: `@utility card-glow { box-shadow: 0 0 20px rgba(79,209,224,0.12); }` | `@utility` (not `@layer utilities`) is the v4 way — it makes the class variant-aware automatically. Use for repeated multi-property patterns. |

---

## Common Pitfalls

- **Never use `@tailwind base/components/utilities`** in v4. Replace all three with `@import "tailwindcss"`. If you see those directives, you are looking at v3 code.

- **Never put design tokens in `:root` expecting Tailwind utilities to appear.** Only `@theme { }` creates utility classes. `:root { }` creates plain CSS variables only.

- **Always use `@theme inline` (not bare `@theme`) when a token references another variable** that changes with dark mode. Bare `@theme` resolves `var()` at build time; `inline` resolves at runtime.

- **Never write `bg-opacity-*` or `text-opacity-*` in v4** — those utilities were removed. Use the slash modifier: `bg-blue-500/50`. If you need a variable opacity, use `bg-(--my-color)/[var(--my-opacity)]`.

- **Never use `@layer utilities` to define custom classes expecting variant support.** Tailwind v4 no longer hijacks the native `@layer` at-rule. Use `@utility my-class { ... }` instead.

- **Always pair `motion-reduce:` with every animated class.** The alfred project's design spec requires respecting `prefers-reduced-motion`. Minimum: `motion-reduce:transition-none` or `motion-reduce:animate-none` alongside every `transition-*` or `animate-*`.

- **The shadow scale shifted by one step in v4.** The old `shadow` is now `shadow-sm`; old `shadow-sm` is now `shadow-xs`. If a shadow looks larger than expected, you are probably hitting v3 muscle memory on the class name.

- **The border default color changed.** In v3, `border` applied a gray-200 colored border. In v4, `border` defaults to `currentColor`. Always specify the color explicitly: `border border-border` or `border border-accent-teal`.

- **Always use `focus-visible:` for interactive elements, not bare `focus:`.** Mouse clicks trigger `focus:` rings unnecessarily. In the alfred dark UI this is especially noticeable. Apply `focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue` together.

- **Avoid `@apply` for composing component styles in v4.** It still works but is discouraged for variant-dependent styles. Use `@utility` for reusable single-purpose helpers; write full class strings in JSX for component-specific styles.

---

## Version Gotchas (v4 vs v3 — agents are heavily trained on v3)

Agents trained before 2025 will confidently write v3 patterns. These are the most common wrong answers:

| What the agent writes (v3) | What v4 actually needs | Why |
|---|---|---|
| `tailwind.config.js` with `theme: { colors: { ... } }` | `@theme { --color-*: value; }` in CSS | Config moved to CSS entirely in v4 |
| `@tailwind base; @tailwind components; @tailwind utilities;` | `@import "tailwindcss";` | The three directives are gone; one import replaces them |
| `bg-blue-500 bg-opacity-50` | `bg-blue-500/50` | `bg-opacity-*` removed; slash modifier uses `color-mix()` |
| `bg-[var(--my-color)]` | `bg-(--my-color)` (shorter) or still `bg-[var(--my-color)]` (valid but verbose) | v4 added parens shorthand; square bracket still works |
| `@layer utilities { .my-util { ... } }` | `@utility my-util { ... }` | Native `@layer` no longer gives variant-awareness |
| `darkMode: 'class'` in config | `@custom-variant dark (&:where(.dark, .dark *));` in CSS | The `darkMode` config key does not exist in v4 |
| `shadow` (medium shadow) | `shadow-sm` | Entire shadow/blur/rounded scale shifted one step smaller |
| `rounded` (medium radius) | `rounded-sm` | Same shift; `rounded-2xl` is unchanged |
| `theme('colors.blue.500')` in CSS | `var(--color-blue-500)` or `--theme(--color-blue-500)` | Theme variables are now native CSS variables; the old `theme()` function is deprecated in v4 (use the CSS variable form) |
| `extend: { colors: { brand: '#...' } }` | `@theme { --color-brand: #...; }` | Direct CSS, no JS wrapper |
| `content: [...]` in config for content scanning | Not needed — v4 auto-detects source files | Manual content paths are optional; v4 scans by default |

> Source: Tailwind CSS official CHANGELOG, v4.0.0 release (tailwindlabs/tailwindcss, retrieved 2026-06-09).
> Source: Tailwind CSS upgrade guide (tailwindcss.com/docs/upgrade-guide, retrieved via search 2026-06-09).

---

## alfred-Specific Setup Reference

Minimal `globals.css` structure for this project:

```css
@import "tailwindcss";

/* 1. Dark-mode variant driven by .dark class on <html> (next-themes compatible) */
@custom-variant dark (&:where(.dark, .dark *));

/* 2. shadcn/ui semantic variables — define in :root / .dark, NOT in @theme */
@layer base {
  :root {
    --background: #0A0E17;
    --foreground: #E8EDF5;
    --surface: #0F1626;
    --border: #1E2A3F;
    --muted-foreground: #8A96A8;
  }
}

/* 3. Map shadcn semantic vars → Tailwind utilities (inline = runtime resolution) */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-surface: var(--surface);
  --color-border: var(--border);
  --color-text-muted: var(--muted-foreground);
}

/* 4. Palette tokens — these generate ALL color utilities directly */
@theme {
  --color-accent-teal:  #4FD1E0;
  --color-accent-green: #34D399;
  --color-accent-blue:  #60A5FA;
  --color-accent-amber: #F0B429;
}

/* 5. Reusable glow utilities (variant-aware) */
@utility glow-teal  { box-shadow: 0 0 16px 2px rgba(79, 209, 224, 0.15); }
@utility glow-green { box-shadow: 0 0 16px 2px rgba(52, 211, 153, 0.15); }
@utility glow-blue  { box-shadow: 0 0 16px 2px rgba(96, 165, 250, 0.15); }
@utility glow-amber { box-shadow: 0 0 16px 2px rgba(240, 180, 41, 0.15); }
```

> The `@layer base` wrapper around `:root` / `.dark` follows shadcn/ui's pattern so the cascade order doesn't interfere with component overrides.
> Source: shadcn/ui docs, "Tailwind v4" (ui.shadcn.com, retrieved 2026-06-09).

---

## What Was Deliberately Left Out

- **`tailwind.config.js` patterns** — v4 is CSS-first; including JS config patterns alongside CSS config patterns would create confusion about which to follow. The v3 migration path is covered only in Version Gotchas.
- **Tailwind Plugins (`@plugin`)** — alfred does not require custom plugins. The `@utility` and `@custom-variant` directives cover everything needed without plugins.
- **`@apply` recipes** — `@apply` still works but is no longer recommended for building component abstractions in v4. Excluded to steer agents toward `@utility` and full class strings in JSX.
- **JIT-specific v3 features** — JIT was merged into the core in v3.0 and is irrelevant in v4. Excluded to avoid noise.
- **Container queries (`@container`)** — first-class in v4 but not a current alfred requirement. Agents should not reach for it without a specific need.
- **Safelisting and `@source`** — relevant for dynamically-constructed class names but alfred's UI uses static class strings; safelisting is not needed.
- **v2 and earlier patterns** — `text-opacity-*`, legacy JIT config, pre-v3 plugin API — excluded entirely to prevent agents from synthesizing outdated code.
- **`tailwindcss-animate` internals** — `animate-in`/`animate-out` are available via the package shadcn/ui installs; the underlying keyframe authoring is out of scope for this skill.
