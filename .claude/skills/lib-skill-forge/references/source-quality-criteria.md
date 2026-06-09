# Source Quality Criteria

Used by lib-skill-forge in Step 3 to evaluate whether a best practices source is worth incorporating.

## Scoring Model

Evaluate each candidate source on these axes before deciding to fetch and read it:

### Author/Org Credibility (required — reject if can't determine)

**Tier 1 — always fetch:**
- Library authors or core contributors (check GitHub contributors list if unsure)
- Maintainer organization's own engineering blog (Software Mansion → RNGH/Reanimated, Meta → React, Vercel → Next.js, etc.)
- Top-tier product engineering blogs: Shopify Engineering, Airbnb Engineering, Netflix Tech, Stripe Engineering, Linear, Figma Engineering, Expo Blog, Callstack Blog, Infinite Red Blog
- Conference talks from the above at React Native EU, App.js Conf, React Conf, RenderATL

**Tier 2 — fetch if content looks specific and non-tutorial:**
- Verified engineers at known tech companies (check LinkedIn / GitHub bio)
- Independent developers with substantial GitHub presence in the library's ecosystem
- Posts with clear code examples that go beyond "getting started"

**Tier 3 — skip unless no Tier 1/2 sources exist:**
- Unverified Medium authors
- Tutorial aggregators (freeCodeCamp, GeeksForGeeks, tutorials-point)
- Personal blogs with no clear author credentials
- Any post framed as "10 things you didn't know about X" clickbait

### Content Specificity (secondary filter)

Prefer sources that cover:
- Non-obvious behavior (edge cases, state machine internals, threading models)
- "Why" explanations, not just "how"
- Performance implications
- Migration from older patterns

Skip sources that are primarily:
- Getting started tutorials
- API listing without insight
- "X vs Y" comparison posts without concrete code

### Community vs. first-party skills

A genuine first-party skill (maintainer's own repo/org/domain) is not scored here — it's the base, handled in Step 1a. A third party's "skill for X" is just another source: judge it on the tiers above (usually Tier 2 at best, Tier 3 if the author is unverified). Never treat a community skill as the base.

### Recency

- Major version changes can make older posts actively misleading
- For libraries with frequent breaking changes (RN ecosystem), prefer posts from within the last 18 months
- Exception: posts from library authors about timeless design principles can be used regardless of age, but note the version context

## Usage in the Skill

When you incorporate a source, cite it inline in the skill like:

```markdown
> Source: Krzysztof Magiera (Reanimated author), "Reanimated 4 launch post", 2024
> Key insight: CSS transitions are now preferred for state-driven animations; worklets remain right for gesture/scroll-driven animations.
```

This keeps the skill's provenance transparent and lets the skill consumer decide how much to trust specific claims.