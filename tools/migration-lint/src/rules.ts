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
 * The active rule set, applied to the migrations directory in registration order.
 * This array is the extension point: append a {@link Rule} to lint something new.
 */
export const rules: readonly Rule[] = [sequenceGrant];
