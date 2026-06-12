# Anti-patterns in skill structure and layout

Real before/after examples from this repo's history, for when you're deciding where
content lives — SKILL.md body vs `references/` — and how readers find it. The
recurring failure: bodies drift toward "everything we know" when they should be
"what you need every time."

## Contents

- [The target shape](#the-target-shape) — what a skill with references looks like
- [Setup-only gotchas in the main body](#setup-only-gotchas-in-the-main-body) — one-time wiring details that don't apply to routine use
- [No index of what the skill covers](#no-index-of-what-the-skill-covers) — bundled references with no Contents section routing to them
- [Sections ordered by accretion](#sections-ordered-by-accretion) — placement by when it was written, not how often it's needed

---

## The target shape

```
skill-name/
├── SKILL.md            # every-time guidance + a Contents section routing to the rest
└── references/
    ├── <topic>.md      # setup, wiring, maintenance, rare scenarios
    └── …
```

The body loads on every trigger; references load only when needed. The test for
body residency: **would an agent doing routine work in this area need this almost
every time?**

---

## Setup-only gotchas in the main body

One-time setup details, wiring gotchas, and config scaffolding that's only relevant
when standing up a feature for the first time. In the main body they inflate
reading time for every agent that opens the skill to write a test or use a tool —
even though most of those agents will never need them.

Rule: if the agent would only need this when setting up from scratch or debugging a
setup-level failure, it belongs in `references/`.

### Example: playwright wiring gotchas dumped in the main body

When the Playwright integration suite was wired up, seven specific gotchas from
that process were recorded directly in the skill body under `### Gotchas hit wiring
this up` — things like `import.meta` breaking the CJS config loader, `.ts`
extension import errors, and UUID seed-id requirements. Genuinely useful, but only
when someone is wiring the suite; an agent authoring a spec doesn't benefit from
reading them.

**Before:** a seven-bullet `### Gotchas hit wiring this up` section in the SKILL.md
body.

**After:** moved to `references/setup-and-wiring.md`; the body keeps a pointer:

```markdown
> **Setting up the suite, editing config, or debugging a setup-level failure?** The full
> `playwright.config.ts` / `auth.setup.ts` reference, the Storybook test-runner browser config,
> and the gotchas hit wiring this suite up (CJS / `import.meta`, `.ts` import extensions, UUID
> seed ids, Radix submenu keyboard nav, optimistic-reload races, `getByText` substring matching,
> …) live in [`references/setup-and-wiring.md`](references/setup-and-wiring.md)
```

### Example: full config template inline in the skill body

A complete `playwright.config.ts` TypeScript template and `auth.setup.ts`
boilerplate lived inline in SKILL.md. They're only needed when standing up the
suite — and added ~50 lines to every skill read for routine test authoring.

**After:** moved to `references/setup-and-wiring.md` alongside the wiring gotchas.

### Example: edge cases and maintenance sections inline

The batch-commits skill had two inline sections for rarely-needed scenarios: "Edge
cases & failure modes" and "Maintaining the tool". The failure modes only matter
when something goes wrong; the maintenance section only applies when someone is
modifying the tool itself.

**After:** both moved to separate reference files, routed from a closing section:

```markdown
## Further Reading

- Getting unexpected output? See [failure-modes.md](./references/failure-modes.md)
- Updating/maintaining the tool? See [maintenance-gotchas.md](./references/maintenance-gotchas.md)
```

---

## No index of what the skill covers

A skill with bundled references but no Contents section. An agent partially reading
SKILL.md can't see what the skill can answer or where; the references are
discoverable only by listing the directory.

### Example: Contents sections added to playwright and batch-commits

Manual polishes added a Contents block at the top of both skills, listing the
body's sections *and* the bundled references/scripts, each reference with a
one-line "when to read" note.

**After (playwright):**

```markdown
**References**
- [`references/setup-and-wiring.md`](references/setup-and-wiring.md) — `playwright.config.ts` /
  `auth.setup.ts` reference, Storybook test-runner browser config, and gotchas hit wiring
  the integration suite
```

A new reference doc isn't done until it's listed there. The same applies inside the
reference doc: open with what the file holds and when to reach for it, so a partial
read can decide whether to continue.

---

## Sections ordered by accretion

New sections appended wherever they happened to be written, regardless of how often
they're needed. Position signals priority.

### Example: every-spec material below a sandbox-provisioning section

A polish of the playwright skill moved "Mocking the backend" (relevant to every
spec) above "Browser availability: Claude Code on the web" (a provisioning concern
that had sat higher purely because it was written first).

**Before:** Browser availability → Storybook test-runner → config reference →
Mocking the backend last.

**After:** Mocking the backend up with the other every-time material; browser
availability near the bottom.
