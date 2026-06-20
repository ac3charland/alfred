---
name: lib-skill-forge
description: Describes how to build a SKILL.md for a programming library or framework from its documentation. Use this when the user provides a library name and doc URL(s) and wants a reusable skill that helps a coding agent implement that library accurately from plain-English descriptions. Trigger on phrases like "create a skill for [library]", "make a skill from [docs URL]", "build a skill for working with [framework]", or any time the user wants to convert library documentation into a coding-agent skill. For general skill creation, iteration, evaluation/benchmarking, or description-trigger optimization that is not driven by a library's documentation, use the skill-creator skill instead.
---
 
# Library Skill Forge
 
Converts library documentation + credentialed best practices into a high-quality SKILL.md that dramatically improves a coding agent's ability to implement the library accurately from plain-English descriptions.
 
**The core bet:** Agent failures come from missing mental models, not missing API syntax. Structure the skill around understanding first, API reference second.
 
## Contents

**This file**

- [Step 0: Gather Inputs](#step-0-gather-inputs)
- [Step 1: Check for Maintainer-Published Agent Assets](#step-1-check-for-maintainer-published-agent-assets)
- [Step 2: Fetch Docs in Parallel](#step-2-fetch-docs-in-parallel)
- [Step 3: Find Credentialed Best Practices Sources](#step-3-find-credentialed-best-practices-sources)
- [Step 4: Synthesize the Skill](#step-4-synthesize-the-skill)
- [Step 4.5: Verify the API Surface](#step-45-verify-the-api-surface)
- [Step 5: Package and Present](#step-5-package-and-present)
- [Quality Checklist](#quality-checklist)

**Bundled resources**

- **references/**
  - [output-structure.md](./references/output-structure.md) — the skill template, examples, and anti-patterns (read before writing)
  - [source-quality-criteria.md](./references/source-quality-criteria.md) — the rubric for choosing credentialed sources

## Step 0: Gather Inputs
 
If the user hasn't provided all of these, ask before proceeding:
 
1. **Library name and version** (e.g., `react-native-reanimated v4`)
2. **Doc section URL(s) to focus on** — specific sections, not just the root. Ask them to link the sections most relevant to their use case (e.g., fundamentals, core API, guides). More focused = better skill.
3. **Use case framing** — what should the agent be better at? (e.g., "describing animations in plain English", "debugging gesture conflicts"). This shapes the plain-English → pattern table.
4. **Output skill name** (kebab-case, e.g., `reanimated`, `gesture-handler`)
## Step 1: Check for Maintainer-Published Agent Assets
 
Before writing anything, look for what the maintainers already publish for agents.
 
### 1a. First-party skill (use as the base if found)
 
A skill written by the library's own maintainers beats anything you'd synthesize — it encodes their intended mental model directly. Look in:
- The GitHub repo: `SKILL.md` at root, `.claude/skills/`, `skills/`, or `AGENTS.md`
- The docs site (often a "for AI / agents / LLMs" page)
- The published npm/PyPI package contents
- A maintainer or Anthropic skills registry, if one exists
**Verify provenance.** It counts as first-party only if it comes from the maintainer's own repo/org/domain — not a fork, mirror, or a third party's "skill for X". Treat community skills as ordinary sources under `references/source-quality-criteria.md`, not as the base.
 
If a genuine first-party skill exists, it becomes the **base** for Step 4 — you augment it, not rebuild from zero. Still check it against the current version (maintainer skills go stale too) and against the user's Step 0 use-case framing.
 
### 1b. llms.txt
 
Check for `llms.txt` / `llms-full.txt` at the domain root — machine-optimized doc summaries that load far faster than scraping.
 
```
https://<library-domain>/llms.txt
https://<library-domain>/llms-full.txt
```
 
If found, use it to orient and to pick sections for deep-fetch. If neither asset exists, proceed to the user-specified URLs.
 
## Step 2: Fetch Docs in Parallel
 
Fetch the user-specified doc section URLs simultaneously. Also fetch:
- Any "migration guide" or "changelog" for the latest major version (version gotchas)
- Any "troubleshooting" or "common issues" page if it exists
- The library's GitHub README if it contains usage examples not in the docs
Do NOT fetch the entire docs site. Curation principles (from Inkeep's production experience):
- **In:** API reference, config options, code patterns, mental models, state machines
- **Out:** marketing pages, pricing, deployment guides, tutorials with heavy external dependencies, changelogs beyond the latest major version
## Step 3: Find Credentialed Best Practices Sources
 
Run 2-3 targeted searches. Quality bar is high — be choosy. See `references/source-quality-criteria.md` for the full rubric.
 
Search templates (fill the brackets for your library's ecosystem):
```
[library name] best practices [maintainer org]
[library name] tips [maintainer org] engineering blog
[library name] [version] common mistakes OR pitfalls
```
 
**No curated source list for this ecosystem? Build one before searching.** The orgs named below are illustrative — they're correct for the React Native ecosystem this skill was distilled from, and useless for most others. Find the equivalents for any library:
- Top GitHub contributors (repo → Insights → Contributors) — their personal blogs/talks are Tier 1
- The maintainer org's own engineering blog (the org that owns the repo)
- The ecosystem's flagship conferences (PyCon/EuroPython for Python, GopherCon for Go, RustConf for Rust, JSConf/React Conf for JS, etc.)
- Whoever the docs themselves cite or thank
**Tier 1 sources (always take seriously):**
- Posts by library authors or core contributors (holds for any ecosystem)
- The maintainer organization's own engineering blog
- Conference talks from known contributors at the ecosystem's flagship events
- *RN/mobile example set:* Software Mansion, Callstack, Expo, Shopify, Infinite Red; React Native EU, App.js Conf
**Reject automatically:**
- Medium posts from authors without verifiable credentials
- random dev.to posts
- Tutorial sites (freeCodeCamp, tutorials-point, geeksforgeeks)
- Posts with no clear author or organizational affiliation
- Posts >2 years old unless the library is stable and they're explicitly about timeless patterns
For each source you use, note the author/org so the skill can cite its provenance.
 
## Step 4: Synthesize the Skill
 
Read `references/output-structure.md` before writing — it contains the detailed template, examples, and anti-patterns.
 
**If Step 1a found a first-party skill, build on it instead of starting from zero:** preserve its substance and the maintainer's mental models, reorganize to the structure below where it differs, then layer in the Step 3 insights and the version/pitfall/"left out" sections maintainers usually skip. Aim for maintainer authority + this skill's structure + the user's use-case framing — not a lightly-edited copy. Attribute the base.
 
Otherwise, write the output SKILL.md from scratch using the proven structure below.
 
**Structural order.** Keep sections in this sequence. Tags mark which are near-universal vs. conditional — for a conditional section, include it only if the library actually has the thing; otherwise skip it rather than faking a hollow section to fill the slot.
 
1. **Mental Model** *(always)* — what the agent must understand before touching any API
2. **Decision Tree** *(if the library offers competing approaches for the same goal; skip for single-path libraries)* — framed as plain-English choices, not API names
3. **Plain-English → Pattern Table** *(always)* — THE core section; maps user descriptions to implementation patterns
4. **Callback / Lifecycle Guarantees** *(if the library has callbacks, events, or a lifecycle/state machine; skip for stateless libraries like parsers, math, formatting)* — pairing rules, what fires when, gotchas
5. **Common Pitfalls** *(always)* — things that bite everyone, stated as rules not hints
6. **Version Gotchas** *(if a recent major version changed recommended patterns; skip if the API has been stable)* — what agents get wrong because they're trained on older content
7. **What Was Deliberately Left Out** *(always)* — and why. This prevents agents from reaching for omitted patterns.
## Step 4.5: Verify the API Surface
 
The skill's entire job is accuracy, so don't ship hallucinated APIs. Cross-check every API name, method, prop, and signature in the pattern table and code examples against the docs fetched in Step 2. Cut or flag anything you can't confirm in the source material. Format validation (Step 5) checks the skill's *shape*, not whether its code is real — this is the only step that catches invented calls.
 
## Step 5: Package and Present
 
Package with the skill-creator script. It imports a sibling module, so it must run from the skill-creator root, and its output defaults to the working directory — so pass a writable output dir explicitly:
```bash
cd /mnt/skills/examples/skill-creator
python -m scripts.package_skill /home/claude/<skill-name> /home/claude
```
Use plain `python -m` here, not `uv run` — the `-m` invocation resolves `scripts` as a package from that directory. The script runs format validation before zipping; fix any errors it reports. Then present the resulting `.skill` file to the user.
 
---
 
## Quality Checklist
 
Before packaging, verify:
- [ ] Mental model section leads — no API lists appear before the model is established
- [ ] Decision tree, if present, frames choices in plain English, not API names
- [ ] Pattern table covers the use case framing the user gave in Step 0
- [ ] Every pitfall is stated as a rule ("always X", "never Y"), not a soft suggestion
- [ ] Version gotchas section, if present, names the version explicitly
- [ ] Conditional sections (decision tree, callbacks, version gotchas) are present only when the library has the thing — none faked to fill a slot
- [ ] Every API name in the skill was confirmed against the fetched docs (Step 4.5)
- [ ] "What was left out" section is present and honest
- [ ] If a first-party skill exists, it was used as the base (not ignored) and attributed
- [ ] Every external source used is cited inline with author/org
- [ ] Skill stays under 500 lines; if longer, move reference content to `references/` and link it