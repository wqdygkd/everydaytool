<script setup lang="ts">
import type { WxpEnhancement, WxpEnhancementType, WxpRunningStatus, WxpTarget } from '../../../../shared/types'
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
const enhancementForm = reactive({
  id: '',
  name: '',
  type: 'css' as WxpEnhancementType,
  urlPattern: '',
  code: '',
  enabled: true,
})

const targets = ref<WxpTarget[]>([])
const targetsLoading = ref(false)

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
    targets.value = []
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
    Object.assign(enhancementForm, {
      id: '',
      name: '',
      type: 'css',
      urlPattern: '',
      code: '',
      enabled: true,
    })
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

async function loadTargets(): Promise<void> {
  if (!store.running) return
  targetsLoading.value = true
  try {
    targets.value = await store.fetchTargets(store.running.port)
  } catch (error) {
    ElMessage.error((error as Error).message || '获取页面列表失败')
  } finally {
    targetsLoading.value = false
  }
}

async function openDevTools(target: WxpTarget): Promise<void> {
  try {
    await store.openDevTools({
      devToolsUrl: target.devToolsUrl,
      title: `DevTools · ${target.title || target.url || 'page'}`,
    })
    ElMessage.success('已打开 DevTools（调试期间注入已暂停）')
  } catch (error) {
    ElMessage.error((error as Error).message || '打开 DevTools 失败')
  }
}

watch(() => store.running?.status, (status) => {
  if (status === 'running') {
    loadTargets()
  } else {
    targets.value = []
  }
})

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
      </div>
      <div class="inline-group status-actions">
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
              placeholder="例如 C:\Program Files\Tencent\Weixin\Weixin.exe"
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
            <span class="muted">登录一次后自动缓存，启动时恢复登录并直接进入主页（登出后失效）</span>
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

    <!-- 页面目标 -->
    <section v-if="isRunning" class="surface-card targets-card">
      <div class="card-header">
        <h3>页面目标</h3>
        <div class="inline-group">
          <el-button size="small" :loading="targetsLoading" @click="loadTargets">
            刷新
          </el-button>
        </div>
      </div>
      <el-table
        v-loading="targetsLoading"
        :data="targets"
        size="small"
        empty-text="暂无页面，点击刷新获取"
      >
        <el-table-column prop="type" label="类型" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.type === 'iframe' ? 'warning' : 'primary'">
              {{ row.type }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="160" show-overflow-tooltip />
        <el-table-column prop="url" label="URL" min-width="260" show-overflow-tooltip />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDevTools(row)">
              打开 DevTools
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
