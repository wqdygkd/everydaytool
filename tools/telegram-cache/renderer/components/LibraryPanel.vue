<script setup lang="ts">
import type { TelegramLibraryEntry, TelegramTrashEntry } from '../../../../shared/telegram-cache'
import type { LibraryMediaItem } from '../stores/telegramCacheStore'
import { confirm } from '@renderer/shared/feedback'
import { toast } from 'vue-sonner'
import { useTelegramCacheStore } from '../stores/telegramCacheStore'
import { formatBytes, formatDateTime } from '../utils/format'

const store = useTelegramCacheStore()
const filter = ref('')

const playerItems = ref<LibraryMediaItem[]>([])
const playerIndex = ref(0)
const playerVisible = ref(false)
const playerTitle = ref('')

const currentMedia = computed(() => playerItems.value[playerIndex.value])

function mediaKind(mimeType?: string): 'video' | 'audio' | 'image' | 'file' {
  if (!mimeType) return 'file'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('image/')) return 'image'
  return 'file'
}

/** el-table 插槽行是 EP 的 DefaultRow；先收敛到业务类型再使用 */
function toEntry(row: unknown): TelegramLibraryEntry {
  return row as TelegramLibraryEntry
}

function toTrash(row: unknown): TelegramTrashEntry {
  return row as TelegramTrashEntry
}

const filteredLibrary = computed(() => {
  const keyword = filter.value.trim().toLowerCase()
  if (!keyword) return store.library
  return store.library.filter(item => (
    `${item.peerTitle ?? ''} ${item.peerId} ${item.messageId} ${item.textPreview ?? ''}`.toLowerCase().includes(keyword)
  ))
})

function stateMeta(entry: TelegramLibraryEntry): { label: string, tone: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' } {
  const percent = Math.round((entry.progress ?? 0) * 100)
  switch (entry.state) {
    case 'complete':
      return { label: '已缓存', tone: 'success' }
    case 'partial':
    case 'downloading':
      return { label: percent > 0 ? `缓存中 ${percent}%` : '缓存中', tone: 'warning' }
    case 'queued':
      return { label: '排队中', tone: 'primary' }
    case 'failed':
      return { label: '失败', tone: 'danger' }
    default:
      return { label: '缺失', tone: 'neutral' }
  }
}

/** 链接按钮文案：t.me 链接显示尾部，tg:// 链接显示源；完整地址放 title */
function linkLabel(entry: TelegramLibraryEntry): string {
  const link = entry.messageLink
  return link.startsWith('https://t.me/') ? link.slice('https://t.me/'.length) : link
}

function jumpToMessage(entry: TelegramLibraryEntry): void {
  store.requestJump(entry.peerId, entry.messageId)
}

async function copyLink(entry: TelegramLibraryEntry): Promise<void> {
  try {
    await navigator.clipboard.writeText(entry.messageLink)
    toast.success('消息链接已复制')
  } catch {
    toast.error(`复制失败：${entry.messageLink}`)
  }
}

async function refresh(): Promise<void> {
  try {
    await Promise.all([store.loadLibrary(), store.loadTrash()])
  } catch (error) {
    toast.error((error as Error).message || '读取影库失败')
  }
}

async function openDir(entry: TelegramLibraryEntry): Promise<void> {
  try {
    await store.openLibraryDir(entry.peerId, entry.messageId)
  } catch (error) {
    toast.error((error as Error).message || '打开目录失败')
  }
}

async function play(entry: TelegramLibraryEntry): Promise<void> {
  try {
    const items = await store.loadLibraryMedia(entry.peerId, entry.messageId)
    if (!items.length) {
      toast.warning('该消息没有可播放的媒体')
      return
    }
    playerItems.value = items
    playerIndex.value = 0
    playerTitle.value = `${entry.peerTitle || entry.peerId} · #${entry.messageId}`
    playerVisible.value = true
  } catch (error) {
    toast.error((error as Error).message || '读取媒体失败')
  }
}

function prevMedia(): void {
  playerIndex.value = (playerIndex.value - 1 + playerItems.value.length) % playerItems.value.length
}

