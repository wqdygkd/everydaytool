<script setup lang="ts">
import type { TelegramCacheConfig } from '../../../../shared/telegram-cache'
import { useTelegramCacheStore } from '../stores/telegramCacheStore'
import { formatBytes, formatDateTime, formatDuration } from '../utils/format'

const store = useTelegramCacheStore()

const MB = 1024 * 1024
const SIZE_OPTIONS = [128, 256, 512, 1024, 2048]
const sizeOptions = SIZE_OPTIONS.map(value => ({ label: `${value} MB`, value }))
const CACHE_OPTIONS = [256, 512, 1024, 2048, 3072, 5120, 10240]
const cacheOptions = CACHE_OPTIONS.map(value => ({ label: `${value} MB`, value }))

const currentConcurrency = computed(() => store.config?.maxHttpConcurrency ?? 3)
const currentLimitMb = computed(() => {
  const bytes = store.config?.maxResourceBytes ?? 512 * MB
  const mb = Math.round(bytes / MB)
  return SIZE_OPTIONS.reduce((best, item) => (Math.abs(item - mb) < Math.abs(best - mb) ? item : best), SIZE_OPTIONS[0])
})
const currentCacheMb = computed(() => {
  const bytes = store.config?.cacheMaxBytes ?? 3072 * MB
  const mb = Math.round(bytes / MB)
  return CACHE_OPTIONS.reduce((best, item) => (Math.abs(item - mb) < Math.abs(best - mb) ? item : best), CACHE_OPTIONS[0])
})
const localResponseEnabled = computed(() => store.config?.localResponseEnabled === true)
const localMediaRangeEnabled = computed(() => store.config?.localMediaRangeEnabled === true)
const pageCaptureEnabled = computed(() => store.config?.enablePageCapture === true)
const m3Report = computed(() => store.m3Report)
const benchmark = computed(() => store.benchmark)
const benchmarkLabel = ref('')
const benchmarkActive = computed(() => benchmark.value?.active ?? null)
const benchmarkRecords = computed(() => benchmark.value?.records ?? [])
const benchmarkComparison = computed(() => {
  const records = benchmarkRecords.value
  if (records.length < 2) return null
  const [latest, previous] = records
  return {
    latest,
    previous,
    networkDelta: latest.networkBytes - previous.networkBytes,
    cacheDelta: latest.cacheServedBytes - previous.cacheServedBytes,
  }
})

function signedBytes(value: number): string {
  if (value === 0) return '0 B'
  return `${value > 0 ? '+' : '-'}${formatBytes(Math.abs(value))}`
}

async function startBenchmark(): Promise<void> {
  try {
    await store.startBenchmark(benchmarkLabel.value)
    ElMessage.success('基准测试已开始，请执行固定场景')
  } catch (error) {
    ElMessage.error((error as Error).message || '开始失败')
  }
}

async function stopBenchmark(): Promise<void> {
  try {
    await store.stopBenchmark()
    ElMessage.success('样本已保存')
  } catch (error) {
    ElMessage.error((error as Error).message || '结束失败')
  }
}

async function clearBenchmarks(): Promise<void> {
  try {
    await ElMessageBox.confirm('清空所有基准测试样本？此操作不可恢复。', '清空样本', { type: 'warning' })
  } catch {
    return
  }
  try {
    await store.clearBenchmarks()
    ElMessage.success('已清空样本')
  } catch (error) {
    ElMessage.error((error as Error).message || '清空失败')
  }
}
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
  archiving: '写入归档',
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
  if (phase === 'downloading' || phase === 'resolving' || phase === 'verifying' || phase === 'archiving') return 'warning'
  return 'neutral'
}

async function startMtprotoDownload(): Promise<void> {
  const link = mtLink.value.trim()
  if (!link) {
    ElMessage.warning('请输入 Telegram 消息链接')
    return
  }
  try {
    await store.startMtprotoDownload(link)
    ElMessage.success('已开始解析消息')
  } catch (error) {
    ElMessage.error((error as Error).message || '启动下载失败')
  }
}

