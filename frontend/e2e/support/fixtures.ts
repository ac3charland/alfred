/**
 * Test fixtures for the integration suite.
 *
 * `seed` resets the mock Supabase backend and loads the rows a test needs, BEFORE
 * the page is navigated. Because the backend is in-memory and the suite runs with
 * workers: 1, a per-test reset gives each test a clean, deterministic database.
 *
 * Import `test` and `expect` from here instead of '@playwright/test'.
 */
import { test as base, expect } from '@playwright/test';

import { MOCK_URL, type SeedState, resetSeedClock } from './constants';

interface Fixtures {
  /** Replace the mock's entire database with the given rows. Call before page.goto(). */
  seed: (state: SeedState) => Promise<void>;
}

// The fixture's "use" callback is named `provide` so the react-hooks lint rule
// doesn't mistake `use(...)` for the React `use` hook.
export const test = base.extend<Fixtures>({
  seed: async ({ request }, provide) => {
    // Clean slate before the test runs, even if the test never calls seed().
    await request.post(`${MOCK_URL}/__mock__/reset`);
    resetSeedClock();

    await provide(async (state: SeedState) => {
      const response = await request.post(`${MOCK_URL}/__mock__/seed`, {
        data: {
          folders: state.folders ?? [],
          items: state.items ?? [],
          projects: state.projects ?? [],
          epics: state.epics ?? [],
          codeItems: state.codeItems ?? [],
        },
      });
      expect(response.ok()).toBeTruthy();
    });
  },
});

export { expect } from '@playwright/test';
