import { runOptimisticMutation } from './optimistic-mutation';

/** Narrow `T | undefined` to `T` without a non-null assertion (linted out). */
function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a defined value');
  return value;
}

describe('runOptimisticMutation', () => {
  it('applies the optimistic change, awaits the API, then reconciles with the result', async () => {
    const order: string[] = [];
    const result = await runOptimisticMutation({
      optimistic: () => order.push('optimistic'),
      apiCall: () => {
        order.push('apiCall');
        return Promise.resolve('saved');
      },
      reconcile: (value) => order.push(`reconcile:${value}`),
      rollback: () => order.push('rollback'),
    });

    expect(result).toBe('saved');
    expect(order).toStrictEqual(['optimistic', 'apiCall', 'reconcile:saved']);
  });

  it('dispatches the optimistic change before the API resolves', async () => {
    const optimistic = jest.fn();
    // A deferred promise the test resolves manually, so it can observe the synchronous
    // optimistic dispatch while the API call is still pending.
    let resolveApi: ((v: string) => void) | undefined;
    const apiCall = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveApi = resolve;
        }),
    );

    const pending = runOptimisticMutation({
      optimistic,
      apiCall,
      reconcile: jest.fn(),
      rollback: jest.fn(),
    });

    // Optimistic dispatch happened synchronously, before the API resolved.
    expect(optimistic).toHaveBeenCalledTimes(1);
    expect(apiCall).toHaveBeenCalledTimes(1);

    defined(resolveApi)('done');
    await pending;
  });

  it('rolls back and re-throws the original error when the API rejects', async () => {
    const reconcile = jest.fn();
    const rollback = jest.fn();
    const apiError = new Error('network');
    expect.assertions(4);

    try {
      await runOptimisticMutation({
        optimistic: () => {},
        apiCall: () => Promise.reject(apiError),
        reconcile,
        rollback,
      });
    } catch (error) {
      expect(error).toBe(apiError);
    }

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(reconcile).not.toHaveBeenCalled();
    // rollback runs with no args.
    expect(rollback).toHaveBeenCalledWith();
  });

  it('calls onError after rollback and before re-throw when the API rejects', async () => {
    const order: string[] = [];
    const apiError = new Error('network');
    expect.assertions(2);

    try {
      await runOptimisticMutation({
        optimistic: () => order.push('optimistic'),
        apiCall: () => Promise.reject(apiError),
        rollback: () => order.push('rollback'),
        onError: (error) => order.push(`onError:${(error as Error).message}`),
      });
    } catch (error) {
      order.push('caught');
      expect(error).toBe(apiError);
    }

    // onError fires after the rollback dispatch and before the caller sees the re-throw, and
    // receives the original error.
    expect(order).toStrictEqual(['optimistic', 'rollback', 'onError:network', 'caught']);
  });

  it('does not call onError when the API succeeds', async () => {
    const onError = jest.fn();
    await runOptimisticMutation({
      optimistic: () => {},
      apiCall: () => Promise.resolve('ok'),
      reconcile: () => {},
      rollback: () => {},
      onError,
    });

    expect(onError).not.toHaveBeenCalled();
  });

  it('does not call onError when reconcile throws (the write already succeeded)', async () => {
    const onError = jest.fn();
    expect.assertions(2);

    try {
      await runOptimisticMutation({
        optimistic: () => {},
        apiCall: () => Promise.resolve('ok'),
        reconcile: () => {
          throw new Error('reconcile boom');
        },
        rollback: () => {},
        onError,
      });
    } catch (error) {
      expect((error as Error).message).toBe('reconcile boom');
    }

    expect(onError).not.toHaveBeenCalled();
  });

  it('does not roll back when reconcile itself throws (the API succeeded)', async () => {
    const rollback = jest.fn();
    expect.assertions(2);

    try {
      await runOptimisticMutation({
        optimistic: () => {},
        apiCall: () => Promise.resolve('ok'),
        reconcile: () => {
          throw new Error('reconcile boom');
        },
        rollback,
      });
    } catch (error) {
      expect((error as Error).message).toBe('reconcile boom');
    }

    expect(rollback).not.toHaveBeenCalled();
  });

  it('skips reconcile when it is omitted (delete-style mutation)', async () => {
    const order: string[] = [];
    await runOptimisticMutation({
      optimistic: () => order.push('optimistic'),
      apiCall: () => Promise.resolve(undefined),
      rollback: () => order.push('rollback'),
    });

    expect(order).toStrictEqual(['optimistic']);
  });

  describe('rollback strategies (the three existing shapes)', () => {
    interface Row {
      id: string;
      name: string;
      pos: number;
    }

    it('full-row: rollback re-applies the captured prior row', async () => {
      const store: Row[] = [{ id: 'a', name: 'old', pos: 0 }];
      const prev = defined(store[0]);
      await runOptimisticMutation({
        optimistic: () => {
          store[0] = { ...prev, name: 'new' };
        },
        apiCall: () => Promise.reject(new Error('x')),
        rollback: () => {
          store[0] = prev;
        },
      }).catch(() => {});

      expect(defined(store[0]).name).toBe('old');
    });

    it('selective-field: rollback restores only the touched field', async () => {
      const store = { name: 'A', pos: 5 };
      const rollback = { name: store.name };
      await runOptimisticMutation({
        optimistic: () => {
          store.name = 'B';
        },
        apiCall: () => Promise.reject(new Error('x')),
        rollback: () => {
          Object.assign(store, rollback);
        },
      }).catch(() => {});

      expect(store.name).toBe('A');
      // pos untouched by the selective rollback.
      expect(store.pos).toBe(5);
    });

    it('position-aware: rollback restores the removed row at its original index', async () => {
      const store: Row[] = [
        { id: 'a', name: 'A', pos: 0 },
        { id: 'b', name: 'B', pos: 1 },
        { id: 'c', name: 'C', pos: 2 },
      ];
      const index = 1;
      const removed = defined(store[index]);
      await runOptimisticMutation({
        optimistic: () => {
          store.splice(index, 1);
        },
        apiCall: () => Promise.reject(new Error('x')),
        rollback: () => {
          store.splice(index, 0, removed);
        },
      }).catch(() => {});

      expect(store.map((r) => r.id)).toStrictEqual(['a', 'b', 'c']);
    });
  });
});
