# Capture from iOS with a Siri Shortcut

alfred's capture endpoint (`POST /api/items`) is the **single ingest path** for both the
in-app capture box and external callers. For external/voice capture it accepts a shared
**API key** instead of a logged-in session, so a Siri Shortcut can drop items straight into
your Inbox. See SPEC §4.2–4.3.

## The endpoint

```
POST https://<your-app-domain>/api/items
Headers:
  x-api-key: <INGEST_API_KEY>          # the value from frontend/.env.local / Vercel env
  Content-Type: application/json
Body:
  { "text": "buy oat milk" }
```

- The key is validated against the server-only `INGEST_API_KEY`. On a match, the item is
  created with the **secret key** server-side (bypassing RLS), so capture works without a
  browser session. On mismatch (or no key) the endpoint requires a logged-in session and
  returns `401`.
- `text` maps to both `title` and `raw_capture`, and the item lands in the Inbox as
  `item_type: "unclassified"` (classification happens later, manually or via the future
  LLM layer). Returns `201` with the created item.
- You can also send `{ "title": "..." }` plus optional `notes`, `due_date`, `folder_id`, etc.

> **Keep the key secret.** Anyone with the URL + key can create items. It's a single-user
> system, so that's an acceptable tradeoff — but treat the key like a password, store it only
> in env/secret stores, and rotate it (regenerate `INGEST_API_KEY`, update Vercel + the
> Shortcut) if it leaks.

## Build the Shortcut (iOS Shortcuts app)

1. **New Shortcut** → name it e.g. *“Capture to alfred.”*
2. Add a **Wait** action set to **~2 seconds**. *(Mitigation for the known Siri dictation
   truncation bug — §4.3. The short delay resolves a timing/race issue that otherwise cuts
   off the start of dictated text.)*
3. Add **Dictate Text**. Optionally set *Language* and tune *Stop Listening* to **After
   Pause** (or **On Tap** for longer notes) so it doesn't cut you off.
4. Add **Get Contents of URL**:
   - **URL:** `https://<your-app-domain>/api/items`
   - **Method:** `POST`
   - **Headers:** add `x-api-key` = `<your INGEST_API_KEY>` and
     `Content-Type` = `application/json`
   - **Request Body:** `JSON` → add a field, key `text`, value = the **Dictated Text**
     variable from step 3.
5. *(Optional)* Add **Show Notification** with the result, or **Get Dictionary Value** →
   `title` to confirm what was saved.
6. *(Optional)* **Add to Siri** with a trigger phrase, and/or add the Shortcut to your Home
   Screen / Lock Screen / Action Button for one-tap capture.

## Why the delay matters (§4.3)

Siri's *Dictate Text* can truncate input, especially the first word(s). Two mitigations:

- The **~2s Wait before Dictate** (step 2) — the most reliable fix in practice.
- Prefer the Shortcuts app's **Dictate Text** action with tuned stop-listening over a raw
  “Hey Siri, …” voice command.

The future LLM cleanup layer (a Cloudflare Worker in front of `POST /api/items`) will also
de-ramble and recover meaning from truncated voice input, making capture more forgiving.

## Cross-device access

alfred is a web app deployed on Vercel, reachable from any device after login:

- **Phone:** open the app URL in Safari and **Add to Home Screen** for an app-like icon;
  use the Siri Shortcut above for hands-free/voice capture.
- **Personal desktop:** just the URL in any browser.
- **Work computer (optional):** same URL; all state lives in Supabase, so every device sees
  the same data.

All clients are thin — there is no local state to sync; the backend is the single source of
truth (SPEC §1, device-portability requirement).
