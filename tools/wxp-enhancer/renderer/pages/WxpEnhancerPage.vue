<script setup lang="ts">
import type { WxpRunningStatus } from '../../../../shared/wxp'
import { useToolPaneActive } from '@renderer/shared/components/ui/overlay-target'
import { isElectronEnvironment } from '@renderer/shared/environment'
import { confirm } from '@renderer/shared/feedback'
import { useDebounceFn } from '@vueuse/core'
import { toast } from 'vue-sonner'
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import { useCopy } from '../../../../renderer/shared/composables/useClipboard'
import { DEFAULT_WXP_SETTINGS } from '../../../../shared/wxp'
import { normalizeWxpLinkFavorites } from '../../../../shared/wxp-favorite'
import { useWxpEnhancerStore } from '../stores/wxpEnhancerStore'

const store = useWxpEnhancerStore()
const isElectron = isElectronEnvironment()
const paneActive = useToolPaneActive()

const ACTIVE_STATUSES = ['launching', 'waiting', 'connecting', 'running']

const STATUS_LABELS: Record<WxpRunningStatus, string> = {
  launching: '启动中',
  waiting: '等待 CDP',
  connecting: '连接中',
  running: '运行中',
  error: '错误',
  stopped: '已停止',
}

const settingsForm = reactive({
  ...DEFAULT_WXP_SETTINGS,
})
const loading = ref(true)
const launching = ref(false)
const stopping = ref(false)
const clearing = ref(false)

let syncingForm = false
let settingsRevision = 0
let savedRevision = 0
let saveQueue: Promise<void> = Promise.resolve()

function normalizeDebugPort(value: unknown): number {
  const port = Math.round(Number(value))
  if (!Number.isFinite(port)) return DEFAULT_WXP_SETTINGS.debugPort
  return Math.min(65535, Math.max(1024, port))
}

function syncSettingsForm(): void {
  syncingForm = true
  Object.assign(settingsForm, store.settings)
  nextTick(() => {
    syncingForm = false
  })
}

/** 表单变更后自动保存；400ms 防抖，保存请求串行执行，避免快速改值时乱序覆盖 */
async function persistSettings(): Promise<void> {
  const revision = settingsRevision
  const snapshot = {
    ...settingsForm,
    debugPort: normalizeDebugPort(settingsForm.debugPort),
  }
  const run = saveQueue
    .then(() => store.saveSettings(snapshot))
    .then(() => {
      savedRevision = Math.max(savedRevision, revision)
    })
  saveQueue = run.catch(() => undefined)
  return run
}

const autoSave = useDebounceFn(() => {
  void persistSettings().catch((error) => {
    toast.error((error as Error).message || '保存设置失败')
  })
}, 400)

const isRunning = computed(() => Boolean(store.running && ACTIVE_STATUSES.includes(store.running.status)))
/** 已连上 CDP 并完成首轮注入：数据采集 / 清除登录缓存只在这个状态下真正作用到页面 */
const isConnected = computed(() => store.running?.status === 'running')
/** 启动设置区（字段 + 浏览 / 自动检测）的锁定判据：点下启动起、到停止完成为止全程只读，
 *  回到「已停止」才放开。错误态不锁——那正是要改路径 / 端口再重试的时候，锁住就无路可走。 */
const settingsLocked = computed(() => isRunning.value || launching.value || stopping.value)

watch(settingsForm, () => {
  if (syncingForm) return
  settingsRevision += 1
  if (!isElectron || settingsLocked.value) return
  void autoSave()
})

const statusLabel = computed(() => {
  const status = store.running?.status
  return status ? STATUS_LABELS[status] ?? status : ''
})
/** 未运行 / 已停止不占标题栏状态位，只有启动过程、运行中与错误才显示状态点 */
const showTopbarStatus = computed(() => Boolean(store.running && store.running.status !== 'stopped'))
/** 运行信息压成一个 chip，避免标题行右侧被多枚 chip 挤换行 */
const runtimeSummary = computed(() => {
  const running = store.running
  return `PID ${running?.pid ?? '-'} · 端口 ${running?.port ?? '-'} · ${running?.targetCount ?? 0} 页`
})
/** 缓存标题行的过程 / 错误说明：运行中恒为空，状态卡在「启动 → 运行中」全程只有一行 */
const statusDetail = computed(() => {
  const running = store.running
  if (!running || running.status === 'running') return ''
  return running.message ?? ''
})
/** 状态点色板：运行绿 / 过渡态黄 / 失败红 / 其余中性 */
const statusTone = computed<'success' | 'warning' | 'danger' | 'neutral'>(() => {
  switch (store.running?.status) {
    case 'running': return 'success'
    case 'error': return 'danger'
    case 'launching':
    case 'waiting':
    case 'connecting': return 'warning'
    default: return 'neutral'
  }
})

