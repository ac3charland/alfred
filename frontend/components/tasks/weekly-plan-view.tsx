'use client';

import { CalendarRange, ChevronDown, ChevronRight, Maximize2 } from 'lucide-react';
import * as React from 'react';

import { ClickableCard } from '@/components/atoms/clickable-card';
import { FullScreenDialog } from '@/components/atoms/dialog';
import { DisclosureToggle } from '@/components/atoms/disclosure-toggle';
import { ViewHeading } from '@/components/atoms/view-heading';
import { WeeklyPlanItems } from '@/components/tasks/weekly-plan-items';
import { formatMonthDay } from '@/lib/date-utils';
import {
  useSelectedWeeklyPlan,
  useWeeklyPlanActions,
  useWeeklyPlanIndex,
} from '@/lib/stores/weekly-plan-store';
import { cn } from '@/lib/utils';

/** The call that fills this view — shown as the empty state, host and key elided. */
const UPLOAD_SNIPPET = String.raw`curl -X POST https://<alfred-host>/api/weekly-plans \
  -H "x-api-key: $INGEST_API_KEY" \
  -H "Content-Type: text/html" \
  --data-binary @week-plan.html`;

/**
 * The plan document itself, in its isolated frame — rendered both inline and (on mobile) inside
 * the full-screen dialog, so the sandbox contract below is defined once and can't drift into a
 * laxer copy on one of the two surfaces.
 */
function PlanFrame({
  html,
  testId,
  className,
}: {
  html: string;
  /** Distinguishes the inline frame from the full-screen one; both can be mounted at once. */
  testId: string;
  className: string;
}) {
  return (
    <iframe
      data-testid={testId}
      title="Weekly plan"
      sandbox="allow-scripts"
      srcDoc={html}
      className={className}
    />
  );
}

/**
 * The Week Plan view: the weekly-review document, rendering itself.
 *
 * The plan is a self-contained HTML document (its own CSS, its own dark mode, and a script
 * that highlights today) uploaded through the keyed ingress endpoint. It renders in an
 * `<iframe srcDoc>` so its `<style>` can't leak into the app and the app's can't restyle it —
 * the same isolation the code module gives a spec snapshot, with one deliberate difference:
 *
 * - `sandbox="allow-scripts"` (the spec frame grants nothing), because the document's own
 *   script is what highlights today's column and fills the today card. Inert scripts would
 *   gut the feature.
 * - `allow-same-origin` stays OFF, so the frame keeps an **opaque origin**: its script can't
 *   read app cookies or storage, or reach the parent DOM. Granting both together would
 *   defeat the sandbox entirely — never add it.
 *
 * No background is set: the document ships its own `prefers-color-scheme` block, so forcing
 * one would break its dark mode.
 *
 * On a phone the inline frame is too cramped for a plan drawn at desktop widths, so below `md`
 * the whole plan is a tap target that reopens it full screen (see the tap layer below).
 *
 * The frame itself opens **shortened** — a preview height, not the whole document — with the
 * tasks and code stories the review created against it (ALF-235's {@link WeeklyPlanItems})
 * sitting underneath, so a glance at the view answers "what came of this week's plan?" without
 * scrolling a full-height document first. "Show full plan" grows the frame in place; the
 * mobile full-screen dialog below is a separate, orthogonal affordance (the widest reading
 * surface), unaffected by whether the inline frame is expanded.
 */
export function WeeklyPlanView() {
  const index = useWeeklyPlanIndex();
  const selected = useSelectedWeeklyPlan();
  const { selectPlan } = useWeeklyPlanActions();
  const [isFullScreen, setIsFullScreen] = React.useState(false);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const frameRegionId = React.useId();

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <ViewHeading
          icon={CalendarRange}
          title="Week Plan"
          description="This week's plan, exactly as it was generated."
        />

        {/* One plan is nothing to pick between, so the picker only appears from two up. The
            label is the upload date alone — the archive stores no other metadata. */}
        {index.length > 1 && (
          <select
            aria-label="Week"
            value={selected?.id ?? ''}
            onChange={(event_) => {
              void selectPlan(event_.target.value);
            }}
            className="rounded-sm border border-border bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
          >
            {index.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {formatMonthDay(plan.uploaded_at)}
              </option>
            ))}
          </select>
        )}
      </div>

      {selected === undefined ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No week plan uploaded yet. Post the generated document and it shows up here.
          </p>
          <pre
            data-testid="weekly-plan-upload-hint"
            className="max-w-full overflow-x-auto rounded-md bg-secondary/40 p-3 text-left text-xs text-muted-foreground"
          >
            {UPLOAD_SNIPPET}
          </pre>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex flex-col gap-2">
            {/* Shortened by default — a preview, not the whole document — and expandable in
                place. The height (not visibility) is what changes, so this is a plain
                transition rather than the app's 0-based reveal/collapse pattern. */}
            <div
              id={frameRegionId}
              className={cn(
                'relative w-full overflow-hidden rounded-md border border-border/60',
                'transition-[height] duration-200 ease-out motion-reduce:transition-none',
                isExpanded ? 'h-[40rem]' : 'h-64',
              )}
            >
              <PlanFrame testId="weekly-plan-html" html={selected.html} className="h-full w-full" />

              {/* The mobile tap layer. It sits OVER the frame because a tap inside a sandboxed
                  iframe never reaches the app — the frame swallows it — so the plan can only be
                  "tappable" via something covering it. That trades the inline frame's own
                  interactivity on mobile for the tap, which is the point: the plan is read full
                  screen, where its controls are actually reachable. Gone at md+, where the
                  inline frame is roomy and stays directly interactive. */}
              <ClickableCard
                aria-label="View the week plan full screen"
                onClick={() => {
                  setIsFullScreen(true);
                }}
                className="absolute inset-0 flex items-end justify-end p-3 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue md:hidden"
              >
                {/* The visible half of the affordance: an invisible tap layer alone would leave
                    nothing to signal the plan opens. Inert so the tap lands on the layer itself. */}
                <span className="pointer-events-none inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                  <Maximize2 size={12} aria-hidden="true" />
                  Full screen
                </span>
              </ClickableCard>
            </div>

            <DisclosureToggle
              variant="inline"
              aria-expanded={isExpanded}
              aria-controls={frameRegionId}
              className="self-start gap-1"
              onClick={() => {
                setIsExpanded((open) => !open);
              }}
            >
              {isExpanded ? (
                <ChevronDown size={14} aria-hidden="true" />
              ) : (
                <ChevronRight size={14} aria-hidden="true" />
              )}
              {isExpanded ? 'Show less' : 'Show full plan'}
            </DisclosureToggle>
          </div>

          <WeeklyPlanItems planId={selected.id} />

          <FullScreenDialog
            open={isFullScreen}
            onOpenChange={setIsFullScreen}
            title={`Week Plan · ${formatMonthDay(selected.uploaded_at)}`}
            closeLabel="Close full screen"
          >
            <PlanFrame
              testId="weekly-plan-html-fullscreen"
              html={selected.html}
              className="h-full w-full"
            />
          </FullScreenDialog>
        </div>
      )}
    </>
  );
}
