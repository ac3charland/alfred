import type { PostgrestError } from '@supabase/supabase-js';

import { mapSupabaseError } from './supabase-errors';

/** Build a minimal PostgrestError with the fields the mapper reads. */
function pgError(code: string, message = 'db error'): PostgrestError {
  const error = { name: 'PostgrestError', message, details: '', hint: '', code };
  return { ...error, toJSON: () => error };
}

describe('mapSupabaseError', () => {
  it('maps 23505 (unique violation) to 409', () => {
    const result = mapSupabaseError(pgError('23505', 'duplicate key value'));
    expect(result).toStrictEqual({ status: 409, message: 'duplicate key value' });
  });

  it('maps 23503 (foreign-key violation) to 400', () => {
    const result = mapSupabaseError(pgError('23503', 'fk violation'));
    expect(result).toStrictEqual({ status: 400, message: 'fk violation' });
  });

  it('maps any other code to 500', () => {
    const result = mapSupabaseError(pgError('42P01', 'undefined table'));
    expect(result).toStrictEqual({ status: 500, message: 'undefined table' });
  });

  it('maps a missing/empty code to 500', () => {
    const result = mapSupabaseError(pgError('', 'mystery failure'));
    expect(result).toStrictEqual({ status: 500, message: 'mystery failure' });
  });

  it('passes the error message through unchanged', () => {
    const result = mapSupabaseError(pgError('23505', 'projects_key_key already exists'));
    expect(result.message).toBe('projects_key_key already exists');
  });
});
