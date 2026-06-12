---
name: npm-workspaces
description: >
  Covers npm workspaces in the alfred monorepo: declaring workspaces in root package.json,
  installing dependencies to the root or a specific workspace, running scripts across all
  packages (the --workspaces --if-present fan-out pattern), targeting a single workspace (-w),
  referencing one workspace from another, the root orchestrator check scripts and how husky
  hooks fan out through them, the single-lockfile / hoisting mental model, and the --workspace
  vs --workspaces flag distinction. Use when adding a workspace, installing or hoisting
  dependencies, wiring a fan-out script, or running a script against one or all packages.
---

## Mental Model

An npm workspaces monorepo has **one root package.json** that owns the `"workspaces"` field, **one `package-lock.json`** at the root, and **one `node_modules/` tree at the root** that all packages share. Each subdirectory listed in `"workspaces"` is a *workspace* — a local package with its own `package.json`, its own scripts, and its own `devDependencies`, but no separate lockfile and no separate `node_modules/` (except for version conflicts, which get a local `node_modules/` only for the conflicting version).

The root serves two distinct roles:
1. **Installer:** `npm install` run from the root installs everything for all workspaces into the shared root `node_modules/`. Running it from inside a workspace dir works too, but always reads/writes the root lockfile.
2. **Orchestrator:** root `package.json` scripts fan commands out to every workspace using `--workspaces --if-present`.

Each workspace is independently runnable (its scripts execute from its own directory), but dependency resolution is always rooted at the monorepo root.

**Hoisting:** npm installs a package once at the root if the version is compatible across all workspaces. If two workspaces need incompatible versions of the same dependency, the conflicting version gets a workspace-local `node_modules/` while the other stays hoisted. You never need to manage this manually.

**The alfred layout:**
```
repo root (package.json: "workspaces": ["frontend","workers","database"])
├─ node_modules/          ← single hoisted tree
├─ package-lock.json      ← single lockfile
├─ frontend/package.json  ← owns check:fast, check:slow, check
├─ workers/package.json   ← owns check:fast, check (no check:slow)
└─ database/package.json  ← may own no check scripts at all
```

The root `check:fast`, `check:slow`, and `check` scripts each run:
```
npm run <tier> --workspaces --if-present
```
This fans the command to every workspace and **gracefully skips** any workspace whose `package.json` does not define that script. That's how workers' missing `check:slow` and database's missing checks are silently bypassed without failing the root command.

---

## Decision Tree

**Do you want to install/add a package?**
- To a specific workspace only → `npm install <pkg> -w <workspace-name>`
- To the root (shared tooling, husky, commitlint, etc.) → `npm install <pkg>` from the repo root (no `-w` flag)
- Reinstall everything from scratch → `npm install` from the repo root (no flags needed; installs all workspaces automatically)

**Do you want to run a script?**
- In ONE workspace → `npm run <script> -w <workspace-name>`
- In ALL workspaces, fail if any is missing the script → `npm run <script> --workspaces`
- In ALL workspaces, skip any that don't have the script → `npm run <script> --workspaces --if-present` ← **this is the alfred orchestrator pattern**
- In a SUBSET of workspaces → repeat `-w`: `npm run <script> -w frontend -w workers`

**Do you need one workspace to depend on another?**
→ `npm install <other-workspace-name> -w <this-workspace>` — npm detects the workspace and symlinks it; the `package.json` entry gets a standard version range (`"^1.0.0"`), not the `workspace:` protocol.

**Should a new devDependency go in the root or a workspace?**
- Root: tooling that affects the whole repo (husky, commitlint, TypeScript base configs, prettier)
- Workspace: tooling that only that package uses (Next.js, Wrangler, Jest configs, package-specific ESLint plugins)
- When unsure: put it in the workspace that owns it; hoist later if multiple workspaces want the same version

---

## Plain-English → Pattern Table

| When the user says... | Use this pattern | Key things to know |
|---|---|---|
| "run check:fast across all packages, skipping any that don't have it" | `npm run check:fast --workspaces --if-present` | `--if-present` is what makes missing scripts a no-op instead of an error; `--workspaces` (plural, no `-w`) means all configured workspaces |
| "add a dep to just the frontend" | `npm install <pkg> -w frontend` | `-w` is the short form of `--workspace`; the dep lands in `frontend/package.json`, not root `package.json` |
| "add a dev dep to the root" | `npm install <pkg> -D` (from repo root, no `-w`) | Root deps go in root `package.json`; use this for husky, commitlint, shared TypeScript config, etc. |
| "install everything from the root / fresh setup" | `npm install` (from repo root) | Installs all workspaces' deps into the shared root `node_modules/`; no `-w` needed; also creates/updates the single `package-lock.json` |
| "run a script in one workspace only" | `npm run <script> -w <workspace-name>` | `-w` accepts the workspace's `name` field from its `package.json`, not the directory name (though they're usually the same) |
| "make a root script fan out to all packages" | `"<script>": "npm run <script> --workspaces --if-present"` in root `package.json` | Packages missing the script are silently skipped; execution order follows the order in root `"workspaces"` array |
| "reference the shared types / database package from frontend" | `npm install <workspace-pkg-name> -w frontend` | npm auto-detects it's a workspace and symlinks it; the entry in `frontend/package.json` will be a standard semver range like `"^1.0.0"`, not `workspace:*` |
| "target two specific workspaces but not the third" | `npm run <script> -w frontend -w workers` | Repeat `-w` for each workspace; this does NOT use `--workspaces` (plural) |
| "run check:slow only — skipping workers and database which don't have it" | `npm run check:slow --workspaces --if-present` | Exactly the alfred pattern; frontend defines `check:slow`, others don't, so others are silently skipped |
| "add the same dep to every workspace at once" | `npm install <pkg> --workspaces` | Adds to all workspace `package.json` files; only do this if every workspace genuinely needs it |
| "declare workspaces in root package.json" | `"workspaces": ["frontend", "workers", "database"]` in root `package.json` | Paths are relative to root; globs work too (`"packages/*"`); order determines execution order for `--workspaces` commands |
| "run npm exec / npx in a workspace context" | `npm exec -w <workspace> -- <cmd>` | Same `-w` flag works with `npm exec`; runs the binary from within the workspace directory |
| "check which workspaces are configured" | `npm ls --workspaces` or inspect root `package.json` `"workspaces"` field | `npm ls --workspaces` shows the dependency tree per workspace |

