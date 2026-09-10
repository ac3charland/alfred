'use client';

import { Brain } from 'lucide-react';
import * as React from 'react';

import { formatElapsed } from './comms-format';

interface ClassifierBannerProperties {
  /** When judgment stopped — the earliest signal the stall was derived from. */
  since: string;
  now: Date;
}

/**
 * The module-level banner for a classifier outage: ingestion healthy, judgment stalled.
 *
 * Deliberately unlike the per-account lines below it, and deliberately not a fourth dot. A
 * source failure means messages are not arriving and the fix is at the source; this means
 * messages ARE arriving and are being stored, and only the judging has stopped — a different
 * fact with a different fix, which is why it gets its own surface and its own voice.
 *
 * Blue and bordered rather than red: nothing is being lost, and a red line here would spend the
 * alarm the account states need.
 */
export function ClassifierBanner({ since, now }: ClassifierBannerProperties) {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-xl border border-accent-blue/50 bg-accent-blue/[0.06] px-3 py-2.5 glow-blue"
    >
      <Brain size={15} className="mt-0.5 shrink-0 text-accent-blue" />
      <p className="text-[13px] leading-relaxed text-foreground">
        <span className="font-medium">Classifier stalled {formatElapsed(since, now)}</span> —
        judgment only. Everything still arriving is still being stored; nothing new is being judged.
      </p>
    </div>
  );
}
