import path from 'node:path';

import { type Finding, type Rule, rules as defaultRules } from './rules.ts';
import type { SkillContext } from './skill.ts';

/** All findings for one skill. */
export interface SkillReport {
  readonly skill: SkillContext;
  readonly findings: readonly Finding[];
}

/** Run every rule against a single skill and collect the findings. */
export function lintSkill(
  skill: SkillContext,
  rules: readonly Rule[] = defaultRules,
  library: readonly SkillContext[] = [skill],
): Finding[] {
  return rules.flatMap((rule) => rule.check(skill, library));
}

/**
 * Run every rule against each skill, preserving input order. `library` holds every skill a rule
 * may compare against, even when only the changed skills are linted; each skill sees only the
 * ones in its own skills directory.
 */
export function lintSkills(
  skills: readonly SkillContext[],
  rules: readonly Rule[] = defaultRules,
  library: readonly SkillContext[] = skills,
): SkillReport[] {
  return skills.map((skill) => {
    const siblings = library.filter((other) => path.dirname(other.dir) === path.dirname(skill.dir));
    return { skill, findings: lintSkill(skill, rules, siblings) };
  });
}

/** Tally findings by severity across reports. */
export function countBySeverity(reports: readonly SkillReport[]): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const report of reports) {
    for (const finding of report.findings) {
      if (finding.severity === 'error') errors += 1;
      else warnings += 1;
    }
  }
  return { errors, warnings };
}
