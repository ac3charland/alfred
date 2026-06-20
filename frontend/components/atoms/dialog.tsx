'use client';

import { type VariantProps, cva } from 'class-variance-authority';
import { Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';

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
