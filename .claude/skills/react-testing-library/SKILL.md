---
name: react-testing-library
description: >
  Covers React component testing with React Testing Library:
  query selection (getBy/queryBy/findBy, role/label/text priority), user interactions
  via @testing-library/user-event v14 (async/await, setup()), async patterns (findBy,
  waitFor), rendering with context providers, and patterns specific to this project's
  components — capture box, task rows, subtask lists, Radix Dialog modals, and folder
  navigation. Use before writing any file that imports from @testing-library/react.
  Do NOT use for end-to-end browser flows (playwright skill) or pure-logic unit tests
  with no rendered component (jest skill).
---

# React Testing Library

## Mental Model

> "The more your tests resemble the way your software is used, the more confidence they can give you."
> — Kent C. Dodds (creator of React Testing Library)

RTL tests DOM nodes, not component instances. You never access React state, component refs, or internal methods — only what a user (or assistive technology) can observe in the rendered output. This makes tests resilient to refactoring: you can rename props, extract components, or restructure internals without breaking tests, as long as the UI behavior is unchanged.

**The accessibility-first contract.** RTL queries the DOM the same way a screen reader would: by role, label, visible text. If a component is hard to query without `data-testid`, that's a signal the component needs better accessibility — not a reason to reach for lower-level selectors.

**What RTL wraps.** RTL is a thin layer over `react-dom/test-utils` that provides queries, `render()`, `screen`, `waitFor`, and `act()` integration. It does not replace Jest (assertions, mocking, test runners) — assume the Jest skill covers those.

### Query Priority Hierarchy

Always reach for queries in this order. Use the first one that works.

1. `getByRole` — covers almost everything; mimics the accessibility tree
2. `getByLabelText` — form inputs associated with a `<label>`
3. `getByPlaceholderText` — inputs without a visible label (less preferred)
4. `getByText` — non-interactive elements: paragraphs, headings, list items
5. `getByDisplayValue` — current value of a filled input/select
6. `getByTestId` — absolute last resort; requires adding `data-testid` to the DOM

> Source: Testing Library official docs (testing-library.com/docs/queries/about), confirmed via GitHub repo README (testing-library/react-testing-library, main branch)

---

## Decision Tree: Which Query Variant?

```
Need to query an element?
│
├─ Will the query THROW if missing? (element must exist)
│   └─ Use getBy* (synchronous, throws with a descriptive error)
│
├─ Element might NOT be in the DOM? (absence assertion)
│   └─ Use queryBy* (returns null — never throws)
│       expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
│
└─ Element appears ASYNCHRONOUSLY? (after a fetch, state update, animation)
    └─ Use findBy* (returns a Promise, retries until timeout ~1000ms)
        const item = await screen.findByRole('listitem', { name: /buy milk/i })

Which *By to choose?
│
├─ It's a button, input, checkbox, combobox, dialog, list, heading, link → getByRole
├─ It's a labeled form field → getByLabelText
├─ It's a paragraph / status text / non-interactive content → getByText
└─ Nothing else works → getByTestId (add data-testid to the component)
```

**All three variants (get/query/find) have AllBy counterparts** (`getAllByRole`, `findAllByRole`, etc.) when you expect multiple matching elements.

---

## Plain-English → Pattern Table

