import { chunkedSend } from './chunked-send';

describe('chunkedSend', () => {
  it('starts nothing until a unit asks, then sends every registered id in one request', async () => {
    const send = jest.fn((_ids: string[]) => Promise.resolve());
    const sender = chunkedSend(3, send);

    const requests = ['a', 'b'].map((id) => sender.add(id));
    expect(send).not.toHaveBeenCalled();

    await Promise.all(requests.map((request) => request()));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(['a', 'b']);
  });

  it('exposes the registered ids in order', () => {
    const sender = chunkedSend(2, () => Promise.resolve());

    sender.add('a');
    sender.add('b');
    sender.add('c');

    expect(sender.ids).toEqual(['a', 'b', 'c']);
  });

  it('splits the ids into chunks of at most the bound, one send each', async () => {
    const send = jest.fn((_ids: string[]) => Promise.resolve());
    const sender = chunkedSend(2, send);

    const requests = ['a', 'b', 'c', 'd', 'e'].map((id) => sender.add(id));
    await Promise.all(requests.map((request) => request()));

    expect(send.mock.calls).toEqual([[['a', 'b']], [['c', 'd']], [['e']]]);
  });

  it('asks the shared send once per chunk however many units await it', async () => {
    const send = jest.fn((_ids: string[]) => Promise.resolve());
    const sender = chunkedSend(2, send);
    const [first, second] = [sender.add('a'), sender.add('b')];

    await first();
    await second();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('settles every unit of a chunk with that chunk’s one outcome, and no other chunk', async () => {
    const send = jest
      .fn<Promise<void>, [string[]]>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('502'));
    const sender = chunkedSend(2, send);
    const requests = ['a', 'b', 'c', 'd'].map((id) => sender.add(id));

    const results = await Promise.allSettled(requests.map((request) => request()));

    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'rejected',
      'rejected',
    ]);
  });

  it('resolves each unit with no rows to reconcile', async () => {
    const sender = chunkedSend(2, () => Promise.resolve());

    await expect(sender.add('a')()).resolves.toEqual([]);
  });
});
