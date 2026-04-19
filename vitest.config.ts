import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
  resolve: {
    alias: {
      // VS Code API is not available in unit tests; stub it
      vscode: new URL('./test/__mocks__/vscode.ts', import.meta.url).pathname,
    },
  },
});