| When the agent/user says... | Pattern to use | Key things to know |
|---|---|---|
| "test that typing in the capture box updates the input" | `userEvent.type(input, 'text')` after `getByRole('textbox', { name: /capture/i })` | `user.type` fires real keyboard events; always `await` it in v14. The eslint rule `prefer-user-event` will error on `fireEvent.change`. |
| "test that submitting the capture box creates an item" | `await user.type(input, 'Buy milk'); await user.click(button)` then assert with `findByRole` or `getByRole` | Test the outcome (item appears in list), not the handler call. Use `findByRole` if the list update is async. |
| "query a button by its accessible name" | `screen.getByRole('button', { name: /submit/i })` | The `name` option matches `aria-label`, button text content, or `aria-labelledby` target. Use a regex for case-insensitivity. |
| "assert the modal (Radix Dialog) appears after clicking" | `await user.click(trigger); const dialog = await screen.findByRole('dialog')` | Radix portals into `document.body`; `screen` queries the whole document so no special setup needed. Query the dialog's heading with `within(dialog).getByRole('heading')`. |
| "assert the modal is NOT shown yet" | `expect(screen.queryByRole('dialog')).not.toBeInTheDocument()` | Use `queryBy*` (not `getBy*`) for absence — `getBy*` throws if the element is missing, making the error misleading. |
| "expand a task row and check subtasks appear" | `await user.click(screen.getByRole('button', { name: /expand/i })); screen.getByRole('list', { name: /subtasks/i })` | If subtasks load asynchronously, use `await screen.findByRole('list', ...)` instead. |
| "test a recursive subtask list renders nested items" | Render the component; assert with `screen.getAllByRole('listitem')` and check `.length` or specific text | `within(parentItem).getAllByRole('listitem')` scopes the query to one subtree. |
| "wait for async content to appear after a fetch" | `const el = await screen.findByRole('listitem', { name: /buy milk/i })` | `findBy*` = `waitFor` + `getBy*` combined. Prefer `findBy*` over `await waitFor(() => screen.getBy*(...))` — same behavior, cleaner error messages. ESLint rule `prefer-find-by` enforces this. |
| "test that clicking confirm in the modal calls the callback" | `await user.click(screen.getByRole('button', { name: /confirm/i }))`; assert mock was called | Always place the mock/spy assertion AFTER the interaction resolves, outside `waitFor`. |
| "test a controlled input reflects the passed value" | Render with `value` and `onChange` props; assert `screen.getByDisplayValue('current text')` | For controlled inputs, assert the DOM value — not the React state variable. |
| "test keyboard navigation (Tab to next field)" | `await user.tab()` moves focus; `expect(screen.getByRole('textbox', { name: /title/i })).toHaveFocus()` | `user.tab()` respects `tabIndex`; `toHaveFocus()` is a jest-dom matcher. |
| "test that pressing Enter submits the form" | `await user.keyboard('{Enter}')` | In user-event v14 the key descriptor is `{Enter}` (capital E). Old v13 style `{enter}` no longer works. |
| "render a component that needs a React Context" | Create a `wrapper` with all needed providers; pass to `render(ui, { wrapper: AllProviders })` | Define a shared `renderWithProviders` utility in `test-utils.ts` to avoid repeating wrapper code across tests. |
| "assert an element has specific text" | `expect(screen.getByRole('heading')).toHaveTextContent('My Tasks')` | `toHaveTextContent` is a jest-dom matcher — the ESLint rule `prefer-to-have-text-content` will flag `element.textContent === '...'`. |
| "scope a query to a specific list item" | `const row = screen.getByRole('row', { name: /buy milk/i }); within(row).getByRole('button', { name: /delete/i })` | `within()` from `@testing-library/react` creates a scoped query set. Import it: `import { within } from '@testing-library/react'`. |

---

## Async: findBy / waitFor / act

### The rules

- **`findBy*` queries are async** — always `await` them. Forgetting `await` causes the test to pass immediately on the initial (empty) render and give a false positive.
- **`findBy*` is preferred over `waitFor(() => getBy*())`** — they're equivalent under the hood, but `findBy*` gives better error messages and is shorter. The ESLint rule `prefer-find-by` in the recommended config enforces this.
- **`waitFor` is for assertions that don't have a matching `findBy*`** — e.g., waiting for an element to disappear, or polling multiple assertions at once.
- **Never put side effects (user interactions, renders) inside `waitFor`** — the callback runs with non-deterministic frequency, so the side effect runs multiple times. The ESLint rule `no-wait-for-side-effects` catches this.
  ```ts
  // Wrong — user.click fires repeatedly
  await waitFor(() => {
    user.click(button);
    expect(something).toBeTruthy();
  });

  // Correct — interaction first, then assertion
  await user.click(button);
  await waitFor(() => expect(something).toBeTruthy());
  ```
- **The `act(...)` warning is a symptom, not the problem.** It means state updated after your test's last assertion. The fix is almost always to `await` a `findBy*` or `waitFor` that catches the trailing update — not to manually wrap things in `act()`. RTL's async utilities already wrap in `act` internally.

  > Source: Kent C. Dodds, "Fix the 'not wrapped in act(...)' warning" (kentcdodds.com/blog/fix-the-not-wrapped-in-act-warning)

### Patterns

```ts
// Wait for async element to appear
const item = await screen.findByRole('listitem', { name: /buy milk/i });

// Wait for element to disappear
await waitFor(() =>
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
);

// Multiple assertions — one per waitFor call is cleaner, but batching is fine
// if they all depend on the same async event
await waitFor(() => {
  expect(screen.getByText('Saved')).toBeInTheDocument();
  expect(mockSave).toHaveBeenCalledOnce();
});
```

