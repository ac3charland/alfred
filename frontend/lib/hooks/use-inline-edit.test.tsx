import { act, renderHook } from '@testing-library/react';

import { useInlineEdit } from './use-inline-edit';

describe('useInlineEdit', () => {
  it('begins editing seeded from the current value, and cancel resets the draft', () => {
    const onSave = jest.fn();
    const { result } = renderHook(() => useInlineEdit('hello', onSave));

    expect(result.current.isEditing).toBe(false);
    act(() => {
      result.current.begin();
    });
    expect(result.current.isEditing).toBe(true);
    expect(result.current.draft).toBe('hello');

    act(() => {
      result.current.setDraft('changed');
    });
    expect(result.current.draft).toBe('changed');

    act(() => {
      result.current.cancel();
    });
    expect(result.current.isEditing).toBe(false);
    expect(result.current.draft).toBe('hello');
  });

  it('saves a trimmed, changed value via onSave and exits edit mode', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useInlineEdit('hello', onSave));

    act(() => {
      result.current.begin();
      result.current.setDraft('  world  ');
    });
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).toHaveBeenCalledWith('world');
    expect(result.current.isEditing).toBe(false);
  });

  it('is a no-op when the draft is empty (and resets the draft)', async () => {
    const onSave = jest.fn();
    const { result } = renderHook(() => useInlineEdit('hello', onSave));

    act(() => {
      result.current.begin();
      result.current.setDraft(' '.repeat(3));
    });
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.draft).toBe('hello');
    expect(result.current.isEditing).toBe(false);
  });

  it('is a no-op when the trimmed draft is unchanged', async () => {
    const onSave = jest.fn();
    const { result } = renderHook(() => useInlineEdit('hello', onSave));

    act(() => {
      result.current.begin();
      result.current.setDraft('  hello  ');
    });
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('rolls the draft back to the current value when onSave throws', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useInlineEdit('hello', onSave));

    act(() => {
      result.current.begin();
      result.current.setDraft('world');
    });
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).toHaveBeenCalledWith('world');
    expect(result.current.draft).toBe('hello');
  });

  it('saves on Enter and cancels on Escape via inputProps.onKeyDown', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useInlineEdit('hello', onSave));

    act(() => {
      result.current.begin();
      result.current.setDraft('world');
    });
    await act(async () => {
      result.current.inputProps.onKeyDown({
        key: 'Enter',
      } as React.KeyboardEvent<HTMLInputElement>);
      // onKeyDown fires save() as a void promise; flush it so the assertion is stable.
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith('world');

    act(() => {
      result.current.begin();
      result.current.setDraft('again');
    });
    act(() => {
      result.current.inputProps.onKeyDown({
        key: 'Escape',
      } as React.KeyboardEvent<HTMLInputElement>);
    });
    expect(result.current.draft).toBe('hello');
    expect(result.current.isEditing).toBe(false);
  });
});
