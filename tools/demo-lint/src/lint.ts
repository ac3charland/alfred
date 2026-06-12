import type { DemosContext } from './demos.ts';
import { type Finding, type Rule, rules as defaultRules } from './rules.ts';

/** Run every rule against the demos directory and collect the findings. */
export function lintDemos(demos: DemosContext, rules: readonly Rule[] = defaultRules): Finding[] {
  return rules.flatMap((rule) => rule.check(demos));
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
