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
/**
 * A soft target well under the hard cap. A description pushing past this is usually
 * smuggling in body content (rules, implied context, extra scope) rather than stating the
 * subject + trigger conditions — so it's an advisory nudge to re-tighten, never a failure.
 */
export const DESCRIPTION_SOFT_MAX_CHARS = 700;
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

/**
 * A description under the hard cap but past the soft target. Warns (never fails) so the
 * author re-checks it for smuggled-in content. Skips the over-cap case — {@link
 * descriptionLength} already errors there, and one finding per description is enough.
 */
const descriptionTightness: Rule = {
  name: 'description-tightness',
  description: `A description should stay tight (under ~${String(DESCRIPTION_SOFT_MAX_CHARS)} chars).`,
  check(skill) {
    const { length } = skill.description;
    if (length <= DESCRIPTION_SOFT_MAX_CHARS || length > DESCRIPTION_MAX_CHARS) return [];
    return [
      {
        rule: 'description-tightness',
        severity: 'warn',
        message: `description is ${String(length)} chars (recommended < ${String(DESCRIPTION_SOFT_MAX_CHARS)}). Check whether it includes rule content, implied context (the repo or package it's in), or other extraneous information — a description states the subject and trigger conditions, not the body's guidance.`,
      },
    ];
  },
};

/** The repo name in a description is redundant scope — see {@link descriptionNoRepoName}. */
const REPO_NAME = /alfred/i;

/**
 * The agent already knows which repo it's in (CLAUDE.md supplies that), so naming the
 * repo in a description wastes the front-loaded, length-capped triggering budget on
 * scope every skill shares. Disambiguate *which part* of the project with "the frontend"
 * / "the monorepo" instead — never the repo name.
 */
const descriptionNoRepoName: Rule = {
  name: 'description-no-repo-name',
  description: 'A description must not name the repo — it is redundant scope.',
  check(skill) {
    const match = REPO_NAME.exec(skill.description);
    if (!match) return [];
    return [
      {
        rule: 'description-no-repo-name',
        severity: 'error',
        message: `description names the repo ("${match[0]}"). The agent already knows which repo it's in (CLAUDE.md), so drop it — it wastes the front-loaded triggering budget. Disambiguate which part with "the frontend" / "the monorepo" if needed.`,
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
export const rules: readonly Rule[] = [
  descriptionLength,
  descriptionTightness,
  descriptionNoRepoName,
  bodyLength,
  compoundToc,
];
