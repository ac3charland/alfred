# Two-instance isolation — operating discipline

alfred runs as **two completely isolated instances** — a **Personal** second brain and a
**Work** one. Each is its own Vercel project pointed at its own Supabase project, so tasks,
folders, code items, and captures are **physically separated**: the two share no session, no
cookies, and no database. "Switching" between them is just a full navigation to the other
origin (the top-right account menu's **Open <other>** link).

This physical separation is the whole point — but it only holds if it's operated with
discipline. The notes below are the human side of that contract.

## Device discipline (the compliance rule)

- **Open the Work URL only on work devices; open the Personal URL only on personal devices.**
  Logging into an instance on a device fetches, renders, and caches that instance's data on it —
  so opening the Work instance on a personal machine puts work data on a personal machine, the
  exact thing the two-deployment model exists to prevent.
- **The Open-other link is a convenience, not a bypass of that rule.** It exists so that, on a
  device where you legitimately use both, moving between brains is one click. It does not carry a
  session across — you log in to the other instance separately — and it does not make it safe to
  open the work brain on a personal device.

## Per-instance secrets

- **Each instance has its own `INGEST_API_KEY`.** The external capture path (the Siri Shortcut)
  presents this shared secret to write to that instance. Keeping them distinct means a leaked
  Personal key cannot write into the Work brain, and vice versa.
- Each instance also has its own Supabase URL, keys, and single auth user — provisioned per
  instance, never shared.

## Shared engineering — apply every schema change to both

Both instances run **identical code** from `main` (a push deploys both Vercel projects) and share
**one** `database/migrations/` set — but each has its **own** Supabase database. So a schema change
is only half-done when it lands in git: **every new migration must be applied to _both_ Supabase
projects**, or the two instances drift and one will 500 on the un-migrated path. Call this out in
any migration's rollout notes, and apply it to Personal and Work as part of shipping it.

There is a single committed migration ledger (`database/migrations-applied.log`); it tracks the
shared schema history, not per-instance applies (both pooler hosts are regional and
indistinguishable in the log). Provisioning a brand-new instance replays the whole set out of band
and is not recorded there.

## Offline / cached data

- There is **no service worker or PWA offline cache today**, so nothing sensitive is persisted
  for offline use. If one is ever added, disable offline caching of task/item data (or scope it
  per origin) so the isolation isn't quietly undone by a cache that outlives a session.
