/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { ImageResponse } from 'next/og';
import { type NextRequest } from 'next/server';

import { GET } from './route';

// Rendering a real PNG pulls in Satori/resvg wasm; we only need to assert what
// the route hands to ImageResponse, so stub it with a plain 200 Response.
jest.mock('next/og', () => ({
  ImageResponse: jest.fn(() => new Response('png', { status: 200 })),
}));

const mockImageResponse = jest.mocked(ImageResponse);

function request(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

// Minimal shape of the JSX ImageResponse receives, for prop assertions.
interface Node {
  props: { style: Record<string, unknown>; children: Node | string };
}

describe('GET /splash', () => {
  it('rejects an invalid size with 400 and never renders an image', () => {
    const response = GET(request('http://localhost/splash?w=0&h=abc'));

    expect(response.status).toBe(400);
    expect(mockImageResponse).not.toHaveBeenCalled();
  });

  it('renders a centered "a" on the navy background at the requested size', () => {
    const response = GET(request('http://localhost/splash?w=1170&h=2532'));

    expect(response.status).toBe(200);
    expect(mockImageResponse).toHaveBeenCalledTimes(1);

    const call = mockImageResponse.mock.calls[0];
    if (!call) throw new Error('ImageResponse was not called');
    const [element, options] = call;
    expect(options).toMatchObject({ width: 1170, height: 2532 });

    const root = element as unknown as Node;
    expect(root.props.style).toMatchObject({
      background: '#1E2A3F',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });

    const glyph = root.props.children as Node;
    expect(glyph.props.children).toBe('a');
    expect(glyph.props.style).toMatchObject({ color: 'white', fontSize: 351 });
  });
});
