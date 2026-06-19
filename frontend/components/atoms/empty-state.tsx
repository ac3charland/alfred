import * as React from 'react';

interface EmptyStateProperties {
  /** The serif headline (e.g. "Your inbox is empty"). */
  title: string;
  /** An optional muted second line beneath the title. */
  description?: string;
}

/**
 * The centered "nothing here yet" block — a serif title with an optional muted subtitle —
 * shown when a list or view has no content (the inbox/folder empty states, a not-found view).
 */
export function EmptyState({ title, description }: EmptyStateProperties) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="font-serif text-2xl text-muted-foreground/50">{title}</p>
      {description !== undefined && (
        <p className="mt-2 text-sm text-muted-foreground/40">{description}</p>
      )}
    </div>
  );
}