async function cancelMtprotoDownload(): Promise<void> {
  try {
    const accepted = await store.cancelMtprotoDownload()
    if (accepted) ElMessage.info('正在取消…')
  } catch (error) {
    ElMessage.error((error as Error).message || '取消失败')
  }
}

async function refreshMtproto(): Promise<void> {
  try {
    await store.refreshMtprotoStatus()
  } catch (error) {
    ElMessage.error((error as Error).message || '读取状态失败')
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
    ElMessage.success('会话已迁移到 OS 加密存储（可删除 .env 里的 TELEGRAM_SESSION）')
  } catch (error) {
    ElMessage.error((error as Error).message || '迁移失败')
  }
}

async function clearSecureSession(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '会删除本工具保存的加密会话并断开连接。若 .env 里仍有 TELEGRAM_SESSION，会回退使用它；要彻底移除请自行删除该行。',
      '清除加密会话',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await store.clearMtprotoSecureSession()
    ElMessage.success('已清除加密会话')
  } catch (error) {
    ElMessage.error((error as Error).message || '清除失败')
  }
}
const cache = computed(() => store.cache)
const probe = computed(() => store.probe)
const selfTest = computed(() => store.selfTest)

async function updateConcurrency(value: number | undefined): Promise<void> {
  if (typeof value !== 'number') return
  await applyConfig({ maxHttpConcurrency: value }, '并发上限已更新')
}

async function updateLimit(value: number): Promise<void> {
  await applyConfig({ maxResourceBytes: value * MB }, '单资源上限已更新')
}

async function updateCacheQuota(value: number): Promise<void> {
  await applyConfig({ cacheMaxBytes: value * MB }, '缓存配额已更新')
}

async function applyConfig(patch: Partial<TelegramCacheConfig>, message: string): Promise<void> {
  try {
    await store.updateConfig(patch)
    ElMessage.success(message)
  } catch (error) {
    ElMessage.error((error as Error).message || '保存配置失败')
  }
}

async function toggleLocalResponse(value: boolean): Promise<void> {
  if (value) {
    try {
      await ElMessageBox.confirm(
        '开启后，命中缓存的图片请求将由本地文件响应。副作用：页面请求可能不再出现在观测里（取决于 Electron 版本），且只对「图片 + 无 Range + 仍在新鲜期」生效；过期条目会先做条件验证。可随时关闭。',
        '开启图片本地复用',
        { type: 'warning', confirmButtonText: '开启' },
      )
    } catch {
      return
    }
  }
  await applyConfig({ localResponseEnabled: value }, value ? '图片本地复用已开启' : '图片本地复用已关闭')
}

async function toggleLocalMediaRange(value: boolean): Promise<void> {
  if (value) {
    try {
      await ElMessageBox.confirm(
        '实验能力：音视频请求按单区间（206 + Content-Range）由本地文件响应。多区间 / 非法区间 / 带 If-Range 不匹配时一律回源。若播放器出现卡顿或黑屏，请立即关闭并反馈。',
        '开启媒体 Range 本地响应',
        { type: 'warning', confirmButtonText: '开启' },
      )
    } catch {
      return
    }
  }
  await applyConfig({ localMediaRangeEnabled: value }, value ? '媒体 Range 本地响应已开启' : '媒体 Range 本地响应已关闭')
}

async function togglePageCapture(value: boolean): Promise<void> {
  if (value) {
    try {
      await ElMessageBox.confirm(
        '开启后会用 CDP 读取页面已经下载完成的图片响应体并直接落库（不再下载一次）。副作用：占用页面调试通道，与开发者工具互斥；只抓图片、单文件上限 16MB；拿不到 blob / MTProto 明文。',
        '开启页面数据捕获',
        { type: 'warning', confirmButtonText: '开启' },
      )
    } catch {
      return
    }
  }
  await applyConfig({ enablePageCapture: value }, value ? '页面数据捕获已开启' : '页面数据捕获已关闭')
}

