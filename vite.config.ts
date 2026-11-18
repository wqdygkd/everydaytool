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
    vue({
      template: {
        compilerOptions: {
          isCustomElement: tag => tag === 'video-player' || tag === 'video-skin' || tag.startsWith('media-'),
        },
      },
    }),
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
      // lucide 官方已把 lucide-vue-next 更名为 @lucide/vue；保留别名兼容旧引用。
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
  optimizeDeps: {
    /**
     * Vite 8.3.5 冷启动时，模块里给出的 `deps/*.js?v=<hash>` 与磁盘上 `_metadata.json`
     * 记录的 browserHash 可能不一致（优化器在 crawl 结束后又跑了一轮，但 metadata 没跟上），
     * 于是每条依赖请求都被判成 `Outdated Optimize Dep` → 504 → main.ts 模块图整体失败 →
     * 窗口白屏且不报错。预构建产物本身可用，这里关掉「哈希对不上就拒绝」的判定。
     * 仅影响 dev server，不改变构建产物；改了依赖后 `rm -rf node_modules/.vite` 可强制重建。
     */
    ignoreOutdatedRequests: true,
  },
})
