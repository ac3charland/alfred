import type { MigrationsContext } from './migrations.ts';
import { type Finding, type Rule, rules as defaultRules } from './rules.ts';

/** Run every rule against the migrations directory and collect the findings. */
export function lintMigrations(
  migrations: MigrationsContext,
  rules: readonly Rule[] = defaultRules,
): Finding[] {
  return rules.flatMap((rule) => rule.check(migrations));
}

/** Tally findings by severity. */
export function countBySeverity(findings: readonly Finding[]): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const finding of findings) {
    if (finding.severity === 'error') errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}
