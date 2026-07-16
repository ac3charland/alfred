---
branch: claude/alf-120-code-items-priority-nud72y
---

# Code stories come in at the top of their project's OUTSTANDING work (ALF-120)

*2026-07-16T21:14:59.213Z*

New code stories are supposed to land at the *top of their project* (ALF-110). But `top_of_project_priority` measured a project's top over EVERY story — including `done`/`abandoned` ones. A completed story keeps its priority, and because new stories are stamped ever-more-negative (top-of-Backlog since ALF-71), a project's best rank is often held by a completed story sitting at the global top. The RPC then treated that hidden story as the project top and returned one step above it — so the new story landed at the top of the WHOLE Backlog, above other projects' outstanding work. ALF-120 measures the project's top/bottom over OUTSTANDING stories only (the set the Backlog shows).

The scenario below spins up a throwaway Postgres, applies every migration exactly as production does, and seeds a backlog where project ACM's best-ranked row is a *completed* story at the global top (rank 1), its visible work starting at rank 5, with another project's story (OTH) at rank 3 in between. It then calls the real `create_code_story` RPC and prints where the new story lands.

```bash
node docs/demos/alf-120-outstanding-project-priority/scenario.ts 2>/dev/null
```

```output
Backlog before — the ACM story at rank 1 is done (hidden); ACM’s top VISIBLE story is rank 5:
       1  ACM-1   ACM    done  (hidden)
       3  OTH-1   OTH    needs_refinement
       5  ACM-2   ACM    needs_refinement

New ACM story ACM-3 created at priority 4.

Backlog after — the new story sits at the top of ACM’s visible list, still behind OTH at rank 3:
       1  ACM-1   ACM    done  (hidden)
       3  OTH-1   OTH    needs_refinement
       4  ACM-3   ACM    needs_refinement
       5  ACM-2   ACM    needs_refinement

Lands above ACM’s top visible story (5): true
Does NOT jump to the whole-Backlog top past OTH’s rank 3: true
Ignored the hidden completed story at rank 1: true
```

The new story lands at priority **4** — the midpoint of OTH's rank 3 and ACM's top visible story at rank 5 — so it is the top of ACM's *visible* list while staying behind OTH's better-ranked work. Before ALF-120 the completed story at rank 1 was treated as ACM's top, and the new story was stamped at ~0, jumping ahead of OTH to the top of the whole Backlog.
