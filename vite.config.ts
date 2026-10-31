import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.join(__dirname, 'renderer'),
  base: './',
  plugins: [
    vue(),
    tailwindcss(),
    AutoImport({
      dts: path.join(__dirname, 'auto-imports.d.ts'),
      imports: ['vue', 'vue-router', 'pinia'],
      vueTemplate: true,
    }),
    Components({
      dts: path.join(__dirname, 'components.d.ts'),
      dirs: [
        path.join(__dirname, 'renderer/shared/components'),
        path.join(__dirname, 'tools/**/renderer/components'),
      ],
    }),
  ],
  resolve: {
    alias: {
      '@renderer': path.join(__dirname, 'renderer'),
      '@tools': path.join(__dirname, 'tools'),
      '@shared': path.join(__dirname, 'shared'),
      // lucide 官方已把 lucide-vue-next 更名为 @lucide/vue;shadcn 注册表模板仍写旧名,
      // 用别名承接,生成组件保持只读不修改
      'lucide-vue-next': '@lucide/vue',
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
