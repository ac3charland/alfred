---
branch: claude/task-item-visual-tweaks-bcotuf
---

# Task item controls centred in the card

*2026-07-03T12:11:46.090Z*

Follow-up to the mobile task-row tweaks: the earlier change centred the checkbox against the *title block*, which looked off once a card also carried a metadata line below the title. Now the leading controls (expand chevron, checkbox) and the trailing actions (+ / ...) centre against the **whole card**.

How: the title and its metadata footer now stack inside one shared mobile column (rowContentColClass — a flex-1 flex-col). The row is a single, non-wrapping line whose leading controls and actions are items-center against that full-height column, so they land in the card vertical centre. At md+ the column is display:contents, dissolving back into the single inline line — desktop is unchanged. This replaces the previous per-row inline meta indent (mobileMetaLeft), since the column already starts under the title.

The mobile-cards baseline (rebased on top of the merged compact-card spacing) moves. In the 3-panel diff (baseline | changed pixels | new render), the new render (right) shows the chevron/checkbox and the + / ... centred beside the two- and three-line titles instead of pinned to the first line. Trade-off: a dense subtask row now shares its column width with the actions, so its badges (e.g. Jul 9 = 0/1) can wrap to a second line — all badges stay visible.

![mobile-cards diff: controls move to the card vertical centre](centering-image-1.png)

The mobile-column-collapse story (which exercises rows that drop the chevron or checkbox column) moves the same way — the controls centre and the badges align under the title through the shared column, with no inline indent.

![mobile-column-collapse diff: controls centred, badges aligned under the title via the shared column](centering-image-2.png)
