<script setup lang="ts">
import type { PikpakGetNode, PikpakGetNodeSortKey } from '../../../../shared/pikpak-get'
import { useCopy } from '@renderer/shared/composables/useClipboard'
import { toast } from 'vue-sonner'
import { humanPikpakBytes, sortPikpakNodes } from '../../../../shared/pikpak-get'
import { usePikpakGetStore } from '../stores/pikpakGetStore'

const emit = defineEmits<{
  downloadStarted: []
}>()

const store = usePikpakGetStore()

const SORT_OPTIONS: Array<{ label: string, value: PikpakGetNodeSortKey }> = [
  { label: '解析顺序', value: 'default' },
  { label: '文件名', value: 'name' },
  { label: '文件大小', value: 'size' },
  { label: '后缀', value: 'ext' },
]

const sortKey = ref<PikpakGetNodeSortKey>('default')
/** 大小默认「大到小」，名 / 后缀默认升序 */
const sortDesc = ref(false)

function onSortChange(value: string): void {
  sortKey.value = value as PikpakGetNodeSortKey
  sortDesc.value = sortKey.value === 'size'
}

const parseResult = computed(() => store.parse)
const selectedCount = computed(() => store.selectedCount)
const selectedFileIds = computed(() => store.selectedFileIds)
const selectedBytes = computed(() => store.selectedBytes)
const parsing = computed(() => Boolean(store.parsingLinkId))
const files = computed(() => store.fileNodes)
const allSelected = computed(() => files.value.length > 0 && files.value.every(node => store.selectedFileIds.includes(node.id)))

const allNodes = computed(() => parseResult.value?.nodes ?? [])
const childrenByParent = computed(() => {
  const map = new Map<string, PikpakGetNode[]>()
  for (const node of allNodes.value) {
    const parent = node.parentId ?? ''
    const list = map.get(parent) ?? []
    list.push(node)
    map.set(parent, list)
  }
  // 排序只作用于同一层（父子层级不变），文件夹恒在文件之前
  for (const [parent, list] of map) map.set(parent, sortPikpakNodes(list, sortKey.value, sortDesc.value))
  return map
})
const collapsedFolders = ref<Set<string>>(new Set())
const visibleNodes = computed(() => {
  const result: Array<{ node: PikpakGetNode, depth: number }> = []
  const visit = (parentId: string, depth: number): void => {
    for (const node of childrenByParent.value.get(parentId) ?? []) {
      result.push({ node, depth })
      if (node.isFolder && !collapsedFolders.value.has(node.id)) visit(node.id, depth + 1)
    }
  }
  visit('', 0)
  return result
})

function toggle(nodeId: string): void {
  store.toggleFile(nodeId)
}

/** 行内复制：只复制名字本身（不含目录），提示走统一 toast */
async function copyName(node: PikpakGetNode): Promise<void> {
  await useCopy(node.name, node.isFolder ? '文件夹名' : '文件名')
}

