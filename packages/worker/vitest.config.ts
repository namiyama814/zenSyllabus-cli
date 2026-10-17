import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          GITHUB_CLIENT_ID: 'test-client',
          GITHUB_CLIENT_SECRET: 'test-secret',
          ALLOWED_GITHUB_USER_ID: '12345',
          PUBLIC_ORIGIN: 'https://zen.test',
        },
      },
    }),
  ],
  test: { include: ['test/**/*.test.ts'], testTimeout: 15000 },
});