async function runM3Report(): Promise<void> {
  try {
    const report = await store.runFeasibilityReport()
    ElMessage.success(`检查完成：${report.decision.summary}`)
  } catch (error) {
    ElMessage.error((error as Error).message || 'M3 检查失败')
  }
}

function checkTone(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  if (status === 'pass') return 'success'
  if (status === 'fail') return 'danger'
  if (status === 'blocked') return 'warning'
  return 'neutral'
}

function checkLabel(status: string): string {
  if (status === 'pass') return '通过'
  if (status === 'fail') return '不通过'
  if (status === 'blocked') return '受阻'
  return '待人工验证'
}

async function clearCache(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '清理缓存会删除资源库中的缓存对象（归档副本、no-store 保存内容与进行中的任务不会被删）。确定继续？',
      '清理缓存',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    const result = await store.clearCache()
    ElMessage.success(`已清理 ${formatBytes(result.evictedBytes)}（${result.evictions} 项）`)
  } catch (error) {
    ElMessage.error((error as Error).message || '清理失败')
  }
}

async function runProbe(): Promise<void> {
  try {
    const result = await store.probePage()
    if (result.ok) ElMessage.success('探测完成')
    else ElMessage.warning(result.error || '探测失败')
  } catch (error) {
    ElMessage.error((error as Error).message || '探测失败')
  }
}

async function runSelfTest(): Promise<void> {
  try {
    const result = await store.runSelfTest()
    if (result.ok) ElMessage.success('自检全部通过')
    else ElMessage.warning('自检存在失败项，请查看详情')
  } catch (error) {
    ElMessage.error((error as Error).message || '自检失败')
  }
}

async function exportDiagnostics(): Promise<void> {
  try {
    const result = await store.exportDiagnostics()
    ElMessage.success(`诊断包已导出（${formatBytes(result.bytes)}）`)
  } catch (error) {
    ElMessage.error((error as Error).message || '导出失败')
  }
}

async function openDataDir(): Promise<void> {
  try {
    await store.openDataDir()
  } catch (error) {
    ElMessage.error((error as Error).message || '打开数据目录失败')
  }
}
</script>

