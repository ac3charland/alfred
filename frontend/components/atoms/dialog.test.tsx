import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';
import { createPortal } from 'react-dom';

import {
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  FormDialog,
  FullScreenDialog,
  SheetDialog,
  SheetFooter,
  dialogContentVariants,
  useSheetFooterClaim,
  useSheetFooterElement,
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

describe('FullScreenDialog', () => {
  it('names the dialog with its title and renders it as a heading', () => {
    render(
      <FullScreenDialog open onOpenChange={jest.fn()} title="Week Plan">
        <p>body</p>
      </FullScreenDialog>,
    );

    expect(screen.getByRole('dialog', { name: 'Week Plan' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Week Plan' })).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('fills the viewport instead of floating as a centred card', () => {
    render(
      <FullScreenDialog open onOpenChange={jest.fn()} title="Week Plan">
        <p>body</p>
      </FullScreenDialog>,
    );

    const content = screen.getByRole('dialog');
    // `100dvh` (not `100vh`) so a phone's collapsing browser chrome can't clip the bottom.
    expect(content).toHaveClass('fixed', 'inset-0', 'h-[100dvh]', 'flex', 'flex-col');
    // None of the FormDialog card chrome: no centring translate, no radius, no padding.
    expect(content).not.toHaveClass('rounded-2xl', 'p-6', '-translate-x-1/2', 'max-w-md');
  });

  it('carries the shared × dismiss, which closes it', async () => {
    const onOpenChange = jest.fn();
    const user = userEvent.setup();
    render(
      <FullScreenDialog open onOpenChange={onOpenChange} title="Week Plan">
        <p>body</p>
      </FullScreenDialog>,
    );

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('accepts a caller-supplied close label', () => {
    render(
      <FullScreenDialog open onOpenChange={jest.fn()} title="Week Plan" closeLabel="Close plan">
        <p>body</p>
      </FullScreenDialog>,
    );

    expect(screen.getByRole('button', { name: 'Close plan' })).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onOpenChange = jest.fn();
    const user = userEvent.setup();
    render(
      <FullScreenDialog open onOpenChange={onOpenChange} title="Week Plan">
        <p>body</p>
      </FullScreenDialog>,
    );

    await user.keyboard('[Escape]');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders nothing when closed', () => {
    render(
      <FullScreenDialog open={false} onOpenChange={jest.fn()} title="Week Plan">
        <p>body</p>
      </FullScreenDialog>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('body')).not.toBeInTheDocument();
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

describe('DialogCloseButton', () => {
  function renderInDialog(node: React.ReactNode) {
    return render(
      <FormDialog open onOpenChange={() => {}} aria-describedby={undefined}>
        <DialogTitle>Dismissable</DialogTitle>
        {node}
      </FormDialog>,
    );
  }

  it('renders the × dismiss with a default "Close" label', () => {
    renderInDialog(<DialogCloseButton />);

    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toHaveTextContent('×');
    expect(close).toHaveAttribute('type', 'button');
  });

  it('accepts a caller-supplied label', () => {
    renderInDialog(<DialogCloseButton label="Close story" />);

    expect(screen.getByRole('button', { name: 'Close story' })).toBeInTheDocument();
  });

  it('closes the dialog when clicked (it IS the Radix Close, not a lookalike)', async () => {
    const onOpenChange = jest.fn();
    const user = userEvent.setup();
    render(
      <FormDialog open onOpenChange={onOpenChange} aria-describedby={undefined}>
        <DialogTitle>Dismissable</DialogTitle>
        <DialogCloseButton />
      </FormDialog>,
    );

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('carries the shared ≥44px mobile tap target (ALF-138)', () => {
    renderInDialog(<DialogCloseButton />);

    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass(
      'h-11',
      'w-11',
      'md:h-auto',
      'md:w-auto',
      'md:p-1',
    );
  });
});

/** A stand-in for `window.visualViewport`: an event target whose readings the test sets. */
class FakeVisualViewport extends EventTarget {
  height = 470;
  offsetTop = 0;
}

function installVisualViewport(viewport: FakeVisualViewport | undefined) {
  Object.defineProperty(globalThis, 'visualViewport', { configurable: true, value: viewport });
}

/** The sheet's resting bar, found even while it is hidden. */
function restingBar() {
  return screen.getByRole('navigation', { name: 'Actions', hidden: true });
}

/** Holds the sheet's footer while mounted, the way an open editor does. */
function Claimant() {
  useSheetFooterClaim(true);
  return <p>editor open</p>;
}

/** Portals a bar into the footer element, the way `TextareaField`'s `actionsTarget` does. */
function EditorBar() {
  const footer = useSheetFooterElement();
  return footer === null ? null : createPortal(<button type="button">Save</button>, footer);
}

function renderSheet(children?: React.ReactNode) {
  return render(
    <SheetDialog open onOpenChange={jest.fn()}>
      <DialogPrimitive.Title>Story</DialogPrimitive.Title>
      <div data-testid="body">body</div>
      <SheetFooter>
        <nav aria-label="Actions">bar</nav>
      </SheetFooter>
      {children}
    </SheetDialog>,
  );
}

describe('SheetDialog', () => {
  afterEach(() => {
    installVisualViewport(undefined);
  });

  it('fills the screen instead of floating as a centred card', () => {
    installVisualViewport(new FakeVisualViewport());
    renderSheet();

    const content = screen.getByRole('dialog');
    expect(content).toHaveClass('fixed', 'inset-x-0', 'z-50', 'flex', 'w-screen', 'flex-col');
    expect(content).not.toHaveClass('rounded-2xl', 'p-6', '-translate-x-1/2', 'max-w-md');
    expect(content).not.toHaveClass('border');
  });

  it('tracks the visible viewport: top and height come from the keyboard-aware reading', () => {
    const viewport = new FakeVisualViewport();
    viewport.height = 470;
    viewport.offsetTop = 30;
    installVisualViewport(viewport);
    renderSheet();

    const content = screen.getByRole('dialog');
    expect(content).toHaveStyle({ top: '30px', height: '470px' });
    expect(content).not.toHaveClass('h-[100dvh]');

    act(() => {
      viewport.height = 300;
      viewport.dispatchEvent(new Event('resize'));
    });

    expect(content).toHaveStyle({ top: '30px', height: '300px' });
  });

  it('falls back to the top of a 100dvh screen where the visual viewport API is absent', () => {
    installVisualViewport(undefined);
    renderSheet();

    const content = screen.getByRole('dialog');
    expect(content).toHaveClass('top-0', 'h-[100dvh]');
    expect(content.style.top).toBe('');
    expect(content.style.height).toBe('');
  });

  it('closes on Escape like any dialog', async () => {
    const onOpenChange = jest.fn();
    const user = userEvent.setup();
    render(
      <SheetDialog open onOpenChange={onOpenChange}>
        <DialogPrimitive.Title>Story</DialogPrimitive.Title>
      </SheetDialog>,
    );

    await user.keyboard('[Escape]');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders nothing when closed', () => {
    render(
      <SheetDialog open={false} onOpenChange={jest.fn()}>
        <DialogPrimitive.Title>Story</DialogPrimitive.Title>
      </SheetDialog>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  describe('footer', () => {
    it("sits after the body, inside the sheet's own footer region", () => {
      renderSheet();

      const footer = screen.getByRole('dialog').querySelector('[data-sheet-footer]');
      if (footer === null) throw new Error('the sheet has no footer element');
      expect(footer).toHaveClass('shrink-0');
      expect(footer).toContainElement(screen.getByRole('navigation', { name: 'Actions' }));
      // The footer follows the body in DOM order, so it pins below it in the flex column.
      expect(
        screen.getByTestId('body').compareDocumentPosition(footer) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('hides the resting content while an editor holds the footer, and restores it on release', () => {
      const view = renderSheet();
      expect(screen.getByRole('navigation', { name: 'Actions' })).toBeInTheDocument();

      view.rerender(
        <SheetDialog open onOpenChange={jest.fn()}>
          <DialogPrimitive.Title>Story</DialogPrimitive.Title>
          <SheetFooter>
            <nav aria-label="Actions">bar</nav>
          </SheetFooter>
          <Claimant />
        </SheetDialog>,
      );
      expect(screen.queryByRole('navigation', { name: 'Actions' })).not.toBeInTheDocument();

      view.rerender(
        <SheetDialog open onOpenChange={jest.fn()}>
          <DialogPrimitive.Title>Story</DialogPrimitive.Title>
          <SheetFooter>
            <nav aria-label="Actions">bar</nav>
          </SheetFooter>
        </SheetDialog>,
      );
      expect(screen.getByRole('navigation', { name: 'Actions' })).toBeInTheDocument();
    });

    it('keeps the resting content mounted while an editor holds the footer, only hidden', () => {
      // A pending debounced write, a launch in flight or a menu's state lives in the resting
      // content; unmounting it every time an editor opens would drop them.
      const unmounted = jest.fn();
      function Resting() {
        React.useEffect(() => unmounted, []);
        return <nav aria-label="Actions">bar</nav>;
      }
      const tree = (claimed: boolean) => (
        <SheetDialog open onOpenChange={jest.fn()}>
          <DialogPrimitive.Title>Story</DialogPrimitive.Title>
          <SheetFooter>
            <Resting />
          </SheetFooter>
          {claimed ? <Claimant /> : null}
        </SheetDialog>
      );
      const view = render(tree(false));
      expect(restingBar()).toBeVisible();

      view.rerender(tree(true));
      expect(restingBar()).not.toBeVisible();

      view.rerender(tree(false));
      expect(restingBar()).toBeVisible();
      expect(unmounted).not.toHaveBeenCalled();
    });

    it('lets an editor portal its own bar into the footer element', () => {
      renderSheet(<EditorBar />);

      const footer = screen.getByRole('dialog').querySelector('[data-sheet-footer]');
      expect(footer).toContainElement(screen.getByRole('button', { name: 'Save' }));
    });

    it('renders no resting content outside a sheet', () => {
      render(
        <SheetFooter>
          <nav aria-label="Actions">bar</nav>
        </SheetFooter>,
      );

      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });
  });

  describe('keeping the focused field in view', () => {
    const scrollIntoView = jest.fn();

    beforeEach(() => {
      jest.useFakeTimers();
      scrollIntoView.mockReset();
      // jsdom does not implement scrollIntoView.
      Element.prototype.scrollIntoView = scrollIntoView;
    });

    afterEach(() => {
      jest.useRealTimers();
      // Back to jsdom's own (absent) implementation.
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    });

    function renderWithField(viewport: FakeVisualViewport) {
      installVisualViewport(viewport);
      renderSheet(<textarea aria-label="Edit notes" />);
    }

    it('scrolls the focused textarea into view, in the next frame, when the keyboard resizes the viewport', () => {
      const viewport = new FakeVisualViewport();
      renderWithField(viewport);
      screen.getByRole('textbox', { name: 'Edit notes' }).focus();
      scrollIntoView.mockClear();

      act(() => {
        viewport.height = 300;
        viewport.dispatchEvent(new Event('resize'));
      });
      // Not synchronously: the sheet has to re-lay-out at the new height first.
      expect(scrollIntoView).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersToNextFrame();
      });

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
      expect(scrollIntoView.mock.contexts[0]).toBe(
        screen.getByRole('textbox', { name: 'Edit notes' }),
      );
    });

    it('does nothing when the focus is not in a text field', () => {
      const viewport = new FakeVisualViewport();
      renderWithField(viewport);
      screen.getByRole('dialog').focus();
      scrollIntoView.mockClear();

      act(() => {
        viewport.height = 300;
        viewport.dispatchEvent(new Event('resize'));
        jest.advanceTimersToNextFrame();
      });

      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('does nothing when the reading did not change', () => {
      const viewport = new FakeVisualViewport();
      renderWithField(viewport);
      screen.getByRole('textbox', { name: 'Edit notes' }).focus();
      scrollIntoView.mockClear();

      act(() => {
        viewport.dispatchEvent(new Event('resize'));
        jest.advanceTimersToNextFrame();
      });

      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });
});
