<script setup lang="ts">
import type { WxpRunningStatus } from '../../../shared/wxp'
import { DEFAULT_WXP_SETTINGS } from '../../../shared/wxp'
import { normalizeWxpLinkFavorites } from '../../../shared/wxp-favorite'
import { useCopy } from '../../../src/shared/composables/useClipboard'
import { useWxpEnhancerStore } from '../stores/wxpEnhancerStore'

const store = useWxpEnhancerStore()

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
const reinjecting = ref(false)
const saving = ref(false)
const clearing = ref(false)

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
/** 已连上 CDP 并完成首轮注入：重新应用 / 采集数据只在这个状态下可用 */
const isConnected = computed(() => store.running?.status === 'running')
const statusLabel = computed(() => {
  if (loading.value && !store.running) return '读取中…'
  if (!store.running) return '未运行'
  return STATUS_LABELS[store.running.status] ?? store.running.status
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
    ElMessage.warning('请先选择 WXP 可执行文件')
    return
  }
  launching.value = true
  try {
    await store.saveSettings({ ...settingsForm })
    settingsDirty.value = false
    await store.launch()
    ElMessage.success('WXP 已启动，增强脚本已注入')
  } catch (error) {
    ElMessage.error((error as Error).message || '启动失败')
  } finally {
    launching.value = false
  }
}

async function handleStop(): Promise<void> {
  stopping.value = true
  try {
    await store.stop()
  } catch (error) {
    ElMessage.error((error as Error).message || '停止失败')
  } finally {
    stopping.value = false
  }
}

async function handleReinject(): Promise<void> {
  reinjecting.value = true
  try {
    const count = await store.reinject()
    ElMessage.success(`已重新注入（${count} 个页面）`)
  } catch (error) {
    ElMessage.error((error as Error).message || '重新应用失败')
  } finally {
    reinjecting.value = false
  }
}

async function handleClearLoginCache(): Promise<void> {
  // 只有「已连上 CDP」才会真正清页面；其余状态后端只登记待清除标记
  const runningNow = isConnected.value
  const confirmText = runningNow
    ? '将清除缓存的登录会话（快照/镜像）并刷新页面回到登录状态，需要重新登录。确定继续？'
    : 'WXP 未在运行：将登记清除标记，下次启动 WXP 时自动清除登录缓存并回到登录页。确定继续？'
  try {
    await ElMessageBox.confirm(confirmText, '清除登录缓存', {
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
      ElMessage.success('已登记，将在下次启动 WXP 时自动清除登录缓存')
    } else {
      ElMessage.success(`已清除登录缓存（${result.pages} 个页面），请重新登录`)
    }
  } catch (error) {
    ElMessage.error((error as Error).message || '清除登录缓存失败')
  } finally {
    clearing.value = false
  }
}

// —— 数据缓存（来自 WXP） ——
const collecting = ref(false)
const dataLogin = computed(() => store.dataCache?.login ?? null)
// 用户信息 JSON 的折叠面板不吃 el 控件底：EP 的折叠头 / 内容包裹层默认取
// --el-fill-color-blank（本仓库绑到 --color-input），在玻璃面板上会显成一条白带。
// 直接覆写 EP 自己的两个变量，比 :deep 改内部类更稳；--color-canvas 恒为 transparent。
const collapseTransparentStyle = {
  '--el-collapse-header-bg-color': 'var(--color-canvas)',
  '--el-collapse-content-bg-color': 'var(--color-canvas)',
}
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
    ElMessage.success('已从 WXP 读取并缓存')
  } catch (error) {
    ElMessage.error((error as Error).message || '读取失败')
  } finally {
    collecting.value = false
  }
}

async function pickExecutable(): Promise<void> {
  try {
    const path = await store.selectExecutable()
    if (path) settingsForm.executablePath = path
  } catch (error) {
    ElMessage.error((error as Error).message || '选择可执行文件失败')
  }
}

async function detectExecutable(): Promise<void> {
  try {
    const path = await store.detectExecutable()
    if (path) {
      settingsForm.executablePath = path
      ElMessage.success(`已检测到：${path}`)
    } else {
      ElMessage.info('未在常见安装位置找到 WXP，请手动选择')
    }
  } catch (error) {
    ElMessage.error((error as Error).message || '自动检测失败')
  }
}

async function saveSettings(): Promise<void> {
  if (!settingsForm.executablePath.trim()) {
    ElMessage.warning('请先选择 WXP 可执行文件')
    return
  }
  saving.value = true
  try {
    await store.saveSettings({ ...settingsForm })
    settingsDirty.value = false
    ElMessage.success('设置已保存')
  } catch (error) {
    ElMessage.error((error as Error).message || '保存失败')
  } finally {
    saving.value = false
  }
}

let unsubscribeStatus: (() => void) | null = null

onMounted(async () => {
  try {
    unsubscribeStatus = store.bindStatusEvents()
    await store.load()
  } catch (error) {
    ElMessage.error((error as Error).message || '读取 WXP 增强设置失败')
  } finally {
    syncSettingsForm()
    loading.value = false
  }
})

