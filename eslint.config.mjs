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
      // 'vue/no-mutating-props': ['error', {
      //   shallowOnly: true,
      // }],
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
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/*.ts', '**/*.tsx'],
            message: 'Electron/Node ESM 源码使用 .js 运行时后缀导入，不导入 .ts/.tsx。',
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
