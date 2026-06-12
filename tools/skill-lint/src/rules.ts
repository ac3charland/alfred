import type { SkillContext } from './skill.ts';

/**
 * Thresholds, traced to the skill-creator authoring guidance
 * (`.claude/skills/skill-creator/SKILL.md`):
 *
 * - Descriptions are "under the ~1024-char cap" (the listing budget Claude sees).
 * - SKILL.md bodies are kept "under 500 lines" ideal; past that, add a layer of
 *   hierarchy and push detail into `references/`.
 *
 * They live here as named constants so the rules — and the skill that documents
 * them — point at one source of truth.
 */
export const DESCRIPTION_MAX_CHARS = 1024;
export const BODY_MAX_LINES = 500;

export type Severity = 'error' | 'warn';

/** One problem a rule found in a skill. */
export interface Finding {
  /** The id of the rule that produced this finding. */
  readonly rule: string;
  /** `error` fails the lint; `warn` is advisory and never fails it. */
  readonly severity: Severity;
  /** Human-readable explanation plus how to fix it. */
  readonly message: string;
  /** 1-based body line the finding points at, when it has one. */
  readonly line?: number;
}

/**
 * A lint rule: a pure check over a {@link SkillContext}. To add a rule, write one
 * of these and register it in {@link rules} below — nothing else needs to change.
 */
export interface Rule {
  /** Stable id, shown in findings (e.g. `description-length`). */
  readonly name: string;
  /** One-line summary of what the rule enforces. */
  readonly description: string;
  /** Return a finding per problem, or `[]` when the skill passes. */
  check(skill: SkillContext): Finding[];
}

/** A skill description longer than the listing budget is truncated in practice. */
const descriptionLength: Rule = {
  name: 'description-length',
  description: `Description must stay within the skill-creator ~${String(DESCRIPTION_MAX_CHARS)}-char cap.`,
  check(skill) {
    const { length } = skill.description;
    if (length <= DESCRIPTION_MAX_CHARS) return [];
    return [
      {
        rule: 'description-length',
        severity: 'error',
        message: `description is ${String(length)} chars (max ${String(DESCRIPTION_MAX_CHARS)}). Tighten it — lead with what-it-does plus the distinctive keywords in the first ~250 chars and drop redundant scope.`,
      },
    ];
  },
};

/** A too-long body costs tokens on every trigger; push detail into references/. */
const bodyLength: Rule = {
  name: 'body-length',
  description: `Body should stay under the recommended ${String(BODY_MAX_LINES)} lines.`,
  check(skill) {
    if (skill.bodyLineCount <= BODY_MAX_LINES) return [];
    return [
      {
        rule: 'body-length',
        severity: 'warn',
        message: `body is ${String(skill.bodyLineCount)} lines (recommended < ${String(BODY_MAX_LINES)}). Add a layer of hierarchy and move detail into references/ that loads on demand.`,
      },
    ];
  },
};

const TOC_HEADING = /^(table of contents|contents)$/i;
/** The TOC must be the 1st or 2nd top-level section — `<=` this 0-based index. */
const MAX_TOC_SECTION_INDEX = 1;

/**
 * A compound skill bundles resources a reader of SKILL.md must discover for
 * progressive disclosure to work, so it needs a Table of Contents near the top.
 */
const compoundToc: Rule = {
  name: 'compound-toc',
  description: 'A compound skill needs a Table of Contents near the top of its body.',
  check(skill) {
    if (!skill.isCompound) return [];
    const dirs = skill.resourceDirs.map((dir) => `${dir}/`).join(', ');
    const tocHeading = skill.headings.find((heading) => TOC_HEADING.test(heading.text));
    if (!tocHeading) {
      return [
        {
          rule: 'compound-toc',
          severity: 'error',
          message: `compound skill (bundles ${dirs}) has no Table of Contents. Add a "## Contents" section near the top that lists the body sections and links the bundled resources, so a reader discovers them on the first read.`,
        },
      ];
    }
    const topLevelIndex = skill.headings
      .filter((heading) => heading.level === 2)
      .indexOf(tocHeading);
    if (topLevelIndex === -1 || topLevelIndex > MAX_TOC_SECTION_INDEX) {
      return [
        {
          rule: 'compound-toc',
          severity: 'error',
          line: tocHeading.line,
          message: `Table of Contents must be a top-level "##" section near the top (the 1st or 2nd section), so the bundled resources (${dirs}) are visible up front.`,
        },
      ];
    }
    return [];
  },
};

/**
 * The active rule set, applied to every skill in registration order. This array
 * is the extension point: append a {@link Rule} to lint something new.
 */
export const rules: readonly Rule[] = [descriptionLength, bodyLength, compoundToc];
