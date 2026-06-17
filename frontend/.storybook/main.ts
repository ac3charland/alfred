import type { StorybookConfig } from '@storybook/nextjs';

const config: StorybookConfig = {
  stories: ['../components/**/*.stories.@(ts|tsx)', '../app/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/nextjs',
    options: {},
  },
  staticDirs: ['../public'],
  // Stories render client components in isolation, including CodeProvider, which
  // instantiates the Supabase browser client (it needs a URL + key or it throws). Inject
  // stub public env so the client constructs; the realtime websocket never connects in a
  // story. Mirrors the mock env the Playwright config injects — never real credentials.
  env: (existing) => ({
    ...existing,
    NEXT_PUBLIC_SUPABASE_URL:
      existing.NEXT_PUBLIC_SUPABASE_URL ?? 'https://storybook.supabase.invalid',
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      existing.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_storybook',
  }),
};

export default config;
