import path from 'node:path';

import type { StorybookConfig } from '@storybook/nextjs';

const config: StorybookConfig = {
  stories: ['../components/**/*.stories.@(ts|tsx)', '../app/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/nextjs',
    options: {},
  },
  staticDirs: ['../public'],
  webpackFinal(webpackConfig) {
    // Stories that mount `CodeProvider` open a `code_items` Realtime channel via the browser
    // Supabase client, which needs env vars + a live backend Storybook doesn't have. Alias the
    // bare `@supabase/ssr` package to a no-op stub — a node_modules specifier the Next path
    // plugin leaves alone, so the alias reliably wins (an `@/…` alias does not).
    const mockPath = path.resolve(process.cwd(), '.storybook/supabase-ssr-mock.ts');
    webpackConfig.resolve ??= {};
    const { alias } = webpackConfig.resolve;
    if (Array.isArray(alias)) {
      alias.unshift({ name: '@supabase/ssr', alias: mockPath, exact: true });
    } else {
      webpackConfig.resolve.alias = { ...alias, '@supabase/ssr$': mockPath };
    }
    return webpackConfig;
  },
};

export default config;
