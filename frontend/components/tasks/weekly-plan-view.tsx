'use client';

import { CalendarRange, Maximize2 } from 'lucide-react';
import * as React from 'react';

import { ClickableCard } from '@/components/atoms/clickable-card';
import { FullScreenDialog } from '@/components/atoms/dialog';
import { formatMonthDay } from '@/lib/date-utils';
import {
  useSelectedWeeklyPlan,
  useWeeklyPlanActions,
  useWeeklyPlanIndex,
} from '@/lib/stores/weekly-plan-store';

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
 */
export function WeeklyPlanView() {
  const index = useWeeklyPlanIndex();
  const selected = useSelectedWeeklyPlan();
  const { selectPlan } = useWeeklyPlanActions();
  const [isFullScreen, setIsFullScreen] = React.useState(false);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-accent-teal">
            <CalendarRange size={20} />
          </div>
          <div className="flex flex-col">
            <h2 className="font-serif text-2xl text-foreground">Week Plan</h2>
            <p className="text-sm text-muted-foreground">
              This week&apos;s plan, exactly as it was generated.
            </p>
          </div>
        </div>

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
        <div className="relative flex flex-1 flex-col">
          <PlanFrame
            testId="weekly-plan-html"
            html={selected.html}
            className="min-h-[40rem] w-full flex-1 rounded-md border border-border/60"
          />

          {/* The mobile tap layer. It sits OVER the frame because a tap inside a sandboxed
              iframe never reaches the app — the frame swallows it — so the plan can only be
              "tappable" via something covering it. That trades the inline frame's own
              interactivity on mobile for the tap, which is the point: the plan is read full
              screen, where its controls are actually reachable. Gone at md+, where the inline
              frame is roomy and stays directly interactive. */}
          <ClickableCard
            aria-label="View the week plan full screen"
            onClick={() => {
              setIsFullScreen(true);
            }}
            className="absolute inset-0 flex items-end justify-end rounded-md p-3 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue md:hidden"
          >
            {/* The visible half of the affordance: an invisible tap layer alone would leave
                nothing to signal the plan opens. Inert so the tap lands on the layer itself. */}
            <span className="pointer-events-none inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
              <Maximize2 size={12} aria-hidden="true" />
              Full screen
            </span>
          </ClickableCard>

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
