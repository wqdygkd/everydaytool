<script setup lang="ts">
import type { WxpRunningStatus } from '../../../../shared/wxp'
import { useCopy } from '../../../../renderer/shared/composables/useClipboard'
import { DEFAULT_WXP_SETTINGS } from '../../../../shared/wxp'
import { normalizeWxpLinkFavorites } from '../../../../shared/wxp-favorite'
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
        <!-- 状态卡只有这一行：状态点 + 状态名 / 运行事实 / 过程说明 / 待清除提示都排在同行，
             任何状态都不额外增行，避免启动过程中卡片高度跳动。 -->
        <div class="status-line">
          <!-- aria-live 只包状态文字：PID / 端口 / 页面随轮询变动，不该被反复朗读 -->
          <div class="status-head" role="status" aria-live="polite">
            <UiStatusTag :tone="statusTone" :pulsing="statusTone === 'success'" />
            <span class="status-name">{{ statusLabel }}</span>
          </div>
          <!-- 运行事实（已连上 CDP 才给）：PID / 端口 / 页面 -->
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
          <UiGroup v-else-if="store.loginCacheClearPending" gap="xs" wrap>
            <UiChip tone="warning">
              登录缓存待清除：下次启动时自动执行
            </UiChip>
          </UiGroup>
          <span v-if="statusDetail" class="status-detail">{{ statusDetail }}</span>
        </div>
      </div>
      <UiGroup gap="sm" wrap class="status-actions">
        <!-- 启动 / 停止互斥：同一时刻只露出一个（未启动只有启动，运行中只有停止）。
             两个按钮都是两字 + 同尺寸，「!」跟着启动钮一起出现，切换时按钮不跳动。 -->
        <UiGroup v-if="!isRunning" gap="xs">
          <el-button
            type="primary"
            :loading="launching"
            :disabled="loading"
            @click="handleLaunch"
          >
            启动
          </el-button>
          <!-- 单实例约束紧贴启动钮：原正文里的那句说明收在这里，只在 hover / 聚焦时展开 -->
          <el-tooltip content="启动前请先退出已打开的 WXP" placement="top">
            <span class="launch-warn" tabindex="0" aria-label="启动前请先退出已打开的 WXP">
              <UiIcon name="alert" :size="16" />
            </span>
          </el-tooltip>
        </UiGroup>
        <el-button
          v-else
          type="warning"
          plain
          :loading="stopping"
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
          :disabled="settingsLocked || !settingsDirty || saving"
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
            :disabled="settingsLocked"
            class="path-row"
            mono
          >
            <template #actions>
              <el-button :disabled="settingsLocked" @click="pickExecutable">
                浏览
              </el-button>
              <el-button :disabled="settingsLocked" @click="detectExecutable">
                自动检测
              </el-button>
            </template>
          </UiPathField>
        </el-form-item>
        <el-form-item label="调试端口">
          <el-input-number
            v-model="settingsForm.debugPort"
            :min="1024"
            :max="65535"
            :disabled="settingsLocked"
          />
        </el-form-item>
        <el-form-item label="状态角标">
          <UiSwitchField
            v-model="settingsForm.showStatusBadge"
            align="start"
            :disabled="settingsLocked"
          >
            在 WXP 顶栏页签后、用户名前显示「增强中」呼吸灯，保存后立即生效
          </UiSwitchField>
        </el-form-item>
        <el-form-item label="缓存登录状态">
          <UiSwitchField
            v-model="settingsForm.cacheLogin"
            align="start"
            :disabled="settingsLocked"
          >
            登录一次后整体缓存会话（14 天有效），启动时自动还原并补跑登录后初始化（租户列表 / NameNode / iframe SSO）；超期需重新登录
          </UiSwitchField>
        </el-form-item>
        <el-form-item label="额外启动参数" class="form-item--last">
          <el-input
            v-model="settingsForm.extraArgs"
            placeholder="可选，空格分隔，如 --lang=zh-CN；调试端口会自动附加"
            :disabled="settingsLocked"
            class="mono"
            spellcheck="false"
          />
        </el-form-item>
      </el-form>
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
/* 全宽铺满窗口，不设 760 内容栏：本页的 WXP 路径、启动参数、登录信息键值与收藏表格
   都吃宽度，居中窄栏在宽窗口下两侧空一大片。面板宽度跟随窗口，面板内部的呼吸仍由
   各面板自己的 16 内边距负责（DESIGN §7.3 的「文档型全宽变体」）。 */
.wxp-enhancer-page {
  display: flex;
  flex-direction: column;
  /* 区块之间 2xl：状态卡 / 设置面板 / 说明是**同级区块**，
     要和面板内部的标题→内容（12）与字段间距（8）拉开层级 */
  gap: var(--spacing-2xl);
  padding: var(--spacing-2xl) var(--spacing-3xl) var(--spacing-3xl);
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

/* 面板里最后一个表单项清掉 EP 默认的 18px 底 margin：它会叠在 UiPanel 的 16px
   内边距上，底部比顶部多空出一块（表单本身没有收尾间隔的需要） */
.form-item--last {
  margin-bottom: 0;
}

.status-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

/* 状态点 + 文案作为一个整体（aria-live 作用域），与后面的 PID / 端口 / 页面同行 */
.status-head {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.status-name {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-medium);
}

/* 状态行尾的过程 / 错误说明：跟在状态文字后面同行，过长时在本行内折行，
   不再单独占一行（错误信息可能好几行：1.5 行距才读得下去，DESIGN §3.2.4 的说明档） */
.status-detail {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.5;
  word-break: break-word;
}

.status-actions {
  flex-shrink: 0;
}

/* 启动钮后的「!」：只做可 hover / 可聚焦的提示标记，不抢主按钮的注意力。
   图标是 16px 的线性 SVG，色取 warning（白底 5.28，达标）；聚焦时给同款焦点环。 */
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
  font-weight: var(--font-weight-medium);
}

.fav-backup {
  font-size: var(--font-size-sm);
}

.fav-table :deep(.fav-hospital-row) {
  font-weight: var(--font-weight-medium);
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
    gap: var(--spacing-lg);
    padding: var(--spacing-lg);
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
