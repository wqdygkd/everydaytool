import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const toolId = process.argv[2]

if (!toolId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(toolId)) {
  throw new Error('Usage: pnpm run create:tool <kebab-case-tool-id>')
}

const rootDir = path.resolve(import.meta.dirname, '..')
const toolDir = path.join(rootDir, 'tools', toolId)
const pageName = `${toolId
  .split('-')
  .map(part => part[0].toUpperCase() + part.slice(1))
  .join('')}Page`

await mkdir(path.join(toolDir, 'renderer/pages'), { recursive: true })

await writeFile(
  path.join(toolDir, 'index.ts'),
  `import { defineTool } from '../../renderer/shared/tool/defineTool';
import ${pageName} from './renderer/pages/${pageName}.vue';

const tool = defineTool({
  id: '${toolId}',
  name: '${toolId}',
  description: '',
  version: '1.0.0',
  color: '#3b82f6',
  category: { key: 'general', name: '通用工具' },
  keywords: ['${toolId}'],
  supportedTargets: ['web', 'win', 'mac'],
  createdAt: '${new Date().toISOString().slice(0, 10)}',
  route: {
    path: '${toolId}',
    name: 'tool-${toolId}',
    component: ${pageName},
    meta: { toolId: '${toolId}', title: '${toolId}' },
  },
});

export default tool;
`,
  { flag: 'wx' },
)

await writeFile(
  path.join(toolDir, 'renderer/pages', `${pageName}.vue`),
  `<template>
  <div class="tool-page">
    ${toolId}
  </div>
</template>

<script setup lang="ts">
</script>

<style scoped>
.tool-page {
  padding: var(--spacing-xl);
}
</style>
`,
  { flag: 'wx' },
)

console.log(`Created tools/${toolId}`)
console.log(`Register it in renderer/config/tools.ts when ready.`)
