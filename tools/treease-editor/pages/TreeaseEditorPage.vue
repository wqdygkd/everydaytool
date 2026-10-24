<script setup lang="ts">
import type { TreeaseInterceptLog, TreeaseInterceptRule, TreeaseInterceptStatus } from '../../../shared/treease'
import { isTauriEnvironment } from '@/desktop/tauri'
import { closeWebview, createWebview, onWebviewEvent, reloadWebview, setWebviewBounds, setWebviewVisible } from '@/desktop/webviews'
import { createCommandHelpers } from '@/shared/commands/createCommandHelpers'
import { isDesktopEnvironment } from '@/shared/environment'
import { STORAGE_KEYS } from '../../../shared/storage-keys'
import { freshBuiltInRules, mergeStoredRules } from '../shared/interceptRules'

const SRC = 'https://treease.com/editor'
const WEBVIEW_ID = 'treease'
const RULES_STORAGE_KEY = STORAGE_KEYS.treeaseInterceptRules
const ENABLED_STORAGE_KEY = STORAGE_KEYS.treeaseInterceptEnabled

interface PatchRow {
  path: string
  text: string
}

interface RuleForm {
  id: string
  name: string
  enabled: boolean
  urlPattern: string
  action: 'modify' | 'block'
  rows: PatchRow[]
}

const isDesktop = ref(isDesktopEnvironment())

const { getApi: getTreeaseEditorApi } = createCommandHelpers('treeaseEditor', 'Treease 编辑器')

// 网页预览无 Tauri 桌面桥接时返回 null，调用方各自走降级分支
function getCommandApi() {
  try {
    return getTreeaseEditorApi()
  } catch {
    return null
  }
}

