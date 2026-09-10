'use client';

import { ArrowRight } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { Button } from '@/components/atoms/button';
import { exampleKindLabel, tierTransition } from '@/components/comms/settings-format';
import { PRUNED_CARD, SETTINGS_CARD, VERSION_STAMP } from '@/components/comms/settings.styles';
import { settle } from '@/components/comms/settle';
import { useCommsSettingsActions } from '@/lib/stores/comms-settings-store';
import type { CommCorrection } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * One correction, which is also one few-shot example.
 *
 * Pruning takes it out of the prompt and leaves the row alone: the record that the owner
 * disagreed with the model is the thing worth keeping even once the example steers badly, and a
 * signal that was never given can't be pruned either. So the card stays legible when pruned —
 * muted, stamped with the version it left at, and one click from coming back.
 */
export function ExampleCard({ correction }: { correction: CommCorrection }) {
  const { setExamplePruned } = useCommsSettingsActions();
  const isPruned = correction.pruned_at !== null;
  const { from, to } = tierTransition(correction);

  const sender = correction.sender_name?.trim();
  const senderLabel = sender === undefined || sender === '' ? correction.sender_handle : sender;

  return (
    <li className={cn(SETTINGS_CARD, isPruned && PRUNED_CARD)}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground">
            <span className="font-medium">{senderLabel}</span>
            <span className="text-muted-foreground"> · {correction.account_label}</span>
            {correction.subject !== null && correction.subject !== '' && (
              <span className="text-muted-foreground"> · {correction.subject}</span>
            )}
          </p>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/70">
            {correction.purged_at === null
              ? (correction.body_excerpt ?? 'No text was captured for this one.')
              : 'Purged — the message and its text are gone.'}
          </p>
        </div>
        <Button
          variant={isPruned ? 'outline' : 'ghost'}
          size="sm"
          className={isPruned ? '' : 'text-muted-foreground'}
          onClick={() => {
            void settle(setExamplePruned(correction.id, !isPruned));
          }}
        >
          {isPruned ? 'Restore' : 'Prune'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <span>{from}</span>
          <ArrowRight size={12} aria-hidden="true" />
          <span className="font-medium text-foreground">{to}</span>
        </span>
        <Badge variant="muted">{exampleKindLabel(correction.kind)}</Badge>
        <span className={VERSION_STAMP}>v{correction.created_version}</span>
        {correction.pruned_version !== null && (
          <span className={VERSION_STAMP}>pruned v{correction.pruned_version}</span>
        )}
      </div>
    </li>
  );
}
