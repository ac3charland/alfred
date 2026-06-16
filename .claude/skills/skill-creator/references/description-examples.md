# Before/after descriptions — a calibration library

Real description rewrites from this repo, each pairing a flawed `description` with its fix and
the rule it broke. Read this when writing or revising any skill description; grep for a
symptom rather than reading end to end. Add the next correction you make here, trimmed to the
essentials (per the lean rule in the compounding-learning skill).

## Contents

- Nominalized guidance masquerading as subject-naming (implement-spec)

## Nominalized guidance masquerading as subject-naming — implement-spec

A conventions / house-style skill's content *is* a small set of rules, so every attempt to
"list what it covers" turns into a list of the advice. The tell: a `subject: a, b, c` clause
where a, b, c read as things-to-do, not subject-nouns. (An even blunter earlier draft led with
`Core rule: never carry spec-only references…` — the same leak, just undisguised.)

BEFORE (still wrong — the colon-list is the body, nominalized):
```
Documents the house style for implementing a written spec, ticket, or design doc: which of
the spec's references belong in the resulting code, comments, commits, PRs, and tests versus
what to leave behind, plus grounding in the existing codebase first, handling a spec that's
ambiguous or has drifted, and test coverage. Read whenever… Trigger on: …
```
AFTER:
```
Documents the house style for implementing a written spec, ticket, or design doc into code.
Read whenever you've been handed a spec, ticket, or design doc and asked to build it. Trigger
on: "implement this spec", "build the spec", …
```

**Rule:** "Describe the skill; don't inline its content." Naming the subject in one phrase is
the whole job for a house-style skill — it has no inventory of subject-nouns to enumerate, so
a colon-list there is always the guidance leaking in. A broad *reference* skill is the opposite
case, where the list is legitimate: `the Messages API, tool definitions, streaming` are real
subjects, not advice.
