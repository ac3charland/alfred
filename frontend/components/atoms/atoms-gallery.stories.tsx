import type { Meta, StoryObj } from '@storybook/nextjs';
import { Check, MoreHorizontal, Plus } from 'lucide-react';
import * as React from 'react';

import { FieldLabel } from './field-label';
import { IconButton } from './icon-button';
import { Spinner } from './spinner';
import { TextField } from './text-field';

/**
 * A single panel that shows the shared UI atoms together — the at-a-glance view of
 * the component library that the task rows, folder nav, and capture box now compose
 * from. Screenshotted for the demo doc.
 */
const meta = {
  title: 'Atoms/Gallery',
  component: IconButton,
  parameters: { controls: { disable: true } },
} satisfies Meta<typeof IconButton>;

export default meta;

type Story = StoryObj<typeof meta>;

const TONES = ['neutral', 'accent', 'affirm', 'danger'] as const;

/**
 * The text colour each tone resolves to on hover. Forced via className here so the
 * static gallery can preview the hover state that's otherwise only visible on
 * pointer-over — at rest neutral, accent and danger all share the muted tint.
 */
const HOVER_PREVIEW: Record<(typeof TONES)[number], string> = {
  neutral: 'text-foreground',
  accent: 'text-accent-teal',
  affirm: 'text-accent-teal',
  danger: 'text-destructive',
};

export const Library: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-8">
      <section className="flex flex-col gap-3">
        <FieldLabel>Icon buttons</FieldLabel>
        <div className="grid grid-cols-[4.5rem_2.5rem_2.5rem_2.5rem_3rem] items-center gap-x-3 gap-y-3">
          {/* Column headers */}
          <span />
          <span className="text-center text-[10px] uppercase tracking-wider text-muted-foreground/50">
            sm
          </span>
          <span className="text-center text-[10px] uppercase tracking-wider text-muted-foreground/50">
            md
          </span>
          <span className="text-center text-[10px] uppercase tracking-wider text-muted-foreground/50">
            lg
          </span>
          <span className="text-center text-[10px] uppercase tracking-wider text-accent-teal/70">
            hover
          </span>

          {TONES.map((tone) => (
            <React.Fragment key={tone}>
              <span className="text-xs uppercase tracking-widest text-muted-foreground/70">
                {tone}
              </span>
              <span className="flex justify-center">
                <IconButton tone={tone} size="sm" aria-label={`${tone} small`}>
                  <MoreHorizontal size={12} />
                </IconButton>
              </span>
              <span className="flex justify-center">
                <IconButton tone={tone} size="md" aria-label={`${tone} medium`}>
                  <Plus size={14} />
                </IconButton>
              </span>
              <span className="flex justify-center">
                <IconButton tone={tone} size="lg" aria-label={`${tone} large`}>
                  <Check size={16} />
                </IconButton>
              </span>
              {/* Forced-hover preview (md) */}
              <span className="flex justify-center">
                <IconButton
                  tone={tone}
                  size="md"
                  className={HOVER_PREVIEW[tone]}
                  aria-label={`${tone} hover`}
                >
                  <Plus size={14} />
                </IconButton>
              </span>
            </React.Fragment>
          ))}
        </div>
        <p className="text-xs text-muted-foreground/60">
          The rightmost column previews each tone&rsquo;s hover colour — at rest neutral, accent and
          danger share the muted tint and only diverge on hover.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <FieldLabel htmlFor="gallery-field">Text field</FieldLabel>
        <TextField id="gallery-field" defaultValue="Write the atoms audit" className="w-full" />
      </section>

      <section className="flex items-center gap-4">
        <FieldLabel>Spinner</FieldLabel>
        <Spinner label="Saving" />
        <Spinner label="Loading" size={20} className="text-accent-teal" />
      </section>
    </div>
  ),
};
