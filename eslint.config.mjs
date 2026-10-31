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
      // 上游检出：各有自己的工具链（telegram-tt 用自带 eslint，tweb 用 oxlint），不套本仓库规则
      'telegram-tt',
      'tweb',
      // shadcn-vue 原始生成组件：只读，禁止修改与 lint（样式一律在外部改，
      // 见 docs/ui-shadcn-roadmap.md Phase 1）
      'renderer/shared/components/shadcn',
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
    // Phase 1 门禁：业务代码禁直接 import element-plus——反馈走 shared/feedback，
    // 组件走 Ui* / shadcn 包装（见 docs/ui-shadcn-roadmap.md）。
    // ui/ 内核与 feedback 自身豁免（它们是 EP 的唯一合法接触面，沿用上一块的规则）。
    files: [
      'renderer/**/*.{ts,vue}',
      'tools/*/renderer/**/*.{ts,vue}',
    ],
    ignores: [
      'renderer/shared/components/ui/**',
      'renderer/shared/feedback/**',
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
          {
            group: ['element-plus', 'element-plus/**'],
            message: '业务代码禁止直接引用 element-plus：反馈走 @renderer/shared/feedback，组件走 Ui* / shadcn 包装。',
          },
        ],
      }],
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
