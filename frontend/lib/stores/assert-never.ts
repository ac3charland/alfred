/**
 * Exhaustiveness guard for a discriminated union's reducer `default` branch: in the
 * `switch` over a union of action types, the `default` case receives `never` once every
 * variant is handled, so passing a value here is a compile error if a variant is missed and
 * a runtime throw if an unknown action slips through. `context` names what was unhandled
 * (e.g. `'task action'` → `Unhandled task action: …`).
 */
export function assertNever(value: never, context: string): never {
  throw new Error(`Unhandled ${context}: ${JSON.stringify(value)}`);
}
