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
- **The Open-other link is a convenience, not a bypass of that rule.** It does not carry a session
  across — you log in to the other instance separately — and it does not make it safe to open the
  work brain on a personal device.
- **The switch link is configured one-directional, on purpose.** Only the **Work** instance sets
  `NEXT_PUBLIC_OTHER_INSTANCE_URL` (→ it shows *Open Personal*); the **Personal** instance leaves it
  unset, so it never offers an *Open Work* link on any device. The app can't detect a cross-origin
  Work login without reintroducing the coupling this model avoids, so this deployment-config choice
  is how "no path to Work from a personal device" is enforced — the Work URL simply never appears on
  the Personal site.

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
projects**, or the two instances drift and one will 500 on the un-migrated path.

**Merging applies it to both.** `.github/workflows/migrate.yml` runs the applier on every push to
`main` as a `personal` / `work` matrix, so the rule above is enforced by the pipeline rather than by
remembering — see [`database/README.md`](../database/README.md#applying-on-merge-the-default-path).
Each database carries its own `public.schema_migrations` ledger, which is what makes "has *this*
instance seen it?" answerable per instance; the two jobs are independent (`fail-fast: false`), so if
one goes red, that instance — and only that instance — is behind until it's re-run.

The committed `database/migrations-applied.log` remains the human-readable, git-reviewable history
of what reached a live database by hand (both pooler hosts are regional and indistinguishable in the
log, so it never tracked instances). Provisioning a brand-new instance is now just pointing the
applier at the empty database: with no schema and no ledger, it applies the whole set from `0001`.

## Offline / cached data

- There is **no service worker or PWA offline cache today**, so nothing sensitive is persisted
  for offline use. If one is ever added, disable offline caching of task/item data (or scope it
  per origin) so the isolation isn't quietly undone by a cache that outlives a session.
