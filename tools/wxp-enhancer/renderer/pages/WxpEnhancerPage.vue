<script setup lang="ts">
import type { WxpRunningStatus } from '../../../../shared/wxp'
import { isElectronEnvironment } from '@renderer/shared/environment'
import { confirm } from '@renderer/shared/feedback'
import { toast } from 'vue-sonner'
import ToolSideInspector from '../../../../renderer/shared/components/workspace/ToolSideInspector.vue'
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import WorkspaceHeader from '../../../../renderer/shared/components/workspace/WorkspaceHeader.vue'
import { useCopy } from '../../../../renderer/shared/composables/useClipboard'
import { DEFAULT_WXP_SETTINGS } from '../../../../shared/wxp'
import { normalizeWxpLinkFavorites } from '../../../../shared/wxp-favorite'
import { useWxpEnhancerStore } from '../stores/wxpEnhancerStore'

const store = useWxpEnhancerStore()
const isElectron = isElectronEnvironment()

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
const settingsDirty = ref(false)
const loading = ref(true)
const launching = ref(false)
const stopping = ref(false)
const saving = ref(false)
const clearing = ref(false)
const settingsOpen = ref(true)

let syncingForm = false

function syncSettingsForm(): void {
  syncingForm = true
  Object.assign(settingsForm, store.settings)
  nextTick(() => {
    syncingForm = false
  })
}

watch(settingsForm, () => {
  if (!syncingForm) settingsDirty.value = true
})

const isRunning = computed(() => Boolean(store.running && ACTIVE_STATUSES.includes(store.running.status)))
/** 已连上 CDP 并完成首轮注入：数据采集 / 清除登录缓存只在这个状态下真正作用到页面 */
const isConnected = computed(() => store.running?.status === 'running')
/** 启动设置区（字段 + 浏览 / 自动检测 / 保存）的锁定判据：点下启动起、到停止完成为止全程只读，
 *  回到「已停止」才放开。错误态不锁——那正是要改路径 / 端口再重试的时候，锁住就无路可走。 */
const settingsLocked = computed(() => isRunning.value || launching.value || stopping.value)
const statusLabel = computed(() => {
  if (loading.value && !store.running) return '读取中…'
  if (!store.running) return '未运行'
  return STATUS_LABELS[store.running.status] ?? store.running.status
})
/** 状态行尾的过程 / 错误说明：运行中恒为空，状态卡在「启动 → 运行中」全程只有一行，高度不跳 */
const statusDetail = computed(() => {
  const running = store.running
  if (!running || running.status === 'running') return ''
  return running.message ?? ''
})
/** 状态点色板：运行绿 / 过渡态黄 / 失败红 / 未运行与已停止灰（UiStatusTag 没有 info 档，用 neutral） */
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
    await store.saveSettings({ ...settingsForm })
    settingsDirty.value = false
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

async function saveSettings(): Promise<void> {
  if (!settingsForm.executablePath.trim()) {
    toast.warning('请先选择 WXP 可执行文件')
    return
  }
  saving.value = true
  try {
    await store.saveSettings({ ...settingsForm })
    settingsDirty.value = false
    toast.success('设置已保存')
  } catch (error) {
    toast.error((error as Error).message || '保存失败')
  } finally {
    saving.value = false
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
  unsubscribeStatus?.()
  if (isRunning.value) void store.stop().catch(() => undefined)
})
</script>