---

## Common Pitfalls

- **Always import queries from `screen`, never destructure from `render()`.**
  `const { getByRole } = render(...)` is valid JS but the ESLint rule `prefer-screen-queries` will error on it. Use `screen.getByRole(...)`.

- **Never use `container.querySelector` or direct DOM node access.**
  The rule `no-container` catches `container.querySelector`; `no-node-access` catches `.children`, `.parentElement`, etc. Both are errors in the recommended config. If you need a scoped query, use `within()`.

- **Never use `getBy*` to assert absence.** `getBy*` throws a descriptive error when the element is missing, which makes the test fail with a confusing "unable to find element" message rather than your intended assertion. Use `queryBy*` + `not.toBeInTheDocument()`.

- **Always prefer jest-dom matchers over manual DOM assertions.**
  | Instead of... | Use... |
  |---|---|
  | `expect(el.textContent).toBe('text')` | `expect(el).toHaveTextContent('text')` |
  | `expect(el).not.toBe(null)` | `expect(el).toBeInTheDocument()` |
  | `expect(el.disabled).toBe(true)` | `expect(el).toBeDisabled()` |
  | `expect(el.value).toBe('foo')` | `expect(el).toHaveValue('foo')` |
  | `expect(el.className).toContain('active')` | `expect(el).toHaveClass('active')` |
  The ESLint plugin `eslint-plugin-jest-dom` (recommended config, all rules as errors) enforces every row above.

- **Never use `fireEvent` when `userEvent` will do.** `fireEvent` dispatches a single synthetic event; `userEvent` dispatches the full realistic event sequence a browser would fire (pointerdown, mousedown, focus, keydown, input, keyup, click, etc.). The rule `prefer-user-event` errors on `fireEvent` when a `userEvent` equivalent exists.

- **Always `await` userEvent calls in v14.** `await user.click(el)`, `await user.type(el, 'text')`, `await user.keyboard('{Enter}')`. They all return `Promise<void>` in v14; forgetting `await` makes the interaction invisible to subsequent assertions.

- **Call `userEvent.setup()` once per test (or once in `beforeEach`), not once per file.** Each `setup()` call creates an isolated pointer/keyboard state. Reusing across tests leaks state.

- **A globally-mounted element with an implicit role collides with `getByRole`.** `renderWithProviders` mounts the toast viewport, so any always-present `role="status"` region there makes `screen.getByRole('status')` (used by the inline `Spinner`) ambiguous and throws. Give a persistent live region a bare `aria-live="polite"` instead of `role="status"` — it's still announced, but `status` stays reserved for the spinner. The general rule: only one element should claim a given role unnamed; otherwise query by `name`.

---

## Version Gotchas (user-event v14)

Agents trained before 2022 will write v13 patterns. The alfred project uses **user-event v14**, which has these breaking changes:

- **All methods return `Promise<void>` — every call requires `await`.**
  v13: `userEvent.click(button)` (synchronous, no await needed)
  v14: `await user.click(button)` (async — `await` is required)

- **The `setup()` API is the preferred entry point.**
  ```ts
  // v14 idiomatic
  const user = userEvent.setup();
  await user.type(input, 'hello');
  await user.click(submitButton);

  // v14 also allows direct calls (same async requirement)
  await userEvent.type(input, 'hello');
  ```

- **Keyboard descriptor capitalization changed.**
  | v13 | v14 |
  |---|---|
  | `{enter}` | `{Enter}` |
  | `{esc}` | `{Escape}` |
  | `{ctrl}` | `{Control}` |
  | `{del}` | `{Delete}` |
  | `{space}` | `' '` (literal space character) |

- **Modifier keys no longer auto-release.**
  v13: `{ctrl}a` held ctrl and released it automatically.
  v14: use `{Control>}a` to hold, `{/Control}` to release explicitly.

- **`userEvent.clear()` now throws on non-editable elements.** Make sure the element is an editable input before calling clear.

- **Fake timers require explicit configuration.**
  ```ts
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  ```

> Source: user-event v14.0.0 release notes (github.com/testing-library/user-event/releases/tag/v14.0.0); confirmed via GitHub issue discussions #910, #1050 (testing-library/user-event)

---

## Rendering With Providers

