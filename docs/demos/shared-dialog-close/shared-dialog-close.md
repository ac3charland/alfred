---
branch: claude/story-modal-close-button-mobile-z96f2h
---

# One shared modal close, with the mobile tap target on both modals

*2026-07-26T04:27:01.430Z*

`fix(code): enlarge story modal close button on mobile` (ALF-138, already on `main`) gave the **story detail modal** a 44px close on mobile by editing that file's inline `DialogClose`. The **epic spec modal** carried a byte-identical copy of the same control and was left behind at `p-1` — still about 24px on a phone.

This branch consolidates the two copies into one control — a `dialog` variant on the `CloseButton` atom, wrapped as `DialogCloseButton` — so the epic spec modal picks up the same target, the story modal's behaviour is preserved exactly, and the next change to the dismiss lands in one place instead of two.

Every shot below is the live app driven through the Playwright mock harness.

## Epic spec modal at 390px — the behavioural change

Its dismiss takes focus when the modal opens, so the focus ring traces the tap target exactly.

**Before** (what `main` ships today) — the ~24px box the story modal used to have.

![](shared-dialog-close-image-1.png)

**After** — 44px, matching the story modal.

![](shared-dialog-close-image-2.png)

## Story detail modal at 390px — unchanged

The refactor is behaviour-preserving here: swapping the inline copy for the shared atom renders the same 44px close `main` already ships.

![](shared-dialog-close-image-3.png)

## Desktop (1280px) — unchanged

The enlargement stays `md:`-gated, so a pointer device keeps the dense header.

![](shared-dialog-close-image-4.png)

## One control, not two copies

Neither modal declares close classes any more.

```bash
grep -n 'DialogCloseButton' frontend/components/code/story-detail-modal.tsx frontend/components/code/epic-spec-modal.tsx
```

```output
frontend/components/code/story-detail-modal.tsx:6:import { DialogCloseButton, DialogTitle, FormDialog } from '@/components/atoms/dialog';
frontend/components/code/story-detail-modal.tsx:210:        <DialogCloseButton />
frontend/components/code/epic-spec-modal.tsx:3:import { DialogCloseButton, DialogTitle, FormDialog } from '@/components/atoms/dialog';
frontend/components/code/epic-spec-modal.tsx:23:        <DialogCloseButton />
```

```bash
sed -n '/dialog:/,+1p' frontend/components/atoms/close-button.tsx
```

```output
        dialog:
          'inline-flex h-11 w-11 items-center justify-center text-2xl leading-none md:h-auto md:w-auto md:p-1 md:text-lg',
```