function nextMedia(): void {
  playerIndex.value = (playerIndex.value + 1) % playerItems.value.length
}

async function removeEntry(entry: TelegramLibraryEntry): Promise<void> {
  try {
    await confirm(
      `把消息 ${entry.messageId} 移入回收站？原目录与 manifest 会保留，可在回收站恢复。`,
      '移入回收站',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await store.deleteLibraryMessage(entry.peerId, entry.messageId)
    toast.success('已移入回收站')
  } catch (error) {
    toast.error((error as Error).message || '移入回收站失败')
  }
}

async function restore(entry: TelegramTrashEntry): Promise<void> {
  try {
    await store.restoreTrash(entry.trashId)
    toast.success('已恢复')
  } catch (error) {
    toast.error((error as Error).message || '恢复失败')
  }
}

async function emptyExpired(): Promise<void> {
  try {
    const removed = await store.emptyTrash()
    toast.success(removed > 0 ? `已清理 ${removed} 个到期条目` : '没有到期的回收站条目')
  } catch (error) {
    toast.error((error as Error).message || '清理失败')
  }
}

onMounted(() => {
  void refresh()
  // 旧目录一次性正名：001.jpg → media/<mediaKey>.<ext>、text.md → message.md、acc-default/ 上移（幂等，无需用户操作）
  void store.normalizeLibrary()
    .then((summary) => {
      if (summary.migrated > 0) toast.success(`已把 ${summary.migrated} 条缓存迁到 messages/<群id>/<消息id>/`)
      if (summary.changed > 0) void refresh()
    })
    .catch(() => undefined)
})
</script>

<template>
  <div class="panel-stack">
    <UiPanel title="本地影库">
      <template #actions>
        <UiChip mono>
          {{ store.library.length }}
        </UiChip>
        <UiButton size="small" :loading="store.busy.library" @click="refresh">
          刷新
        </UiButton>
      </template>

      <UiToolbar wrap gap="sm">
        <UiSearchInput v-model="filter" variant="box" width="100%" placeholder="按会话 / 消息 ID / 正文过滤" clearable trim />
      </UiToolbar>

      <UiTable :data="filteredLibrary" height="420" empty-text="还没有本地缓存：在 Telegram 消息上右键「缓存此消息」">
        <UiTableColumn label="时间" width="132">
          <template #default="{ row }">
            <span class="mono muted">{{ formatDateTime(row.savedAt) }}</span>
          </template>
        </UiTableColumn>
        <UiTableColumn label="会话" width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="cell-stack">
              <span class="mono">{{ row.peerTitle || row.peerId }}</span>
              <span v-if="row.senderName" class="muted small">{{ row.senderName }}</span>
            </div>
          </template>
        </UiTableColumn>
        <UiTableColumn label="消息 / 链接" width="210" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="cell-stack">
              <span class="mono">{{ row.messageId }}</span>
              <UiButton
                size="small"
                text
                type="primary"
                class="link-button"
                :title="row.messageLink"
                @click="jumpToMessage(toEntry(row))"
              >
                {{ linkLabel(toEntry(row)) }}
              </UiButton>
            </div>
          </template>
        </UiTableColumn>
        <UiTableColumn label="状态" width="112">
          <template #default="{ row }">
            <UiChip :tone="stateMeta(toEntry(row)).tone">
              {{ stateMeta(toEntry(row)).label }}
            </UiChip>
          </template>
        </UiTableColumn>
        <UiTableColumn label="大小" width="88" align="right">
          <template #default="{ row }">
            <span class="mono muted">{{ formatBytes(row.size) }}</span>
          </template>
        </UiTableColumn>
        <UiTableColumn label="附件" width="64" align="right">
          <template #default="{ row }">
            <span class="mono muted">{{ row.attachmentCount }}</span>
          </template>
        </UiTableColumn>
        <UiTableColumn label="正文" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="muted">{{ row.textPreview || '—' }}</span>
          </template>
        </UiTableColumn>
        <UiTableColumn label="本地目录" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <UiButton
              size="small"
              text
              type="primary"
              class="link-button mono"
              :title="row.localDir"
              @click="openDir(toEntry(row))"
            >
              {{ row.relativeDir }}
            </UiButton>
          </template>
        </UiTableColumn>
        <UiTableColumn label="操作" width="212" align="right">
          <template #default="{ row }">
            <div class="row-actions">
              <UiButton size="small" text type="primary" @click="play(toEntry(row))">
                播放
              </UiButton>
              <UiButton size="small" text type="primary" :title="row.localDir" @click="openDir(toEntry(row))">
                打开文件夹
              </UiButton>
              <UiButton size="small" text type="primary" @click="copyLink(toEntry(row))">
                复制链接
              </UiButton>
              <UiButton size="small" text type="danger" @click="removeEntry(toEntry(row))">
                删除
              </UiButton>
            </div>
          </template>
        </UiTableColumn>
      </UiTable>

      <UiHint block>
        影库只读本地索引与 manifest，不访问 Telegram；原消息被删除 / 账号失去访问时仍可打开目录查看。
        删除只移入回收站，不会直接销毁文件。
      </UiHint>
    </UiPanel>

    <UiPanel title="回收站">
      <template #actions>
        <UiChip mono>
          {{ store.trash.length }}
        </UiChip>
        <UiButton size="small" @click="emptyExpired">
          清理到期
        </UiButton>
      </template>

      <UiTable :data="store.trash" height="220" empty-text="回收站为空">
        <UiTableColumn label="删除时间" width="132">
          <template #default="{ row }">
            <span class="mono muted">{{ formatDateTime(row.deletedAt) }}</span>
          </template>
        </UiTableColumn>
        <UiTableColumn label="会话 / 消息" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono">{{ row.peerId }} / {{ row.messageId }}</span>
          </template>
        </UiTableColumn>
        <UiTableColumn label="到期" width="132">
          <template #default="{ row }">
            <span class="mono muted">{{ formatDateTime(row.expiresAt) }}</span>
          </template>
        </UiTableColumn>
        <UiTableColumn label="操作" width="90" align="right">
          <template #default="{ row }">
            <UiButton size="small" text type="primary" @click="restore(toTrash(row))">
              恢复
            </UiButton>
          </template>
        </UiTableColumn>
      </UiTable>
    </UiPanel>

    <UiDialog v-model="playerVisible" :title="playerTitle" width="760px" destroy-on-close>
      <div v-if="currentMedia" class="player">
        <video
          v-if="mediaKind(currentMedia.mimeType) === 'video'"
          :src="currentMedia.url"
          controls
          autoplay
          class="player-media"
        />
        <audio
          v-else-if="mediaKind(currentMedia.mimeType) === 'audio'"
          :src="currentMedia.url"
          controls
          autoplay
          class="player-audio"
        />
        <img
          v-else-if="mediaKind(currentMedia.mimeType) === 'image'"
          :src="currentMedia.url"
          :alt="currentMedia.fileName || currentMedia.mediaKey"
          class="player-media"
        >
        <div v-else class="player-file">
          {{ currentMedia.fileName || currentMedia.mediaKey }}
        </div>
        <div v-if="playerItems.length > 1" class="player-nav">
          <UiButton size="small" @click="prevMedia">
            上一个
          </UiButton>
          <span class="mono muted">{{ playerIndex + 1 }} / {{ playerItems.length }}</span>
          <UiButton size="small" @click="nextMedia">
            下一个
          </UiButton>
        </div>
      </div>
    </UiDialog>
  </div>
</template>

<style scoped lang="scss">
.panel-stack {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacing-xs);
}

.cell-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.small {
  font-size: var(--font-size-xs);
}

.link-button {
  padding: 0;
  height: auto;
  justify-content: flex-start;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-sm);
}

.player-media {
  max-width: 100%;
  max-height: 60vh;
  border-radius: var(--radius-md);
  background: #000;
}

.player-audio {
  width: 100%;
}

.player-file {
  padding: var(--spacing-lg);
  color: var(--color-text-secondary);
}

.player-nav {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}
</style>