onUnmounted(() => {
  unsubscribeStatus?.()
})
</script>

<template>
  <div class="wxp-enhancer-page tool-page">
    <!-- 运行状态 -->
    <UiPanel class="status-card">
      <div class="status-info">
        <div class="status-line" role="status" aria-live="polite">
          <UiStatusTag :tone="statusTone" :pulsing="statusTone === 'success'" />
          <span class="status-name">{{ statusLabel }}</span>
        </div>
        <p v-if="store.running?.message" class="status-message">
          {{ store.running.message }}
        </p>
        <UiGroup v-if="isRunning" gap="xs" wrap class="status-meta">
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
        <UiGroup v-else-if="store.loginCacheClearPending" gap="xs" wrap class="status-meta">
          <UiChip tone="warning">
            登录缓存待清除：下次启动时自动执行
          </UiChip>
        </UiGroup>
      </div>
      <UiGroup gap="sm" wrap class="status-actions">
        <el-button v-if="isConnected" :loading="reinjecting" @click="handleReinject">
          重新应用
        </el-button>
        <el-button
          type="primary"
          :loading="launching"
          :disabled="isRunning || loading"
          @click="handleLaunch"
        >
          启动
        </el-button>
        <el-button
          type="warning"
          plain
          :loading="stopping"
          :disabled="!isRunning"
          @click="handleStop"
        >
          停止
        </el-button>
      </UiGroup>
    </UiPanel>

    <!-- 启动设置 -->
    <UiPanel title="启动设置">
      <template #actions>
        <el-button
          size="small"
          type="primary"
          plain
          :loading="saving"
          :disabled="!settingsDirty || saving"
          @click="saveSettings"
        >
          保存设置
        </el-button>
      </template>
      <el-form label-width="110px">
        <el-form-item label="WXP 路径" required>
          <UiPathField
            v-model="settingsForm.executablePath"
            placeholder="选择 WxP Client 可执行文件（如 WxP Client.exe）"
            :disabled="isRunning"
            class="path-row"
            mono
          >
            <template #actions>
              <el-button :disabled="isRunning" @click="pickExecutable">
                浏览
              </el-button>
              <el-button :disabled="isRunning" @click="detectExecutable">
                自动检测
              </el-button>
            </template>
          </UiPathField>
          <UiHint block>
            使用 WXP 自身数据启动：登录一次后保持登录，再次启动直接进入应用主页；
            启动前请先退出已打开的 WXP（单实例应用）。
          </UiHint>
        </el-form-item>
        <el-form-item label="调试端口">
          <el-input-number
            v-model="settingsForm.debugPort"
            :min="1024"
            :max="65535"
            :disabled="isRunning"
          />
        </el-form-item>
        <el-form-item label="状态角标">
          <UiSwitchField v-model="settingsForm.showStatusBadge" align="start">
            在 WXP 顶栏页签后、用户名前显示「增强中」呼吸灯，保存后立即生效
          </UiSwitchField>
        </el-form-item>
        <el-form-item label="缓存登录状态">
          <UiSwitchField v-model="settingsForm.cacheLogin" align="start">
            登录一次后整体缓存会话（14 天有效），启动时自动还原并补跑登录后初始化（租户列表 / NameNode / iframe SSO）；超期需重新登录
          </UiSwitchField>
        </el-form-item>
        <el-form-item label="额外启动参数">
          <el-input
            v-model="settingsForm.extraArgs"
            placeholder="可选，空格分隔，如 --lang=zh-CN；调试端口会自动附加"
            :disabled="isRunning"
            class="mono"
            spellcheck="false"
          />
        </el-form-item>
      </el-form>
      <UiHint block>
        路径 / 端口 / 额外参数在下次启动时生效；角标与缓存开关保存后立即生效（运行中会用新脚本重新注入）。
        调试端口会作为 <span class="mono">--remote-debugging-port</span> 附加，被其他程序占用时启动会失败并提示更换。
      </UiHint>
    </UiPanel>

    <!-- 数据缓存（来自 WXP） -->
    <UiPanel title="数据缓存（来自 WXP）">
      <template #actions>
        <UiGroup gap="sm" wrap>
          <span v-if="store.dataCache" class="muted">采集于 {{ fmtTime(store.dataCache.collectedAt) }}</span>
          <el-button
            size="small"
            type="danger"
            plain
            :loading="clearing"
            @click="handleClearLoginCache"
          >
            清除登录缓存
          </el-button>
          <el-button
            size="small"
            type="primary"
            plain
            :loading="collecting"
            :disabled="!isConnected"
            @click="handleCollect"
          >
            从 WXP 读取
          </el-button>
        </UiGroup>
      </template>
      <UiHint class="section-hint">
        WXP 登录后自动把登录信息与收藏缓存到 <span class="mono">data-cache.json</span>（收藏变化或每 5 分钟刷新）；
        WXP 未运行时仍显示上次结果。收藏备份会在 WXP 重装 / 清缓存后自动补回。
      </UiHint>
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
              <el-button link size="small" :disabled="!dataLogin.accessToken" @click="useCopy(dataLogin.accessToken, '令牌')">
                复制
              </el-button>
            </template>
          </UiKeyValue>
          <UiKeyValue label="访问有效期至" label-width="88px">
            {{ fmtTime(dataLogin.accessExpiresAt) }}
          </UiKeyValue>
          <UiKeyValue label="刷新令牌" label-width="88px" mono>
            {{ maskToken(dataLogin.refreshToken) }}
            <template #actions>
              <el-button link size="small" :disabled="!dataLogin.refreshToken" @click="useCopy(dataLogin.refreshToken, '刷新令牌')">
                复制
              </el-button>
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
        <el-collapse v-if="dataLogin.user" class="user-json" :style="collapseTransparentStyle">
          <el-collapse-item name="user" title="用户信息 JSON">
            <UiCodeBlock max-height="240px">
              {{ JSON.stringify(dataLogin.user, null, 2) }}
            </UiCodeBlock>
          </el-collapse-item>
        </el-collapse>
        <template v-if="favCount">
          <div class="fav-head">
            <h4 class="fav-title">
              收藏的转发（{{ favCount }}）
            </h4>
            <span v-if="store.dataCache?.favoritesUpdatedAt" class="muted fav-backup">
              工具侧备份于 {{ fmtTime(store.dataCache.favoritesUpdatedAt) }}
            </span>
          </div>
          <UiTable
            class="fav-table"
            :data="favTree"
            row-key="id"
            :tree-props="{ children: 'children' }"
            default-expand-all
            max-height="420"
            :row-class-name="favRowClass"
          >
            <el-table-column prop="name" label="医院 / 转发" min-width="200" show-overflow-tooltip />
            <el-table-column prop="sceneformal" label="环境" width="90" />
            <el-table-column prop="accessPoint" label="接入点" min-width="140" show-overflow-tooltip />
            <el-table-column prop="targetPoint" label="原地址" min-width="140" show-overflow-tooltip />
          </UiTable>
        </template>
        <UiHint v-else block>
          暂无收藏数据。
        </UiHint>
      </template>
      <UiHint v-else block>
        尚未读取，启动 WXP 并登录后自动采集，也可点击「从 WXP 读取」手动刷新。
      </UiHint>
    </UiPanel>
  </div>
