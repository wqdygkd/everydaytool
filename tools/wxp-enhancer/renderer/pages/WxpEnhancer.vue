<script setup lang="ts">
import type { WxpEnhancement, WxpEnhancementType, WxpRunningStatus } from '../../../../shared/types'
import { DEFAULT_WXP_SETTINGS } from '../../../../shared/types'
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

const enhancementDialogVisible = ref(false)
const EMPTY_ENHANCEMENT_FORM = {
  id: '',
  name: '',
  type: 'css' as WxpEnhancementType,
  urlPattern: '',
  code: '',
  enabled: true,
}

const enhancementForm = reactive({ ...EMPTY_ENHANCEMENT_FORM })

async function handleLaunch(): Promise<void> {
  launching.value = true
  try {
    await store.saveSettings({ ...settingsForm })
    settingsDirty.value = false
    await store.launch()
    ElMessage.success('启动成功，界面增强已生效')
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
    ElMessage.success(`已重新应用界面增强（${count} 个页面）`)
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
const showPassword = ref(false)
const dataLogin = computed(() => store.dataCache?.login ?? null)
const userCode = computed(() => String((dataLogin.value?.user as Record<string, unknown> | null)?.code ?? '—'))
const userName = computed(() => String((dataLogin.value?.user as Record<string, unknown> | null)?.name ?? '—'))
const favRows = computed(() => {
  const favorites = store.dataCache?.favorites ?? []
  return favorites.map((key) => {
    const parts = String(key).split('|')
    return { key, env: parts[0] ?? '', name: parts[1] ?? '', access: parts[2] ?? '', target: parts.slice(3).join('|') }
  })
})

function maskToken(v: string): string {
  if (!v) return '—'
  return v.length <= 14 ? v : `${v.slice(0, 8)}…${v.slice(-4)}`
}

function fmtTime(ms: number): string {
  return ms ? new Date(ms).toLocaleString() : '—'
}

async function copyValue(v: string, label: string): Promise<void> {
  if (!v) return
  try {
    await navigator.clipboard.writeText(v)
    ElMessage.success(`${label}已复制`)
  } catch {
    ElMessage.error('复制失败')
  }
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

function openEnhancementDialog(row?: WxpEnhancement): void {
  if (row) {
    Object.assign(enhancementForm, {
      id: row.id,
      name: row.name,
      type: row.type,
      urlPattern: row.urlPattern ?? '',
      code: row.code,
      enabled: row.enabled,
    })
  } else {
    Object.assign(enhancementForm, EMPTY_ENHANCEMENT_FORM)
  }
  enhancementDialogVisible.value = true
}

async function saveEnhancement(): Promise<void> {
  if (!enhancementForm.name.trim() || !enhancementForm.code.trim()) {
    ElMessage.warning('请填写名称和代码内容')
    return
  }
  try {
    const applied = await store.saveEnhancement({
      id: enhancementForm.id,
      name: enhancementForm.name.trim(),
      type: enhancementForm.type,
      code: enhancementForm.code,
      enabled: enhancementForm.enabled,
      urlPattern: enhancementForm.urlPattern.trim(),
    })
    enhancementDialogVisible.value = false
    ElMessage.success(applied ? '已保存并重新应用' : '已保存')
  } catch (error) {
    ElMessage.error((error as Error).message || '保存失败')
  }
}

async function removeEnhancement(row: WxpEnhancement): Promise<void> {
  await ElMessageBox.confirm(`确定删除「${row.name}」？`, '确认', { type: 'warning' })
  const applied = await store.deleteEnhancement(row.id)
  ElMessage.success(applied ? '已删除并重新应用' : '已删除')
}

async function toggleEnhancement(row: WxpEnhancement, enabled: boolean | string | number): Promise<void> {
  try {
    const applied = await store.saveEnhancement({ ...row, enabled: Boolean(enabled) })
    ElMessage.success(applied ? '已重新应用' : '已更新')
  } catch (error) {
    row.enabled = !enabled
    ElMessage.error((error as Error).message || '更新失败')
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
    <section class="surface-card status-card">
      <div class="status-info">
        <div class="status-line">
          <span class="status-dot" :class="{ pulsing: statusTagType === 'success' }" :data-tone="statusTagType" />
          <span class="status-name">{{ statusLabel }}</span>
          <el-tag v-if="store.running" :type="statusTagType" size="small">
            {{ store.running.message || '—' }}
          </el-tag>
        </div>
        <div v-if="isRunning" class="status-meta mono">
          <span class="chip">PID {{ store.running?.pid ?? '-' }}</span>
          <span class="chip">端口 {{ store.running?.port }}</span>
          <span class="chip">页面 {{ store.running?.targetCount ?? 0 }}</span>
        </div>
        <div v-else-if="store.loginCacheClearPending" class="status-meta">
          <span class="chip">登录缓存待清除：下次启动时自动执行</span>
        </div>
      </div>
      <div class="inline-group status-actions">
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
      </div>
    </section>

    <!-- 启动设置 -->
    <section class="surface-card settings-card">
      <div class="card-header">
        <h3>启动设置</h3>
        <el-button
          size="small"
          type="primary"
          plain
          :disabled="!settingsDirty"
          @click="saveSettings"
        >
          保存设置
        </el-button>
      </div>
      <el-form label-width="110px" class="settings-form">
        <el-form-item label="WXP 路径" required>
          <div class="inline-group path-row">
            <el-input
              v-model="settingsForm.executablePath"
              placeholder="例如 C:\Users\你\AppData\Local\Programs\Wxp Client\WxP Client.exe"
              class="mono"
            />
            <el-button :disabled="isRunning" @click="pickExecutable">
              浏览
            </el-button>
            <el-button :disabled="isRunning" @click="detectExecutable">
              自动检测
            </el-button>
          </div>
          <div class="form-hint">
            使用 WXP 自身数据启动：登录一次后保持登录，再次启动直接进入应用主页；
            启动前请先退出已打开的 WXP（单实例应用）。
          </div>
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
          <div class="switch-row">
            <el-switch v-model="settingsForm.showStatusBadge" />
            <span class="muted">在 WXP 窗口左下角显示「增强中」呼吸灯，保存后立即生效</span>
          </div>
        </el-form-item>
        <el-form-item label="缓存登录状态">
          <div class="switch-row">
            <el-switch v-model="settingsForm.cacheLogin" />
            <span class="muted">登录一次后整体缓存会话，启动时还原并自动进入主页、补跑登录后的数据初始化（链接中心租户列表、代理 NameNode、中心页 SSO）；token 过期时不自动进入，登出后失效</span>
          </div>
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
    </section>

    <!-- 数据缓存（来自 WXP） -->
    <section class="surface-card data-card">
      <div class="card-header">
        <h3>数据缓存（来自 WXP）</h3>
        <div class="inline-group">
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
        </div>
      </div>
      <p class="form-hint section-hint">
        读取时把 WXP 页面里的登录令牌、用户信息与收藏数据缓存到工具数据目录（data-cache.json），此处查看；WXP 未运行时仍可查看上次采集结果。
      </p>
      <template v-if="dataLogin">
        <div class="kv-list">
          <div class="kv-row">
            <span class="kv-label">登录账号</span>
            <span class="kv-value">{{ dataLogin.username || '—' }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">登录密码</span>
            <span class="kv-value mono">{{ showPassword ? dataLogin.password || '—' : '••••••••' }}</span>
            <el-button link size="small" @click="showPassword = !showPassword">
              {{ showPassword ? '隐藏' : '显示' }}
            </el-button>
          </div>
          <div class="kv-row">
            <span class="kv-label">访问令牌</span>
            <span class="kv-value mono break">{{ dataLogin.accessToken || '—' }}</span>
            <el-button link size="small" @click="copyValue(dataLogin.accessToken, '令牌')">
              复制
            </el-button>
          </div>
          <div class="kv-row">
            <span class="kv-label">访问有效期至</span>
            <span class="kv-value">{{ fmtTime(dataLogin.accessExpiresAt) }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">刷新令牌</span>
            <span class="kv-value mono break">{{ maskToken(dataLogin.refreshToken) }}</span>
            <el-button link size="small" @click="copyValue(dataLogin.refreshToken, '刷新令牌')">
              复制
            </el-button>
          </div>
          <div class="kv-row">
            <span class="kv-label">刷新有效期至</span>
            <span class="kv-value">{{ fmtTime(dataLogin.refreshExpiresAt) }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">用户编码</span>
            <span class="kv-value">{{ userCode }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">用户名称</span>
            <span class="kv-value">{{ userName }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">NameNode</span>
            <span class="kv-value mono break">{{ dataLogin.nameNodeAddrs || '—' }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">状态源</span>
            <span class="kv-value mono break">{{ dataLogin.statusQueryServers || '—' }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">会话快照</span>
            <span class="kv-value">{{ dataLogin.snapshotExists ? '存在' : '无' }}</span>
          </div>
        </div>
        <el-collapse v-if="dataLogin.user" class="user-json">
          <el-collapse-item name="user" title="用户信息 JSON">
            <pre class="mono user-json-pre">{{ JSON.stringify(dataLogin.user, null, 2) }}</pre>
          </el-collapse-item>
        </el-collapse>
        <template v-if="favRows.length">
          <h4 class="fav-title">
            收藏的转发（{{ favRows.length }}）
          </h4>
          <el-table :data="favRows" size="small" max-height="320">
            <el-table-column prop="env" label="环境" width="90" />
            <el-table-column prop="name" label="转发名称" min-width="160" show-overflow-tooltip />
            <el-table-column prop="access" label="接入点" min-width="140" />
            <el-table-column prop="target" label="原地址" min-width="140" />
          </el-table>
        </template>
        <p v-else class="form-hint">
          暂无收藏数据。
        </p>
      </template>
      <p v-else class="form-hint">
        尚未读取，启动 WXP 后点击「从 WXP 读取」。
      </p>
    </section>

    <!-- 界面增强 -->
    <section class="surface-card enhancements-card">
      <div class="card-header">
        <h3>界面增强</h3>
        <el-button size="small" type="primary" @click="openEnhancementDialog()">
          新增增强
        </el-button>
      </div>
      <p class="form-hint section-hint">
        CSS / JS 规则会在每次页面加载前自动注入，保存后若 WXP 正在运行将立即重新应用；可按 URL 片段限定生效页面。
      </p>
      <el-table :data="store.enhancements" empty-text="暂无增强规则，点击「新增增强」添加">
        <el-table-column prop="name" label="名称" min-width="140" show-overflow-tooltip />
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.type === 'css' ? 'primary' : 'warning'">
              {{ row.type.toUpperCase() }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="生效范围" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.urlPattern" class="mono">{{ row.urlPattern }}</span>
            <span v-else class="muted">全部页面</span>
          </template>
        </el-table-column>
        <el-table-column label="启用" width="80">
          <template #default="{ row }">
            <el-switch
              :model-value="row.enabled"
              @change="(value: any) => toggleEnhancement(row, value)"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEnhancementDialog(row)">
              编辑
            </el-button>
            <el-button link type="danger" @click="removeEnhancement(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 增强 编辑弹窗 -->
    <el-dialog
      v-model="enhancementDialogVisible"
      :title="enhancementForm.id ? '编辑增强' : '新增增强'"
      width="720px"
    >
      <el-form label-width="90px">
        <el-form-item label="名称" required>
          <el-input v-model="enhancementForm.name" placeholder="例如：夜间模式" />
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="enhancementForm.type">
            <el-radio-button value="css">
              CSS
            </el-radio-button>
            <el-radio-button value="js">
              JS
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="生效范围">
          <el-input
            v-model="enhancementForm.urlPattern"
            placeholder="可选，URL 包含该片段时生效，留空为全部页面"
            class="mono"
          />
        </el-form-item>
        <el-form-item label="代码" required>
          <el-input
            v-model="enhancementForm.code"
            type="textarea"
            :rows="14"
            class="mono"
            :placeholder="enhancementForm.type === 'css'
              ? '/* 示例：调整侧栏底色 */\n.sidebar { background: #fbf3f1 !important; }'
              : '// 示例：页面加载后执行\nconsole.log(\'[wxp-enhancer]\', location.href);'"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="enhancementDialogVisible = false">
          取消
        </el-button>
        <el-button type="primary" @click="saveEnhancement">
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.wxp-enhancer-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: 20px 24px 24px;
}

.surface-card {
  padding: var(--spacing-md) var(--spacing-lg) var(--spacing-lg);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-md);

  h3 {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
  }
}

/* 状态卡 */
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

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-xs);
  background: var(--color-text-tertiary);

  &[data-tone='success'] {
    background: var(--color-success);
  }

  &[data-tone='warning'] {
    background: var(--color-warning);
  }

  &[data-tone='danger'] {
    background: var(--color-error);
  }

  &.pulsing {
    animation: wxp-status-pulse 2s ease-in-out infinite;
  }
}

@keyframes wxp-status-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-success) 45%, transparent);
  }

  50% {
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-success) 0%, transparent);
  }
}

.status-meta {
  display: flex;
  gap: var(--spacing-xs);
  margin-top: var(--spacing-sm);
}

/* 设置卡 */
.path-row {
  width: 100%;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  width: 100%;
}

.section-hint {
  margin: 0 0 var(--spacing-md);
}

/* 数据缓存卡 */
.data-card .kv-list {
  margin-bottom: var(--spacing-md);
}

.data-card .kv-label {
  width: 88px;
}

.data-card .kv-row {
  align-items: center;
}

.data-card .kv-value.break {
  word-break: break-all;
}

.user-json {
  margin-bottom: var(--spacing-md);
}

.user-json-pre {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  font-size: var(--font-size-xs);
}

.fav-title {
  margin: var(--spacing-md) 0 var(--spacing-sm);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
}

@media (max-width: 760px) {
  .wxp-enhancer-page {
    padding: 14px;
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
