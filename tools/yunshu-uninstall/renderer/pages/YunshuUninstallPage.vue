<script setup lang="ts">
import type { ResidueGroup, ResidueItem, ResidueStatus } from '@shared/yunshu-uninstall'
import { useCopy } from '@renderer/shared/composables/useClipboard'
import { confirm } from '@renderer/shared/feedback'
import { formatBytes, RESIDUE_GROUP_LABELS } from '@shared/yunshu-uninstall'
import { toast } from 'vue-sonner'
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import { cleanResidue, onCleanProgress, openKeychainAccess, openTrash, scanResidue } from '../ipc'

/** 清单里按组分段展示的组；manual / note 另作「手动处理」区 */
const LIST_GROUPS: ResidueGroup[] = ['service', 'process', 'file', 'certificate']

const scanning = ref(false)
const cleaning = ref(false)
const items = ref<ResidueItem[]>([])
const statuses = reactive<Record<string, ResidueStatus>>({})
const messages = reactive<Record<string, string>>({})
const selected = reactive(new Set<string>())
const showOnlyUnfinished = ref(false)
const scannedAt = ref('')
const blocked = ref<string[]>([])
const lastRun = ref<{ done: number, failed: number, escalated: boolean } | null>(null)
const scanError = ref('')
let unsubscribe: (() => void) | null = null

const busy = computed(() => scanning.value || cleaning.value)

const cleanable = computed(() => items.value.filter(item => item.removable))

function statusOf(item: ResidueItem): ResidueStatus {
  if (!item.exists) return 'absent'
  return statuses[item.id] ?? (item.removable ? 'pending' : 'kept')
}

function matchesView(item: ResidueItem): boolean {
  if (!showOnlyUnfinished.value) return true
  const status = statusOf(item)
  return status === 'pending' || status === 'failed'
}

function isPending(item: ResidueItem): boolean {
  return item.removable && statusOf(item) !== 'done'
}

/** 待处理：可清理且还没跑过的条目 */
const pendingItems = computed(() => cleanable.value.filter(item => isPending(item)))
const pendingCount = computed(() => pendingItems.value.filter(item => statusOf(item) !== 'failed').length)
const doneCount = computed(() => items.value.filter(item => statusOf(item) === 'done').length)
const failedCount = computed(() => items.value.filter(item => statusOf(item) === 'failed').length)
const adminCount = computed(() => cleanable.value
  .filter(item => item.needsAdmin && isPending(item))
  .length)

const selectedCount = computed(() => pendingItems.value.filter(item => selected.has(item.id)).length)
const selectedBytes = computed(() => items.value
  .filter(item => selected.has(item.id) && statusOf(item) !== 'done')
  .reduce((sum, item) => sum + item.sizeBytes, 0))
const totalBytes = computed(() => items.value.reduce((sum, item) => sum + item.sizeBytes, 0))
const existsCount = computed(() => items.value.filter(item => item.exists && item.group !== 'note' && item.group !== 'manual').length)
const absentCount = computed(() => items.value.filter(item => !item.exists).length)

/** 只有跑过一次之后，「待办 / 日志」才需要分开看 */
const canNarrow = computed(() => doneCount.value > 0 || failedCount.value > 0)
const unfinishedCount = computed(() => pendingCount.value + failedCount.value)

const manualItems = computed(() => items.value.filter(item => item.group === 'manual'))
const noteItems = computed(() => items.value.filter(item => item.group === 'note'))
/** 没有需要手动动手的项时，这一段就只是「无需处理」的说明 */
const tailTitle = computed(() => manualItems.value.length > 0 ? '需要手动处理' : '无需处理')
const tailMeta = computed(() => manualItems.value.length > 0
  ? `${manualItems.value.length} 项 · 工具不会替你动这些`
  : '工具不改系统文件')

interface GroupView {
  key: ResidueGroup
  label: string
  items: ResidueItem[]
  meta: string
  selectable: boolean
  allSelected: boolean
  someSelected: boolean
}