Alfred components read from the `FoldersProvider` / `TasksProvider` Context stores (see
the **`data-flow`** skill). A naked `render()` throws on the missing context. Use the real
shared helper — `renderWithProviders` in **`frontend/lib/test-utils.tsx`** — which wraps the
UI in both providers and seeds them:

```tsx
import { renderWithProviders } from '@/lib/test-utils';

// seed the stores per test
renderWithProviders(<FolderNav />, { folders: FOLDERS });
renderWithProviders(<CaptureBox />, { tasks: [] });
```

**Gotcha — store-driven removal needs the list, not a lone row.** With the optimistic
store, completing/deleting/moving a task changes its status/folder (or removes it), so it
drops out of the scoped view; the row unmounts because **`TaskList`** re-renders from
`useScopedTasks(scope)`. A standalone `<TaskRow node={…} />` is prop-driven and won't remove
itself. So test those behaviors through `TaskList` seeded with the flat item list + a scope:

```tsx
renderWithProviders(<TaskList scope={{ type: 'inbox' }} />, { tasks: [BASE_ITEM], folders: [FOLDER] });
// click complete → assert the row is gone; reject the api mock → assert it reappears (rollback)
```

To assert the optimistic frame before the request settles, make the `api-client` mock return a
never-resolving promise (`mockImplementation(() => new Promise(() => {}))`); for reconcile use
`mockResolvedValue`, for rollback `mockRejectedValue`.

> Source: Testing Library official setup docs (testing-library.com/docs/react-testing-library/setup); Redux docs "Writing Tests" section (redux.js.org/usage/writing-tests)

---

## Mocking API Clients in alfred Tests

The alfred frontend uses a thin `lib/api-client.ts` module. To avoid `@typescript-eslint/no-unsafe-return` errors in module factory functions, use the `jest.mocked()` pattern instead of inline arrow wrappers:

```ts
// WRONG — causes no-unsafe-return (mock() return is `any`)
jest.mock('@/lib/api-client', () => ({
  createItem: (...args: unknown[]) => mockCreateItem(...args), // unsafe return
}));

// CORRECT — jest.mock + jest.mocked()
import * as apiClient from '@/lib/api-client';
jest.mock('@/lib/api-client');
const mockCreateItem = jest.mocked(apiClient.createItem);
// jest auto-mocks all exports with jest.fn(); jest.mocked() gives typed access
```

This approach:
- Avoids the `no-unsafe-return` error from wrapping `any` mock return values
- Gives full TypeScript types on the mock (`.mockResolvedValue` checks the return type)
- Works with `jest.clearAllMocks()` in `beforeEach`

**DB null fields in test fixtures (unicorn/no-null)**

`ItemNode` and other DB row types have `string | null` nullable fields (from generated Supabase types). Since `unicorn/no-null` forbids `null` literals in test files, use the `DB_NULL` sentinel:

```ts
const DB_NULL = undefined as unknown as null;

const fixture: ItemNode = {
  notes: DB_NULL,      // satisfies `string | null` type without null literal
  folder_id: DB_NULL,  // same
  // ...
};
```

## What Was Deliberately Left Out

- **`render` return value beyond `rerender`/`unmount`** — the `container`, `baseElement`, and `asFragment` return values are valid but rarely needed; using them is often a sign you should use a screen query instead. The `no-container` ESLint rule prevents the most common misuse.

- **`fireEvent`** — it exists and is valid for events that have no `userEvent` equivalent (e.g., custom synthetic events). For everything else, `userEvent` is required by the ESLint config. `fireEvent` is not documented here to avoid agents defaulting to it.

- **`act()` manual wrapping** — RTL wraps `act()` internally in all its async utilities. Manual `act()` calls are excluded here because agents that know about `act()` tend to reach for it when they should instead `await` a `findBy*` or `waitFor`.

- **Snapshot testing** — `toMatchSnapshot()` / `asFragment()` snapshot tests are excluded. They test structure, not behavior, and are fragile to any markup change. Kent C. Dodds advises against them for component behavior tests.

- **`screen.debug()`** — a useful debugging tool but not a testing pattern; left out to keep the skill focused on assertions.

- **MSW (Mock Service Worker)** — network mocking is out of scope for this skill. Alfred uses MSW for fetch mocking; that's covered separately.

- **React 18 concurrent mode `act()` nuances** — the behavioral differences between React 17 and 18 `act()` wrapping are real but narrow; covering them here would add noise. If you see persistent `act()` warnings after properly awaiting all interactions, the React Testing Library GitHub issues tracker is the right place to investigate.
