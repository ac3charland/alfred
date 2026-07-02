import { copyToClipboard } from './clipboard';

describe('copyToClipboard', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');

  afterEach(() => {
    if (originalClipboard === undefined) {
      // jsdom leaves `clipboard` undefined by default; drop any stub the test installed.
      Reflect.deleteProperty(globalThis.navigator, 'clipboard');
    } else {
      Object.defineProperty(globalThis.navigator, 'clipboard', originalClipboard);
    }
  });

  function stubClipboard(writeText: jest.Mock): void {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  }

  it('writes the text and reports success', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await expect(copyToClipboard('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('reports failure (without throwing) when the write is rejected', async () => {
    const writeText = jest.fn().mockRejectedValue(new Error('denied'));
    stubClipboard(writeText);

    await expect(copyToClipboard('hello')).resolves.toBe(false);
  });

  it('reports failure when the Clipboard API is unavailable', async () => {
    Reflect.deleteProperty(globalThis.navigator, 'clipboard');

    await expect(copyToClipboard('hello')).resolves.toBe(false);
  });
});
