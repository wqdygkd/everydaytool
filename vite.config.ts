import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.join(__dirname, 'renderer'),
  base: './',
  plugins: [
    vue(),
    AutoImport({
      dts: path.join(__dirname, 'auto-imports.d.ts'),
      imports: ['vue', 'vue-router', 'pinia'],
      resolvers: [ElementPlusResolver({ importStyle: 'css' })],
      vueTemplate: true,
    }),
    Components({
      dts: path.join(__dirname, 'components.d.ts'),
      dirs: [
        path.join(__dirname, 'renderer/shared/components'),
        path.join(__dirname, 'tools/**/renderer/components'),
      ],
      resolvers: [ElementPlusResolver({ importStyle: 'css' })],
    }),
  ],
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
})
