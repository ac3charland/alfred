import type { Preview } from '@storybook/nextjs';
import React from 'react';

import '../app/globals.css';

const preview: Preview = {
  decorators: [
    (Story) =>
      React.createElement(
        'div',
        { className: 'dark min-h-screen bg-background text-foreground p-8' },
        React.createElement(Story),
      ),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /date$/i,
      },
    },
    nextjs: {
      appDirectory: true,
    },
  },
};

export default preview;
