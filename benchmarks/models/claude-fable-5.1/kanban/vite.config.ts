import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ command }) => ({
  // `npm run build` inlines JS + CSS into one self-contained dist/index.html.
  // The plugin is only needed (and only loaded) for the production build.
  plugins: command === 'build' ? [viteSingleFile()] : [],
  // `npm run start` serves the app on http://localhost:8081
  server: {
    port: 7081,
    strictPort: true,
  },
  preview: {
    port: 8081,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
}));
