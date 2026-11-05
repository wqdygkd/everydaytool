<script setup lang="ts">
import type { TelegramCacheConfig } from '../../../../shared/telegram-cache'
import { confirm } from '@renderer/shared/feedback'
import { toast } from 'vue-sonner'
import { useTelegramCacheStore } from '../stores/telegramCacheStore'
import { formatBytes } from '../utils/format'

const store = useTelegramCacheStore()

const MB = 1024 * 1024
const CACHE_OPTIONS = [256, 512, 1024, 2048, 3072, 5120, 10240]
const cacheOptions = CACHE_OPTIONS.map(value => ({ label: `${value} MB`, value }))

const currentCacheMb = computed(() => {
  const bytes = store.config?.cacheMaxBytes ?? 3072 * MB
  const mb = Math.round(bytes / MB)
  return CACHE_OPTIONS.reduce((best, item) => (Math.abs(item - mb) < Math.abs(best - mb) ? item : best), CACHE_OPTIONS[0])
})

// 站点 origin 稳定性：端口落盘后固定；一旦变化，页面侧登录态（localStorage）、IndexedDB 与
// Cache Storage 全部作废，所以这里要把「已固定 / 本次已变化」显式说清楚。
const siteReady = computed(() => store.site?.ready ?? false)
const originLabel = computed(() => {
  if (!siteReady.value) return '未就绪'
  return store.site?.originChanged ? '本次已变化' : '已固定'
})
const originTone = computed<'neutral' | 'success' | 'warning'>(() => {
  if (!siteReady.value) return 'neutral'
  return store.site?.originChanged ? 'warning' : 'success'
})

const mtproto = computed(() => store.mtproto)
const mtprotoSessionPath = computed(() => {
  const source = mtproto.value?.sessionSource
  if (source === 'env') return '.env 明文（TELEGRAM_SESSION）'
  if (source === 'none') return '未生成'
  return `${store.snapshot?.dataDirectory || ''}/telegram-cache/telegram-session.bin`
})
const mtLink = ref('')
const mtActive = computed(() => mtproto.value?.active ?? null)
const mtLast = computed(() => mtproto.value?.lastTask ?? null)
const mtProgress = computed(() => {
  const task = mtActive.value
  if (!task || !task.totalBytes || task.totalBytes <= 0) return 0
  return Math.min(99, Math.round((task.bytes / task.totalBytes) * 100))
})

const MT_PHASE_LABELS: Record<string, string> = {
  idle: '空闲',
  resolving: '解析消息',
  downloading: '下载中',
  verifying: '校验完整性',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
}

function mtPhaseLabel(phase?: string): string {
  return phase ? (MT_PHASE_LABELS[phase] ?? phase) : '—'
}

function mtPhaseTone(phase?: string): 'success' | 'danger' | 'warning' | 'neutral' | 'info' {
  if (phase === 'completed') return 'success'
  if (phase === 'failed') return 'danger'
  if (phase === 'cancelled') return 'info'
  if (phase === 'downloading' || phase === 'resolving' || phase === 'verifying') return 'warning'
  return 'neutral'
}

async function startMtprotoDownload(): Promise<void> {
  const link = mtLink.value.trim()
  if (!link) {
    toast.warning('请输入 Telegram 消息链接')
    return
  }
  try {
    await store.startMtprotoDownload(link)
    toast.success('已开始解析消息')
  } catch (error) {
    toast.error((error as Error).message || '启动下载失败')
  }
}

async function cancelMtprotoDownload(): Promise<void> {
  try {
    const accepted = await store.cancelMtprotoDownload()
    if (accepted) toast.info('正在取消…')
  } catch (error) {
    toast.error((error as Error).message || '取消失败')
  }
}

async function refreshMtproto(): Promise<void> {
  try {
    await store.refreshMtprotoStatus()
  } catch (error) {
    toast.error((error as Error).message || '读取状态失败')
  }
}

function sessionSourceLabel(): string {
  const source = mtproto.value?.sessionSource
  if (source === 'secure') return 'OS 加密存储'
  if (source === 'env') return '.env 明文'
  return '缺失'
}

