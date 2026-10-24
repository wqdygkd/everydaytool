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
      'release',
      'data',
      // Cargo 构建产物（.cargo/config.toml 的 target-dir 在仓库根）
      'target',
      '.target',
      'docs',
      '*.md',
      'auto-imports.d.ts',
      'components.d.ts',
      // Rust 侧由 cargo fmt / clippy 负责；assets 下的注入脚本刻意保持 ES5 风格
      'src-tauri/**',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
    ],
  },
  {
    rules: {
      'antfu/if-newline': 'off',
      'style/brace-style': 'off',
    },
  },
  {
    // ESLint 10 下 unused-imports 对纯 JS 文件误报（把使用中的变量判为仅类型引用），
    // 仅对扩展 / 构建脚本这类纯 JS 关闭该规则，其余文件保持检查
    files: ['tools/**/extension/**/*.js', 'scripts/**/*.mjs', '*.mjs'],
    rules: {
      'unused-imports/no-unused-vars': 'off',
    },
  },
  {
    files: [
      'src/**/*.{ts,vue}',
      'tools/*/{pages,components,stores,composables,shared}/**/*.{ts,vue}',
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
            group: ['**/server/**', '@tools/*/server/**'],
            message: '前端不得直接导入后端模块，请通过桌面适配层暴露的 Tauri command API 调用。',
          },
        ],
      }],
    },
  },
  {
    files: [
      'shared/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/*.js', '**/*.jsx', '**/*.cjs', '**/*.mjs'],
            message: 'Node/后端侧源码统一使用 .ts 后缀导入（构建期由 esbuild rewriteExtensions 还原为 .js）；.js 后缀会让编辑器无法跳转到 .ts 源且拿不到类型。',
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
  {
    files: ['tools/interceptor/extension/**/*.js'],
    languageOptions: {
      globals: {
        chrome: 'readonly',
        crypto: 'readonly',
        WebSocket: 'readonly',
      },
    },
  },
)
