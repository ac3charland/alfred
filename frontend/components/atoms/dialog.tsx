'use client';

import { type VariantProps, cva } from 'class-variance-authority';
import { Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';
import { createPortal } from 'react-dom';

import { CloseButton } from '@/components/atoms/close-button';
import { useVisualViewport } from '@/lib/hooks/use-visual-viewport';
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

interface SheetFooterContextValue {
  /** The footer element once it has mounted, `null` on the very first render. */
  element: HTMLElement | null;
  /** True while at least one editor holds the footer. */
  claimed: boolean;
  /** Take the footer for an editor; returns the release. */
  claim: () => () => void;
}

const SheetFooterContext = React.createContext<SheetFooterContextValue | null>(null);

/**
 * The sheet's footer element, for an editor that draws its own action bar there (a
 * `TextareaField`'s `actionsTarget`). `null` outside a sheet, and for the render before the
 * footer has mounted.
 */
export function useSheetFooterElement(): HTMLElement | null {
  return React.useContext(SheetFooterContext)?.element ?? null;
}

/**
 * Hold the sheet's footer while `active` and the calling component are mounted, which hides
 * the resting {@link SheetFooter} content so the editor's own bar has the footer to itself. A
 * no-op outside a sheet.
 */
export function useSheetFooterClaim(active: boolean): void {
  const claim = React.useContext(SheetFooterContext)?.claim;
  React.useEffect(() => {
    if (!active || claim === undefined) return;
    return claim();
  }, [active, claim]);
}

/**
 * The sheet's resting footer content (a story's action bar): portalled into the sheet's footer
 * element and hidden while an editor holds it, so the sheet has one bottom bar whatever is
 * going on. Renders nothing outside a {@link SheetDialog}.
 */
export function SheetFooter({ children }: { children: React.ReactNode }) {
  const sheet = React.useContext(SheetFooterContext);
  if (sheet?.element == null || sheet.claimed) return null;
  return createPortal(children, sheet.element);
}

export interface SheetDialogProperties extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Extra classes for the overlay — pass `z-[55]` here to match a deeper stacking context. */
  overlayClassName?: string | undefined;
}

/**
 * A full-bleed sheet sized to the part of the screen the user can see: the same
 * `Root → Portal → Overlay → Content` scaffold as `FormDialog`, but the content fills the
 * screen (no radius, border or padding) and tracks `window.visualViewport`, so a phone's
 * on-screen keyboard shortens it instead of covering its lower half. That is what
 * {@link FullScreenDialog}'s `100dvh` cannot do: iOS Safari doesn't shrink `dvh` for the keyboard.
 * Where the API is absent the sheet falls back to `top-0 h-[100dvh]`.
 *
 * `children` are the header and the scrolling body (`min-h-0 flex-1 overflow-y-auto`); after them
 * the sheet renders an always-present, `shrink-0` footer. A story's resting action bar goes there
 * through {@link SheetFooter}; an editor draws its own bar in it via {@link useSheetFooterElement}
 * and {@link useSheetFooterClaim}. Because the footer sits outside the scrolling body, scrolling
 * to the end always leaves the last line of the content above it.
 *
 * When the visible viewport changes and a text field inside has focus, the field is scrolled
 * into view — the sheet just resized under it.
 */
export function SheetDialog({
  open,
  onOpenChange,
  className,
  overlayClassName,
  style,
  children,
  ...contentProps
}: SheetDialogProperties) {
  const viewport = useVisualViewport();
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [footer, setFooter] = React.useState<HTMLElement | null>(null);
  const [claims, setClaims] = React.useState(0);

  const claim = React.useCallback(() => {
    setClaims((count) => count + 1);
    return () => {
      setClaims((count) => count - 1);
    };
  }, []);
  const footerContext = React.useMemo(
    () => ({ element: footer, claimed: claims > 0, claim }),
    [footer, claims, claim],
  );

  // The keyboard just resized the sheet (or iOS panned the viewport to a focused field): bring
  // the focused field back into view once the new height has laid out. `nearest` scrolls no
  // further than needed, and the browser's own caret-following takes over as the user types.
  // The first reading is not a change, so only a later one schedules the scroll.
  const lastViewport = React.useRef(viewport);
  React.useEffect(() => {
    if (lastViewport.current === viewport) return;
    lastViewport.current = viewport;
    if (viewport === null) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return;
      if (contentRef.current?.contains(active) !== true) return;
      // `scrollIntoView` is unimplemented under jsdom, so feature-detect it.
      if (typeof active.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [viewport]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogOverlay className={overlayClassName} />
        <DialogPrimitive.Content
          ref={contentRef}
          className={cn(
            'fixed inset-x-0 z-50 flex w-screen flex-col bg-surface',
            viewport === null && 'top-0 h-[100dvh]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none',
            className,
          )}
          style={
            viewport === null
              ? style
              : { ...style, top: viewport.offsetTop, height: viewport.height }
          }
          // No description anywhere — silences the Radix warning without inventing prose.
          aria-describedby={undefined}
          {...contentProps}
        >
          <SheetFooterContext value={footerContext}>
            {children}
            <div ref={setFooter} data-sheet-footer="" className="shrink-0" />
          </SheetFooterContext>
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
