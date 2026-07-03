import type { Meta, StoryObj } from '@storybook/nextjs';
import { Check, MoreHorizontal, Plus } from 'lucide-react';
import * as React from 'react';

import { FieldLabel } from './field-label';
import { IconButton } from './icon-button';
import { Spinner } from './spinner';
import { TextField } from './text-field';
import { VISUAL_TARGET, withVisualFrame } from './visual-test';

/**
 * A single panel that shows the shared UI atoms together — the at-a-glance view of
 * the component library that the task rows, folder nav, and capture box now compose
 * from. Screenshotted for the demo doc.
 */
const meta = {
  title: 'Atoms/Gallery',
  component: IconButton,
  decorators: [withVisualFrame],
  parameters: { controls: { disable: true }, visualTest: { target: VISUAL_TARGET } },
} satisfies Meta<typeof IconButton>;

export default meta;

type Story = StoryObj<typeof meta>;

const TONES = ['neutral', 'accent', 'affirm', 'danger'] as const;

// The shared panel body, rendered by both the desktop and mobile gallery stories so the two
// viewports audit the identical composition. The `max-w-md` column is wider than a phone, so at
// the 390px mobile viewport the sections reflow — the value the mobile snapshot captures.
function GalleryPanel() {
  return (
    <div className="flex max-w-md flex-col gap-8">
      <section className="flex flex-col gap-3">
        <FieldLabel>Icon buttons</FieldLabel>
        <div className="flex flex-col gap-3">
          {TONES.map((tone) => (
            <div key={tone} className="flex items-center gap-4">
              <span className="w-16 text-xs uppercase tracking-widest text-muted-foreground/70">
                {tone}
              </span>
              <IconButton tone={tone} size="sm" aria-label={`${tone} small`}>
                <MoreHorizontal size={12} />
              </IconButton>
              <IconButton tone={tone} size="md" aria-label={`${tone} medium`}>
                <Plus size={14} />
              </IconButton>
              <IconButton tone={tone} size="lg" aria-label={`${tone} large`}>
                <Check size={16} />
              </IconButton>
            </div>
          ))}
        </div>
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
  );
}

/** The atom library at the desktop default viewport. */
export const Library: Story = {
  render: () => <GalleryPanel />,
};

/**
 * The library at a phone content width. Atoms are fixed-size with no `md:`-gated behaviour, so a
 * shrink-wrapped crop is viewport-independent (identical to {@link Library}); the mobile audit
 * value is seeing the shared atoms at a realistic phone column width — the `w-full` text field
 * stretches edge-to-edge as it does in the capture box on a real phone. So this renders in a
 * fixed phone-width frame (targeted for capture) rather than the shrink-to-fit visual frame.
 */
export const MobileLibrary: Story = {
  decorators: [
    (Story) => (
      <div data-testid="gallery-mobile-frame" className="w-[358px] bg-background">
        <Story />
      </div>
    ),
  ],
  render: () => <GalleryPanel />,
  parameters: {
    visualTest: {
      target: '[data-testid="gallery-mobile-frame"]',
      viewport: { width: 390, height: 844 },
    },
  },
};
