'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { Input } from '@/components/atoms/input';
import { readerCaptureNotes } from '@/lib/reader/capture';
import { postOpenLink } from '@/lib/reader/open-link';
import { postEyebrow } from '@/lib/reader/source';
import { useReaderPublications } from '@/lib/stores/reader-settings-store';
import { useTaskActions } from '@/lib/stores/tasks-store';
import { useToastActions } from '@/lib/stores/toast-store';
import type { ReaderPostListItem } from '@/lib/types';

import { captureFieldClass, captureInputClass } from './post-row.styles';

export interface ReaderInboxCaptureProperties {
  /** The form's id, so the verb that toggles it can name it in `aria-controls`. */
  id?: string;
  post: ReaderPostListItem;
  /** Close the field (Escape) — the row unmounts it, which discards any draft. */
  onClose: () => void;
  /** The input, so the row's `a` key can focus a field that is already open. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

/**
 * A reader row's Add-to-Inbox field: one line of free text that becomes an unclassified Inbox
 * item, linked back to the post (`source_url` is the row's own Original/Session link) and noted
 * with where it came from. The post stays where it is — a post is reading material that may
 * prompt several items, so after an add the field clears and keeps focus for the next one.
 *
 * Mounted only while open, so its draft is its own `useState` (several rows may have one open,
 * each with its own draft) and closing — Escape, the verb, or the row leaving — discards it.
 *
 * The write goes through the Tasks store's `addTask`, so the Inbox updates optimistically, and a
 * failure is rolled back and toasted there; this only puts the text back so it isn't lost, and
 * confirms a success with its own toast linking to the Inbox.
 */
export function ReaderInboxCapture({ id, post, onClose, inputRef }: ReaderInboxCaptureProperties) {
  const { addTask } = useTaskActions();
  const { showToast } = useToastActions();
  const publications = useReaderPublications();
  const [draft, setDraft] = React.useState('');
  const ownRef = React.useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;

  // Opening the field is asking to type into it.
  React.useEffect(() => {
    ref.current?.focus();
  }, [ref]);

  const text = draft.trim();

  const submit = () => {
    if (text === '') return;
    // Cleared at once (optimistic), which is also what stops a double-pressed Enter adding twice.
    setDraft('');
    const href = postOpenLink(post).href;
    addTask({
      text,
      sourceUrl: href,
      notes: readerCaptureNotes(post, postEyebrow(post, publications), href),
    }).then(
      () => {
        showToast('Added to Inbox', 'default', '/?view=inbox');
      },
      () => {
        // The store has rolled back and toasted; give the text back unless something new was
        // typed since. (A field closed meanwhile is unmounted, and the update goes nowhere.)
        setDraft((current) => (current === '' ? text : current));
      },
    );
  };

  return (
    <form
      id={id}
      className={captureFieldClass}
      data-testid="reader-row-capture"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        ref={ref}
        aria-label="New Inbox item"
        placeholder="Something to do about this post…"
        className={captureInputClass}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          onClose();
        }}
      />
      <Button type="submit" variant="outline" size="sm" disabled={text === ''}>
        Add
      </Button>
    </form>
  );
}