function toggleFolder(id: string): void {
  const next = new Set(collapsedFolders.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsedFolders.value = next
}

function filesUnderFolder(folderId: string): string[] {
  const result: string[] = []
  const visit = (id: string): void => {
    for (const child of childrenByParent.value.get(id) ?? []) {
      if (child.isFolder) visit(child.id)
      else result.push(child.id)
    }
  }
  visit(folderId)
  return result
}

function folderSelected(folderId: string): boolean {
  const ids = filesUnderFolder(folderId)
  return ids.length > 0 && ids.every(id => selectedFileIds.value.includes(id))
}

function toggleFolderFiles(folderId: string): void {
  store.toggleFiles(filesUnderFolder(folderId))
}

function toggleAll(): void {
  if (allSelected.value) store.clearSelection()
  else store.selectAllFiles()
}

async function reparse(): Promise<void> {
  const current = parseResult.value
  if (!current) return
  try {
    await store.parseLink(current.linkId, true)
    toast.success('已重新解析')
  } catch (error) {
    toast.error((error as Error).message || '重新解析失败')
  }
}

/** 勾选的文件中「已下载」的 id */
const selectedDownloadedIds = computed(() => {
  return files.value.filter(node => node.downloaded && selectedFileIds.value.includes(node.id)).map(node => node.id)
})

async function deleteRecords(): Promise<void> {
  const current = parseResult.value
  if (!current || !selectedDownloadedIds.value.length) {
    toast.warning('请勾选「已下载」的文件或文件夹')
    return
  }
  try {
    const count = await store.resetRecords(current.linkId, selectedDownloadedIds.value)
    toast.success(`已删除 ${count} 条下载记录`)
    await store.parseLink(current.linkId, true)
  } catch (error) {
    toast.error((error as Error).message || '删除记录失败')
  }
}

async function redownload(): Promise<void> {
  const current = parseResult.value
  if (!current || !selectedDownloadedIds.value.length) {
    toast.warning('请勾选「已下载」的文件或文件夹')
    return
  }
  try {
    await store.resetRecords(current.linkId, selectedDownloadedIds.value)
    await store.startDownload({ linkId: current.linkId, fileIds: selectedDownloadedIds.value })
    toast.success('已重新提交下载')
    emit('downloadStarted')
  } catch (error) {
    toast.error((error as Error).message || '重新下载失败')
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}
</script>

<template>
  <div class="parse-pane">
    <div v-if="!parseResult" class="parse-empty">
      <UiEmpty
        title="选择分享链接"
        text="在左侧「分享链接」里点选一条，解析出的文件会显示在这里，勾选后即可下载。"
        center
      />
    </div>

    <template v-else>
      <div class="parse-head">
        <div class="parse-title">
          <span class="title-text">{{ parseResult.title || '分享内容' }}</span>
          <span class="title-meta">{{ files.length }} 个文件</span>
          <span v-if="parseResult.parsedAt" class="title-meta">· 解析于 {{ formatTime(parseResult.parsedAt) }}</span>
          <span v-if="selectedCount" class="title-meta selected">· 已选 {{ selectedCount }} · {{ humanPikpakBytes(selectedBytes) }}</span>
        </div>
        <div class="parse-actions">
          <span class="sort-field">
            <UiSelect
              :model-value="sortKey"
              :options="SORT_OPTIONS"
              size="small"
              @update:model-value="onSortChange"
            />
          </span>
          <UiButton
            size="small"
            :disabled="sortKey === 'default'"
            :title="sortDesc ? '当前降序，点击切换为升序' : '当前升序，点击切换为降序'"
            @click="sortDesc = !sortDesc"
          >
            {{ sortDesc ? '降序' : '升序' }}
          </UiButton>
          <UiButton size="small" :disabled="parsing" @click="reparse">
            重新解析
          </UiButton>
          <UiButton size="small" @click="toggleAll">
            {{ allSelected ? '清空' : '全选' }}
          </UiButton>
          <UiButton v-if="selectedDownloadedIds.length" size="small" @click="deleteRecords">
            删除记录（{{ selectedDownloadedIds.length }}）
          </UiButton>
          <UiButton v-if="selectedDownloadedIds.length" size="small" type="primary" @click="redownload">
            重新下载（{{ selectedDownloadedIds.length }}）
          </UiButton>
        </div>
      </div>

      <div class="file-tree">
        <template v-for="{ node, depth } in visibleNodes" :key="node.id">
          <div
            v-if="node.isFolder"
            class="folder-row"
            :style="{ paddingLeft: `${depth * 16 + 12}px` }"
          >
            <UiCheckbox
              :model-value="folderSelected(node.id)"
              @update:model-value="toggleFolderFiles(node.id)"
            />
            <span class="folder-caret" @click="toggleFolder(node.id)">{{ collapsedFolders.has(node.id) ? '▸' : '▾' }}</span>
            <span class="folder-name mono" @click="toggleFolder(node.id)">{{ node.name }}</span>
            <span class="file-size mono">{{ humanPikpakBytes(node.size) }}</span>
            <UiIconButton class="row-copy" icon="copy" :size="22" label="复制文件夹名" @click.stop="copyName(node)" />
          </div>
          <div v-else class="file-row" :style="{ paddingLeft: `${depth * 16 + 12}px` }">
            <div class="file-hit" @click="toggle(node.id)">
              <span class="hit-check" @click.stop>
                <UiCheckbox
                  :model-value="selectedFileIds.includes(node.id)"
                  @update:model-value="toggle(node.id)"
                />
              </span>
              <span class="file-path mono">{{ node.name }}</span>
              <span
                v-if="node.downloaded"
                class="downloaded-mark"
                :class="{ 'is-missing': !node.exists }"
                :aria-label="node.exists ? '已下载' : '已下载但文件缺失'"
                :title="node.exists ? '已下载' : '已下载但文件缺失（可删除记录重新下载）'"
              >
                {{ node.exists ? '✓' : '!' }}
              </span>
              <span class="file-size mono">{{ humanPikpakBytes(node.size) }}</span>
            </div>
            <UiIconButton class="row-copy" icon="copy" :size="22" label="复制文件名" @click.stop="copyName(node)" />
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.parse-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.parse-empty {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xl);
}

.parse-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  flex: 0 0 48px;
  height: 48px;
  padding: 0 14px;
  border-bottom: 1px solid var(--color-border-light);
}

.parse-title {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-sm);
  min-width: 0;
}

.title-text {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-meta {
  flex: none;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.title-meta.selected {
  color: var(--color-primary-strong);
}

.parse-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--spacing-sm);
}

/* UiSelect 设了 inheritAttrs:false，宽度由本组件的包裹元素定（scoped 才稳） */
.sort-field {
  display: inline-flex;
  flex: none;
  width: 104px;
}

.file-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--spacing-sm) 0;
}

.folder-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding-right: 8px;
  padding-top: var(--spacing-xs);
  padding-bottom: var(--spacing-xs);
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;

  &:hover {
    background: color-mix(in srgb, var(--color-primary) 7%, transparent);
  }
}

.folder-caret {
  flex: none;
  width: 12px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.folder-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.file-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding-right: 8px;
  padding-top: var(--spacing-xs);
  padding-bottom: var(--spacing-xs);
  border-radius: var(--radius-sm);

  &:hover {
    background: color-mix(in srgb, var(--color-primary) 7%, transparent);
  }
}

/* 勾选 / 文件名 / 标记 / 大小都在 .file-hit 里：点空白处切换选中，复选框自己处理点击 */
.file-hit {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
  cursor: pointer;
  user-select: none;
}

.hit-check {
  display: inline-flex;
  flex: none;
}

/* 行内复制：悬停 / 键盘聚焦才显现，避免每行常驻一枚按钮抢视线 */
.row-copy {
  flex: none;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.file-row:hover .row-copy,
.file-row:focus-within .row-copy,
.folder-row:hover .row-copy,
.folder-row:focus-within .row-copy {
  opacity: 1;
}

.file-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.downloaded-mark {
  flex: none;
  color: var(--color-success);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);

  &.is-missing {
    color: var(--color-warning);
  }
}

.file-size {
  flex: none;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}
</style>
