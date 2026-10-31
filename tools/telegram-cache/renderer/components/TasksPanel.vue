<script setup lang="ts">
import type { TelegramLibraryEntry, TelegramMessageState } from '../../../../shared/telegram-cache'
import { useTelegramCacheStore } from '../stores/telegramCacheStore'
import { formatBytes } from '../utils/format'

const store = useTelegramCacheStore()

type ChipTone = 'success' | 'primary' | 'warning' | 'danger' | 'neutral'

const stateMeta: Record<string, { label: string, tone: ChipTone }> = {
  queued: { label: '排队中', tone: 'primary' },
  downloading: { label: '缓存中', tone: 'warning' },
  partial: { label: '缓存中', tone: 'warning' },
  failed: { label: '失败', tone: 'danger' },
  missing: { label: '缺失', tone: 'neutral' },
  complete: { label: '已缓存', tone: 'success' },
}

/**
 * el-table 的插槽行是 EP 的 DefaultRow（`Record<PropertyKey, any>`），不保证具体字段真的存在；
 * 进来先收敛到影库条目类型。运行期就是表格里的同一份对象，不做转换。
 */
function toEntry(row: unknown): TelegramLibraryEntry {
  return row as TelegramLibraryEntry
}

function stateInfo(state: TelegramMessageState): { label: string, tone: ChipTone } {
  return stateMeta[state] ?? { label: state, tone: 'neutral' }
}

function progressOf(row: unknown): number {
  const entry = toEntry(row)
  if (entry.state === 'complete') return 100
  const ratio = entry.progress
  return ratio === undefined ? 0 : Math.min(99, Math.max(0, Math.round(ratio * 100)))
}

/** 只列还没归档完的消息：完成的都在影库那边看 */
const pending = computed(() => store.library.filter(entry => entry.state !== 'complete'))

async function refresh(): Promise<void> {
  try {
    await store.loadLibrary()
  } catch (error) {
    ElMessage.error((error as Error).message || '读取归档进度失败')
  }
}

function openDir(row: unknown): void {
  const entry = toEntry(row)
  void store.openLibraryDir(entry.peerId, entry.messageId).catch((error: unknown) => {
    ElMessage.error((error as Error).message || '打开目录失败')
  })
}

function jump(row: unknown): void {
  const entry = toEntry(row)
  store.requestJump(entry.peerId, entry.messageId)
}
</script>

<template>
  <div class="panel-stack">
    <UiPanel title="归档进度">
      <template #actions>
        <UiChip mono>
          进行中 {{ pending.length }}
        </UiChip>
        <el-button size="small" :loading="store.busy.library" @click="refresh">
          刷新
        </el-button>
      </template>

      <UiTable
        :data="pending"
        height="520"
        empty-text="当前没有正在归档的消息：在 Telegram 消息上右键「缓存此消息」"
      >
        <el-table-column label="会话" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="task-cell">
              <span>{{ toEntry(row).peerTitle || toEntry(row).peerId }}</span>
              <span class="muted task-meta">{{ toEntry(row).senderName || toEntry(row).peerId }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="消息" width="110">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="jump(row)">
              #{{ toEntry(row).messageId }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="96">
          <template #default="{ row }">
            <UiChip :tone="stateInfo(toEntry(row).state).tone" variant="soft">
              {{ stateInfo(toEntry(row).state).label }}
            </UiChip>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="140">
          <template #default="{ row }">
            <UiProgress :percentage="progressOf(row)" />
            <span class="mono muted progress-text">{{ formatBytes(toEntry(row).size) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono muted">{{ toEntry(row).textPreview || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column width="110" align="right">
          <template #default="{ row }">
            <el-button size="small" text @click="openDir(row)">
              打开文件夹
            </el-button>
          </template>
        </el-table-column>
      </UiTable>

      <UiHint block>
        进度来自主进程的归档事件（`EVENT_LIBRARY`），按 4MB 分片推进；中断的消息会停在「缓存中」，
        在影库或这里再点一次「缓存此消息」会从已有分片继续，不会从 0 重下。
      </UiHint>
    </UiPanel>
  </div>
</template>

<style scoped lang="scss">
.panel-stack {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.task-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.task-meta {
  font-size: var(--font-size-xs);
}

.progress-text {
  display: block;
  margin-top: 2px;
  font-size: var(--font-size-xs);
}
</style>
