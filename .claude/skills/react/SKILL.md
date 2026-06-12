---
name: react
description: >
  Covers React function-component and hooks patterns in the alfred frontend: hooks,
  state, effects, refs, context, memoization, composition, and recursive component
  trees (task/subtask rendering). Use before writing or reviewing any file under
  frontend/ that imports from 'react' — especially recursive subtask rendering,
  inline-expanding rows, controlled inputs, cascade modals, and deciding whether an
  effect is actually needed. Do NOT use for tests: React component tests belong to the
  react-testing-library skill, and non-component unit tests to the jest skill.
---

# React Skill (Function Components + Hooks)

> Sources: react.dev Learn + Reference sections fetched from
> raw.githubusercontent.com/reactjs/react.dev (June 2026); React 19 blog post
> (Dec 2024); React Compiler v1.0 blog post (Oct 2025). No first-party
> SKILL.md or llms.txt found at react.dev.

---

## Mental Model

React renders your component tree as a pure function of state + props. Each
render is a snapshot: every closure — event handlers, effects, callbacks —
captures the values of that render, not "the latest values." This is the
source of most hooks bugs.

**The rendering cycle is not a lifecycle.** Think in *synchronization*, not
*mount/unmount*:

- State or props changed → React calls your function → produces a new UI
  description → commits it. That's it.
- Effects are not "code that runs on mount." They are the *minimal seam between
  React and external systems*. If no external system is involved, you probably
  do not need an effect.

**Three things React tracks for identity:**
1. Component type at a position in the tree (different type → destroy + remount).
2. `key` prop (same type but different key → destroy + remount).
3. Position in JSX (same type, same position → state preserved across renders).

Consequence: nested component *definitions* inside a render function produce a
new component type every render, causing constant remounts. Always define
components at module scope.

**State is a snapshot, not a variable.** Calling `setState` queues an update
for the *next* render. Reading state immediately after `setState` gives you the
old value. Use functional updaters (`setState(prev => ...)`) when the next
value depends on the previous one.

**In alfred specifically:** the backend is the source of truth, surfaced to
components through two Context stores (see the **`data-flow`** skill). Components
read via `useFolders()` / `useTasks()` and mutate via store actions (optimistic +
reconcile) — they do **not** receive server data as drilled props, call the API
client directly, or `router.refresh()`. Local state is only for transient UI
(expanded row, input draft); never mirror store data in `useState`.

---

## Decision Tree: Which Hook Handles This?

```
User needs to remember something across renders?
├── Does it affect what's rendered on screen?
│   ├── YES → useState (or useReducer for complex update logic)
│   └── NO  → useRef  (timer IDs, DOM nodes, previous-value bookmarks)
│
Does the user want to run code "when X changes"?
├── Is X entirely inside React (props/state change)?
│   ├── Derive the value during render (no hook needed)
│   └── If expensive: useMemo
├── Is it a user interaction (click, submit, keypress)?
│   └── Event handler (no hook needed)
└── Is it syncing with something OUTSIDE React?
    └── useEffect with correct dependency array
        (and always a cleanup function if it subscribes anything)

Does a child need to call a function owned by this component?
└── Pass the function as a prop; wrap in useCallback only if
    the child is wrapped in memo() AND re-renders are measured to matter

Does a deep subtree need shared data without prop drilling?
└── createContext + useContext
    (split contexts by update frequency to limit re-renders)
```

---

## Plain-English → Pattern Table

