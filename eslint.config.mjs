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
      'docs',
      '*.md',
      'auto-imports.d.ts',
      'components.d.ts',
    ],
  },
  {
    rules: {
      'antfu/if-newline': 'off',
      'style/brace-style': 'off',
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
            message: '前端不得直接导入后端模块，请通过 preload 暴露的 IPC API 调用。',
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
            message: 'Node/Electron 侧源码统一使用 .ts 后缀导入（构建期由 esbuild rewriteExtensions 还原为 .js）；.js 后缀会让编辑器无法跳转到 .ts 源且拿不到类型。',
          },
        ],
      }],
    },
  },
  {
    files: ['tools/chrome-sandbox/extension/**/*.js'],
    languageOptions: {
      globals: {
        chrome: 'readonly',
      },
    },
  },
)
