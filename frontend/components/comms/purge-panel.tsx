'use client';

import { Trash2 } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { Button } from '@/components/atoms/button';
import { DialogDescription, DialogTitle, FormDialog } from '@/components/atoms/dialog';
import { PickerChip } from '@/components/atoms/picker-chip';
import { TextField } from '@/components/atoms/text-field';
import { ToggleButton } from '@/components/atoms/toggle-button';
import { SETTINGS_CAPTION, SETTINGS_CARD } from '@/components/comms/settings.styles';
import { type PurgeInput, purgeComms } from '@/lib/api-client';
import { useFormSubmit } from '@/lib/hooks/use-form-submit';
import { useCommsAccounts } from '@/lib/stores/comms-store';

/**
 * The purge — the deliberate "I want this gone", and the one destructive control in the module.
 *
 * It sits under the example set because that is where its blast radius lands: unlike the 60-day
 * retention sweep, which leaves corrections their denormalised text, a purge blanks the text of
 * every example it reaches. Putting the control anywhere else would hide that from the person
 * pressing it.
 *
 * Three selectors, no fourth: one message, one account, or everything before a date. A purge
 * with no selector would be "delete the whole mirror", which is not a thing to reach by
 * accident, so the API refuses it and the button stays disabled until one is filled in.
 *
 * This is the one surface here that calls the API client directly rather than through a store
 * action. What it destroys is `comm_messages` — rows the QUEUE store owns, not this one — and
 * that table carries a realtime subscription, so the deletes reach the queue through the same
 * channel a Worker's writes do. An optimistic action here would be a second, racing writer to a
 * store this page has no business reaching into.
 */
type PurgeMode = 'before' | 'account' | 'message';

const MODE_LABEL: Record<PurgeMode, string> = {
  before: 'Before a date',
  account: 'One account',
  message: 'One message',
};

const MODES: PurgeMode[] = ['before', 'account', 'message'];

export function PurgePanel() {
  const accounts = useCommsAccounts();
  const [mode, setMode] = React.useState<PurgeMode>('before');
  const [before, setBefore] = React.useState('');
  const [accountId, setAccountId] = React.useState<string | null>(null);
  const [messageId, setMessageId] = React.useState('');
  const [confirming, setConfirming] = React.useState(false);
  const [purged, setPurged] = React.useState<number | undefined>();

  const selection: PurgeInput | undefined = React.useMemo(() => {
    if (mode === 'before') {
      // A date input yields a bare `YYYY-MM-DD`; the API wants an instant, and midnight UTC is
      // the reading that matches "everything before this day".
      return before === '' ? undefined : { before: `${before}T00:00:00.000Z` };
    }
    if (mode === 'account') {
      return accountId === null ? undefined : { account_id: accountId };
    }
    return messageId.trim() === '' ? undefined : { message_id: messageId.trim() };
  }, [mode, before, accountId, messageId]);

  const reset = () => {
    setBefore('');
    setAccountId(null);
    setMessageId('');
  };

  return (
    <section className={SETTINGS_CARD}>
      <div className="flex flex-col gap-1">
        <p className={SETTINGS_CAPTION}>Purge</p>
        <p className="text-xs text-muted-foreground/70">
          Messages already expire after 60 days. This is for the ones that shouldn’t wait — and
          unlike the sweep, it blanks the example text too.
        </p>
      </div>

      <div className="flex flex-wrap gap-1" role="group" aria-label="What to purge">
        {MODES.map((value) => (
          <ToggleButton
            key={value}
            pressed={mode === value}
            onToggle={() => {
              setMode(value);
              setPurged(undefined);
            }}
          >
            {MODE_LABEL[value]}
          </ToggleButton>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {mode === 'before' && (
          <TextField
            type="date"
            aria-label="Purge everything before"
            value={before}
            onChange={(event_) => {
              setBefore(event_.target.value);
            }}
          />
        )}
        {mode === 'account' && (
          <PickerChip
            value={accountId}
            options={accounts.map((account) => ({ value: account.id, label: account.label }))}
            onSelect={setAccountId}
            trigger={
              <Badge asButton variant="muted" interactive aria-label="Account to purge">
                {accounts.find((account) => account.id === accountId)?.label ?? 'Choose an account'}
              </Badge>
            }
          />
        )}
        {mode === 'message' && (
          <TextField
            className="w-[22rem] max-w-full"
            aria-label="Message id to purge"
            placeholder="Message id"
            value={messageId}
            onChange={(event_) => {
              setMessageId(event_.target.value);
            }}
          />
        )}

        <Button
          variant="destructive"
          size="sm"
          disabled={selection === undefined}
          onClick={() => {
            setConfirming(true);
          }}
        >
          <Trash2 size={14} />
          Purge
        </Button>

        {purged !== undefined && (
          <p aria-live="polite" className="text-xs text-muted-foreground">
            Purged {purged} {purged === 1 ? 'message' : 'messages'}
          </p>
        )}
      </div>

      <PurgeConfirmDialog
        selection={confirming ? selection : undefined}
        onOpenChange={(open) => {
          if (!open) setConfirming(false);
        }}
        onPurged={(count) => {
          setPurged(count);
          setConfirming(false);
          reset();
        }}
      />
    </section>
  );
}

/** Mounted fresh per confirm, so a pending state can never outlive the dialog it began in. */
function PurgeConfirmDialog({
  selection,
  onOpenChange,
  onPurged,
}: {
  selection: PurgeInput | undefined;
  onOpenChange: (open: boolean) => void;
  onPurged: (count: number) => void;
}) {
  return (
    <FormDialog
      open={selection !== undefined}
      onOpenChange={onOpenChange}
      onOpenAutoFocus={(event_) => {
        event_.preventDefault();
      }}
    >
      {selection !== undefined && (
        <PurgeConfirmBody
          selection={selection}
          onCancel={() => {
            onOpenChange(false);
          }}
          onPurged={onPurged}
        />
      )}
    </FormDialog>
  );
}

function PurgeConfirmBody({
  selection,
  onCancel,
  onPurged,
}: {
  selection: PurgeInput;
  onCancel: () => void;
  onPurged: (count: number) => void;
}) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const { error, isPending, submit } = useFormSubmit({
    onSubmit: () => purgeComms(selection),
    onSuccess: (result) => {
      onPurged(result.purged);
    },
    errorMessage: 'Could not purge those messages. Try again.',
  });

  return (
    <>
      <DialogTitle className="text-base font-semibold text-foreground">Purge messages?</DialogTitle>
      <DialogDescription className="mt-2 text-sm text-muted-foreground">
        This deletes the messages from alfred and blanks their example text. Nothing is touched in
        Gmail or Messages.
      </DialogDescription>

      {error !== null && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="outline" size="sm" ref={cancelRef} onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" disabled={isPending} onClick={() => void submit()}>
          {isPending ? 'Purging…' : 'Purge'}
        </Button>
      </div>
    </>
  );
}
