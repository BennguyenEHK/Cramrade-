import { defineConfig } from 'vitest/config';

// One test run for the whole repo: the shared package and the pure server code.
export default defineConfig({
  test: {
    include: ['packages/shared/src/**/*.test.ts', 'supabase/functions/_shared/**/*.test.ts'],
    passWithNoTests: true,
  },
});