<template>
  <div class="panel-stack">
    <UiPanel title="页面能力探测">
      <template #actions>
        <el-button size="small" type="primary" :loading="store.busy.probe" :disabled="!store.pageWebContentsId" @click="runProbe">
          探测当前页面
        </el-button>
      </template>

      <UiHint v-if="!store.pageWebContentsId" block>
        页面尚未就绪（webview 未挂载或未完成首次加载）。请等待 Telegram 页面加载后重试。
      </UiHint>

      <UiEmpty v-else-if="!probe" text="尚未探测。探测只读取页面公开线索（performance / 媒体元素 / Service Worker），不做任何写操作。" variant="bordered" />

      <template v-else>
        <UiHint v-if="probe.error" block class="error-text">
          {{ probe.error }}
        </UiHint>
        <template v-else>
          <UiDetailGrid :columns="2">
            <UiDetailItem label="页面地址" size="xs" wrap>
              {{ probe.url || '—' }}
            </UiDetailItem>
            <UiDetailItem label="探测时间" size="xs" mono>
              {{ formatDateTime(probe.probedAt) }}
            </UiDetailItem>
            <UiDetailItem label="performance 资源" size="xs" mono>
              {{ probe.performance.resources }}
            </UiDetailItem>
            <UiDetailItem label="transfer / decoded" size="xs" mono>
              {{ formatBytes(probe.performance.transferSize) }} / {{ formatBytes(probe.performance.decodedBodySize) }}
            </UiDetailItem>
            <UiDetailItem label="媒体元素（video/audio）" size="xs" mono>
              {{ probe.mediaElementCount }}（{{ probe.videoCount }}/{{ probe.audioCount }}）
            </UiDetailItem>
            <UiDetailItem label="blob: 资源" size="xs" mono>
              {{ probe.blobUrlCount }}
            </UiDetailItem>
          </UiDetailGrid>

          <ul class="finding-list">
            <li v-for="finding in probe.findings" :key="finding">
              {{ finding }}
            </li>
          </ul>
        </template>
      </template>
    </UiPanel>

    <UiPanel title="任务协调器自检">
      <template #actions>
        <el-button size="small" :loading="store.busy.selfTest" @click="runSelfTest">
          运行自检
        </el-button>
      </template>

      <UiEmpty v-if="!selfTest" text="尚未运行。自检使用注入 runner 验证同键合并、异键隔离、取消传播、失败清理与重试，不触碰网络。" variant="bordered" />
      <div v-else class="step-list">
        <UiChip :tone="selfTest.ok ? 'success' : 'danger'">
          {{ selfTest.ok ? '全部通过' : '存在失败' }}
        </UiChip>
        <div v-for="step in selfTest.steps" :key="step.name" class="step-row">
          <UiChip :tone="step.ok ? 'success' : 'danger'">
            {{ step.ok ? '通过' : '失败' }}
          </UiChip>
          <div class="step-body">
            <span class="step-name">{{ step.name }}</span>
            <span class="muted step-detail">{{ step.detail }}</span>
          </div>
        </div>
      </div>
    </UiPanel>

    <UiPanel title="M3 可行性（页面数据捕获）">
      <template #actions>
        <el-button size="small" type="primary" :loading="store.busy.m3" @click="runM3Report">
          运行检查
        </el-button>
      </template>

      <div class="kv-stack">
        <UiKeyValue label="页面数据捕获" label-width="120px">
          <UiGroup gap="sm" justify="end">
            <UiChip :tone="pageCaptureEnabled ? (cache?.pageCaptureAttached ? 'success' : 'danger') : 'neutral'">
              {{ pageCaptureEnabled ? (cache?.pageCaptureAttached ? 'CDP 已附加' : '未附加（可能被 DevTools 占用）') : '关闭' }}
            </UiChip>
            <el-switch :model-value="pageCaptureEnabled" @update:model-value="togglePageCapture" />
          </UiGroup>
        </UiKeyValue>
        <UiKeyValue label="捕获字节 / 命中 / 失败" label-width="150px" mono>
          {{ formatBytes(cache?.pageCapturedBytes) }} / {{ cache?.pageCaptureHits ?? 0 }} / {{ cache?.pageCaptureMisses ?? 0 }}
        </UiKeyValue>
      </div>

      <UiHint block>
        页面捕获只读取<strong>开启之后新发生</strong>且已下载完成的图片请求（重新加载页面或滚动聊天触发）；
        与开发者工具互斥，DevTools 打开会分离调试器并停止捕获。不捕获 blob / 播放中数据 / MTProto 明文。
      </UiHint>

      <UiEmpty v-if="!m3Report" text="尚未运行。检查只汇总已观测的流量分类与捕获能力，不发起下载、不附加调试器。" variant="bordered" />
      <template v-else>
        <UiDetailGrid :columns="2">
          <UiDetailItem label="图片 / 媒体请求" size="xs" mono>
            {{ m3Report.observation.imageRequests }} / {{ m3Report.observation.mediaRequests }}
          </UiDetailItem>
          <UiDetailItem label="WebSocket 请求" size="xs" mono>
            {{ m3Report.observation.websocketRequests }}
          </UiDetailItem>
          <UiDetailItem label="blob 线索（最近探测）" size="xs" mono>
            {{ m3Report.observation.blobClues ?? '未探测' }}
          </UiDetailItem>
          <UiDetailItem label="检查时间" size="xs" mono>
            {{ formatDateTime(m3Report.checkedAt) }}
          </UiDetailItem>
        </UiDetailGrid>

        <UiHint block>
          <strong>判定：</strong>{{ m3Report.decision.summary }}
        </UiHint>

        <div class="report-block">
          <div class="report-title">
            §19 检查清单
          </div>
          <div class="check-list">
            <div v-for="check in m3Report.checks" :key="check.id" class="check-row">
              <UiChip :tone="checkTone(check.status)">
                {{ checkLabel(check.status) }}
              </UiChip>
              <div class="check-body">
                <span class="step-name">{{ check.title }}</span>
                <span class="muted step-detail">{{ check.detail }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="report-block">
          <div class="report-title">
            运行环境与依赖
          </div>
          <UiDetailGrid :columns="2">
            <UiDetailItem label="Electron / Chromium" size="xs" wrap>
              {{ m3Report.environment.electron || '?' }} / {{ m3Report.environment.chrome || '?' }}
            </UiDetailItem>
            <UiDetailItem label="teleproto" size="xs" wrap>
              {{ m3Report.dependencies.teleproto.installed
                ? `teleproto@${m3Report.dependencies.teleproto.version || 'unknown'}`
                : '未安装' }}
            </UiDetailItem>
            <UiDetailItem label="页面地址" size="xs" wrap>
              {{ m3Report.environment.pageUrl || '未探测' }}
            </UiDetailItem>
            <UiDetailItem label="页面 UA" size="xs" wrap>
              {{ m3Report.environment.userAgent || '未探测' }}
            </UiDetailItem>
          </UiDetailGrid>
        </div>

        <div class="report-block">
          <div class="report-title">
            页面捕获限制
          </div>
          <ul class="finding-list">
            <li v-for="item in m3Report.capture.limitations" :key="item">
              {{ item }}
            </li>
          </ul>
        </div>

        <div class="report-block">
          <div class="report-title">
            MTProto 下载器（{{ m3Report.mtproto.available ? '凭据已配置' : '未配置' }}）
          </div>
          <ul class="finding-list">
            <li v-for="item in m3Report.mtproto.prerequisites" :key="item">
              {{ item }}
            </li>
            <li v-for="item in m3Report.mtproto.notes" :key="item">
              {{ item }}
            </li>
          </ul>
        </div>
      </template>
    </UiPanel>

    <UiPanel title="MTProto 消息下载（实验）">
      <template #actions>
        <el-button size="small" @click="refreshMtproto">
          刷新状态
        </el-button>
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
        <el-button v-if="mtproto?.sessionSource === 'env' && mtproto?.encryptionAvailable" size="small" @click="migrateSession">
          迁移到加密存储
        </el-button>
        <el-button v-if="mtproto?.sessionSource === 'secure'" size="small" @click="clearSecureSession">
          清除加密会话
        </el-button>
      </UiToolbar>

      <UiHint v-if="mtproto?.missing?.length" block class="danger-hint">
        缺少：{{ mtproto.missing.join(' / ') }}。在项目根目录 `.env` 填好后，运行
        <span class="mono">pnpm telegram:session</span> 生成会话并粘回 `.env`，再重启应用。
      </UiHint>
      <UiHint v-else-if="mtproto?.error" block class="danger-hint">
        {{ mtproto.error }}
      </UiHint>

      <UiToolbar gap="sm" class="mt-input-row">
        <el-input
          v-model="mtLink"
          class="ctl-fill"
          size="small"
          placeholder="https://t.me/<频道>/<消息ID> 或 https://t.me/c/<频道ID>/<消息ID>"
          :disabled="Boolean(mtActive)"
          clearable
        />
        <el-button size="small" type="primary" :loading="Boolean(mtActive) && mtActive?.phase === 'resolving'" :disabled="Boolean(mtActive)" @click="startMtprotoDownload">
          下载媒体
        </el-button>
        <el-button size="small" :disabled="!mtActive" @click="cancelMtprotoDownload">
          取消
        </el-button>
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
          <UiKeyValue label="归档" label-width="88px" wrap>
            <span class="mono">{{ mtLast.archiveRelativePath || '—' }}</span>
          </UiKeyValue>
        </div>
      </template>

      <UiHint block>
        只能下载当前账号本来就能访问的消息；私密链接要求频道已在对话列表里（access hash 来自会话缓存）。
        媒体写入归档目录，消息正文（截断 20k 字符）写入同目录 <span class="mono">message.json</span>。
        凭据只在主进程读取；<strong>不要把 .env 提交或截图</strong>。
      </UiHint>
    </UiPanel>

    <UiPanel title="基准测试（M2 验收）">
      <template #actions>
        <UiChip :tone="benchmarkActive ? 'warning' : 'neutral'">
          {{ benchmarkActive ? '进行中' : '未开始' }}
        </UiChip>
      </template>

      <UiToolbar gap="sm" class="mt-input-row">
        <el-input
          v-model="benchmarkLabel"
          class="ctl-fill"
          size="small"
          placeholder="样本标签，如 baseline / with-cache"
          :disabled="Boolean(benchmarkActive)"
          clearable
        />
        <el-button size="small" type="primary" :disabled="Boolean(benchmarkActive)" @click="startBenchmark">
          开始
        </el-button>
        <el-button size="small" :disabled="!benchmarkActive" @click="stopBenchmark">
          结束并保存
        </el-button>
        <el-button size="small" :disabled="!benchmarkRecords.length" @click="clearBenchmarks">
          清空记录
        </el-button>
      </UiToolbar>

      <UiHint v-if="benchmarkActive" block>
        已开始：{{ benchmarkActive.label }}（{{ formatDateTime(benchmarkActive.startedAt) }}）。
        现在执行固定场景（同一聊天、同样的滚动 / 播放 / 切图操作），完成后点「结束并保存」。
      </UiHint>

      <UiTable :data="benchmarkRecords.slice(0, 10)" height="220" empty-text="还没有样本：先建立 baseline，再开启本地响应采集对照">
        <el-table-column label="样本" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="benchmark-cell">
              <span>{{ row.label }}</span>
              <span class="muted benchmark-time">{{ formatDateTime(row.endedAt) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="时长" width="76">
          <template #default="{ row }">
            <span class="mono muted">{{ formatDuration(row.durationMs) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="请求" width="64" align="right">
          <template #default="{ row }">
            <span class="mono">{{ row.requests }}</span>
          </template>
        </el-table-column>
        <el-table-column label="网络字节" width="92" align="right">
          <template #default="{ row }">
            <span class="mono">{{ formatBytes(row.networkBytes) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="本地复用" width="92" align="right">
          <template #default="{ row }">
            <span class="mono muted">{{ formatBytes(row.cacheServedBytes) }}</span>
          </template>
        </el-table-column>
      </UiTable>

      <UiDetailGrid v-if="benchmarkComparison" :columns="2">
        <UiDetailItem label="网络字节 Δ（最新 − 上一）" size="xs" mono>
          {{ signedBytes(benchmarkComparison.networkDelta) }}
        </UiDetailItem>
        <UiDetailItem label="本地复用字节 Δ" size="xs" mono>
          {{ signedBytes(benchmarkComparison.cacheDelta) }}
        </UiDetailItem>
      </UiDetailGrid>

      <UiHint block>
        统计口径：网络字节来自响应头 <span class="mono">content-length</span>，只覆盖可观测的 HTTP 请求，
        <strong>不等于网卡真实流量</strong>；本地复用字节省的是本地返回的响应体。
        建议先采集 baseline（本地响应关闭），再开启本地响应采集 with-cache，并保持同一聊天 / 同样操作路径。
        测试期间若清空观测，样本会标注「可能无效」。
      </UiHint>
    </UiPanel>

    <UiPanel title="诊断与配置">
      <div class="kv-stack">
        <UiKeyValue label="HTTP 并发" label-width="112px">
          <el-input-number
            :model-value="currentConcurrency"
            :min="1"
            :max="8"
            size="small"
            controls-position="right"
            @change="updateConcurrency"
          />
        </UiKeyValue>
        <UiKeyValue label="单资源上限" label-width="112px">
          <el-select :model-value="currentLimitMb" size="small" class="ctl-sm" @change="updateLimit">
            <el-option v-for="option in sizeOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </UiKeyValue>
        <UiKeyValue label="缓存占用" label-width="112px" mono>
          {{ formatBytes(cache?.sizeBytes) }} / {{ formatBytes(cache?.maxBytes) }}
        </UiKeyValue>
        <UiKeyValue label="缓存配额" label-width="112px">
          <el-select :model-value="currentCacheMb" size="small" class="ctl-sm" @change="updateCacheQuota">
            <el-option v-for="option in cacheOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </UiKeyValue>
        <UiKeyValue label="图片本地复用" label-width="112px">
          <UiGroup gap="sm" justify="end">
            <UiChip :tone="localResponseEnabled ? (cache?.handlerInstalled ? 'success' : 'danger') : 'neutral'">
              {{ localResponseEnabled ? (cache?.handlerInstalled ? '已开启' : '处理器安装失败') : '关闭' }}
            </UiChip>
            <el-switch :model-value="localResponseEnabled" @update:model-value="toggleLocalResponse" />
          </UiGroup>
        </UiKeyValue>
        <UiKeyValue label="媒体 Range" label-width="112px">
          <UiGroup gap="sm" justify="end">
            <UiChip :tone="localMediaRangeEnabled ? (cache?.handlerInstalled ? 'success' : 'danger') : 'neutral'">
              {{ localMediaRangeEnabled ? (cache?.handlerInstalled ? '已开启（单区间）' : '处理器安装失败') : '关闭' }}
            </UiChip>
            <el-switch :model-value="localMediaRangeEnabled" @update:model-value="toggleLocalMediaRange" />
          </UiGroup>
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
            <el-button size="small" text type="primary" @click="openDataDir">
              打开
            </el-button>
          </div>
        </UiKeyValue>
      </div>

      <UiHint v-if="store.snapshot?.webSession?.restartRequired" block class="danger-hint">
        数据目录已切换：重启后 Chromium 会话目录才会指向新位置；旧目录中的缓存与登录态不会迁移（可能需要重新登录）。
      </UiHint>

      <UiToolbar gap="sm" class="actions-row">
        <el-button size="small" type="primary" :loading="store.busy.diagnostics" @click="exportDiagnostics">
          导出诊断包
        </el-button>
        <el-button size="small" :loading="store.busy.cache" @click="clearCache">
          清理缓存
        </el-button>
        <span class="muted export-hint">
          {{ store.diagnostics ? `已导出 ${formatBytes(store.diagnostics.bytes)}：${store.diagnostics.relativePath}` : '未导出' }}
        </span>
      </UiToolbar>

      <UiHint block>
        本地响应默认关闭：图片开关只处理「已校验 + 新鲜 + 图片 + 无 Range」；媒体开关只处理单区间 Range（206）。
        其余请求（多区间、非法区间、过期且验证失败、未入库）一律原样回源。两者都通过
        <span class="mono">protocol.handle</span> 接管分区 http(s)，页面请求可能不再出现在 webRequest 观测里——
        <strong>观测覆盖与本地复用不能同时保证</strong>。
      </UiHint>

      <UiHint block class="danger-hint">
        多账号提示：当前无法从页面可靠取得 Telegram 账号身份，缓存按 session 分区共享。切换账号前请先「清理缓存」并关闭本地复用，避免把上一个账号的图片当成本地命中。
      </UiHint>

      <UiHint block>
        诊断包只包含脱敏后的观测统计、资源索引、任务与配置，不含 Cookie / Authorization / 请求头原文 / 响应体 / 消息正文；
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

.finding-list {
  margin: var(--spacing-md) 0 0;
  padding-left: var(--spacing-lg);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.6;
}

.report-block {
  margin-top: var(--spacing-md);
}

.report-title {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.check-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-sm);
}

.check-row {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
}

.check-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
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

.benchmark-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.benchmark-time {
  font-size: var(--font-size-xs);
}

.step-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.step-row {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
}

.step-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.step-name {
  font-size: var(--font-size-sm);
}

.step-detail {
  font-size: var(--font-size-xs);
  word-break: break-word;
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

.error-text {
  color: var(--color-error);
}

.danger-hint {
  color: var(--color-warning);
}
</style>
