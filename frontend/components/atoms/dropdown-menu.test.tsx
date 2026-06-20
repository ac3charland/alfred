import { render, screen } from '@testing-library/react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  dropdownMenuItemVariants,
} from './dropdown-menu';

describe('dropdownMenuItemVariants', () => {
  it('applies destructive tone for the destructive variant', () => {
    const result = dropdownMenuItemVariants({ variant: 'destructive' });
    expect(result).toContain('text-destructive');
    expect(result).toContain('focus:text-destructive');
  });

  it('uses the secondary focus tone for the default variant', () => {
    const result = dropdownMenuItemVariants({ variant: 'default' });
    expect(result).toContain('focus:text-secondary-foreground');
    expect(result).not.toContain('text-destructive');
  });

  it('keeps the shared item base classes across variants', () => {
    for (const variant of ['default', 'destructive'] as const) {
      const result = dropdownMenuItemVariants({ variant });
      expect(result).toContain('rounded-sm');
      expect(result).toContain('focus:bg-secondary');
    }
  });
});

describe('DropdownMenu', () => {
  it('renders content and items when open', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    const remove = screen.getByRole('menuitem', { name: 'Delete' });
    expect(remove).toHaveClass('text-destructive');
  });

  it('renders a styled sub-trigger and sub-content', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub open>
            <DropdownMenuSubTrigger>Move to…</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Inbox</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const subTrigger = screen.getByText('Move to…');
    expect(subTrigger).toHaveClass('focus:bg-secondary');
    expect(screen.getByRole('menuitem', { name: 'Inbox' })).toBeInTheDocument();
  });
});
