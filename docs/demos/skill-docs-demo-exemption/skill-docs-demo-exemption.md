---
branch: claude/contextual-three-dots-dropdowns-or1mto
---

# demo-lint exempts skill markdown from the demo requirement

*2026-09-04T00:21:17.586Z*

Two changes ride together here, and the first is what unblocked the second.

**The problem.** `branch-folder` exempts a branch whose every change lives under `docs/`, on the grounds that documentation has no behaviour to capture. Skill files are documentation by every meaningful measure — prose the swarm reads — but they live in `.claude/skills/`, outside `docs/`. So a branch that only records a gotcha into a skill was told it owed a demo doc for a change with nothing to demo.

**The fix.** `isDocsPath` now also counts a **markdown file under `.claude/skills/`** as docs. Deliberately markdown-only: a skill may bundle a script (`batch-commits/scripts/batch-commit.mjs`), and a script does have behaviour, so its branch still owes a demo like any other code change.

```bash
cd tools/demo-lint && node --experimental-strip-types 2>/dev/null -e "
import { gatherDemos } from './src/demos.ts';
const ask = (path) => {
  const { hasChangesOutsideDocs } = gatherDemos('../../docs/demos', '.', 'feat/x', [path]);
  console.log((hasChangesOutsideDocs ? 'owes a demo  ' : 'exempt       ') + path);
};
ask('docs/specs/ALF-191.html');
ask('.claude/skills/supabase/SKILL.md');
ask('.claude/skills/git/references/rebase.md');
ask('.claude/skills/batch-commits/scripts/batch-commit.mjs');
ask('.claude/settings.json');
ask('frontend/lib/tasks/dispatch.ts');
"
```

```output
exempt       docs/specs/ALF-191.html
exempt       .claude/skills/supabase/SKILL.md
exempt       .claude/skills/git/references/rebase.md
owes a demo  .claude/skills/batch-commits/scripts/batch-commit.mjs
owes a demo  .claude/settings.json
owes a demo  frontend/lib/tasks/dispatch.ts
```

That exemption is what lets the rest of this branch exist: three gotchas surfaced by an adversarial review of the ALF-191 spec, each now recorded in the skill that owns it. Below is the evidence for each, so the entries rest on observed behaviour rather than on a reviewer's reading.

### 1 · `items.due_date` is a `timestamptz` (→ `supabase` skill)

The write schema accepts a date-only string and Postgres coerces it to midnight, so what you send is not what you read back. A tick that compares a preset to the raw column is always false, and string day-math throws.

```bash
cd frontend && node --experimental-strip-types 2>/dev/null -e "
import { addDays } from './lib/habits/dates.ts';
const fromDb = '2026-09-04T00:00:00+00:00';  // what a reconciled row carries
const preset = '2026-09-04';                 // what todayISODate() produces
console.log('preset === row.due_date :', preset === fromDb);
try { addDays(fromDb, 1); } catch (e) { console.log('addDays(raw)           :', e.constructor.name + ': ' + e.message); }
console.log('after .slice(0, 10)     :', preset === fromDb.slice(0, 10), '| addDays ->', addDays(fromDb.slice(0, 10), 1));
"
```

```output
preset === row.due_date : false
addDays(raw)           : RangeError: Invalid time value
after .slice(0, 10)     : true | addDays -> 2026-09-05
```

### 2 · A disabled menu item's `title` is unreachable (→ `shadcn-ui` skill)

Every `DropdownMenu` item variant sets `pointer-events-none` when disabled, so it is not a hover target and the browser never renders its tooltip. A `Chip` — a plain `<button disabled title>` — keeps pointer events, which is why the same hint works there and silently does not in the menu.

```bash
grep -c 'data-\[disabled\]:pointer-events-none' frontend/components/atoms/dropdown-menu.tsx \
  | xargs printf 'dropdown-menu.tsx  pointer-events-none on disabled: %s variants\n'
grep -c 'pointer-events-none' frontend/components/atoms/chip.tsx \
  | xargs printf 'chip.tsx           pointer-events-none anywhere:    %s\n'
```

```output
dropdown-menu.tsx  pointer-events-none on disabled: 3 variants
chip.tsx           pointer-events-none anywhere:    0
```

### 3 · Portalled content sits outside the snapshot target (→ `storybook` skill)

`DropdownMenuContent` and `DropdownMenuSubContent` both render through a Radix `Portal`, i.e. outside `#storybook-root` — which is what `visualTest.target` defaults to. A snapshot story that opens a menu therefore captures the trigger with **no menu**, and passes forever. The failure is silent, not red.

```bash
grep -n 'const target = visual.target' frontend/.storybook/test-runner.ts
grep -n 'DropdownMenuPrimitive.Portal>' frontend/components/atoms/dropdown-menu.tsx \
  | sed 's/^/portal wrapper at line /'
```

```output
69:    const target = visual.target ?? '#storybook-root';
portal wrapper at line 19:  <DropdownMenuPrimitive.Portal>
portal wrapper at line 34:  </DropdownMenuPrimitive.Portal>
portal wrapper at line 129:  <DropdownMenuPrimitive.Portal>
portal wrapper at line 145:  </DropdownMenuPrimitive.Portal>
```
