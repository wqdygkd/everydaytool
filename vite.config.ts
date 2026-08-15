import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(__dirname, 'renderer'),
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@renderer': path.join(__dirname, 'renderer'),
      '@tools': path.join(__dirname, 'tools'),
      '@shared': path.join(__dirname, 'shared'),
    },
  },
  build: {
    outDir: path.join(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});