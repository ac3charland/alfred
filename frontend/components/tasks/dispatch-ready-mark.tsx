import { dispatchReadyPipClass } from '@/components/tasks/task-row.styles';
import { DISPATCH_READY_LABEL } from '@/lib/tasks/dispatch';

/**
 * The dispatch-ready cue: a small green dot on an Inbox row saying Dispatch will send it —
 * `dispatchReadiness`'s verdict, rendered, and nothing else (the row never names what a NOT-ready
 * row is missing; that stays the bulk bar's readiness line).
 *
 * It is **inert by construction**, a `<span>` in every mode. The only action it could offer is
 * Dispatch itself, which belongs to the bulk bar, and select mode's row is one `<button>` — a
 * nested control there would be invalid HTML with undefined activation behaviour. Being always-
 * inert means one component mounts in both the ordinary row and the select-mode branch, exactly
 * as `ClassificationMark` does. The repo has no tooltip primitive, so the hover text is a native
 * `title` carrying the same words as the accessible name.
 */
export function DispatchReadyMark() {
  return (
    <span
      // `role="img"` is what exposes `aria-label` as the accessible name on a bare span — the
      // dot carries no text of its own to name it.
      role="img"
      aria-label={DISPATCH_READY_LABEL}
      title={DISPATCH_READY_LABEL}
      className={dispatchReadyPipClass}
    />
  );
}
