import { defineConfig } from 'vitest/config'
import path             from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals:     true,
    coverage: {
      provider:   'v8',
      reporter:   ['text', 'html', 'lcov'],
      include:    ['src/lib/**/*.ts'],
      exclude:    ['src/lib/supabase/**', 'src/lib/inngest/client.ts'],
      thresholds: {
        lines:      80,
        functions:  80,
        branches:   75,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
