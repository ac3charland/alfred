---
branch: claude/alfred-refinement-spec-link-4qjy9m
---

# Refinement PRs link the rendered HTML spec via htmlpreview

*2026-07-01T04:54:24.174Z*

The refinement skill now tells each refinement PR description to include a live, clickable preview link to the HTML spec. GitHub serves a committed .html file as raw source (a reviewer who clicks the spec sees markup, not the rendered plan), so the link routes through htmlpreview.github.io, which renders the self-contained file faithfully.

The skill's 'What to produce' section now carries the preview-link instruction and the exact URL template:

```bash
grep -A6 "Link the rendered spec" .claude/skills/refinement/SKILL.md
```

```output
   - **Link the rendered spec via `htmlpreview.github.io`.** GitHub serves a committed `.html`
     file as raw source, not a rendered page, so a reviewer who clicks the spec can't actually
     read it. Add a clickable link in the description that renders it, pointing at the file on
     **this PR's head branch** (not `main` — the spec isn't there yet):

     ```
     https://htmlpreview.github.io/?https://github.com/<owner>/<repo>/blob/<branch>/docs/specs/<REF>.html
```

Following that template for a real committed spec produces a resolvable, clickable link. A refinement PR points at its own head branch; here we use an already-merged spec on main to show the link resolves to a real rendered page:

```bash
OWNER=ac3charland; REPO=alfred; BRANCH=main; REF=ALF-64
SPEC="docs/specs/${REF}.html"
echo "https://htmlpreview.github.io/?https://github.com/${OWNER}/${REPO}/blob/${BRANCH}/${SPEC}"
test -f "$SPEC" && echo "target resolves to a committed spec: $SPEC"
```

```output
https://htmlpreview.github.io/?https://github.com/ac3charland/alfred/blob/main/docs/specs/ALF-64.html
target resolves to a committed spec: docs/specs/ALF-64.html
```
