import { defineConfig } from 'vitest/config';

// Run from the project root:
//   npx vitest run --config .solutions/vitest.config.ts
export default defineConfig({
  test: {
    include: ['.solutions/tests/**/*.test.ts'],
    environment: 'node',
  },
});
