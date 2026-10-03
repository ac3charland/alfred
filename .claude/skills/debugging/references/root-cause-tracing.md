# Root-cause tracing

The error usually surfaces deep in the stack: a `NaN` at render, a null row in a Worker, a file
written to the wrong directory. Fixing it there treats a symptom. Trace it back instead.

## Walk the chain backward

1. **Symptom:** what's wrong, and where it shows (`TypeError: cannot read 'title' of undefined` in
   `TaskRow`).
2. **Immediate cause:** the line that produced it (`task.title`, where `task` is undefined).
3. **Who called it, with what:** go up one frame and record the *value* that was passed, not just
   the function name (`TaskList` mapped over `ids` and looked each up in the store, and one id had
   no entry).
4. **Repeat** until you reach the place the value was first wrong: the store dropped the task on an
   optimistic rollback while the id list kept it.
5. **Fix at that source.** Then decide whether the layers in between should also refuse the bad
   value (a guard, a validated type, a thrown error). That's defence in depth, never a substitute
   for the source fix.

## When you can't trace by reading: capture the stack

Log right *before* the suspect operation, with its inputs and the call stack:

```ts
console.error('DEBUG lookup', { id, known: Object.keys(byId).length, stack: new Error().stack });
```

- Use `console.error` in tests. Jest and Playwright surface stderr, while an app logger may be
  silenced.
- Narrow the output: `npm run test -w frontend -- <pattern> 2>&1 | grep 'DEBUG lookup'`.
- Read the stacks for the pattern: the same test, the same caller, the same argument each time.

## Finding the test that pollutes shared state

When a test fails only in the full run (leaked mocks, timers, module state, a leftover row), bisect
the order rather than reading every file. Run the suspect file alone. If it passes, run it after
each half of its siblings (`npm run test -w <pkg> -- <a> <suspect>`) and halve again until one file
breaks it. Then fix the leak at its source (a missing `afterEach` restore, module state shared
across tests) instead of reordering tests.
