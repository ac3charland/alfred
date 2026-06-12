# Inline title edit is optimistic

*2026-06-12T18:35:40.218Z*

Double-clicking a task title opens an inline editor. On submit (Enter or the confirm button), the edit is applied **optimistically**: the editor closes and the new title shows instantly via the tasks store's optimistic patch — `handleSaveTitle` no longer awaits the server before exiting edit mode. The store reconciles with the saved row in the background (or rolls the title back on failure), exactly like the due-date, notes, complete, move, and delete interactions.

In the recording, the PATCH to the server is artificially held for ~1.2s. The title flips to its new value the instant Enter is pressed — well before the request resolves — proving the update is driven by the optimistic store, not the network round-trip.

![Double-click title, retype, Enter; the new title appears instantly while the PATCH is still in flight](optimistic-title-edit-video-1.gif)