---

## Common Pitfalls

**Always run `npm install` from the repo root, not from inside a workspace directory.** Running it inside a workspace still reads/writes the root lockfile (correct) but can cause confusion and some edge-case behaviors; the root is the canonical install location.

**Never create a `package-lock.json` inside a workspace directory.** There is exactly one lockfile for the whole repo, at the root. If one appears inside a workspace (e.g. from running `npm install` in that directory on a fresh clone), delete it and run `npm install` from the root.

**Always use `--workspaces --if-present` together for orchestrator scripts.** Using `--workspaces` alone will exit with an error if any workspace lacks the script. In alfred, `workers/` has no `check:slow` and `database/` may have no `check:*` scripts at all — `--if-present` is what makes the fan-out safe.

**Never use `workspace:*` protocol in npm.** It is a pnpm/Yarn feature. The npm documentation previously mentioned it, but it throws `EUNSUPPORTEDPROTOCOL` in npm (confirmed broken as of npm 11.6.4; see npm/cli issue #8845). Use `npm install <workspace-name> -w <other-workspace>` instead — npm auto-symlinks it and writes a normal semver range.

**`-w` matches the `"name"` field in the workspace's `package.json`, not the directory name.** They're usually the same in alfred, but if a workspace's `package.json` has `"name": "@alfred/frontend"` and the directory is `frontend/`, the flag must be `-w @alfred/frontend` (or `-w frontend` if npm resolves it by path, but the name is safer).

**Execution order under `--workspaces` is the order of the `"workspaces"` array in root `package.json`.** If workspace B depends on workspace A's build output, list A before B.

**Root `node_modules/.bin` entries are shared.** A CLI tool installed in any workspace (or the root) is available to all. This is usually convenient but can mask missing local installs when running outside the monorepo.

**`--if-present` is a flag for `npm run`, not a general workspace flag.** It tells npm to skip the command silently when the named script isn't defined. It has no effect on `npm install` or `npm exec`.

---

## Version Gotchas

**npm workspaces require npm 7+.** The feature was introduced in npm 7 (ships with Node.js 15+; backported to Node.js 14 via separate install). npm 6 silently ignores the `"workspaces"` field. Run `npm --version` to confirm ≥ 7.

**`-w` as a shorthand for `--workspace` was stabilized in npm 7.14.0.** Earlier npm 7.x builds require the full `--workspace` flag. Alfred is unlikely to encounter this on any modern Node version, but it explains why you may see the long form in older documentation.

**`workspace:` protocol was incorrectly documented for npm.** npm's own docs previously showed `npm install b@workspace:* -w a` — this was a documentation error copied from pnpm/Yarn. It was corrected (npm/cli commit 16ac4e0, 2026) to show `npm install b -w a`. Always use the short form without the protocol specifier.

**Install with the SAME npm major that generated the committed lockfile, or you get huge spurious drift.** The repo lockfile was generated by **npm 11**. Running `npm install` under an older npm (e.g. the **npm 10.9.7** that ships with the local Node) rewrites lockfile metadata non-deterministically — adding `"dev": true` and deleting `"libc": [...]` across dozens of unrelated optional/platform packages. CLAUDE.md flags this as drift to revert, but the cleaner fix is to **use the matching npm**: when adding/removing a dependency or workspace, `git checkout package-lock.json` then run `npx --yes npm@11 install` so the only diff is your real change (the new `workspaces` entry, the `node_modules/<pkg>` link, and any genuinely new resolved deps). Check `git diff package-lock.json` before committing — a net *deletion* of lines for an *addition* is the tell that you ran the wrong npm.

---

## What Was Deliberately Left Out

**Turborepo / Nx.** alfred's SPEC.md explicitly notes these as a future optional layer for running only affected packages and caching results (`turbo run check:fast --filter=...[HEAD]`). They're not adopted now. This skill covers only npm workspaces primitives. If/when Turborepo is added, a separate `turborepo` skill should cover it.

**`npm ci` vs `npm install` nuance.** `npm ci` also respects workspaces and is preferred in CI (installs exactly from the lockfile, never updates it). That's a CI concern and covered in the CI setup skill rather than here.

**`--include-workspace-root` flag.** This flag makes root-targeting scripts also run on the root package itself. The alfred orchestrator doesn't need this — the root scripts are the orchestrators, not participants.

**Yarn / pnpm workspaces.** Different flag names, different protocols (`workspace:`), different hoisting strategies. Only npm is in scope for alfred.

**Publishing workspace packages to npm registry.** Alfred is a private single-user app; no packages are published. Workspace publishing patterns (`npm publish -w <ws>`, `private: true`, `publishConfig`) are out of scope.

**Parallel script execution.** `npm run --workspaces` runs workspaces sequentially (in declaration order). Running them in parallel requires a third-party tool (e.g. `concurrently`, `npm-run-all`) or Turborepo. This project runs sequentially, which is fine for a small three-workspace monorepo.
