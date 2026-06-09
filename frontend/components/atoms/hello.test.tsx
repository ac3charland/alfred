import { render, screen } from '@testing-library/react';

import { Hello } from './hello';

describe('Hello', () => {
  it('renders a greeting with the given name', () => {
    render(<Hello name="World" />);
    expect(screen.getByText('Hello, World!')).toBeInTheDocument();
  });
});
