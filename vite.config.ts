import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const buildTarget = process.env.TAURI_ENV_PLATFORM === 'windows'
  || (!process.env.TAURI_ENV_PLATFORM && process.platform === 'win32')
  ? 'chrome105'
  : 'safari15'

// Tauri 2 + Vite 约定：index.html 在项目根，前端源码在 src/，构建产物在 dist/。
export default defineConfig({
  base: './',
  clearScreen: false,
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
        path.join(__dirname, 'src/shared/components'),
        path.join(__dirname, 'tools/**/components'),
      ],
      resolvers: [ElementPlusResolver({ importStyle: 'css' })],
    }),
  ],
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
      '@tools': path.join(__dirname, 'tools'),
      '@shared': path.join(__dirname, 'shared'),
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    outDir: path.join(__dirname, 'dist'),
    emptyOutDir: true,
    target: buildTarget,
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // 以下目录在构建/运行时会被独占锁定，监视会刷 EBUSY：
      // - target/：Cargo 构建产物（.cargo/config.toml 的 target-dir，位于仓库根）
      // - data/：WebView2 的 Chromium profile
      // - src-tauri/：Rust 源码与旧构建目录
      ignored: ['**/target/**', '**/src-tauri/**', '**/data/**', '**/dist/**'],
    },
  },
})
