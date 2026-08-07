import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` targets GitHub Pages at <user>.github.io/stable-gm/.
// Override with BASE_PATH=/ for root-hosted deploys.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH ?? '/stable-gm/',
  build: { outDir: 'dist', sourcemap: false },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
