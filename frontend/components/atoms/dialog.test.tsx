import { render, screen } from '@testing-library/react';
import { Dialog as DialogPrimitive } from 'radix-ui';

import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  FormDialog,
  dialogContentVariants,
} from './dialog';

describe('DialogOverlay', () => {
  it('renders the shared blur classes with a default z-50', () => {
    render(
      <DialogPrimitive.Root open>
        <DialogPrimitive.Portal>
          <DialogOverlay data-testid="overlay" />
          <DialogPrimitive.Content aria-describedby={undefined}>
            <DialogPrimitive.Title>t</DialogPrimitive.Title>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>,
    );
    const overlay = screen.getByTestId('overlay');
    expect(overlay).toHaveClass('fixed', 'inset-0', 'z-50', 'bg-black/60', 'backdrop-blur-sm');
  });

  it('lets a className override the z-index without dropping the blur', () => {
    render(
      <DialogPrimitive.Root open>
        <DialogPrimitive.Portal>
          <DialogOverlay data-testid="overlay" className="z-[55]" />
          <DialogPrimitive.Content aria-describedby={undefined}>
            <DialogPrimitive.Title>t</DialogPrimitive.Title>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>,
    );
    const overlay = screen.getByTestId('overlay');
    expect(overlay).toHaveClass('z-[55]', 'backdrop-blur-sm');
  });
});

describe('dialogContentVariants', () => {
  it('maps each maxWidth to its class', () => {
    expect(dialogContentVariants({ maxWidth: 'md' })).toContain('max-w-md');
    expect(dialogContentVariants({ maxWidth: 'lg' })).toContain('max-w-lg');
    expect(dialogContentVariants({ maxWidth: '2xl' })).toContain('max-w-2xl');
  });

  it('keeps the shared surface classes', () => {
    const result = dialogContentVariants({ maxWidth: 'lg' });
    expect(result).toContain('rounded-2xl');
    expect(result).toContain('bg-surface');
  });
});

describe('FormDialog', () => {
  it('renders its children when open', () => {
    render(
      <FormDialog open onOpenChange={jest.fn()} aria-describedby={undefined}>
        <DialogPrimitive.Title>New project</DialogPrimitive.Title>
        <p>body</p>
      </FormDialog>,
    );
    expect(screen.getByText('New project')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    render(
      <FormDialog open={false} onOpenChange={jest.fn()} aria-describedby={undefined}>
        <DialogPrimitive.Title>Hidden</DialogPrimitive.Title>
      </FormDialog>,
    );
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('applies the maxWidth variant to the content', () => {
    render(
      <FormDialog open onOpenChange={jest.fn()} maxWidth="2xl" aria-describedby={undefined}>
        <DialogPrimitive.Title id="d-title">Wide</DialogPrimitive.Title>
      </FormDialog>,
    );
    const content = screen.getByRole('dialog');
    expect(content).toHaveClass('max-w-2xl', 'rounded-2xl');
  });

  it('merges a content className (e.g. a scrollable body)', () => {
    render(
      <FormDialog
        open
        onOpenChange={jest.fn()}
        className="flex max-h-[85vh] flex-col"
        aria-describedby={undefined}
      >
        <DialogPrimitive.Title>Scroll</DialogPrimitive.Title>
      </FormDialog>,
    );
    const content = screen.getByRole('dialog');
    expect(content).toHaveClass('flex', 'max-h-[85vh]', 'flex-col', 'max-w-md');
  });
});

describe('re-exported dialog parts', () => {
  it('composes a controlled dialog from the atom parts (Title, Description, Close)', () => {
    render(
      <DialogRoot open>
        <DialogPortal>
          <DialogOverlay />
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Re-exported title</DialogTitle>
            <DialogDescription>Re-exported description</DialogDescription>
            <DialogClose>Close me</DialogClose>
          </DialogContent>
        </DialogPortal>
      </DialogRoot>,
    );
    expect(screen.getByText('Re-exported title')).toBeInTheDocument();
    expect(screen.getByText('Re-exported description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close me' })).toBeInTheDocument();
  });
});