function genId(): string {
  return `rule_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
}

function toForm(rule: TreeaseInterceptRule): RuleForm {
  return {
    id: rule.id || genId(),
    name: rule.name || '',
    enabled: rule.enabled !== false,
    urlPattern: rule.urlPattern || '',
    action: rule.action,
    rows: rule.patches.length
      ? rule.patches.map(p => ({
          path: p.path,
          text: typeof p.value === 'string' ? p.value : JSON.stringify(p.value),
        }))
      : [{ path: '', text: '' }],
  }
}

function readStoredRules(): TreeaseInterceptRule[] {
  try {
    const raw = localStorage.getItem(RULES_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as TreeaseInterceptRule[]
      if (Array.isArray(parsed)) return mergeStoredRules(parsed)
    }
  } catch {
    // 忽略，使用内置规则
  }
  return freshBuiltInRules()
}

const ruleForms = ref<RuleForm[]>(readStoredRules().map(toForm))
const expanded = ref<string[]>(ruleForms.value.map(f => f.id))
// navigator.onLine 反映主机网络状态：离线时禁止清缓存刷新，避免删掉唯一可用的本地副本
function readOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

const isOnline = ref(readOnline())

function updateOnlineStatus() {
  isOnline.value = readOnline()
}
// 默认启用：除非用户之前手动关闭过
const interceptEnabled = ref(localStorage.getItem(ENABLED_STORAGE_KEY) !== '0')
const attached = ref(false)
const ruleCount = ref(0)
const hits = ref(0)
const starting = ref(false)
const showDialog = ref(false)
const webviewHost = ref<HTMLElement | null>(null)
let webviewReady = false
let webviewUnsub: (() => void) | null = null
let webviewObserver: ResizeObserver | null = null

let currentWebviewId: number | null = null
let offLog: (() => void) | null = null

function parseValue(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return ''
  try {
    return JSON.parse(trimmed)
  } catch {
    return text
  }
}

function buildRules(): TreeaseInterceptRule[] {
  return ruleForms.value.map(f => ({
    id: f.id,
    name: f.name.trim(),
    enabled: f.enabled,
    urlPattern: f.urlPattern.trim(),
    action: f.action,
    patches: f.action === 'block'
      ? []
      : f.rows
          .filter(r => r.path.trim())
          .map(r => ({ path: r.path.trim(), value: parseValue(r.text) })),
  }))
}

function hasActiveRule(rules: TreeaseInterceptRule[]): boolean {
  return rules.some(r => r.enabled && r.urlPattern && (r.action === 'block' || r.patches.length > 0))
}

function persistRules(rules: TreeaseInterceptRule[]) {
  // 配额满 / 隐私模式下 localStorage 写入会抛错，不能让规则保存连带中断后续流程
  try {
    localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules))
    localStorage.setItem(ENABLED_STORAGE_KEY, interceptEnabled.value ? '1' : '0')
  } catch (error) {
    logger.warn('Failed to persist intercept rules', { error: (error as Error).message })
  }
}

function ensureLogSubscription() {
  if (offLog) return
  const api = getCommandApi()
  if (!api) return
  offLog = api.on(api.commands.EVENT_INTERCEPT_LOG, (payload) => {
    const log = payload as TreeaseInterceptLog
    if (currentWebviewId !== null && log.webviewId !== currentWebviewId) return
    hits.value = log.hits
    attached.value = true
  })
}

function getWebviewId(): number | null {
  // Rust 侧固定以 1 作为当前子 Webview 的逻辑 ID
  return webviewReady ? 1 : null
}

function syncWebviewBounds() {
  const host = webviewHost.value
  if (!host || !webviewReady) return
  const rect = host.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) {
    void setWebviewVisible(WEBVIEW_ID, false).catch(() => {})
    return
  }
  void setWebviewBounds(WEBVIEW_ID, {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }).catch(() => {})
}

async function ensureWebview() {
  if (webviewReady || !isDesktop.value) return
  const host = webviewHost.value
  if (!host) return
  webviewReady = true
  const rect = host.getBoundingClientRect()
  webviewUnsub = onWebviewEvent(WEBVIEW_ID, (event) => {
    if (event.kind === 'loading-stop') handleWebviewReady()
  })
  try {
    await createWebview({
      id: WEBVIEW_ID,
      url: SRC,
      profile: 'treease',
      preset: 'treease',
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    })
    if (typeof ResizeObserver !== 'undefined') {
      webviewObserver = new ResizeObserver(() => syncWebviewBounds())
      webviewObserver.observe(host)
    }
    window.addEventListener('resize', syncWebviewBounds)
    document.addEventListener('scroll', syncWebviewBounds, true)
    syncWebviewBounds()
    handleWebviewReady()
  } catch (error) {
    webviewReady = false
    ElMessage.error(`页面内核创建失败：${(error as Error).message}`)
  }
}

function applyStatus(status: TreeaseInterceptStatus) {
  attached.value = status.attached
  ruleCount.value = status.ruleCount
  hits.value = status.hits
}

async function refreshStatus() {
  const api = getCommandApi()
  if (!api || currentWebviewId === null) return
  try {
    const status = await api.invoke(
      api.commands.INTERCEPT_STATUS,
      currentWebviewId,
    ) as TreeaseInterceptStatus | null
    if (status) applyStatus(status)
    else attached.value = false
  } catch {
    attached.value = false
  }
}

async function startIntercept() {
  const api = getCommandApi()
  if (!api) {
    ElMessage.warning(
      `接口拦截仅在 everydaytool 桌面端可用（Tauri=${isTauriEnvironment()}）。请在桌面窗口中打开工具页`,
    )
    return
  }
  const webviewId = getWebviewId()
  if (webviewId === null) {
    ElMessage.warning('页面内核未就绪，请等待页面加载完成')
    return
  }
  const rules = buildRules()
  if (!hasActiveRule(rules)) {
    ElMessage.warning('请至少启用一个接口规则（匹配 pattern，修改或屏蔽）')
    return
  }
  starting.value = true
  try {
    ensureLogSubscription()
    const status = await api.invoke(
      api.commands.INTERCEPT_START,
      webviewId,
      rules,
    ) as TreeaseInterceptStatus
    currentWebviewId = webviewId
    applyStatus(status)
    interceptEnabled.value = true
    persistRules(rules)
  } catch (e) {
    ElMessage.error((e as Error).message || '启动拦截失败')
  } finally {
    starting.value = false
  }
}

async function stopIntercept() {
  const api = getCommandApi()
  const rules = buildRules()
  if (api && currentWebviewId !== null) {
    try {
      await api.invoke(api.commands.INTERCEPT_STOP, currentWebviewId)
    } catch {
      // 忽略，后端可能已清理
    }
    ElMessage.info('已停止拦截')
  }
  attached.value = false
  interceptEnabled.value = false
  persistRules(rules)
}

async function applyRules() {
  const api = getCommandApi()
  if (!api || currentWebviewId === null) {
    ElMessage.warning('拦截未启动')
    return
  }
  const rules = buildRules()
  try {
    const status = await api.invoke(
      api.commands.INTERCEPT_UPDATE_RULES,
      currentWebviewId,
      rules,
    ) as TreeaseInterceptStatus
    applyStatus(status)
    persistRules(rules)
    ElMessage.success('规则已动态生效，后续响应将按新值修改')
  } catch (e) {
    ElMessage.error((e as Error).message || '更新规则失败')
  }
}

function addRule() {
  const form: RuleForm = { id: genId(), name: '', enabled: true, urlPattern: '', action: 'modify', rows: [{ path: '', text: '' }] }
  ruleForms.value.push(form)
  expanded.value.push(form.id)
}

async function resetToBuiltIn() {
  try {
    await ElMessageBox.confirm('将用代码内置规则覆盖当前全部配置，继续吗？', '恢复内置', { type: 'warning' })
  } catch {
    return
  }
  ruleForms.value = freshBuiltInRules().map(toForm)
  expanded.value = ruleForms.value.map(f => f.id)
  const rules = buildRules()
  persistRules(rules)
  if (attached.value) {
    await applyRules()
  } else {
    ElMessage.success('已恢复内置规则')
  }
}

function removeRule(index: number) {
  const [removed] = ruleForms.value.splice(index, 1)
  if (removed) expanded.value = expanded.value.filter(id => id !== removed.id)
  if (!ruleForms.value.length) addRule()
}

function addRow(form: RuleForm) {
  form.rows.push({ path: '', text: '' })
}

function removeRow(form: RuleForm, index: number) {
  form.rows.splice(index, 1)
  if (!form.rows.length) form.rows.push({ path: '', text: '' })
}

function handleWebviewReady() {
  if (!webviewReady) return
  currentWebviewId = 1
  void refreshStatus().then(() => {
    if (interceptEnabled.value && !attached.value && isDesktop.value && hasActiveRule(buildRules())) {
      void startIntercept()
    }
  })
}

async function handleReload() {
  if (!isOnline.value) {
    ElMessage.warning('当前处于离线状态，已保留本地缓存；恢复网络后再刷新获取最新内容')
    return
  }
  // 手动刷新 = 清页面缓存 + 重载：加载最新内容并重新缓存
  const api = getCommandApi()
  if (api && currentWebviewId !== null) {
    try {
      await api.invoke(api.commands.CACHE_CLEAR)
      ElMessage.success('已清除页面缓存，正在加载最新内容')
    } catch {
      // 忽略：继续刷新
    }
  }
  if (isDesktop.value) {
    try {
      await reloadWebview(WEBVIEW_ID)
    } catch {
      // 忽略：内核可能尚未就绪
    }
    return
  }
  const iframe = document.querySelector<HTMLIFrameElement>('#treease-frame')
  if (iframe) iframe.src = SRC
}

onMounted(async () => {
  ensureLogSubscription()
  window.addEventListener('online', updateOnlineStatus)
  window.addEventListener('offline', updateOnlineStatus)
  await nextTick()
  void ensureWebview()
})

onUnmounted(() => {
  offLog?.()
  offLog = null
  webviewUnsub?.()
  webviewUnsub = null
  webviewObserver?.disconnect()
  webviewObserver = null
  window.removeEventListener('resize', syncWebviewBounds)
  document.removeEventListener('scroll', syncWebviewBounds, true)
  window.removeEventListener('online', updateOnlineStatus)
  window.removeEventListener('offline', updateOnlineStatus)
  const api = getCommandApi()
  if (api && currentWebviewId !== null && attached.value) {
    void api.invoke(api.commands.INTERCEPT_STOP, currentWebviewId).catch(() => {})
  }
  if (webviewReady) {
    webviewReady = false
    void closeWebview(WEBVIEW_ID).catch(() => {})
  }
})
</script>

<template>
  <div class="treease-page">
    <UiToolbar bordered surface gap="sm" padding="8px 12px">
      <span class="muted toolbar-src">{{ SRC }}</span>
      <template #end>
        <el-tag v-if="attached" size="small" type="success">
          拦截中 · {{ ruleCount }} 个接口{{ hits > 0 ? ` · 命中 ${hits} 次` : '' }}
        </el-tag>
        <el-tag v-else size="small" type="info">
          未拦截
        </el-tag>
        <el-tag v-if="!isOnline" size="small" type="warning">
          离线 · 缓存模式
        </el-tag>
        <el-button size="small" :disabled="!isDesktop" @click="showDialog = true">
          拦截设置
        </el-button>
        <el-button size="small" title="清除页面缓存并重新加载最新内容" @click="handleReload">
          刷新
        </el-button>
      </template>
    </UiToolbar>
    <div class="treease-body">
      <div v-if="isDesktop" ref="webviewHost" class="tool-frame" />
      <iframe
        v-else
        id="treease-frame"
        :src="SRC"
        class="tool-frame"
        allow="fullscreen; clipboard-read; clipboard-write"
      />
    </div>

    <UiDialog v-model="showDialog" title="接口响应拦截" width="680px" destroy-on-close>
      <el-alert
        type="info"
        class="intercept-alert"
        :closable="false"
        show-icon
        title="每个接口独立规则"
        description="修改模式：命中后改写 JSON 响应体并返回，其余透传；屏蔽模式：请求直接失败不发出（如 sentry.io 上报）。注入式实现（页面 fetch / XHR），规则保存后立即动态生效。"
      />
      <el-collapse v-model="expanded">
        <el-collapse-item v-for="(form, ri) in ruleForms" :key="form.id" :name="form.id">
          <template #title>
            <el-switch v-model="form.enabled" size="small" @click.stop />
            <span class="rule-title-name">{{ form.name || '未命名接口' }}</span>
            <el-tag v-if="form.action === 'block'" size="small" type="danger" class="rule-action-tag">
              屏蔽
            </el-tag>
            <span class="rule-title-pattern">{{ form.urlPattern || '未配置匹配' }}</span>
          </template>
          <el-form label-width="90px">
            <el-form-item label="接口名称">
              <el-input v-model="form.name" placeholder="如：用量接口 / 屏蔽 sentry 上报" />
            </el-form-item>
            <el-form-item label="接口匹配">
              <el-input v-model="form.urlPattern" placeholder="*api.treease.com/v1/usage*，屏蔽如 *sentry.io*" />
            </el-form-item>
            <el-form-item label="动作">
              <el-select v-model="form.action">
                <el-option label="修改响应字段" value="modify" />
                <el-option label="屏蔽请求（不发出）" value="block" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="form.action === 'modify'" label="修改字段">
              <UiGroup direction="column" gap="sm" block>
                <div v-for="(row, i) in form.rows" :key="i" class="patch-row">
                  <el-input v-model="row.path" placeholder="JSON 路径，如 limits.aiProcessingMonthly.limit" />
                  <el-input v-model="row.text" placeholder="新值，JSON 格式，如 9999" />
                  <el-button size="small" type="danger" link @click="removeRow(form, i)">
                    删除
                  </el-button>
                </div>
                <UiGroup gap="sm">
                  <el-button size="small" plain @click="addRow(form)">
                    新增字段
                  </el-button>
                  <el-button size="small" type="danger" link @click="removeRule(ri)">
                    删除该接口
                  </el-button>
                </UiGroup>
              </UiGroup>
            </el-form-item>
            <el-form-item v-else label="说明">
              <UiHint>命中该匹配的请求将被拦截并返回 403，上报/遥测类接口适用。</UiHint>
              <UiGroup gap="sm" class="rule-delete-group">
                <el-button size="small" type="danger" link @click="removeRule(ri)">
                  删除该接口
                </el-button>
              </UiGroup>
            </el-form-item>
          </el-form>
        </el-collapse-item>
      </el-collapse>
      <UiGroup gap="sm" class="rule-actions">
        <el-button size="small" plain @click="addRule">
          新增接口
        </el-button>
        <el-button size="small" plain @click="resetToBuiltIn">
          恢复内置
        </el-button>
      </UiGroup>
      <UiGroup gap="sm" class="dialog-status">
        <span class="muted">状态：</span>
        <el-tag v-if="attached" size="small" type="success">
          拦截中 · {{ ruleCount }} 个接口{{ hits > 0 ? ` · 已命中 ${hits} 次` : ' · 等待请求' }}
        </el-tag>
        <el-tag v-else size="small" type="info">
          未启动
        </el-tag>
      </UiGroup>
      <template #footer>
        <el-button v-if="!attached" type="primary" :loading="starting" @click="startIntercept">
          启动拦截
        </el-button>
        <el-button v-if="attached" @click="applyRules">
          保存并应用
        </el-button>
        <el-button v-if="attached" type="danger" plain @click="stopIntercept">
          停止拦截
        </el-button>
      </template>
    </UiDialog>
  </div>
</template>

<style scoped lang="scss">
.treease-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--color-raised);
}

.toolbar-src {
  font-size: var(--font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.treease-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.tool-frame {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  width: 100%;
  border: 0;
}

.intercept-alert {
  margin-bottom: var(--spacing-md);
}

.rule-title-name {
  margin: 0 var(--spacing-sm);
  font-weight: var(--font-weight-semibold);
}

.rule-action-tag {
  margin: 0 var(--spacing-xs);
}

.rule-title-pattern {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.patch-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: var(--spacing-sm);
  align-items: center;
}

.rule-delete-group {
  margin-top: var(--spacing-sm);
}

.rule-actions {
  margin-top: var(--spacing-md);
}

.dialog-status {
  margin-top: var(--spacing-md);
  font-size: var(--font-size-sm);
}
</style>
