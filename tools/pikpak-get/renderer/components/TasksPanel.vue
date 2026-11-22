<script setup lang="ts">
import type { PikpakGetTask } from '../../../../shared/pikpak-get'
import { toast } from 'vue-sonner'
import ToolSideInspector from '../../../../renderer/shared/components/workspace/ToolSideInspector.vue'
import { humanPikpakBytes } from '../../../../shared/pikpak-get'
import { usePikpakGetStore } from '../stores/pikpakGetStore'

const store = usePikpakGetStore()

const open = defineModel<boolean>({ default: false })

const tasks = computed(() => store.tasks)
const activeTasks = computed(() => store.activeTasks)
const queueSummary = computed(() => store.queueSummary)
const refreshError = computed(() => store.refreshError)

/** 面板宽度（上次拖拽结果，落在 localStorage；ToolSideInspector 不自己持久化） */
const WIDTH_KEY = 'pikpakGet.tasksPanelWidth'
const width = ref(readWidth())

function readWidth(): number {
  const saved = Number(globalThis.localStorage?.getItem(WIDTH_KEY))
  return Number.isFinite(saved) && saved >= 260 && saved <= 420 ? saved : 320
}

function saveWidth(next: number): void {
  width.value = next
  globalThis.localStorage?.setItem(WIDTH_KEY, String(next))
}

/** 面板展开时：立即拉一次任务，并把轮询提速到 1s；收起后回落到按任务状态决定的节奏 */
watch(open, (value) => {
  store.setPanelOpen(value)
  if (value) void store.refreshTasks().catch(() => undefined)
})

onUnmounted(() => {
  store.setPanelOpen(false)
})

const STATUS_LABELS: Record<PikpakGetTask['status'], string> = {
  queued: '排队中',
  running: '下载中',
  cancelling: '取消中',
  done: '完成',
  partial: '部分完成',
  error: '失败',
  cancelled: '已取消',
}

function currentFile(task: PikpakGetTask): PikpakGetTask['files'][string] | null {
  if (!task.currentFile) return null
  return task.files[task.currentFile] ?? null
}

function displayFile(task: PikpakGetTask): PikpakGetTask['files'][string] {
  return currentFile(task) ?? { nodeId: '', name: '', size: 0, downloaded: 0, speed: 0, eta: 0 }
}

