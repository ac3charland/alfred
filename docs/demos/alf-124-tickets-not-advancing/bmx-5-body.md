## What & why

Implements **BMX-5**: a way to open the selected bookmark in an incognito window from Bookmark Express (v3, the current MV3 build).

**Cmd+Shift+Enter** (Ctrl+Shift+Enter on Windows/Linux, or Cmd/Ctrl+Shift+click) opens the highlighted bookmark in a fresh incognito window. Per the ticket, this is a **fixed keystroke with no toggle** to change it (unlike the new/same-tab behavior, which keeps its Invert toggle), and it's surfaced in the popup's helper footer.

## Changes

- **`src/lib/settings.ts`** — new `OpenMode` type (`new-tab` / `same-tab` / `incognito`) and an `openMode()` helper that resolves the held modifiers.
- **`src/App.svelte`** — the shared `open()` controller now dispatches on `OpenMode`, adding an incognito branch that calls `chrome.windows.create({ url, incognito: true })`.

## Notes

Incognito relies on `chrome.windows.create` (no manifest permission needed).

```alfred
alfred-ticket: BMX-5
phase: implementation
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