async function handleLaunch(): Promise<void> {
  if (!settingsForm.executablePath.trim()) {
    toast.warning('请先选择 WXP 可执行文件')
    return
  }
  launching.value = true
  try {
    autoSave.cancel()
    await persistSettings()
    await store.launch()
    toast.success('WXP 已启动，增强脚本已注入')
  } catch (error) {
    toast.error((error as Error).message || '启动失败')
  } finally {
    launching.value = false
  }
}

async function handleStop(): Promise<void> {
  stopping.value = true
  try {
    await store.stop()
  } catch (error) {
    toast.error((error as Error).message || '停止失败')
  } finally {
    stopping.value = false
  }
}

async function handleClearLoginCache(): Promise<void> {
  // 只有「已连上 CDP」才会真正清页面；其余状态后端只登记待清除标记
  const runningNow = isConnected.value
  const confirmText = runningNow
    ? '将清除缓存的登录会话（快照/镜像）并刷新页面回到登录状态，需要重新登录。确定继续？'
    : 'WXP 未在运行：将登记清除标记，下次启动 WXP 时自动清除登录缓存并回到登录页。确定继续？'
  try {
    await confirm(confirmText, '清除登录缓存', {
      type: 'warning',
      confirmButtonText: '清除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  clearing.value = true
  try {
    const result = await store.clearLoginCache()
    if (result.pending) {
      toast.success('已登记，将在下次启动 WXP 时自动清除登录缓存')
    } else {
      toast.success(`已清除登录缓存（${result.pages} 个页面），请重新登录`)
    }
  } catch (error) {
    toast.error((error as Error).message || '清除登录缓存失败')
  } finally {
    clearing.value = false
  }
}

// —— 数据缓存（来自 WXP） ——
const collecting = ref(false)
const dataLogin = computed(() => store.dataCache?.login ?? null)
const userCode = computed(() => String((dataLogin.value?.user as Record<string, unknown> | null)?.code ?? '—'))
const userName = computed(() => String((dataLogin.value?.user as Record<string, unknown> | null)?.name ?? '—'))
const UNKNOWN_HOSPITAL = '未知医院'
interface FavTreeRow {
  id: string
  name: string
  sceneformal: string
  accessPoint: string
  targetPoint: string
  children?: FavTreeRow[]
}
const favTree = computed<FavTreeRow[]>(() => {
  const groups = new Map<string, FavTreeRow[]>()
  for (const fav of normalizeWxpLinkFavorites(store.dataCache?.favorites)) {
    const hospital = fav.hospital || UNKNOWN_HOSPITAL
    const rows = groups.get(hospital) ?? []
    rows.push({
      id: `${hospital}\0${rows.length}\0${fav.simpleName}`,
      name: fav.simpleName,
      sceneformal: fav.sceneformal,
      accessPoint: fav.accessPoint,
      targetPoint: fav.targetPoint,
    })
    groups.set(hospital, rows)
  }
  return [...groups.entries()]
    .sort((a, b) => {
      if (a[0] === UNKNOWN_HOSPITAL) return 1
      if (b[0] === UNKNOWN_HOSPITAL) return -1
      return a[0].localeCompare(b[0], 'zh')
    })
    .map(([hospital, children]) => ({
      id: hospital,
      name: `${hospital}（${children.length}）`,
      sceneformal: '',
      accessPoint: '',
      targetPoint: '',
      children,
    }))
})
const favCount = computed(() => favTree.value.reduce((sum, row) => sum + (row.children?.length ?? 0), 0))

function favRowClass({ row }: { row: FavTreeRow }): string {
  return row.children ? 'fav-hospital-row' : ''
}

function maskToken(v: string): string {
  if (!v) return '—'
  return v.length <= 14 ? v : `${v.slice(0, 8)}…${v.slice(-4)}`
}

function fmtTime(ms: number): string {
  return ms ? new Date(ms).toLocaleString() : '—'
}

async function handleCollect(): Promise<void> {
  collecting.value = true
  try {
    await store.collectData()
    toast.success('已从 WXP 读取并缓存')
  } catch (error) {
    toast.error((error as Error).message || '读取失败')
  } finally {
    collecting.value = false
  }
}

async function pickExecutable(): Promise<void> {
  try {
    const path = await store.selectExecutable()
    if (path) settingsForm.executablePath = path
  } catch (error) {
    toast.error((error as Error).message || '选择可执行文件失败')
  }
}

async function detectExecutable(): Promise<void> {
  try {
    const path = await store.detectExecutable()
    if (path) {
      settingsForm.executablePath = path
      toast.success(`已检测到：${path}`)
    } else {
      toast.info('未在常见安装位置找到 WXP，请手动选择')
    }
  } catch (error) {
    toast.error((error as Error).message || '自动检测失败')
  }
}

let unsubscribeStatus: (() => void) | null = null

onMounted(async () => {
  if (!isElectron) {
    syncSettingsForm()
    loading.value = false
    return
  }
  try {
    unsubscribeStatus = store.bindStatusEvents()
    await store.load()
  } catch (error) {
    toast.error((error as Error).message || '读取 WXP 增强设置失败')
  } finally {
    syncSettingsForm()
    loading.value = false
  }
})

onUnmounted(() => {
  autoSave.cancel()
  if (isElectron && savedRevision < settingsRevision) {
    void persistSettings().catch(() => undefined)
  }
  unsubscribeStatus?.()
  if (isRunning.value) void store.stop().catch(() => undefined)
})
</script>

<template>
  <div class="wxp-enhancer-page tool-page">
    <Teleport v-if="paneActive && showTopbarStatus" defer to="#app-topbar-state">
      <span class="tb-state" :class="`is-${statusTone}`">
        <i class="tb-dot" />
        {{ statusLabel }}
      </span>
    </Teleport>

    <ToolSurface class="wxp-surface">
      <div class="form-studio">
        <aside class="config-pane">
          <div class="pane-title">
            启动设置
          </div>

          <div class="config-form">
            <UiFormField label-width="72px" label="WXP 路径" required>
              <UiPathField
                v-model="settingsForm.executablePath"
                placeholder="选择 WxP Client 可执行文件"
                :disabled="settingsLocked"
                class="path-row"
                mono
              >
                <template #actions>
                  <UiButton size="small" :disabled="settingsLocked" @click="pickExecutable">
                    浏览
                  </UiButton>
                  <UiButton size="small" :disabled="settingsLocked" @click="detectExecutable">
                    检测
                  </UiButton>
                </template>
              </UiPathField>
            </UiFormField>
            <UiFormField label-width="72px" label="调试端口">
              <input
                v-model="settingsForm.debugPort"
                type="number"
                :min="1024"
                :max="65535"
                :disabled="settingsLocked"
                class="ui-port-input"
                @change="settingsForm.debugPort = normalizeDebugPort(settingsForm.debugPort)"
              >
            </UiFormField>
            <UiFormField label-width="72px" label="状态角标">
              <UiSwitchField
                v-model="settingsForm.showStatusBadge"
                align="start"
                :disabled="settingsLocked"
              >
                WXP 顶栏显示「增强中」呼吸灯
              </UiSwitchField>
            </UiFormField>
            <UiFormField label-width="72px" label="缓存登录">
              <UiSwitchField
                v-model="settingsForm.cacheLogin"
                align="start"
                :disabled="settingsLocked"
              >
                登录一次后缓存会话
              </UiSwitchField>
            </UiFormField>
            <UiFormField label-width="72px" label="额外参数" class="form-item--last">
              <UiInput
                v-model="settingsForm.extraArgs"
                placeholder="如 --lang=zh-CN；端口会自动附加"
                :disabled="settingsLocked"
                class="mono"
                spellcheck="false"
              />
            </UiFormField>
          </div>

          <section class="pane-section">
            <header class="pane-section-head">
              <div>
                <strong>缓存维护</strong>
                <span>读取需要 WXP 已连接；未运行时清除会在下次启动生效。</span>
              </div>
            </header>
            <div class="pane-actions">
              <UiButton
                size="small"
                type="primary"
                plain
                :loading="collecting"
                :disabled="!isConnected"
                @click="handleCollect"
              >
                从 WXP 读取
              </UiButton>
              <UiButton
                size="small"
                type="danger"
                plain
                :loading="clearing"
                @click="handleClearLoginCache"
              >
                清除登录缓存
              </UiButton>
            </div>
          </section>

          <div class="config-actions">
            <UiButton
              v-if="!isRunning"
              type="primary"
              :loading="launching"
              :disabled="loading"
              @click="handleLaunch"
            >
              启动
            </UiButton>
            <UiButton
              v-else
              type="warning"
              plain
              :loading="stopping"
              @click="handleStop"
            >
              停止
            </UiButton>
          </div>

          <UiHint size="xs" align="start" class="legal-hint">
            启动前请先退出已打开的 WXP；关闭本工具会停止由 edt 托管的会话。
          </UiHint>
        </aside>

        <section class="result-pane">
          <header class="result-head">
            <div>
              <strong>WXP 数据缓存</strong>
              <span v-if="statusDetail" class="status-detail" :title="statusDetail">
                {{ statusDetail }}
              </span>
              <span v-else-if="store.dataCache">采集于 {{ fmtTime(store.dataCache.collectedAt) }}</span>
              <span v-else>登录后自动采集，也可在左侧手动读取</span>
            </div>
            <div class="result-actions">
              <UiChip v-if="isConnected" mono>
                {{ runtimeSummary }}
              </UiChip>
              <UiChip v-else-if="store.loginCacheClearPending" tone="warning">
                登录缓存待清除
              </UiChip>
              <UiChip :tone="dataLogin ? 'success' : 'neutral'">
                {{ dataLogin ? '已有缓存' : '暂无缓存' }}
              </UiChip>
            </div>
          </header>

          <div class="cache-scroll">
            <UiHint v-if="loading" block>
              正在读取本地缓存…
            </UiHint>
            <template v-else-if="dataLogin">
              <div class="kv-list">
                <UiKeyValue label="登录账号" label-width="88px">
                  {{ dataLogin.username || '—' }}
                </UiKeyValue>
                <UiKeyValue label="登录密码" label-width="88px" mono>
                  <span class="muted">应用 RSA 加密存储，工具不读取</span>
                </UiKeyValue>
                <UiKeyValue label="访问令牌" label-width="88px" mono>
                  {{ maskToken(dataLogin.accessToken) }}
                  <template #actions>
                    <UiButton link size="small" :disabled="!dataLogin.accessToken" @click="useCopy(dataLogin.accessToken, '令牌')">
                      复制
                    </UiButton>
                  </template>
                </UiKeyValue>
                <UiKeyValue label="访问有效期至" label-width="88px">
                  {{ fmtTime(dataLogin.accessExpiresAt) }}
                </UiKeyValue>
                <UiKeyValue label="刷新令牌" label-width="88px" mono>
                  {{ maskToken(dataLogin.refreshToken) }}
                  <template #actions>
                    <UiButton link size="small" :disabled="!dataLogin.refreshToken" @click="useCopy(dataLogin.refreshToken, '刷新令牌')">
                      复制
                    </UiButton>
                  </template>
                </UiKeyValue>
                <UiKeyValue label="刷新有效期至" label-width="88px">
                  {{ fmtTime(dataLogin.refreshExpiresAt) }}
                </UiKeyValue>
                <UiKeyValue label="用户编码" label-width="88px">
                  {{ userCode }}
                </UiKeyValue>
                <UiKeyValue label="用户名称" label-width="88px">
                  {{ userName }}
                </UiKeyValue>
                <UiKeyValue label="NameNode" label-width="88px" mono>
                  {{ dataLogin.nameNodeAddrs || '—' }}
                </UiKeyValue>
                <UiKeyValue label="会话快照" label-width="88px">
                  {{ dataLogin.snapshotExists ? '存在' : '无' }}
                </UiKeyValue>
              </div>
              <UiCollapse v-if="dataLogin.user" class="user-json">
                <UiCollapseItem name="user" title="用户信息 JSON">
                  <UiCodeBlock max-height="200px">
                    {{ JSON.stringify(dataLogin.user, null, 2) }}
                  </UiCodeBlock>
                </UiCollapseItem>
              </UiCollapse>
              <template v-if="favCount">
                <div class="fav-head">
                  <h3 class="fav-title">
                    收藏的转发
                  </h3>
                  <UiChip>{{ favCount }}</UiChip>
                  <span v-if="store.dataCache?.favoritesUpdatedAt" class="muted fav-backup">
                    备份于 {{ fmtTime(store.dataCache.favoritesUpdatedAt) }}
                  </span>
                </div>
                <UiTable
                  class="fav-table"
                  :data="favTree"
                  row-key="id"
                  :tree-props="{ children: 'children' }"
                  default-expand-all
                  max-height="440"
                  :row-class-name="favRowClass"
                >
                  <UiTableColumn prop="name" label="医院 / 转发" min-width="220" show-overflow-tooltip />
                  <UiTableColumn prop="sceneformal" label="环境" width="90" />
                  <UiTableColumn prop="accessPoint" label="接入点" min-width="150" show-overflow-tooltip />
                  <UiTableColumn prop="targetPoint" label="原地址" min-width="150" show-overflow-tooltip />
                </UiTable>
              </template>
              <UiHint v-else block>
                暂无收藏数据。
              </UiHint>
            </template>
            <UiEmpty
              v-else
              class="cache-empty"
              title="还没有 WXP 缓存"
              text="启动 WXP 并登录后自动采集，也可在左侧启动设置里手动读取。"
              center
              icon="layers"
            />
          </div>
        </section>
      </div>
    </ToolSurface>
  </div>
</template>

<style scoped lang="scss">
.wxp-enhancer-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.tb-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.tb-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
}

.tb-state.is-success {
  color: var(--color-success);

  .tb-dot {
    background: var(--color-success);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success) 14%, transparent);
  }
}