</template>

<style scoped lang="scss">
.wxp-enhancer-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-xl) var(--spacing-2xl) var(--spacing-2xl);
}

/* 状态卡：UiPanel 根上的左右分栏；窄窗口由媒体查询改成上下 */
.status-card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.status-info {
  flex: 1;
  min-width: 0;
}

.status-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.status-name {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
}

/* 状态详情走正文而不是 tag：错误信息可能很长，tag 会把标题行撑破 */
.status-message {
  margin: var(--spacing-xs) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.4;
  word-break: break-word;
}

.status-meta {
  margin-top: var(--spacing-sm);
}

.status-actions {
  flex-shrink: 0;
}

.section-hint {
  margin: 0 0 var(--spacing-md);
}

/* 登录信息分两栏：按行配对（账号|密码、令牌|有效期…），窄窗口回退单栏。
   UiKeyValue 自带 top 分隔线 + padding，行间不再加 gap，保持原列表节奏；
   列间距取页面级 24px，让两栏之间有明确的呼吸感。 */
.kv-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: var(--spacing-3xl);
  margin-bottom: var(--spacing-md);
}

/* 原 .kv-value.break：长令牌 / 地址在窄容器内断行 */
.kv-list :deep(.ui-kv-value) {
  word-break: break-all;
}

.user-json {
  margin-bottom: var(--spacing-md);
}

.fav-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--spacing-sm);
  margin: var(--spacing-md) 0 var(--spacing-sm);
}

.fav-title {
  margin: 0;
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
}

.fav-backup {
  font-size: var(--font-size-sm);
}

.fav-table :deep(.fav-hospital-row) {
  font-weight: var(--font-weight-semibold);
}

/* 收藏表嵌在玻璃面板里：EP 表格默认把行底铺成 --el-fill-color-blank（本仓库 = --color-input，
   白色 .88），在 raised 面板上就是一块比面板还亮的大白块。这里让表格自身不铺底
   （行直接透出面板），表头也不压灰底、只留一条 hairline；hover 用品牌浅底而不是灰调填充，
   避免整行变“实心灰条”。 */
.fav-table {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-expanded-cell-bg-color: transparent;
  --el-table-header-bg-color: transparent;
  --el-table-row-hover-bg-color: var(--color-primary-soft);
  --el-table-border-color: var(--color-border-light);
}

@media (max-width: 760px) {
  .wxp-enhancer-page {
    padding: var(--spacing-md);
  }

  .status-card {
    align-items: stretch;
    flex-direction: column;
  }

  .path-row {
    align-items: stretch;
    flex-direction: column;
  }

  .kv-list {
    grid-template-columns: 1fr;
  }
}
</style>
