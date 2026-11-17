import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'wxt'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(rootDir, '..')

/**
 * everydaytool 平台浏览器插件（WXT）。
 * - 产物目录默认 `.output/chrome-mv3`，由 EDT 准备/load / electron-builder 打包。
 * - 不自动拉起浏览器：用户自开 Chrome，解包加载产物目录。
 * - manifest.key 固定，保证扩展 ID 与历史 interceptor 扩展一致。
 */
export default defineConfig({
  // 从仓库根执行 `wxt -c browser-extension/wxt.config.ts` 时必须显式指定
  root: rootDir,
  modules: ['@wxt-dev/module-vue'],
  srcDir: rootDir,
  outDir: path.join(rootDir, '.output'),
  // 开发态不自动开浏览器（与「用户自开 + 不碰系统代理」一致）
  webExt: {
    disabled: true,
  },
  alias: {
    '@shared': path.join(repoRoot, 'shared'),
    '@ext': path.join(rootDir, 'lib'),
  },
  vite: () => ({
    resolve: {
      alias: {
        '@shared': path.join(repoRoot, 'shared'),
        '@ext': path.join(rootDir, 'lib'),
      },
    },
  }),
  manifest: {
    name: 'everydaytool',
    description: 'everydaytool（edt）浏览器插件：连接桌面端，承载拦截器等工具能力。',
    version: '2.0.0',
    minimum_chrome_version: '120',
    // 与历史解包扩展同一公钥 → 同一扩展 ID（迁移兼容，禁止更换）
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvz5NkoroLG/XlehZs3O74LLgrkl4nWWEoz2jNZb3QhM2oi+qBABCq29t/yGhUjZZ9RQWieeWBnKwJfJiXdXu7APStmMhZlmeiF5wiZmSUpLaT1qtZS9Os6qvzZ8WkcVfAvtdu5Vu4IEyM2EKeFVG5b1qE03fb24+mxi3bDXuzWau+JEHROWrdKvd6z8O3tN7rGpfthe3qgsnmfO7KkgI/uARbQ+7TeMZIKTjBX76DEHzXyjk/MfQo0uKSPFMKmg6GXxNKAdE+L1NeU4AMqsIzo/ofbKIkKv7u+2abpe4xx+cEfkzHoIoA7Zgz7UTmCrAXt/vgRQU0/jdGsIpF8K3UwIDAQAB',
    permissions: ['proxy', 'storage', 'tabs', 'scripting', 'alarms', 'userScripts'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'everydaytool',
    },
  },
})
