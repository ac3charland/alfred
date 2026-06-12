import { type Finding, type Rule, rules as defaultRules } from './rules.ts';
import type { SkillContext } from './skill.ts';

/** All findings for one skill. */
export interface SkillReport {
  readonly skill: SkillContext;
  readonly findings: readonly Finding[];
}

/** Run every rule against a single skill and collect the findings. */
export function lintSkill(skill: SkillContext, rules: readonly Rule[] = defaultRules): Finding[] {
  return rules.flatMap((rule) => rule.check(skill));
}

/** Run every rule against each skill, preserving input order. */
export function lintSkills(
  skills: readonly SkillContext[],
  rules: readonly Rule[] = defaultRules,
): SkillReport[] {
  return skills.map((skill) => ({ skill, findings: lintSkill(skill, rules) }));
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
