---
branch: claude/stryker-at-ceiling-audit-z2n2s1
---

# Stryker AT_CEILING audit: cosmetic class suppressions → tested style modules

*2026-06-20T19:27:22.828Z*

The Stryker audit found ~44 `// Stryker disable … StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect` markers across the frontend. Each silenced a survived mutant on a Tailwind class string rather than killing it. This change removes every cosmetic suppression and instead makes the mutants *killable*: the class clusters move into co-located `*.styles.ts` modules locked by `toContain` unit tests (the existing `navLinkClass` pattern), while the atoms assert their classes on rendered output via `toHaveClass`. The logic-equivalence AT_CEILING markers (null-guards, dead defensive code, the redundant compact-Enter handler) are genuinely equivalent and stay.

```bash
grep -rln 'no behavioral effect' frontend/components frontend/lib | wc -l | tr -d ' '
```

```output
0
```

```bash
ls frontend/components/tasks/*.styles.ts frontend/components/tasks/task-row/*.styles.ts
```

```output
frontend/components/tasks/capture-box.styles.ts
frontend/components/tasks/cascade-modal.styles.ts
frontend/components/tasks/folder-drop-zone.styles.ts
frontend/components/tasks/inbox-screen.styles.ts
frontend/components/tasks/task-row.styles.ts
frontend/components/tasks/task-row/task-meta-panel.styles.ts
```

```bash
cat frontend/components/tasks/folder-drop-zone.styles.ts frontend/components/tasks/folder-drop-zone.styles.test.ts
```

```output
/**
 * Visual styling for the sidebar drop zone, extracted so the drag-state-only classes can be
 * locked by a unit test without standing up a live dnd-kit drag (useDroppable is inert in
 * jsdom, so `isOver` never flips there).
 */
export const dropZoneBaseClass =
  'rounded-sm transition-colors duration-100 motion-reduce:transition-none';
export const dropZoneActiveClass = 'bg-accent-teal/15 ring-1 ring-accent-teal/50';
import { dropZoneActiveClass, dropZoneBaseClass } from './folder-drop-zone.styles';

describe('folder-drop-zone styles', () => {
  it('base zone styling is a rounded surface with a colour transition', () => {
    expect(dropZoneBaseClass).toContain('rounded-sm');
    expect(dropZoneBaseClass).toContain('transition-colors');
    expect(dropZoneBaseClass).toContain('motion-reduce:transition-none');
  });

  it('active (hovered) styling adds the teal wash + ring', () => {
    expect(dropZoneActiveClass).toContain('bg-accent-teal/15');
    expect(dropZoneActiveClass).toContain('ring-accent-teal/50');
  });
});
```

Verification (`npm run mutation -w frontend`, scoped per file): the 6 new style modules score **100% — 33/33 mutants killed, 0 survived**; the four atoms (due-date-chip, text-field, icon-button, field-label) score **100%**; `lib/ui/nav-link-class.ts` **100%**. Every previously-suppressed cosmetic className mutant is now killed by a test instead of silenced. (folder-nav retains 9 pre-existing, unrelated logic survivors that never carried a suppression — out of scope for this audit.)
