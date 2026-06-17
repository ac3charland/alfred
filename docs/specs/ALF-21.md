# ALF-21 — Dismiss new folder textbox on escape or click outside

## Context / problem

The **new-folder creation form** appears inline in the sidebar when the user clicks the "+" (Create folder) button. Once open, the only way to close it without saving is to press Escape. There is no way to dismiss it by clicking elsewhere — a standard UX expectation for any inline text input.

The same `FolderNameForm` component (`frontend/components/tasks/folder-nav.tsx`, lines 33–75) is reused for the **folder rename** form (opened via a folder's "Edit" option); it has the same gap.

The Escape key handler (`onKeyDown` checking `event_.key === 'Escape'`) is already implemented and unit-tested for both the create form (lines 298–322 of `folder-nav.test.tsx`) and the rename form (lines 543–556). This ticket adds the missing **click-outside** dismissal.

## Proposed change

When the user clicks (or taps) anywhere outside the currently-open `FolderNameForm` — whether it is the create-folder form or the rename-folder form — that form is dismissed without saving.

Behaviour is identical to pressing Escape:

- **Create form:** discard the pending name, hide the form, restore the "+" button area; re-opening shows an empty input.
- **Rename form:** discard the edited name, hide the form, restore the folder's nav link with its original name.

A click **inside** the form (on the text input or the submit button) must never trigger dismissal.

## Acceptance criteria

- [ ] Clicking anywhere outside the active create-folder form dismisses it; no folder is created; the input value is cleared; the "+" button area is restored.
- [ ] Re-opening the create form after a click-outside dismiss shows an empty input (same state as a fresh open).
- [ ] Clicking anywhere outside the active rename-folder form dismisses it; no rename is applied; the folder's nav link is restored with its original name.
- [ ] Clicking inside the form — on the text input or on the check (submit) button — does **not** dismiss it; the submit button still saves.
- [ ] Pressing Escape continues to dismiss both forms (existing behaviour must not regress).
- [ ] Submitting via Enter key or the check button still works as before.
- [ ] Unit tests cover the click-outside dismiss path for the create form and the rename form.

## Out of scope / open questions

- **Rename form in scope?** The ticket title says "new folder textbox", but `FolderNameForm` is the shared component for both create and rename. This spec treats both as in scope because fixing one and not the other would be inconsistent UX and the shared component makes it a single change. If rename should be excluded, raise it before implementing.
- **Implementation approach is left to the implementer.** Two common patterns:
  - Attach a `pointerdown` listener on `document` inside a `useEffect`, compare the event target to a `ref` on the `<form>` element, and call `onCancel` when the target is outside. This is generally more reliable because it fires before `blur` and avoids the blur-before-click race on the submit button.
  - Use the form's `onBlur` event with `relatedTarget` checking to detect focus leaving all focusable children of the form.
  Either is acceptable so long as all acceptance criteria above are met.
- **Mobile / touch** is not explicitly in scope; the click-outside mechanism should work on tap too (pointer events fire on touch), but no mobile-specific edge cases are in scope for this ticket.