const visibleGroups = computed<GroupView[]>(() => {
  const groups: GroupView[] = []
  for (const group of LIST_GROUPS) {
    const all = items.value.filter(item => item.group === group)
    const shown = all.filter(matchesView)
    if (shown.length === 0) continue
    const sized = shown.reduce((sum, item) => sum + item.sizeBytes, 0)
    const presentHere = shown.filter(item => item.exists).length
    const absentHere = shown.length - presentHere
    const pendingHere = shown.filter(isPending)
    groups.push({
      key: group,
      label: RESIDUE_GROUP_LABELS[group],
      items: shown,
      meta: `${presentHere} 项存在${absentHere > 0 ? ` · ${absentHere} 项不在` : ''}${sized > 0 ? ` · ${formatBytes(sized)}` : ''}`,
      selectable: pendingHere.length > 0,
      allSelected: pendingHere.length > 0 && pendingHere.every(item => selected.has(item.id)),
      someSelected: pendingHere.some(item => selected.has(item.id)),
    })
  }
  return groups
})

const emptyTitle = computed(() => {
  if (scanError.value) return '扫描失败'
  if (showOnlyUnfinished.value) return '没有未完成的条目'
  return '没有检测到云枢残留'
})

const emptyText = computed(() => {
  if (scanError.value) return scanError.value
  if (showOnlyUnfinished.value) return '这次选中的条目都已经处理完了，关掉右上角的开关可以看完整记录。'
  return '应用、服务、进程与根证书都不在，系统是干净的。'
})

/** 状态落在 statusline 左端（点 + 文字），不进标题栏（DESIGN §5.3） */
const runState = computed<{ text: string, tone: 'primary' | 'success' | 'error' | 'neutral' }>(() => {
  if (scanning.value) return { text: '扫描中…', tone: 'primary' }
  if (cleaning.value) return { text: `清理中 ${doneCount.value} / ${doneCount.value + pendingCount.value + failedCount.value}`, tone: 'primary' }
  if (failedCount.value > 0) return { text: `${failedCount.value} 项未完成`, tone: 'error' }
  if (lastRun.value && pendingCount.value === 0) return { text: `已清理 ${lastRun.value.done} 项`, tone: 'success' }
  if (pendingCount.value > 0) return { text: `${pendingCount.value} 项待清理`, tone: 'primary' }
  return { text: '无残留', tone: 'neutral' }
})

const scannedLabel = computed(() => {
  if (!scannedAt.value) return '未扫描'
  const time = new Date(scannedAt.value)
  return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')} 扫描`
})

const primaryLabel = computed(() => {
  if (cleaning.value) return '清理中…'
  if (scanning.value) return '扫描中…'
  if (selectedCount.value === 0) return '没有选中条目'
  return `清理 ${selectedCount.value} 项 · ${formatBytes(selectedBytes.value)}`
})

function statusText(item: ResidueItem): string {
  const status = statusOf(item)
  if (status === 'absent') return '不存在'
  if (status === 'done') return '已清理'
  if (status === 'running') return messages[item.id] || '处理中…'
  if (status === 'failed') return messages[item.id] || '失败'
  if (status === 'kept') return '仅提示'
  return '待清理'
}

function toggleSelect(id: string): void {
  if (selected.has(id)) selected.delete(id)
  else selected.add(id)
}

function setGroupSelected(group: ResidueGroup, value: boolean): void {
  for (const item of items.value) {
    if (item.group !== group || !isPending(item)) continue
    if (value) selected.add(item.id)
    else selected.delete(item.id)
  }
}

function applyScan(result: Awaited<ReturnType<typeof scanResidue>>): void {
  items.value = result.items
  scannedAt.value = result.scannedAt
  blocked.value = result.blocked
  for (const key of Object.keys(statuses)) delete statuses[key]
  for (const key of Object.keys(messages)) delete messages[key]
  selected.clear()
  for (const item of result.items) {
    if (item.removable) selected.add(item.id)
  }
}