| When the description says... | Use this pattern | Key thing to know |
|---|---|---|
| "store what the user typed" | `useState` + `value={state}` + `onChange` controlled input | Never read the DOM value directly; React owns the input value |
| "compute X from props/state" | Derive inline during render: `const x = items.filter(...)` | Do NOT put x in state and sync it with an effect — that's redundant state |
| "do X when the component first appears" | `useEffect(() => { ... }, [])` | React 19 Strict Mode double-invokes effects in dev; write the cleanup or the test will lie to you |
| "sync with an external thing (websocket, interval, localStorage)" | `useEffect` with setup + `return () => cleanup` | Every subscribe needs a matching unsubscribe; the cleanup runs before re-run AND on unmount |
| "reset a child's state when a prop changes" | Put `key={propThatChanges}` on the child | Do NOT use an effect that calls `setState('')` on prop change — that causes an extra render |
| "show all subtasks of a task, recursively" | `<TaskRow>` that maps its `children` prop and renders `<TaskRow>` for each | Key each row by the task's stable database `id`, never by array index; the tree can reorder |
| "expand a row inline to show subtasks" | Local `useState(false)` for `isExpanded`; conditional render of child rows below | Keep expansion state local to the row — no need to lift it; sibling rows don't care |
| "confirm before completing a parent that has subtasks" | Modal triggered by event handler; call API only after user confirms | Do NOT trigger the modal in an effect watching a `pendingComplete` state variable — put the logic in the click handler |
| "disable a button while a fetch is in flight" | Local `useState(false)` for `isPending`; set true before fetch, false in finally | Or use React 19's `useActionState` / `useFormStatus` for form-based actions |
| "share theme / auth / current user across the whole tree" | `createContext` + `useContext`; wrap with a Provider near the root | Memoize the context value with `useMemo` if it's an object; otherwise every consumer re-renders on every parent render |
| "focus an input on mount or after a state change" | `useRef` + `ref.current.focus()` inside `useEffect` or an event handler | Never call `ref.current` during render — only in effects or handlers |
| "expensive filter/sort of the task list" | `useMemo(() => items.filter(...), [items, filter])` | Only add useMemo after you've measured — premature memoization hurts readability for no gain; React Compiler v1.0 handles most cases automatically |
| "pass a stable callback to a memoized child" | `useCallback(fn, [deps])` — only if the child is wrapped in `memo()` | `useCallback` is useless if the child is not memoized; it just adds verbosity |
| "two sibling components need the same state" | Lift state to their closest common parent; pass down as props + setter | Do NOT duplicate state in both children and try to sync them |
| "read the previous value of a prop/state" | Sync it in an effect: `useEffect(() => { prevRef.current = value }, [value])` | `react-hooks/refs` (recommended-latest) **errors on a render-body `ref.current = …` write**. Assign refs only in effects/handlers — e.g. the stores' rollback ref in `lib/stores/*` |

---

## Callback / Lifecycle Guarantees

**useState**
- Setter calls within one synchronous event handler are *batched* — React renders once after the handler completes, not once per call.
- `setState(value)` with the same value (by `Object.is`) skips a re-render.
- Functional updater `setState(prev => next)` always receives the latest queued state, not the closure snapshot. Use it when computing next state from previous.

**useEffect**
- Runs *after* the browser has painted — not during render, not before paint.
- Cleanup runs: (a) before the effect re-runs with new deps, and (b) when the component unmounts.
- In Strict Mode (development only), React intentionally mounts → unmounts → remounts every component to surface missing cleanups. Your effect must be idempotent against this.
- Every reactive value (props, state, context values, variables computed from them inside the component) that the effect reads *must* appear in the dependency array. Missing deps = stale closure bug. Suppress the lint rule and you own the bug.

**useLayoutEffect**
- Same signature as `useEffect` but fires *synchronously after DOM mutations, before paint*. Only use it when you need to measure the DOM and prevent a visible flicker (e.g., positioning a tooltip). Default to `useEffect`.

**useRef**
- `.current` is mutable and does not trigger re-renders. Safe to read/write in event handlers and effects.
- Do NOT read or write `.current` during the render function body (except the lazy-initialization pattern: `if (ref.current === null) ref.current = new Foo()`).

**Context**
- All consumers of a context re-render when the Provider's `value` changes by `Object.is` reference. An object literal `value={{ a, b }}` creates a new reference every render — wrap it in `useMemo`.
- Split contexts by update frequency: a rapidly-changing value in the same context as a stable value forces all consumers to re-render on every change.

---

## Common Pitfalls

**Effects**
- Never put logic in an effect that belongs in an event handler. If the code answers "what did the user just do?", it is an event handler. If it answers "what must stay in sync while this component is displayed?", it is an effect.
- Never use an effect to derive state from other state or props. Calculate the derived value during render instead. The classic violation: `useEffect(() => setFullName(first + ' ' + last), [first, last])`.
- Never chain effects (effect A sets state, triggering effect B). Collapse the logic into a single event handler or a single effect.
- Never pass an effect a dependency array of `[]` just to suppress "runs too often." If the effect reads a reactive value, that value belongs in the array. Fix the code, not the array.
- Always write the cleanup function for any subscription, interval, or event listener created inside an effect. Without it, Strict Mode double-invoke will surface the bug during development.

**Dependency arrays**
- The `eslint-plugin-react-hooks` rules `rules-of-hooks` and `exhaustive-deps` are configured as **errors** in this project. Never add `// eslint-disable` to silence them — fix the code. Every error the linter reports is a real bug.
- Objects and functions created inside a component are new references every render. Putting them in a dependency array causes the effect to re-run on every render. Move the object/function inside the effect, or stabilize it with `useCallback`/`useMemo`.
- Stable values (refs, setter functions from `useState`, dispatch from `useReducer`) do not need to be in the dependency array — they are guaranteed stable across renders.

**Keys and recursive lists**
- Always key list items by their stable, unique database ID. Never use array index as a key for a list that can reorder, filter, or update.
- In the recursive task tree, every `<TaskRow>` at every depth needs `key={task.id}`. A missing or index-based key causes React to reuse the wrong component instance and corrupt local state (expand/collapse, input focus).
- Never define a component function inside another component's render body. The inner function is a new component type every render, causing every child to unmount and remount on every parent render.

