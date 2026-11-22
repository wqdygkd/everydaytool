import antfu from '@antfu/eslint-config'

export default antfu(
  {
    gitignore: false,
    stylistic: {
      indent: 2,
      quotes: 'single',
    },
    typescript: true,
    vue: true,
    ignores: [
      'node_modules',
      'dist',
      'dist-electron',
      'release',
      'data',
      '.impeccable',
      'docs',
      '**/*.md',
      '**/.tmp*/**',
      'auto-imports.d.ts',
      'components.d.ts',
      'browser-extension/.output',
      'browser-extension/.wxt',
      // 子模块各自维护构建产物：tweb 使用 oxlint。
      'tweb',
      'deploy/pikpak-get-nas/service.mjs',
    ],
  },
  {
    rules: {
      'antfu/if-newline': 'off',
      'style/brace-style': 'off',
    },
  },
  {
    // 样式块统一 SCSS：DESIGN.md 要求「样式只落在页面 scoped SCSS」，
    // 而纯 CSS 块用不了 @use / mixin，还会把 `&` 嵌套降级成运行时特性。
    // 浏览器插件 popup 不走 DESIGN 令牌，允许独立 CSS。
    files: ['**/*.vue'],
    ignores: ['browser-extension/**'],
    rules: {
      'vue/block-lang': ['error', { style: { lang: 'scss' } }],
    },
  },
  {
    // ESLint 10 对未使用导入的 JS 规则会误伤构建脚本里的环境引用。
    files: ['scripts/**/*.mjs', '*.mjs'],
    rules: {
      'unused-imports/no-unused-vars': 'off',
    },
  },
  {
    files: [
      'renderer/**/*.{ts,vue}',
      'tools/*/renderer/**/*.{ts,vue}',
      'tools/*/index.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/*.js'],
            message: '前端源码使用无后缀 TS 模块导入，Vue SFC 保留 .vue。',
          },
          {
            group: ['**/backend/**', '@tools/*/backend/**'],
            message: '前端不能直接调用后端模块，请通过 preload 暴露的 IPC API 调用。',
          },
        ],
      }],
    },
  },
  {
    files: [
      'electron/**/*.ts',
      'tools/*/backend/**/*.ts',
      'backend/**/*.ts',
      'shared/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/*.js', '**/*.jsx', '**/*.cjs', '**/*.mjs'],
            message: 'Node/Electron 源码统一使用 .ts 后缀导入；构建时由 esbuild 还原为 .js。',
          },
        ],
      }],
    },
  },
)
