import { readFileSync } from 'node:fs';
import path from 'node:path';

import { TOUCH_QUERY } from '@/lib/hooks/use-media-query';

describe('TOUCH_QUERY', () => {
  it('states the same condition as the `touch:` CSS variant, so CSS and JS never disagree', () => {
    // The grid's squares resize through the CSS variant while the editor's container is chosen
    // from this string. A drift between them would draw 38px squares that open a desktop popover.
    const css = readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8');
    expect(css).toContain(`@custom-variant touch (@media ${TOUCH_QUERY});`);
  });

  it('covers a narrow viewport and a coarse pointer, either one alone', () => {
    expect(TOUCH_QUERY).toBe('(width < 48rem) or (pointer: coarse)');
  });
});
