# Output Structure Template

The proven structure for library skills, distilled from the Reanimated and Gesture Handler skills. Follow this order — it's not arbitrary. Each section builds context that makes the next section meaningful.

Sections 1, 3, 5, and 7 are near-universal. Sections 2 (Decision Tree), 4 (Callbacks/Lifecycle), and 6 (Version Gotchas) are conditional — include them only when the library actually has competing approaches, callbacks/lifecycle, or version-specific pattern changes. Skip a conditional section rather than padding it with filler.

---

## Section 1: Mental Model

**Purpose:** Establish the conceptual framework before any API is introduced. An agent that understands *why* will debug faster than one that just knows *what*.

**What to cover:**
- The core abstraction (what is this library actually doing under the hood?)
- The threading/execution model if relevant (e.g., UI thread vs JS thread)
- The state machine if the library has one (gestures, animations)
- The single most important thing that's non-obvious

**Format:** Prose paragraphs, optionally with a simple diagram in ASCII or a short list. No code yet.

**Anti-pattern:** Starting with "To use X, first import Y from Z." That's tutorial mode, not mental-model mode.

**Example (from Gesture Handler):**
```markdown
## Mental Model: Gesture State Machine

Every gesture lives in one of six states: UNDETERMINED → BEGAN → ACTIVE → END (success) or FAILED/CANCELLED (failure). This isn't just trivia — it's the debugging model. When a gesture doesn't fire, it either never left UNDETERMINED, got FAILED by a recognizer conflict, or got CANCELLED mid-gesture by another gesture winning the competition. Every debugging question maps to: which state transition didn't happen?
```

---

## Section 2: Decision Tree *(conditional — only if the library has competing approaches)*

**Purpose:** Answer "which approach do I use?" in plain English before any implementation. This is where agents fail most — they default to one pattern for everything.

**What to cover:**
- The top-level fork in approach (e.g., CSS transitions vs worklets; same-component vs cross-component composition)
- Each branch labeled with its plain-English trigger ("use this when the user says...")
- When NOT to use an approach

**Format:** A tree or a simple if/else block written in prose or a nested list. Avoid code here — this is a routing decision, not implementation.

**Example (from Reanimated):**
```markdown
## Choosing the Right API

**Is this animation triggered by a state change (button press, tab switch, toggle)?**
→ Yes → Use CSS transitions/animations (Reanimated 4+). Simpler, less code, no worklet needed.
→ No, it's driven by a gesture or scroll position → Use worklets + shared values.

**Do you need to interrupt or chain animations dynamically?**
→ Yes → Use `withSequence`, `withDelay`, or gesture callbacks.
→ No, it's a one-shot → CSS transitions are sufficient.
```

---

## Section 3: Plain-English → Pattern Table

**THE core section.** This is what makes the skill useful for the stated use case (describing intent to an agent).

**Format:** A markdown table with three columns:
| When the user says... | Use this pattern | Key things to know |

**How to populate it:**
- Walk through the use case framing from Step 0 and generate 8-15 rows
- The "user says" column should be natural language, not API names
- The "pattern" column names the approach + the 2-3 key API calls involved
- The "key things to know" column is where you put the non-obvious gotcha

**Example rows (from Reanimated):**
```markdown
| "animate when this boolean changes" | CSS transition on the animated style | Wrap the component in `<Animated.View>` — plain `<View>` won't pick up the transition |
| "spring back to position" | `withSpring(originalValue)` in `onDeactivate` | Use `didSucceed` param to only spring back on gesture cancel, not on completion |
| "parallax scroll effect" | `interpolate()` with `Extrapolation.CLAMP` | Always clamp — without it, values fly off-screen past the scroll range |
```

---

## Section 4: Callback / Lifecycle Guarantees *(conditional — only if the library has callbacks/lifecycle)*

**Purpose:** Paired callbacks are where agents write silent bugs. Make the pairing rules explicit.

**What to cover:**
- Which callbacks are guaranteed to pair (if A fires, B will always fire)
- What data is available in each callback
- Which callbacks run on the UI thread vs JS thread (if relevant)
- The `didSucceed` / completion status pattern if it exists

**Format:** A short list of rules, stated as guarantees.

**Example (from Gesture Handler):**
```markdown
- `onBegin` and `onFinalize` always pair — if onBegin fired, onFinalize will fire even if the gesture fails.
- `onActivate` and `onDeactivate` always pair — if the gesture reached ACTIVE, onDeactivate fires on completion OR cancellation.
- `onDeactivate` receives `didSucceed: boolean` — use this to distinguish "gesture completed" from "gesture was interrupted by another gesture winning".
- All callbacks run on the UI thread by default — call `runOnJS(setState)(value)` to update React state.
```

---

## Section 5: Common Pitfalls

**Purpose:** The things that bite everyone. Stated as hard rules, not soft suggestions.

**Format:** Bulleted rules. Each bullet starts with "Always", "Never", or a concrete conditional.

**Anti-pattern:** "You might want to consider using useMemo here." → Weak. Say "Always wrap the gesture builder in useMemo — without it, a new gesture instance is created on every render and gesture state resets."

**How to source:** Combine things from the docs' troubleshooting section + things called out in your Tier 1/2 sources + things that are buried in the docs but obviously important.

---

## Section 6: Version Gotchas *(conditional — only if a recent major version changed patterns)*

**Purpose:** Agents are trained on older content. If the library has changed its recommended patterns in recent versions, agents will confidently write the old way.

**Format:** Explicit version-tagged list.

```markdown
## Version Gotchas (as of v4.x)

- **CSS transitions are new in v4** — agents trained before this will default to worklets for everything. For state-driven animations, CSS is now preferred and significantly less code.
- **`useAnimatedStyle` is still valid but no longer the first choice** for simple state-driven cases.
- **The `withTiming` / `withSpring` basics are unchanged** — safe to use pre-v4 examples for these.
```

---

## Section 7: What Was Deliberately Left Out

**Purpose:** Prevents agents from reaching for patterns that weren't included and confidently writing broken/suboptimal code.

**Format:** Brief bulleted list with a one-line reason for each omission.

**Example (from Gesture Handler):**
```markdown
## What's Not in This Skill (and Why)

- **`useMemo` for gesture builders** — `useMemo` can't wrap hooks; included the principle but not the code pattern to avoid agents writing `useMemo(() => useGesture(...))`.
- **Lower-level gesture API (pre-v2)** — Gesture Handler v2 replaced it entirely; including it would create confusion about which to use.
- **`PanGestureHandler` component syntax** — deprecated in favor of the builder API; agents that know the old API will default to it without prompting, so it's excluded intentionally.
```

---

## Length and Hierarchy

- Target: 300-450 lines for SKILL.md body
- If the pattern table + pitfalls push past 500 lines, move the pitfalls to `references/pitfalls.md` and link it
- If you're covering multiple distinct sub-domains (e.g., a library with both gesture and scroll APIs), split into `references/gestures.md` and `references/scroll.md`, with SKILL.md as the router