**State**
- Never mutate state objects or arrays in place. Spread to copy: `setState([...prev, newItem])`. Mutation bypasses React's change detection.
- Never read state immediately after calling the setter and expect the new value — the update is queued for the next render.
- Never put derived data in state. If it can be computed from existing state or props, compute it. Redundant state requires you to keep two things in sync, and they will diverge.

**Context**
- Never pass a new object literal or inline function as the context value without memoizing it. `<Ctx.Provider value={{ user, setUser }}>` creates a new value every render.

**Refs**
- Never store in a ref something that should trigger a re-render when it changes. Refs are silent — the UI will not update.
- Never pass `ref.current` as a prop to a child if you need the child to react to its changes — use state instead.

---

## Version Gotchas

### React 19 (released Dec 2024)

- **`ref` is now a plain prop.** Function components receive `ref` directly: `function MyInput({ ref, ...props })`. `forwardRef` is no longer needed for new components and is planned for deprecation. Agents trained on React 18 will write `forwardRef` wrappers — skip it for any new component.
- **`use(promise)` and `use(context)` are new APIs, not hooks.** Unlike hooks, `use()` can be called conditionally and inside loops. Use `use(SomeContext)` instead of `useContext(SomeContext)` where conditional consumption is needed. Use `use(promise)` for Suspense-integrated data reads — but only pass promises created *outside* the render function (e.g., from Server Components), not inline `fetch()` calls, which recreate on every render.
- **`useActionState`** (renamed from `useFormState`) manages async form actions: returns `[state, action, isPending]`. Use it instead of manual `useState` + `isPending` flags for form submissions.
- **`useOptimistic`** applies an immediate optimistic update while an async action completes, reverting automatically on error. Use it for instant UI feedback on task completion/edit.
- **Ref cleanup functions.** Ref callbacks can now return a cleanup function: `ref={(node) => { ...; return () => cleanup(); }}`. React calls the cleanup on unmount.
- **`useFormStatus`** (from `react-dom`) reads the pending state of the nearest parent `<form>` — useful for submit buttons inside design-system components that don't receive `isPending` as a prop.
- **`useMemo` / `useCallback` are still valid** but React Compiler v1.0 (stable Oct 2025, included in Next.js by default) auto-memoizes components and hooks. For new code, rely on the compiler; use `useMemo`/`useCallback` manually only when you need precise control or can measure the gain.

### React Compiler v1.0 (stable Oct 2025)

- Automatically applies the equivalent of `memo`, `useMemo`, and `useCallback` to all components that follow the Rules of React. Code that mutates state, reads refs during render, or violates rules *will not be optimized* — the compiler silently skips non-conforming code.
- Next.js includes the compiler by default in new projects. Verify it is active before manually adding memoization wrappers — redundant manual `useMemo` is not harmful but is noise.
- The compiler cannot memoize across module boundaries or optimize impure functions. Keep components pure.

---

## What Was Deliberately Left Out (and Why)

- **Class components.** This project uses function components exclusively. Including class-component patterns would invite the wrong pattern.
- **`useReducer` deep-dive.** Covered in the decision tree entry. The folders/tasks Context stores use `useReducer` over flat arrays + the pure `lib/tree.ts` helpers — see the **`data-flow`** skill for that store/reducer pattern; this skill stays focused on hook mechanics.
- **`useImperativeHandle`.** An advanced escape hatch for exposing DOM methods through a ref. Not a pattern this project needs; including it would invite overuse.
- **`useSyncExternalStore`.** The right API for subscribing to an *external* store (Redux, Zustand). Alfred's client cache is a React **Context** store (`useReducer` + Context, see the **`data-flow`** skill), not an external store, so this hook isn't needed for it. It IS used in `inbox-screen.tsx` to subscribe to `matchMedia` (a genuine external source).
- **`useEffectEvent` / `useEvent`.** A hook for non-reactive effect logic (reads latest props without re-running). Still marked experimental as of mid-2026; do not use in production code. Monitor react.dev for stabilization.
- **Server Components / Client Components boundary.** Covered in the Next.js skill. This skill is React-only: hooks, state, composition, refs, context. The `"use client"` directive and RSC data-fetching patterns belong there.
- **React 18 concurrent features (`startTransition`, `useDeferredValue`).** Not needed at alfred's scale (hundreds of tasks). If list rendering becomes noticeably slow, add these to the skill then.
- **Suspense for data fetching patterns (pre-React 19).** React 19's `use(promise)` supersedes the older ad-hoc Suspense patterns. Including the older patterns would create confusion about which to use.
- **Testing patterns (RTL, Jest).** Covered in the Jest/RTL skill.
