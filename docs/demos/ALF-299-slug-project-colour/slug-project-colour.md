---
branch: claude/ticket-slug-project-color-f20pyt
---

# ALF-299: ticket slug on each card matches the project colour

*2026-09-29T19:16:20.660Z*

Every story card on a project board now tints its ticket slug (the ref, e.g. ALF-3) with that project's colour — the same colour the board title, the ProjectNav icon and the Backlog badge already wear. Until now the slug was a fixed teal on every board. The title and the rest of the card stay neutral.

**The palette, on one card each** — the new `ProjectColors` Storybook story (a committed visual baseline): blue, amber, green, red and teal slugs over unchanged neutral titles.

![](slug-project-colour-image-1.png)

**In the live app, with no pick** — three seeded projects. The first-created project (Alfred) is blue by creation slot, so its slugs are blue, abandoned bucket included.

![](slug-project-colour-image-2.png)

The second-created project (Sapling) resolves to amber, so *its* board's slugs are amber — the slug tells you which project a card belongs to.

![](slug-project-colour-image-3.png)

**With the owner's pick** — Reef has a stored green pick, which wins over its creation slot; the slugs follow it.

![](slug-project-colour-image-4.png)

**Recolouring from the toolbar** — before: Alfred at rest, blue title, blue sidebar pill, blue slugs.

![](slug-project-colour-image-5.png)

After picking Red from the palette button (saved through the real PATCH): the title, the sidebar pill and every card slug turn red together.

![](slug-project-colour-image-6.png)

**The drag ghost** — lifting a card on Reef's board: the floating ghost's slug is green like the card it came from (dimmed in place behind it), over the teal-highlighted drop lane.

![](slug-project-colour-image-7.png)

**The committed board baselines moved** (`code-board--seeded` and four siblings). The change sits under the snapshot gate's 1% threshold, so no diff image was emitted; the baselines were removed and regenerated instead. Before — slugs ALF-3, ALF-4, ALF-5, ALF-7 in the old fixed teal:

![](slug-project-colour-image-8.png)

After — the same board, slugs in the project's blue, matching the title:

![](slug-project-colour-image-9.png)

**Review follow-up: the same ticket on the other surfaces that print its slug.** An adversarial review pointed out that a story would otherwise be amber on its board card but teal in the Backlog / Needs human action list and in the detail modal it opens. Both now take the project colour too, through one shared `StoryRef` atom that the board card, its drag ghost, the dashboard queue row, the Backlog row and the modal all render.

The Backlog (and, identically, Needs human action): each row's slug matches the project badge beside it — Alfred blue, Sapling amber, Reef green.

![](slug-project-colour-image-10.png)

The detail modal opened from Sapling's amber card: its header slug is amber, so the card and the modal it opens agree.

![](slug-project-colour-image-11.png)

**Baselines moved by this follow-up:** the four `code-backlog--*` baselines, `code-needshumanaction--seeded` and the eight `code-storydetailmodal--*` ones, all removed and regenerated because the tint is under the snapshot threshold. Measured against the previous baselines, the modal ones differ by about 45 pixels and the Needs-human-action one by 142, all inside the ref; the Backlog ones differ by about 1,000 pixels because they also pick up an unrelated, already-stale heading — the old baselines still read "The Software Factory" where the Backlog has said "Backlog" since before this branch (compare the two images below). Before:

![](slug-project-colour-image-12.png)

After:

![](slug-project-colour-image-13.png)
