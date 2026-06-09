import worker from './index';

describe('alfred worker', () => {
  it('returns 200 with expected body', async () => {
    const fetch = worker.fetch;
    if (!fetch) {
      throw new Error('worker.fetch is not defined');
    }

    const request = new Request('http://localhost/') as unknown as Parameters<typeof fetch>[0];
    const environment = {} as Parameters<typeof fetch>[1];
    const context = {} as ExecutionContext;

    const response = await fetch(request, environment, context);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('alfred workers ok');
  });
});
