import type { MigrationsContext } from './migrations.ts';

export type Severity = 'error' | 'warn';

/** The API roles every sequence must grant USAGE to so security-invoker inserts can allocate from it. */
export const REQUIRED_ROLES = ['anon', 'authenticated', 'service_role'] as const;

/** One problem a rule found in the migrations directory. */
export interface Finding {
  /** The id of the rule that produced this finding. */
  readonly rule: string;
  /** `error` fails the lint; `warn` is advisory and never fails it. */
  readonly severity: Severity;
  /** Human-readable explanation plus how to fix it. */
  readonly message: string;
}

/**
 * A lint rule: a pure check over a {@link MigrationsContext}. To add a rule, write
 * one of these and register it in {@link rules} below — nothing else needs to change.
 */
export interface Rule {
  /** Stable id, shown in findings (e.g. `sequence-grant`). */
  readonly name: string;
  /** One-line summary of what the rule enforces. */
  readonly description: string;
  /** Return a finding per problem, or `[]` when the migrations pass. */
  check(migrations: MigrationsContext): Finding[];
}

/**
 * Every sequence a migration creates must grant USAGE to all the API roles. The
 * insert RPCs are `security invoker`, so a column default's `nextval('<seq>')` runs
 * as the *calling* role — which needs USAGE on the sequence or the insert is rejected
 * with `permission denied for sequence`. A `create sequence` that forgets the grant
 * (as 0005 did, fixed in 0008) is exactly this latent 500, caught statically here.
 */
const sequenceGrant: Rule = {
  name: 'sequence-grant',
  description: 'Every created sequence must grant USAGE to anon, authenticated, and service_role.',
  check(migrations) {
    return migrations.createdSequences.flatMap(({ name, file }) => {
      const granted = migrations.sequenceUsageGrants.get(name);
      const missing = REQUIRED_ROLES.filter((role) => !(granted?.has(role) ?? false));
      if (missing.length === 0) return [];
      return [
        {
          rule: 'sequence-grant',
          severity: 'error' as const,
          message: `sequence ${name} (created in ${file}) is missing USAGE grants for: ${missing.join(', ')}. A security-invoker insert allocates from the sequence via nextval() as the calling role, which needs USAGE or the insert is rejected with "permission denied for sequence". Fix: grant usage on sequence ${name} to anon, authenticated, service_role;`,
        },
      ];
    });
  },
};

/**
 * Every view brought back by a bare `create view` must (re-)grant SELECT to all the API roles.
 * A `drop view` drops the view's privileges, and a bare `create view` (unlike `create or replace`,
 * which preserves them) starts from none — so a widen-a-column drop/recreate that forgets to
 * re-grant leaves a `security_invoker` view unreadable by `authenticated`, and every read fails
 * with `permission denied for view …` → a 500. That is exactly the ALF-124 code-story 500 (0014
 * dropped/recreated `v_code_stories` without re-granting; fixed in 0017). The grant must land at or
 * after the recreate — {@link MigrationsContext.viewSelectGrants} already discards earlier grants —
 * so a stale pre-drop grant can't mask the gap.
 */
const viewGrant: Rule = {
  name: 'view-grant',
  description:
    'Every bare `create view` must re-grant SELECT to anon, authenticated, service_role.',
  check(migrations) {
    return migrations.createdViews.flatMap(({ name, file }) => {
      const granted = migrations.viewSelectGrants.get(name);
      const missing = REQUIRED_ROLES.filter((role) => !(granted?.has(role) ?? false));
      if (missing.length === 0) return [];
      return [
        {
          rule: 'view-grant',
          severity: 'error' as const,
          message: `view ${name} (created in ${file}) is missing SELECT grants for: ${missing.join(', ')}. A bare "create view" (and the "drop view" before it) drops the view's privileges; a security-invoker view then can't be read by the calling role and every query fails with "permission denied for view ${name}" (a 500). A prior grant from before the recreate does NOT count — Postgres dropped it. Fix: grant select on ${name} to anon, authenticated, service_role;`,
        },
      ];
    });
  },
};

/**
 * The numbers two already-applied migrations share, each with the exact filenames that share it.
 * The applier's ledger is keyed by filename, so renaming either file of a pair would make production
 * treat it as unapplied and run it again — these pairs stay as committed. Listing filenames (not just
 * numbers) means a third file arriving at one of these numbers still fails {@link uniqueNumber}.
 */
export const LEGACY_SHARED_NUMBERS: ReadonlyMap<number, ReadonlySet<string>> = new Map([
  [31, new Set(['0031_realtime_items.sql', '0031_respace_code_priority.sql'])],
  [41, new Set(['0041_project_color.sql', '0041_reader_instapaper_source.sql'])],
]);

/** The number a migration filename starts with (`0042_x.sql` → 42), or `undefined` when it has none. */
function migrationNumber(file: string): number | undefined {
  const digits = /^\d+/.exec(file)?.[0];
  return digits === undefined ? undefined : Number.parseInt(digits, 10);
}

/** A migration number as it appears in filenames: zero-padded to four digits. */
function formatNumber(number: number): string {
  return String(number).padStart(4, '0');
}

/**
 * No two migrations may share a number. Migrations apply in filename order and the ledger is keyed
 * by filename, so a shared number never crashes the applier — it silently leaves the pair's relative
 * order to the alphabet. It happens when two branches cut from the same `main` each take the next
 * number and both merge. Numbers are compared as integers, so `42_x.sql` and `0042_y.sql` clash.
 * The legacy pairs in {@link LEGACY_SHARED_NUMBERS} are tolerated exactly as committed.
 */
const uniqueNumber: Rule = {
  name: 'unique-number',
  description: 'No two migrations may share a NNNN number (two applied legacy pairs excepted).',
  check(migrations) {
    const byNumber = new Map<number, string[]>();
    for (const file of migrations.migrationFiles) {
      const number = migrationNumber(file);
      if (number === undefined) continue;
      byNumber.set(number, [...(byNumber.get(number) ?? []), file]);
    }
    const nextFree = formatNumber(Math.max(0, ...byNumber.keys()) + 1);

    return [...byNumber].flatMap(([number, files]) => {
      if (files.length < 2) return [];
      const legacy = LEGACY_SHARED_NUMBERS.get(number);
      if (legacy !== undefined && files.every((file) => legacy.has(file))) return [];
      return [
        {
          rule: 'unique-number',
          severity: 'error' as const,
          message: `migration number ${formatNumber(number)} is used by ${String(files.length)} files: ${files.join(', ')}. Migrations apply in filename order, so a shared number leaves their relative order to the alphabet — usually two branches cut from the same main that each took the next number. Fix: rename the file your branch added (the one not on main — see git diff --name-status origin/main -- database/migrations) to the next free number, ${nextFree}_<name>.sql. Never rename a migration that is already on main: it is applied, and the ledger is keyed by filename, so the new name would run again.`,
        },
      ];
    });
  },
};

/**
 * The active rule set, applied to the migrations directory in registration order.
 * This array is the extension point: append a {@link Rule} to lint something new.
 */
export const rules: readonly Rule[] = [sequenceGrant, viewGrant, uniqueNumber];
