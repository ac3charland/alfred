'use client';

import { type VariantProps, cva } from 'class-variance-authority';
import { Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';

import { CloseButton } from '@/components/atoms/close-button';
import { cn } from '@/lib/utils';

/**
 * The shared dim-and-blur overlay behind a modal. Defaults to `z-50`; pass `className`
 * (e.g. `z-[55]`) to override the stacking without re-pasting the blur/animation classes.
 * (The z-index differences across dialogs are intentional stacking — keep them.)
 */
const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

// Re-export the unstyled structural pieces so call sites import the dialog parts from this
// one home rather than reaching back to `radix-ui` for `Dialog.Title` / `.Description` /
// `.Close`. (Title/Description/Close carry no shared styling — each site passes its own
// className — but routing them through the atom keeps the whole dialog surface in one import
// and off the raw Radix primitive.)
const DialogRoot = DialogPrimitive.Root;
const DialogPortal = DialogPrimitive.Portal;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;
const DialogClose = DialogPrimitive.Close;
const DialogContent = DialogPrimitive.Content;

const dialogContentVariants = cva(
  cn(
    'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
    'w-full rounded-2xl border border-border bg-surface p-6',
    'shadow-[0_0_40px_0_rgba(79,209,224,0.08)]',
    'data-[state=open]:animate-in data-[state=closed]:animate-out',
    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none',
  ),
  {
    variants: {
      maxWidth: {
        md: 'max-w-md',
        lg: 'max-w-lg',
        '2xl': 'max-w-2xl',
      },
    },
    defaultVariants: {
      maxWidth: 'md',
    },
  },
);

/**
 * The modal's "×" dismiss: the Radix `Close` wired (via `asChild`) to the shared
 * `CloseButton`'s `dialog` presentation, so every modal's close is one control — muted with a
 * teal focus ring, a ≥44px tap target on mobile, dense again at md+. Sits in the header row
 * opposite the title; pass `label` when "Close" isn't specific enough for the surface.
 */
export function DialogCloseButton({ label = 'Close' }: { label?: string | undefined }) {
  return (
    <DialogPrimitive.Close asChild>
      <CloseButton variant="dialog" aria-label={label}>
        <span aria-hidden="true">×</span>
      </CloseButton>
    </DialogPrimitive.Close>
  );
}

export interface FormDialogProperties
  extends
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof dialogContentVariants> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Extra classes for the overlay — pass `z-[55]` here to match a deeper stacking context. */
  overlayClassName?: string;
}

/**
 * The shared modal scaffold: `Root → Portal → DialogOverlay → Content`, with the dialog's
 * width as a `maxWidth` variant and the common surface/animation classes baked in. Pass
 * `className` for per-dialog content tweaks (e.g. a scrollable `flex max-h-[85vh] flex-col`
 * body) and `overlayClassName` for the overlay's z-index. Controlled via `open` /
 * `onOpenChange`; forwards `onOpenAutoFocus` (and any other Content props).
 */
export function FormDialog({
  open,
  onOpenChange,
  maxWidth,
  className,
  overlayClassName,
  children,
  ...contentProps
}: FormDialogProperties) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogOverlay className={overlayClassName} />
        <DialogPrimitive.Content
          className={cn(dialogContentVariants({ maxWidth }), className)}
          {...contentProps}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface FullScreenDialogProperties
  // `title` is ours (the header text), not the DOM's tooltip attribute.
  extends Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'title'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The header text, which doubles as the dialog's accessible name. */
  title: React.ReactNode;
  /** Overrides the × dismiss's label when "Close" isn't specific enough for the surface. */
  closeLabel?: string | undefined;
  /** Extra classes for the overlay — pass `z-[55]` here to match a deeper stacking context. */
  overlayClassName?: string | undefined;
}

/**
 * A full-bleed modal: the same `Root → Portal → Overlay → Content` scaffold as `FormDialog`, but
 * the content **fills the viewport** rather than floating as a centred card — no centring
 * translate, no radius, no padding. Built for handing a cramped embedded document (a week plan,
 * a rendered spec) the whole screen on a phone.
 *
 * Height is `100dvh`, not `100vh`: on mobile the two differ by the browser's collapsing
 * toolbars, and `100vh` leaves the bottom of the document clipped behind them.
 *
 * The header is a compact title row with the shared × dismiss; `children` fill the remaining
 * space in a `min-h-0` flex column, so a `h-full` child (an iframe, a scroll container) gets
 * exactly the leftover height instead of overflowing the screen.
 */
export function FullScreenDialog({
  open,
  onOpenChange,
  title,
  closeLabel,
  className,
  overlayClassName,
  children,
  ...contentProps
}: FullScreenDialogProperties) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogOverlay className={overlayClassName} />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col bg-surface',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none',
            className,
          )}
          // No description anywhere — silences the Radix warning without inventing prose.
          aria-describedby={undefined}
          {...contentProps}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
            <DialogPrimitive.Title className="font-serif text-lg text-foreground">
              {title}
            </DialogPrimitive.Title>
            <DialogCloseButton label={closeLabel} />
          </div>
          <div className="min-h-0 flex-1">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export {
  DialogOverlay,
  dialogContentVariants,
  DialogRoot,
  DialogPortal,
  DialogTrigger,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogContent,
};