<template>
  <div class="wxp-enhancer-page tool-page">
    <WorkspaceHeader
      icon="wxpEnhancer"
      title="WXP 增强"
      description="启动 WXP、注入增强脚本，并把登录信息与收藏缓存在本机"
      :status-label="statusLabel"
      :status-tone="statusTone"
    >
      <template #actions>
        <UiButton size="small" @click="settingsOpen = !settingsOpen">
          {{ settingsOpen ? '收起设置' : '启动设置' }}
        </UiButton>
        <UiGroup v-if="!isRunning" gap="xs">
          <UiButton
            type="primary"
            :loading="launching"
            :disabled="loading"
            @click="handleLaunch"
          >
            启动
          </UiButton>
          <span class="launch-warn" tabindex="0" aria-label="启动前请先退出已打开的 WXP" title="启动前请先退出已打开的 WXP">
            <UiIcon name="alert" :size="16" />
          </span>
        </UiGroup>
        <UiButton
          v-else
          type="warning"
          plain
          :loading="stopping"
          @click="handleStop"
        >
          停止
        </UiButton>
      </template>
    </WorkspaceHeader>

    <ToolSurface class="wxp-surface">
      <template #toolbar>
        <UiToolbar gap="sm" flush>
          <span class="surface-label" role="status" aria-live="polite">
            {{ statusLabel }}
          </span>
          <UiGroup v-if="isConnected" gap="xs" wrap>
            <UiChip mono>
              PID {{ store.running?.pid ?? '-' }}
            </UiChip>
            <UiChip mono>
              端口 {{ store.running?.port }}
            </UiChip>
            <UiChip mono>
              页面 {{ store.running?.targetCount ?? 0 }}
            </UiChip>
          </UiGroup>
          <UiChip v-else-if="store.loginCacheClearPending" tone="warning">
            登录缓存待清除
          </UiChip>
          <span v-if="statusDetail" class="status-detail">{{ statusDetail }}</span>
          <template #end>
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
          </template>
        </UiToolbar>
      </template>

      <div class="wxp-studio">
        <ToolSideInspector
          :open="settingsOpen"
          title="启动设置"
          :width="320"
          side="left"
          body-padding="14px"
          @close="settingsOpen = false"
        >
          <template #actions>
            <UiButton
              size="small"
              type="primary"
              plain
              :loading="saving"
              :disabled="settingsLocked || !settingsDirty || saving"
              @click="saveSettings"
            >
              保存
            </UiButton>
          </template>
          <div class="config-form">
            <UiFormField label-width="82px" label="WXP 路径" required>
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
            <UiFormField label-width="82px" label="调试端口">
              <input
                v-model="settingsForm.debugPort"
                type="number"
                :min="1024"
                :max="65535"
                :disabled="settingsLocked"
                class="ui-port-input"
                @change="settingsForm.debugPort = Math.min(65535, Math.max(1024, Math.round(Number(settingsForm.debugPort) || 1024)))"
              >
            </UiFormField>
            <UiFormField label-width="82px" label="状态角标">
              <UiSwitchField
                v-model="settingsForm.showStatusBadge"
                align="start"
                :disabled="settingsLocked"
              >
                WXP 顶栏显示「增强中」呼吸灯
              </UiSwitchField>
            </UiFormField>
            <UiFormField label-width="82px" label="缓存登录">
              <UiSwitchField
                v-model="settingsForm.cacheLogin"
                align="start"
                :disabled="settingsLocked"
              >
                登录一次后缓存会话
              </UiSwitchField>
            </UiFormField>
            <UiFormField label-width="82px" label="额外参数" class="form-item--last">
              <UiInput
                v-model="settingsForm.extraArgs"
                placeholder="如 --lang=zh-CN；端口会自动附加"
                :disabled="settingsLocked"
                class="mono"
                spellcheck="false"
              />
            </UiFormField>
            <UiHint block>
              启动前请先退出已打开的 WXP；关闭本工具会停止由 edt 托管的会话。
            </UiHint>
          </div>
        </ToolSideInspector>

        <section class="wxp-main">
          <header class="cache-head">
            <div>
              <strong>WXP 数据缓存</strong>
              <span v-if="store.dataCache">采集于 {{ fmtTime(store.dataCache.collectedAt) }}</span>
              <span v-else>登录后自动采集，也可手动读取</span>
            </div>
            <UiChip :tone="dataLogin ? 'success' : 'neutral'">
              {{ dataLogin ? '已有缓存' : '暂无缓存' }}
            </UiChip>
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
              text="启动 WXP 并登录后自动采集，也可以点击「从 WXP 读取」手动刷新。"
              center
              icon="layers"
            />
          </div>
        </section>
      </div>

      <template #statusline>
        <span>WXP ENHANCER</span>
        <span v-if="store.dataCache?.favoritesUpdatedAt">收藏备份 {{ fmtTime(store.dataCache.favoritesUpdatedAt) }}</span>
        <span class="status-spacer" />
        <span>{{ settingsOpen ? 'SETTINGS OPEN' : 'SETTINGS HIDDEN' }}</span>
      </template>
    </ToolSurface>
  </div>
</template>

<style scoped lang="scss">
.wxp-enhancer-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0 18px 18px;
  overflow: hidden;
}

.wxp-surface {
  min-height: 0;
}

.surface-label {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.status-detail {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wxp-studio {
  display: flex;
  flex: 1;
  gap: 12px;
  min-height: 0;
  padding: 12px;
}

.wxp-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-fill) 28%, transparent);
}

.cache-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  flex: 0 0 50px;
  min-height: 50px;
  padding: 0 14px;
  border-bottom: 1px solid var(--color-border-light);

  > div {
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
  gap: 15px;
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

.launch-warn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-warning);
  cursor: help;
  border-radius: 50%;
  transition: color var(--transition-fast);
}

.launch-warn:hover {
  color: var(--color-text-primary);
}

.launch-warn:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
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

.status-spacer {
  flex: 1;
}
</style>
