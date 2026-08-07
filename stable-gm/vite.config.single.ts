import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Inlines all JS/CSS into one self-contained index.html. Used for the
// shareable preview build (no external requests, opens from anywhere).
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: {
    outDir: 'dist-single',
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
  },
});