function sessionSourceTone(): 'success' | 'warning' | 'danger' {
  const source = mtproto.value?.sessionSource
  if (source === 'secure') return 'success'
  if (source === 'env') return 'warning'
  return 'danger'
}

async function migrateSession(): Promise<void> {
  try {
    await store.migrateMtprotoSession()
    toast.success('会话已迁移到 OS 加密存储（可删除 .env 里的 TELEGRAM_SESSION）')
  } catch (error) {
    toast.error((error as Error).message || '迁移失败')
  }
}

async function clearSecureSession(): Promise<void> {
  try {
    await confirm(
      '会删除本工具保存的加密会话并断开连接。若 .env 里仍有 TELEGRAM_SESSION，会回退使用它；要彻底移除请自行删除该行。',
      '清除加密会话',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await store.clearMtprotoSecureSession()
    toast.success('已清除加密会话')
  } catch (error) {
    toast.error((error as Error).message || '清除失败')
  }
}

const cache = computed(() => store.cache)

async function updateCacheQuota(value: number): Promise<void> {
  await applyConfig({ cacheMaxBytes: value * MB }, '缓存配额已更新')
}

async function applyConfig(patch: Partial<TelegramCacheConfig>, message: string): Promise<void> {
  try {
    await store.updateConfig(patch)
    toast.success(message)
  } catch (error) {
    toast.error((error as Error).message || '保存配置失败')
  }
}

async function clearCache(): Promise<void> {
  try {
    await confirm(
      '清理缓存会删除媒体对象库里的去重对象（归档消息本身与进行中的任务不会被删）。确定继续？',
      '清理缓存',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    const result = await store.clearCache()
    toast.success(`已清理 ${formatBytes(result.evictedBytes)}（${result.evictions} 项）`)
  } catch (error) {
    toast.error((error as Error).message || '清理失败')
  }
}

async function exportDiagnostics(): Promise<void> {
  try {
    const result = await store.exportDiagnostics()
    toast.success(`诊断包已导出（${formatBytes(result.bytes)}）`)
  } catch (error) {
    toast.error((error as Error).message || '导出失败')
  }
}

async function openDataDir(): Promise<void> {
  try {
    await store.openDataDir()
  } catch (error) {
    toast.error((error as Error).message || '打开数据目录失败')
  }
}
</script>

<template>
  <div class="panel-stack">
    <UiPanel title="MTProto 消息下载（实验）">
      <template #actions>
        <UiButton size="small" @click="refreshMtproto">
          刷新状态
        </UiButton>
      </template>

      <div class="kv-stack">
        <UiKeyValue label="凭据" label-width="88px">
          <UiChip :tone="mtproto?.configured ? 'success' : 'danger'">
            {{ mtproto?.configured ? '已读取 api_id / api_hash' : '缺失' }}
          </UiChip>
        </UiKeyValue>
        <UiKeyValue label="会话" label-width="88px">
          <UiGroup gap="xs" justify="end">
            <UiChip :tone="sessionSourceTone()">
              {{ sessionSourceLabel() }}
            </UiChip>
            <span class="muted session-hint">{{ mtproto?.encryptionAvailable ? 'safeStorage 可用' : 'safeStorage 不可用' }}</span>
          </UiGroup>
        </UiKeyValue>
        <UiKeyValue label="连接" label-width="88px">
          <UiChip :tone="mtproto?.connected ? 'success' : 'neutral'">
            {{ mtproto?.connected ? '已连接' : '未连接' }}
          </UiChip>
        </UiKeyValue>
        <UiKeyValue label="账号" label-width="88px" wrap>
          <span class="mono">{{ mtproto?.account ? `${mtproto.account.id}${mtproto.account.username ? ` @${mtproto.account.username}` : ''}` : '—' }}</span>
        </UiKeyValue>
        <UiKeyValue label="teleproto" label-width="88px" mono>
          {{ mtproto?.libVersion || '未安装' }}
        </UiKeyValue>
      </div>

      <UiToolbar
        v-if="mtproto?.sessionSource === 'secure' || (mtproto?.sessionSource === 'env' && mtproto?.encryptionAvailable)"
        gap="sm"
        class="mt-input-row"
      >
        <UiButton v-if="mtproto?.sessionSource === 'env' && mtproto?.encryptionAvailable" size="small" @click="migrateSession">
          迁移到加密存储
        </UiButton>
        <UiButton v-if="mtproto?.sessionSource === 'secure'" size="small" @click="clearSecureSession">
          清除加密会话
        </UiButton>
      </UiToolbar>

      <UiHint v-if="mtproto?.missing?.length" block class="danger-hint">
        缺少：{{ mtproto.missing.join(' / ') }}。在项目根目录 `.env` 填好后，运行
        <span class="mono">pnpm telegram:session</span> 生成会话并粘回 `.env`，再重启应用。
      </UiHint>
      <UiHint v-else-if="mtproto?.error" block class="danger-hint">
        {{ mtproto.error }}
      </UiHint>

      <UiToolbar gap="sm" class="mt-input-row">
        <UiInput
          v-model="mtLink"
          class="ctl-fill"
          size="small"
          placeholder="https://t.me/<频道>/<消息ID> 或 https://t.me/c/<频道ID>/<消息ID>"
          :disabled="Boolean(mtActive)"
          clearable
        />
        <UiButton size="small" type="primary" :loading="Boolean(mtActive) && mtActive?.phase === 'resolving'" :disabled="Boolean(mtActive)" @click="startMtprotoDownload">
          下载媒体
        </UiButton>
        <UiButton size="small" :disabled="!mtActive" @click="cancelMtprotoDownload">
          取消
        </UiButton>
      </UiToolbar>

      <template v-if="mtActive">
        <div class="mt-progress">
          <UiChip :tone="mtPhaseTone(mtActive.phase)">
            {{ mtPhaseLabel(mtActive.phase) }}
          </UiChip>
          <span class="mono muted mt-progress-text">
            {{ formatBytes(mtActive.bytes) }}<template v-if="mtActive.totalBytes"> / {{ formatBytes(mtActive.totalBytes) }}</template>
            <template v-if="mtActive.resumedFrom > 0"> · 从 {{ formatBytes(mtActive.resumedFrom) }} 续传</template>
          </span>
        </div>
        <UiProgress :percentage="mtProgress" :status="mtActive.phase === 'failed' ? 'exception' : undefined" />
        <span class="muted mt-file">{{ mtActive.fileName || '解析中…' }}</span>
      </template>

      <template v-else-if="mtLast">
        <div class="mt-progress">
          <UiChip :tone="mtPhaseTone(mtLast.phase)">
            {{ mtPhaseLabel(mtLast.phase) }}
          </UiChip>
          <span class="mono muted mt-progress-text">{{ formatBytes(mtLast.bytes) }}</span>
        </div>
        <UiHint v-if="mtLast.error" block class="danger-hint">
          {{ mtLast.error }}
        </UiHint>
        <div v-if="mtLast.sha256" class="report-block">
          <UiKeyValue label="SHA-256" label-width="88px" mono wrap>
            <span class="mono mt-sha">{{ mtLast.sha256 }}</span>
          </UiKeyValue>
        </div>
      </template>

      <UiHint block>
        只能下载当前账号本来就能访问的消息；私密链接要求频道已在对话列表里（access hash 来自会话缓存）。
        凭据只在主进程读取；<strong>不要把 .env 提交或截图</strong>。
      </UiHint>
    </UiPanel>

    <UiPanel title="数据与配置">
      <div class="kv-stack">
        <UiKeyValue label="站点 origin" label-width="112px" wrap>
          <div class="data-dir">
            <span class="mono data-path">{{ store.site?.url || '未就绪' }}</span>
            <UiChip variant="soft" :tone="originTone">
              {{ originLabel }}
            </UiChip>
          </div>
        </UiKeyValue>
        <UiKeyValue label="站点端口" label-width="112px" mono>
          {{ store.site?.port ?? '—' }}
        </UiKeyValue>
        <UiKeyValue label="缓存占用" label-width="112px" mono>
          {{ formatBytes(cache?.sizeBytes) }} / {{ formatBytes(cache?.maxBytes) }}
        </UiKeyValue>
        <UiKeyValue label="缓存配额" label-width="112px">
          <UiSelect
            :model-value="currentCacheMb"
            size="small"
            class="ctl-sm"
            :options="cacheOptions"
            @update:model-value="v => updateCacheQuota(Number(v))"
          />
        </UiKeyValue>
        <UiKeyValue label="Web 登录缓存" label-width="112px" wrap>
          <div class="data-dir">
            <span class="mono data-path">{{ store.snapshot?.webSession?.directory || '—' }}</span>
            <UiChip :tone="store.snapshot?.webSession?.inDataDirectory ? 'success' : 'warning'">
              {{ store.snapshot?.webSession?.inDataDirectory ? '数据目录' : '默认目录' }}
            </UiChip>
          </div>
        </UiKeyValue>
        <UiKeyValue label="MTProto 会话" label-width="112px" wrap>
          <span class="mono data-path">{{ mtprotoSessionPath }}</span>
        </UiKeyValue>
        <UiKeyValue label="数据目录" label-width="112px" wrap>
          <div class="data-dir">
            <span class="mono data-path">{{ store.snapshot?.dataDirectory || '—' }}</span>
            <UiButton size="small" text type="primary" @click="openDataDir">
              打开
            </UiButton>
          </div>
        </UiKeyValue>
      </div>

      <UiHint v-if="store.site?.originChanged" block class="danger-hint">
        {{ store.site?.portNote }}
      </UiHint>
      <UiHint v-else-if="store.site?.port" block>
        站点端口 {{ store.site.port }} 已落盘：origin 固定，页面登录态与本地缓存可以跨重启复用。
      </UiHint>

      <UiHint v-if="store.snapshot?.webSession?.restartRequired" block class="danger-hint">
        数据目录已切换：重启后 Chromium 会话目录才会指向新位置；旧目录中的缓存与登录态不会迁移（可能需要重新登录）。
      </UiHint>

      <UiToolbar gap="sm" class="actions-row">
        <UiButton size="small" type="primary" :loading="store.busy.diagnostics" @click="exportDiagnostics">
          导出诊断包
        </UiButton>
        <UiButton size="small" :loading="store.busy.cache" @click="clearCache">
          清理缓存
        </UiButton>
        <span class="muted export-hint">
          {{ store.diagnostics ? `已导出 ${formatBytes(store.diagnostics.bytes)}：${store.diagnostics.relativePath}` : '未导出' }}
        </span>
      </UiToolbar>

      <UiHint block>
        归档目录按 <span class="mono">messages/&lt;群 id&gt;/&lt;消息 id&gt;/</span> 落盘，正文与元信息在
        <span class="mono">message.md</span>，媒体在 <span class="mono">media/&lt;媒体键&gt;.&lt;扩展名&gt;</span>；
        媒体对象按 SHA-256 去重后硬链，所以同一份文件只占一块磁盘。
      </UiHint>

      <UiHint block>
        诊断包只包含脱敏后的统计、索引、任务与配置，不含 Cookie / Authorization / 请求头原文 / 响应体 / 消息正文；
        URL 查询参数值统一为 <span class="mono">***</span>，完整地址仅存在于主进程内存。
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

.kv-stack {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.report-block {
  margin-top: var(--spacing-md);
}

.mt-input-row {
  margin-top: var(--spacing-md);
}

.mt-progress {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
}

.mt-progress-text {
  font-size: var(--font-size-xs);
}

.mt-file {
  display: block;
  margin-top: var(--spacing-xs);
  font-size: var(--font-size-xs);
  word-break: break-all;
}

.mt-sha {
  font-size: var(--font-size-xs);
  word-break: break-all;
}

.session-hint {
  font-size: var(--font-size-xs);
}

.data-dir {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  justify-content: flex-end;
}

.data-path {
  font-size: var(--font-size-xs);
  word-break: break-all;
}

.actions-row {
  margin-top: var(--spacing-md);
}

.export-hint {
  font-size: var(--font-size-xs);
  word-break: break-all;
}

.danger-hint {
  color: var(--color-warning);
}
</style>