.tb-state.is-warning {
  color: var(--color-warning);

  .tb-dot {
    background: var(--color-warning);
  }
}

.tb-state.is-danger {
  color: var(--color-error);

  .tb-dot {
    background: var(--color-error);
  }
}

.wxp-surface {
  min-height: 0;
}

.form-studio {
  display: flex;
  flex: 1;
  min-height: 0;
}

.config-pane {
  display: flex;
  flex: 0 0 360px;
  flex-direction: column;
  width: 360px;
  min-width: 0;
  min-height: 0;
  padding: 16px;
  overflow-y: auto;
  border-right: 1px solid var(--color-border-light);
}

.pane-title {
  margin-bottom: 15px;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.result-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  flex: 0 0 48px;
  min-height: 48px;
  padding: 0 14px;
  border-bottom: 1px solid var(--color-border-light);

  > div:first-child {
    display: grid;
    min-width: 0;
    gap: 1px;
  }

  strong {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
  }

  span {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-xs);
  }
}

.result-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  min-width: 0;
}

.status-detail {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cache-scroll {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 14px;
  overflow: auto;
}

.config-form {
  display: flex;
  flex-direction: column;
  gap: 17px;
}

.form-item--last {
  margin-bottom: 0;
}

.ui-port-input {
  width: 120px;
  height: var(--control-height);
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-field);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-sm);

  &:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--color-primary) 38%, var(--color-border));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 12%, transparent);
  }
}

.pane-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-light);
}

.pane-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-sm);

  > div {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  strong {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
  }

  span {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-xs);
    line-height: 1.45;
  }
}

.pane-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.config-actions {
  display: flex;
  margin-top: var(--spacing-md);
  padding-top: var(--spacing-md);
  border-top: 1px solid var(--color-border-light);

  .ui-button {
    width: 100%;
  }
}

.legal-hint {
  margin-top: auto;
  padding-top: 22px;
}

.kv-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: var(--spacing-3xl);
  margin-bottom: 14px;
}

.kv-list :deep(.ui-kv-value) {
  word-break: break-all;
}

.user-json {
  margin-bottom: 14px;
}

.fav-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--spacing-sm);
  margin: 16px 0 8px;
}

.fav-title {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.fav-backup {
  font-size: var(--font-size-sm);
}

.fav-table :deep(.fav-hospital-row) {
  font-weight: var(--font-weight-medium);
}

.cache-empty {
  min-height: 240px;
}

@media (max-width: 1180px) {
  .config-pane {
    flex-basis: 320px;
    width: 320px;
  }
}
</style>