function formatEta(seconds: number): string {
  if (!seconds || seconds <= 0) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}时${m}分`
  if (m > 0) return `${m}分${s}秒`
  return `${s}秒`
}

function percent(task: PikpakGetTask): number {
  const file = currentFile(task)
  if (!file || !file.size) return 0
  return Math.min(100, Math.round((file.downloaded / file.size) * 100))
}

/** 任务计划量：排队中显示「还要下多少」，进行中显示「已完成几个」 */
function plannedLine(task: PikpakGetTask): string {
  const planned = task.plannedFiles ?? 0
  const bytes = task.plannedBytes ?? 0
  if (!planned && !bytes) return ''
  const done = Object.values(task.files).filter(file => file.size > 0 && file.downloaded >= file.size).length
  if (task.status === 'queued') return `计划 ${planned} 个文件 · ${humanPikpakBytes(bytes)}`
  if (task.status === 'running') return `进度 ${done}/${planned} 个文件 · 共 ${humanPikpakBytes(bytes)}`
  return `共 ${done}/${planned} 个文件 · ${humanPikpakBytes(bytes)}`
}

/** 最近一次成功刷新的时间（过期提示用） */
function lastUpdatedText(): string {
  const at = store.lastRefreshedAt
  if (!at) return '尚未刷新'
  return `最后更新 ${new Date(at).toLocaleTimeString()}`
}

async function cancel(taskId: string): Promise<void> {
  try {
    await store.cancelTask(taskId)
  } catch (error) {
    toast.error((error as Error).message || '取消失败')
  }
}

/** 手动刷新：失败要给出提示（自动轮询那条路径是静默的，靠 refreshError 标识过期） */
async function manualRefresh(): Promise<void> {
  try {
    await store.refreshTasks()
  } catch (error) {
    toast.error((error as Error).message || '刷新任务失败')
  }
}
</script>

<template>
  <ToolSideInspector
    :open="open"
    title="下载任务"
    :width="width"
    resizable
    :min-width="260"
    :max-width="420"
    body-padding="0"
    @close="open = false"
    @update:width="saveWidth"
  >
    <template #actions>
      <UiIconButton icon="refresh" label="刷新任务" @click="manualRefresh" />
    </template>

    <div class="tasks-panel">
      <div class="panel-summary">
        <span>{{ activeTasks.length }} 个进行中</span>
        <span v-if="queueSummary.tasks" class="mono">
          排队 {{ queueSummary.tasks }} 个 / {{ queueSummary.files }} 个文件 / {{ humanPikpakBytes(queueSummary.bytes) }}
        </span>
      </div>

      <div v-if="refreshError" class="panel-stale" :title="refreshError">
        已断开引擎 · {{ lastUpdatedText() }}（下面的数字可能已过期）
      </div>

      <div class="panel-body">
        <UiEmpty v-if="!tasks.length" text="暂无下载任务；在分享链接里解析并勾选后开始" />

        <div v-else class="task-list">
          <div v-for="task in tasks" :key="task.id" class="task-row">
            <div class="task-head">
              <span class="task-status" :class="`is-${task.status}`">{{ STATUS_LABELS[task.status] }}</span>
              <UiButton
                v-if="task.status === 'running' || task.status === 'queued' || task.status === 'cancelling'"
                size="small"
                @click="cancel(task.id)"
              >
                取消
              </UiButton>
            </div>

            <div v-if="currentFile(task)" class="task-current">
              <div class="task-file mono">
                {{ displayFile(task).name }}
              </div>
              <div class="task-bytes mono">
                {{ humanPikpakBytes(displayFile(task).downloaded) }} / {{ humanPikpakBytes(displayFile(task).size) }}
                <template v-if="displayFile(task).speed > 0">
                  · {{ humanPikpakBytes(displayFile(task).speed) }}/s<template v-if="displayFile(task).eta > 0">
                    · 剩余 {{ formatEta(displayFile(task).eta) }}
                  </template>
                </template>
              </div>
              <UiProgress :percentage="percent(task)" :show-text="true" />
            </div>

            <div v-if="plannedLine(task)" class="task-planned mono">
              {{ plannedLine(task) }}
            </div>

            <div v-if="task.error" class="task-error">
              {{ task.error }}
            </div>

            <div v-if="task.logs.length" class="task-logs">
              <div v-for="(log, index) in task.logs.slice(-4)" :key="index" class="task-log mono">
                {{ log.ts }} {{ log.level.toUpperCase().padEnd(4, ' ') }} {{ log.message }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </ToolSideInspector>
</template>

<style scoped lang="scss">
/* 面板自头条以下独立滚动：汇总与过期提示固定在顶部，任务列表滚动 */
.tasks-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.panel-summary {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: none;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border-light);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.panel-stale {
  flex: none;
  padding: 6px 14px;
  border-bottom: 1px solid var(--color-border-light);
  color: var(--color-warning);
  font-size: var(--font-size-xs);
}

.panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--spacing-md);
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.task-row {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: var(--color-table);
}

.task-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.task-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);

  &::before {
    content: '';
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--color-text-tertiary);
  }

  &.is-done {
    color: var(--color-success);

    &::before { background: var(--color-success); }
  }

  &.is-partial,
  &.is-cancelling {
    color: var(--color-warning);

    &::before { background: var(--color-warning); }
  }

  &.is-error {
    color: var(--color-error);

    &::before { background: var(--color-error); }
  }

  &.is-running {
    color: var(--color-primary);

    &::before { background: var(--color-primary); }
  }
}

.task-current {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--spacing-xs) var(--spacing-md);
  align-items: center;

  :deep(.ui-progress) {
    grid-column: 1 / -1;
  }
}

.task-file {
  grid-column: 1 / -1;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-bytes {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.task-planned {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.task-error {
  color: var(--color-error);
  font-size: var(--font-size-xs);
}

.task-logs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--spacing-sm);
  background: var(--color-fill);
  border-radius: var(--radius-sm);
}

.task-log {
  color: var(--color-text-tertiary);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
