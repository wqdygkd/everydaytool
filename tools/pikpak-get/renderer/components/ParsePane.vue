<script setup lang="ts">
import type { IconName } from '@renderer/shared/components/ui/icons'
import type { PikpakGetNode, PikpakGetNodeSortKey } from '../../../../shared/pikpak-get'
import { useCopy } from '@renderer/shared/composables/useClipboard'
import { toast } from 'vue-sonner'
import { groupPikpakNodes, humanPikpakBytes } from '../../../../shared/pikpak-get'
import { usePikpakGetStore } from '../stores/pikpakGetStore'

const props = defineProps<{
  /** 右侧任务面板是否已展开（决定按钮语义是「打开」还是「收起」） */
  tasksOpen?: boolean
}>()

const emit = defineEmits<{
  downloadStarted: []
  openTasks: []
}>()

const store = usePikpakGetStore()

const SORT_OPTIONS: Array<{ label: string, value: PikpakGetNodeSortKey }> = [
  { label: '解析顺序', value: 'default' },
  { label: '文件名', value: 'name' },
  { label: '文件大小', value: 'size' },
  { label: '后缀', value: 'ext' },
]

// 排序状态在 store：它是「下载排队顺序」的唯一来源，工具条与顶栏按钮共用
function onSortChange(value: string): void {
  store.setSortKey(value as PikpakGetNodeSortKey)
}

const parseResult = computed(() => store.parse)
const selectedCount = computed(() => store.selectedCount)
const selectedFileIds = computed(() => store.selectedFileIds)
const selectedBytes = computed(() => store.selectedBytes)
const files = computed(() => store.fileNodes)
const activeTaskCount = computed(() => store.activeTasks.length)
const allSelected = computed(() => files.value.length > 0 && files.value.every(node => store.selectedFileIds.includes(node.id)))

const allNodes = computed(() => parseResult.value?.nodes ?? [])
const childrenByParent = computed(() => groupPikpakNodes(allNodes.value, store.sortKey, store.sortDesc))
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

/** 勾选的文件中「已下载」的 id，同样按展示顺序排队 */
const selectedDownloadedIds = computed(() => {
  // selectedDownloadOrder 本身就是「已勾选」的子集，这里只需再筛「已下载」
  const downloaded = new Set(files.value.filter(node => node.downloaded).map(node => node.id))
  return store.selectedDownloadOrder.filter(id => downloaded.has(id))
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

/** 低频动作收进「更多」，工具条只留排序、全选与两个下载入口 */
const moreItems = computed<Array<{ command: string, label: string, icon: IconName }>>(() => {
  const items: Array<{ command: string, label: string, icon: IconName }> = [
    { command: 'reparse', label: '重新解析', icon: 'refresh' },
  ]
  if (selectedDownloadedIds.value.length) {
    items.push({ command: 'deleteRecords', label: `删除记录（${selectedDownloadedIds.value.length}）`, icon: 'trash' })
    items.push({ command: 'redownload', label: `重新下载（${selectedDownloadedIds.value.length}）`, icon: 'download' })
  }
  return items
})

function onMoreCommand(command: string): void {
  if (command === 'reparse') void reparse()
  else if (command === 'deleteRecords') void deleteRecords()
  else if (command === 'redownload') void redownload()
}

async function downloadSelected(): Promise<void> {
  try {
    const task = await store.downloadSelected()
    if (!task) {
      toast.warning('请先勾选要下载的文件')
      return
    }
    toast.success('下载任务已提交到引擎')
    emit('downloadStarted')
  } catch (error) {
    toast.error((error as Error).message || '提交任务失败')
  }
}
</script>

<template>
  <div class="parse-pane">
    <div class="parse-head">
      <div class="parse-title">
        <template v-if="parseResult">
          <span class="title-text">{{ parseResult.title || '分享内容' }}</span>
          <span class="title-meta">{{ files.length }} 个文件</span>
          <span v-if="parseResult.parsedAt" class="title-meta">· 解析于 {{ formatTime(parseResult.parsedAt) }}</span>
          <span v-if="selectedCount" class="title-meta selected">· 已选 {{ selectedCount }} · {{ humanPikpakBytes(selectedBytes) }}</span>
        </template>
        <span v-else class="title-text">未选择分享链接</span>
      </div>

      <div class="parse-actions">
        <template v-if="parseResult">
          <span class="sort-field">
            <UiSelect
              :model-value="store.sortKey"
              :options="SORT_OPTIONS"
              size="small"
              @update:model-value="onSortChange"
            />
          </span>
          <UiButton
            size="small"
            :disabled="store.sortKey === 'default'"
            :title="store.sortDesc ? '当前降序，点击切换为升序' : '当前升序，点击切换为降序'"
            @click="store.toggleSortDesc()"
          >
            {{ store.sortDesc ? '降序' : '升序' }}
          </UiButton>
          <UiButton size="small" @click="toggleAll">
            {{ allSelected ? '清空' : '全选' }}
          </UiButton>
        </template>

        <UiDropdown v-if="parseResult" :items="moreItems" @command="onMoreCommand">
          <template #trigger>
            <UiIconButton icon="more" :size="28" label="更多操作" />
          </template>
        </UiDropdown>

        <UiButton
          size="small"
          :title="props.tasksOpen ? '收起右侧下载任务面板' : '展开右侧下载任务面板'"
          @click="emit('openTasks')"
        >
          下载任务{{ activeTaskCount ? `（${activeTaskCount}）` : '' }}
        </UiButton>
        <UiButton type="primary" size="small" :disabled="!selectedCount" @click="downloadSelected">
          下载选中{{ selectedCount ? `（${selectedCount}）` : '' }}
        </UiButton>
      </div>
    </div>

    <div v-if="!parseResult" class="parse-empty">
      <UiEmpty
        title="选择分享链接"
        text="在左侧「分享链接」里点选一条，解析出的文件会显示在这里，勾选后即可下载。"
        center
      />
    </div>

    <div v-else class="file-tree">
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
