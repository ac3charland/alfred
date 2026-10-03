---
branch: claude/alf-329-skill-suggestions-09dkf0
---

# ALF-329: debugging skill, epic ledger, review focus

*2026-10-03T12:53:31.334Z*

implement-epic now keeps its progress ledger at .claude/epic-ledger.md. The file must never be committed, so git ignores it:

```bash
git check-ignore -v .claude/epic-ledger.md
```

```output
.gitignore:40:.claude/epic-ledger.md	.claude/epic-ledger.md
```

The refinement spec template's acceptance criteria now end with an optional Review focus list: edge inputs the spec implies but never mentions, each an impl criterion with a test:

```bash
sed -n '/<h3>Review focus/,/<\/ul>/p' .claude/skills/refinement/assets/spec-template.html
```

```output
  <h3>Review focus</h3>
  <ul class="checks">
    <li data-trace="impl">[input or condition] → [expected behaviour]</li>
  </ul>
```

The bug skill's reproduce and fix steps now route an unexplained cause to the new debugging skill:

```bash
grep -n 'debugging. skill' .claude/skills/bug/SKILL.md
```

```output
34:   If reading the code doesn't explain it, work it with the `debugging` skill before you guess.
38:3. **Fix the cause** — located per the `debugging` skill, not guessed. Then watch the same test go
```
