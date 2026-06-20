import { dateInputClass } from './task-meta-panel.styles';

describe('task-meta-panel styles', () => {
  it('themes the native date picker to the dark colour scheme', () => {
    expect(dateInputClass).toContain('[color-scheme:dark]');
  });
});
