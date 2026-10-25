import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 纯函数冒烟：shared 契约层与工具内的路由映射。不渲染组件、不依赖桌面桥接，
// 与 cargo test 一起构成「改动验证」的最低门槛（见 CONTRIBUTING.md）。
export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
      '@tools': path.join(__dirname, 'tools'),
      '@shared': path.join(__dirname, 'shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['shared/**/*.test.ts', 'tools/**/*.test.ts', 'src/**/*.test.ts'],
  },
})