async function runScan(): Promise<void> {
  if (busy.value) return
  scanning.value = true
  scanError.value = ''
  try {
    applyScan(await scanResidue())
  } catch (error) {
    scanError.value = (error as Error).message
    items.value = []
    toast.error((error as Error).message)
  } finally {
    scanning.value = false
  }
}

async function requestClean(): Promise<void> {
  if (busy.value) return
  const ids = [...selected].filter(id => items.value.some(item => item.id === id && item.removable))
  if (ids.length === 0) {
    toast.info('先勾选要清理的条目')
    return
  }
  const needsAdmin = items.value.some(item => ids.includes(item.id) && item.needsAdmin)
  try {
    await confirm(
      `将把 ${ids.length} 项（${formatBytes(selectedBytes.value)}）移到系统废纸篓，可在 Finder 里拖回原处。${needsAdmin ? '其中包含系统目录项，会请求一次管理员授权。' : ''}`,
      '清理云枢残留',
      { type: 'warning', confirmButtonText: '移到废纸篓', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  await runClean(ids)
}

async function runClean(ids: string[]): Promise<void> {
  cleaning.value = true
  for (const id of ids) {
    statuses[id] = 'pending'
    delete messages[id]
  }
  const pathById = new Map(items.value.map(item => [item.id, item.path]))
  try {
    const result = await cleanResidue(ids)
    // 用重扫结果核对：报「已完成」但路径仍存在的，降级成失败，不粉饰
    const survivors = new Set(result.rescan.items.map(item => item.path))
    for (const key of Object.keys(statuses)) delete statuses[key]
    for (const key of Object.keys(messages)) delete messages[key]
    for (const entry of result.results) {
      const stillThere = survivors.has(pathById.get(entry.id) ?? '')
      if (entry.status === 'done' && stillThere) {
        statuses[entry.id] = 'failed'
        messages[entry.id] = '仍存在，需复查'
      } else {
        statuses[entry.id] = entry.status
        messages[entry.id] = entry.message
      }
    }
    const failed = Object.values(statuses).filter(status => status === 'failed').length
    const done = Object.values(statuses).filter(status => status === 'done').length
    lastRun.value = { done, failed, escalated: result.escalated }
    selected.clear()
    // 失败的条目保持勾选，方便直接重试；列表保留为「本次清理记录」，重新扫描才刷新
    for (const entry of result.results) {
      if (statuses[entry.id] === 'failed' && items.value.some(item => item.id === entry.id && item.removable)) {
        selected.add(entry.id)
      }
    }
    if (failed === 0) toast.success(`已清理 ${done} 项，全部进入废纸篓`)
    else toast.warning(`已清理 ${done} 项，${failed} 项未完成`)
    scannedAt.value = result.rescan.scannedAt
  } catch (error) {
    toast.error((error as Error).message)
  } finally {
    cleaning.value = false
  }
}

async function revealTrash(): Promise<void> {
  try {
    await openTrash()
  } catch (error) {
    toast.error((error as Error).message)
  }
}

async function launchKeychain(): Promise<void> {
  try {
    await openKeychainAccess()
  } catch (error) {
    toast.error((error as Error).message)
  }
}

async function copyFingerprint(value?: string): Promise<void> {
  if (!value) return
  await useCopy(value, 'SHA-256')
}

onMounted(() => {
  unsubscribe = onCleanProgress((progress) => {
    statuses[progress.id] = progress.status
    messages[progress.id] = progress.message
  })
  void runScan()
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
})
</script>

<template>
  <div class="yunshu-page tool-page">
    <ToolSurface class="cleanup-surface">
      <template #toolbar>
        <UiCheckbox v-if="canNarrow" v-model="showOnlyUnfinished" class="view-toggle" :disabled="busy">
          只看未完成{{ unfinishedCount > 0 ? `（${unfinishedCount}）` : '' }}
        </UiCheckbox>
        <span class="toolbar-spacer" />
        <span v-if="selectedCount > 0" class="toolbar-count">已选 {{ selectedCount }} / {{ pendingItems.length }}</span>
        <UiIconButton
          icon="external"
          :size="32"
          label="在废纸篓中显示"
          :disabled="busy"
          @click="revealTrash"
        />
        <UiButton :disabled="busy" @click="runScan">
          重新扫描
        </UiButton>
        <UiButton
          type="primary"
          :disabled="busy || selectedCount === 0"
          :loading="cleaning"
          @click="requestClean"
        >
          {{ primaryLabel }}
        </UiButton>
      </template>

      <div class="cleanup-body">
        <div v-if="scanning" class="skeleton">
          <div v-for="n in 6" :key="n" class="skeleton-row" />
        </div>

        <UiEmpty
          v-else-if="visibleGroups.length === 0 && manualItems.length === 0"
          center
          icon="trash"
          :title="emptyTitle"
        >
          {{ emptyText }}
          <template #actions>
            <UiButton size="small" :disabled="busy" @click="runScan">
              重新扫描
            </UiButton>
          </template>
        </UiEmpty>

        <template v-else>
          <section v-for="group in visibleGroups" :key="group.key" class="grp">
            <header class="grp-head">
              <span class="grp-name">{{ group.label }}</span>
              <span class="grp-meta">{{ group.meta }}</span>
              <span class="grp-spacer" />
              <UiCheckbox
                v-if="group.selectable"
                class="grp-all"
                :model-value="group.allSelected"
                :indeterminate="!group.allSelected && group.someSelected"
                :disabled="busy"
                @update:model-value="(value: boolean) => setGroupSelected(group.key, value)"
              >
                全选
              </UiCheckbox>
            </header>
            <ul class="rows">
              <li
                v-for="item in group.items"
                :key="item.id"
                class="row"
                :class="`is-${statusOf(item)}`"
              >
                <UiCheckbox
                  :model-value="selected.has(item.id)"
                  :disabled="busy || !item.removable || statusOf(item) === 'done'"
                  @update:model-value="toggleSelect(item.id)"
                />
                <span class="row-label mono" :title="item.path">{{ item.label }}</span>
                <span class="row-meta">{{ item.detail || item.kindLabel }}</span>
                <span class="row-size">{{ item.sizeBytes > 0 ? formatBytes(item.sizeBytes) : '' }}</span>
                <span class="row-status" :class="`is-${statusOf(item)}`">
                  <i class="status-dot" />
                  {{ statusText(item) }}
                </span>
              </li>
            </ul>
          </section>

          <section
            v-if="manualItems.length > 0 || noteItems.length > 0"
            class="grp is-manual"
            :class="{ 'is-warning': manualItems.length > 0 }"
          >
            <header class="grp-head">
              <span class="grp-name">{{ tailTitle }}</span>
              <span class="grp-meta">{{ tailMeta }}</span>
            </header>

            <article v-for="item in manualItems" :key="item.id" class="guide">
              <div class="guide-head">
                <strong>{{ item.label }}</strong>
                <span class="guide-where">{{ item.detail }}</span>
              </div>
              <p class="guide-reason">
                {{ item.guide?.reason }}
              </p>
              <ol class="guide-steps">
                <li v-for="(step, index) in item.guide?.steps ?? []" :key="index">
                  {{ step }}
                </li>
              </ol>
              <div v-if="item.guide?.fingerprint" class="guide-fp">
                <span class="guide-fp-label">SHA-256</span>
                <code class="guide-fp-value mono">{{ item.guide.fingerprint }}</code>
                <UiButton size="small" text @click="copyFingerprint(item.guide?.fingerprint)">
                  复制
                </UiButton>
              </div>
              <div class="guide-actions">
                <UiButton size="small" @click="launchKeychain">
                  打开钥匙串访问
                </UiButton>
              </div>
            </article>

            <article v-for="item in noteItems" :key="item.id" class="guide is-note">
              <div class="guide-head">
                <strong>{{ item.label }}</strong>
                <span class="guide-where">无需处理</span>
              </div>
              <p class="guide-reason">
                {{ item.detail }}
              </p>
            </article>
          </section>
        </template>
      </div>

      <template #statusline>
        <span class="run-state" :class="`is-${runState.tone}`">
          <i class="status-dot" />
          {{ runState.text }}
          <em>{{ scannedLabel }}</em>
        </span>
        <span class="statusline-spacer" />
        <span class="statusline-sum">
          可清理 {{ existsCount }} 项 · {{ formatBytes(totalBytes) }}<template v-if="absentCount > 0"> · {{ absentCount }} 项不存在</template><template v-if="adminCount > 0"> · {{ adminCount }} 项需授权</template><template v-if="blocked.length > 0"> · {{ blocked.length }} 条被拦下</template>
        </span>
      </template>
    </ToolSurface>
  </div>
</template>

<style scoped lang="scss">
.yunshu-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.cleanup-surface {
  flex: 1;
  min-height: 0;
}

.toolbar-spacer {
  flex: 1;
}

.view-toggle {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.toolbar-count {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
}

/* ---------- 主体：分组清单 ---------- */

.cleanup-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 10px var(--spacing-lg);
}

.grp + .grp {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border-light);
}

.grp-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  background: var(--color-fill);
}

.grp-name {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.grp-meta {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
}

.grp-spacer {
  flex: 1;
}

.grp-all {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.rows {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-height: 40px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  transition: background-color var(--duration-fast) var(--ease-out);

  &:hover {
    background: color-mix(in srgb, var(--color-on-solid) 36%, transparent);
  }

  &.is-done .row-label,
  &.is-absent .row-label {
    color: var(--color-text-tertiary);
  }

  &.is-absent:hover {
    background: transparent;
  }
}

.row-label {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-meta {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-size {
  flex: 0 0 84px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.row-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 104px;
  justify-content: flex-end;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);

  &.is-running {
    color: var(--color-primary-strong);

    .status-dot {
      background: var(--color-primary);
    }
  }

  &.is-done {
    color: var(--color-success);

    .status-dot {
      background: var(--color-success);
    }
  }

  &.is-failed {
    color: var(--color-error);

    .status-dot {
      background: var(--color-error);
    }
  }

  &.is-kept {
    color: var(--color-warning);

    .status-dot {
      background: var(--color-warning);
    }
  }

  &.is-absent {
    color: var(--color-text-tertiary);

    .status-dot {
      background: var(--color-border);
    }
  }
}

/* ---------- 手动处理 ---------- */

.is-manual.is-warning .grp-head {
  background: color-mix(in srgb, var(--color-warning) 8%, transparent);
}

.is-manual.is-warning .grp-name {
  color: var(--color-warning);
}

.is-manual:not(.is-warning) .grp-name {
  color: var(--color-text-tertiary);
}

.guide {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 10px 14px;

  & + .guide {
    border-top: 1px solid var(--color-border-light);
  }
}

.guide-head {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-sm);

  strong {
    color: var(--color-text-primary);
    font-size: var(--font-size-base);
    font-weight: 500;
  }
}

.guide-where {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.guide-reason {
  margin: 0;
  max-width: 76ch;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

.guide-steps {
  margin: 0;
  padding-left: 18px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.6;

  li::marker {
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
  }
}

.guide-fp {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--color-well);
}

.guide-fp-label {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.guide-fp-value {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.guide-actions {
  display: flex;
  gap: var(--spacing-sm);
}

/* ---------- 骨架 ---------- */

.skeleton {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--spacing-sm) 0;
}

.skeleton-row {
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--color-fill);
}

/* ---------- 状态点 / statusline ---------- */

.status-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
}

.statusline-spacer {
  flex: 1;
}

.statusline-sum {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;

  em {
    color: var(--color-text-tertiary);
    font-style: normal;
  }

  &.is-primary .status-dot {
    background: var(--color-primary);
  }

  &.is-success .status-dot {
    background: var(--color-success);
  }

  &.is-error .status-dot {
    background: var(--color-error);
  }

  &.is-neutral .status-dot {
    background: var(--color-text-tertiary);
  }
}
</style>
