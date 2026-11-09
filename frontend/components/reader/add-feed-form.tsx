'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { TextField } from '@/components/atoms/text-field';
import { addFeedErrorMessage } from '@/components/reader/feed-format';
import { FEED_FIELD_ERROR, PUBLICATION_CAPTION } from '@/components/reader/publications.styles';
import { useReaderSettingsActions } from '@/lib/stores/reader-settings-store';

/**
 * The publications page's "Add a feed" field: paste a blog's feed URL, press Add feed (or Enter),
 * and its card joins the roster once the server has fetched it and found a feed. Nothing is
 * optimistic — the button shows pending while the URL is fetched. A refusal keeps the text in the
 * field and says why on one red line beneath it; a success clears the field.
 */
export function AddFeedForm() {
  const { addFeed } = useReaderSettingsActions();
  const [url, setUrl] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const errorId = React.useId();

  const submit = async () => {
    const trimmed = url.trim();
    if (trimmed === '' || pending) return;
    setPending(true);
    setError(undefined);
    try {
      await addFeed(trimmed);
      setUrl('');
    } catch (error_) {
      setError(addFeedErrorMessage(error_));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-2"
      aria-label="Add a feed"
      // The route judges the URL, so a pasted host with no scheme gets this field's own line
      // rather than the browser's validation bubble.
      noValidate
      onSubmit={(event_) => {
        event_.preventDefault();
        void submit();
      }}
    >
      <p className={PUBLICATION_CAPTION}>Add a feed</p>
      <div className="flex items-center gap-2">
        <TextField
          className="flex-1"
          type="url"
          inputMode="url"
          aria-label="Feed URL"
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : errorId}
          placeholder="https://example.com/feed.xml"
          value={url}
          disabled={pending}
          onChange={(event_) => {
            setUrl(event_.target.value);
            // A refusal was about the text it was given; an edit is a new attempt.
            setError(undefined);
          }}
        />
        <Button type="submit" size="sm" variant="accent" disabled={pending || url.trim() === ''}>
          {pending ? 'Adding…' : 'Add feed'}
        </Button>
      </div>
      {error !== undefined && (
        <p id={errorId} role="alert" className={FEED_FIELD_ERROR}>
          {error}
        </p>
      )}
    </form>
  );
}
