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
const launching = ref(false)
const stopping = ref(false)

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
const statusLabel = computed(() => {
  if (!store.running) return '未运行'
  return STATUS_LABELS[store.running.status] ?? store.running.status
})
const statusTagType = computed(() => {
  const status = store.running?.status
  if (status === 'running') return 'success'
  if (status === 'error') return 'danger'
  if (status) return 'warning'
  return 'info'
})
/** 状态点色板：UiStatusTag 无 info 档，「未运行」落 neutral（ tertiary 灰点） */
const statusDotTone = computed(() => (statusTagType.value === 'info' ? 'neutral' : statusTagType.value))

async function handleLaunch(): Promise<void> {
  launching.value = true
  try {
    await store.saveSettings({ ...settingsForm })
    settingsDirty.value = false
    await store.launch()
    ElMessage.success('启动成功，脚本注入已生效')
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
  try {
    const count = await store.reinject()
    ElMessage.success(`已重新注入（${count} 个页面）`)
  } catch (error) {
    ElMessage.error((error as Error).message || '重新应用失败')
  }
}

async function handleClearLoginCache(): Promise<void> {
  const runningNow = isRunning.value
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
  try {
    const result = await store.clearLoginCache()
    if (result.pending) {
      ElMessage.success('已登记，将在下次启动 WXP 时自动清除登录缓存')
    } else {
      ElMessage.success(`已清除登录缓存（${result.pages} 个页面），请重新登录`)
    }
  } catch (error) {
    ElMessage.error((error as Error).message || '清除登录缓存失败')
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
    ElMessage.success('已从 WXP 读取并缓存')
  } catch (error) {
    ElMessage.error((error as Error).message || '读取失败')
  } finally {
    collecting.value = false
  }
}

async function pickExecutable(): Promise<void> {
  const path = await store.selectExecutable()
  if (path) {
    settingsForm.executablePath = path
    settingsDirty.value = true
  }
}

async function detectExecutable(): Promise<void> {
  const path = await store.detectExecutable()
  if (path) {
    settingsForm.executablePath = path
    settingsDirty.value = true
    ElMessage.success(`已检测到：${path}`)
  } else {
    ElMessage.info('未在常见安装位置找到 WXP，请手动选择')
  }
}

async function saveSettings(): Promise<void> {
  try {
    await store.saveSettings({ ...settingsForm })
    settingsDirty.value = false
    ElMessage.success('设置已保存')
  } catch (error) {
    ElMessage.error((error as Error).message || '保存失败')
  }
}

let unsubscribeStatus: (() => void) | null = null

onMounted(async () => {
  unsubscribeStatus = store.bindStatusEvents()
  await store.load()
  syncSettingsForm()
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
        <div class="status-line">
          <UiStatusTag :tone="statusDotTone" :pulsing="statusTagType === 'success'" />
          <span class="status-name">{{ statusLabel }}</span>
          <el-tag v-if="store.running" :type="statusTagType" size="small">
            {{ store.running.message || '—' }}
          </el-tag>
        </div>
        <UiGroup v-if="isRunning" gap="xs" class="status-meta">
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
        <UiGroup v-else-if="store.loginCacheClearPending" gap="xs" class="status-meta">
          <UiChip>
            登录缓存待清除：下次启动时自动执行
          </UiChip>
        </UiGroup>
      </div>
      <UiGroup gap="sm" class="status-actions">
        <el-button @click="handleClearLoginCache">
          清除登录缓存
        </el-button>
        <el-button v-if="isRunning" @click="handleReinject">
          重新应用
        </el-button>
        <el-button
          type="primary"
          :loading="launching"
          :disabled="isRunning"
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
          :disabled="!settingsDirty"
          @click="saveSettings"
        >
          保存设置
        </el-button>
      </template>
      <el-form label-width="110px">
        <el-form-item label="WXP 路径" required>
          <UiPathField
            v-model="settingsForm.executablePath"
            placeholder="例如 C:\Users\你\AppData\Local\Programs\Wxp Client\WxP Client.exe"
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
          <UiSwitchField v-model="settingsForm.showStatusBadge">
            在 WXP 顶栏页签后、用户名前显示「增强中」呼吸灯，保存后立即生效
          </UiSwitchField>
        </el-form-item>
        <el-form-item label="缓存登录状态">
          <UiSwitchField v-model="settingsForm.cacheLogin">
            登录一次后整体缓存会话，启动时还原并自动进入主页、补跑登录后的数据初始化（链接中心租户列表、代理 NameNode、中心页 SSO）；快照超期（14 天）则不自动进入，需重新登录
          </UiSwitchField>
        </el-form-item>
        <el-form-item label="额外启动参数">
          <el-input
            v-model="settingsForm.extraArgs"
            placeholder="可选，空格分隔，如 --lang=zh-CN；调试端口会自动附加"
            :disabled="isRunning"
            class="mono"
          />
        </el-form-item>
      </el-form>
    </UiPanel>

    <!-- 数据缓存（来自 WXP） -->
    <UiPanel title="数据缓存（来自 WXP）">
      <template #actions>
        <UiGroup gap="sm">
          <span v-if="store.dataCache" class="muted">采集于 {{ fmtTime(store.dataCache.collectedAt) }}</span>
          <el-button
            size="small"
            type="primary"
            plain
            :loading="collecting"
            :disabled="!isRunning"
            @click="handleCollect"
          >
            从 WXP 读取
          </el-button>
        </UiGroup>
      </template>
      <UiHint class="section-hint">
        WXP 登录后自动把登录信息与收藏数据缓存到工具数据目录（data-cache.json），此处查看；收藏变化或每 5 分钟自动刷新，也可手动刷新。WXP 未运行时仍可查看上次采集结果。
      </UiHint>
      <template v-if="dataLogin">
        <div class="kv-list">
          <UiKeyValue label="登录账号" label-width="88px">
            {{ dataLogin.username || '—' }}
          </UiKeyValue>
          <UiKeyValue label="登录密码" label-width="88px" mono>
            <span class="muted">应用 RSA 加密存储，工具不读取</span>
          </UiKeyValue>
          <UiKeyValue label="访问令牌" label-width="88px" mono>
            {{ dataLogin.accessToken || '—' }}
            <template #actions>
              <el-button link size="small" @click="useCopy(dataLogin.accessToken, '令牌')">
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
              <el-button link size="small" @click="useCopy(dataLogin.refreshToken, '刷新令牌')">
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
          <UiKeyValue label="状态源" label-width="88px" mono>
            {{ dataLogin.statusQueryServers || '—' }}
          </UiKeyValue>
          <UiKeyValue label="会话快照" label-width="88px">
            {{ dataLogin.snapshotExists ? '存在' : '无' }}
          </UiKeyValue>
        </div>
        <el-collapse v-if="dataLogin.user" class="user-json">
          <el-collapse-item name="user" title="用户信息 JSON">
            <UiCodeBlock max-height="240px">
              {{ JSON.stringify(dataLogin.user, null, 2) }}
            </UiCodeBlock>
          </el-collapse-item>
        </el-collapse>
        <template v-if="favCount">
          <h4 class="fav-title">
            收藏的转发（{{ favCount }}）
            <span v-if="store.dataCache?.favoritesUpdatedAt" class="muted">工具侧备份于 {{ fmtTime(store.dataCache.favoritesUpdatedAt) }}，WXP 重装/清缓存后自动恢复</span>
          </h4>
          <el-table
            class="fav-table"
            :data="favTree"
            row-key="id"
            :tree-props="{ children: 'children' }"
            default-expand-all
            size="small"
            max-height="420"
            :row-class-name="favRowClass"
          >
            <el-table-column prop="name" label="医院 / 转发" min-width="200" show-overflow-tooltip />
            <el-table-column prop="sceneformal" label="环境" width="90" />
            <el-table-column prop="accessPoint" label="接入点" min-width="140" show-overflow-tooltip />
            <el-table-column prop="targetPoint" label="原地址" min-width="140" show-overflow-tooltip />
          </el-table>
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

/* 状态卡：UiPanel 根上的左右分栏 */
.status-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.status-line {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.status-name {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
}

.status-meta {
  margin-top: var(--spacing-sm);
}

.section-hint {
  margin: 0 0 var(--spacing-md);
}

.kv-list {
  margin-bottom: var(--spacing-md);
}

/* 原 .kv-value.break：长令牌 / 地址在窄容器内断行 */
.kv-list :deep(.ui-kv-value) {
  word-break: break-all;
}

.user-json {
  margin-bottom: var(--spacing-md);
}

.fav-title {
  margin: var(--spacing-md) 0 var(--spacing-sm);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
}

.fav-table :deep(.fav-hospital-row) {
  font-weight: var(--font-weight-semibold);
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
}
</style>
