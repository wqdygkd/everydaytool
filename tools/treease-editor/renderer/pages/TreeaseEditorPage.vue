<script setup lang="ts">
import type { TreeaseInterceptLog, TreeaseInterceptRule, TreeaseInterceptStatus } from '../../../../shared/types'
import { isElectronEnvironment } from '@renderer/shared/environment'
import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'
import { TREEASE_WEBVIEW_PARTITION } from '../../../../shared/webview'
import { freshBuiltInRules, mergeStoredRules } from '../shared/interceptRules'

const SRC = 'https://treease.com/editor'
const RULES_STORAGE_KEY = 'edt:treease-intercept-rules'
const ENABLED_STORAGE_KEY = 'edt:treease-intercept-enabled'

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

const isElectron = ref(isElectronEnvironment())

const { getApi: getTreeaseEditorApi } = createIpcHelpers('treeaseEditor', 'Treease 编辑器')

// 网页预览无 preload 注入时返回 null，调用方各自走降级分支
function getIpc() {
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
const webviewRef = ref<HTMLElement | null>(null)

let currentWebContentsId: number | null = null
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
  localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules))
  localStorage.setItem(ENABLED_STORAGE_KEY, interceptEnabled.value ? '1' : '0')
}

function ensureLogSubscription() {
  if (offLog) return
  const api = getIpc()
  if (!api) return
  offLog = api.on(api.channels.EVENT_INTERCEPT_LOG, (payload) => {
    const log = payload as TreeaseInterceptLog
    if (currentWebContentsId !== null && log.webContentsId !== currentWebContentsId) return
    hits.value = log.hits
    attached.value = true
  })
}

function getGuestId(): number | null {
  const el = webviewRef.value as unknown as { getWebContentsId?: () => number } | null
  if (!el || typeof el.getWebContentsId !== 'function') return null
  try {
    const id = el.getWebContentsId()
    return Number.isInteger(id) ? id : null
  } catch {
    return null
  }
}

function applyStatus(status: TreeaseInterceptStatus) {
  attached.value = status.attached
  ruleCount.value = status.ruleCount
  hits.value = status.hits
}

async function refreshStatus() {
  const api = getIpc()
  if (!api || currentWebContentsId === null) return
  try {
    const status = await api.invoke(
      api.channels.INTERCEPT_STATUS,
      currentWebContentsId,
    ) as TreeaseInterceptStatus | null
    if (status) applyStatus(status)
    else attached.value = false
  } catch {
    attached.value = false
  }
}

async function startIntercept() {
  const api = getIpc()
  if (!api) {
    const w = window as unknown as Record<string, unknown>
    ElMessage.warning(
      `接口拦截仅在 Electron 桌面端可用（当前：envBrowser=${Boolean(w.envBrowser)}，edtRuntime=${Boolean(w.edtRuntime)}，UA含Electron=${navigator.userAgent.includes('Electron')}）。请完全退出 Electron 后重跑 pnpm dev`,
    )
    return
  }
  const guestId = getGuestId()
  if (guestId === null) {
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
      api.channels.INTERCEPT_START,
      guestId,
      rules,
    ) as TreeaseInterceptStatus
    currentWebContentsId = guestId
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
  const api = getIpc()
  const rules = buildRules()
  if (api && currentWebContentsId !== null) {
    try {
      await api.invoke(api.channels.INTERCEPT_STOP, currentWebContentsId)
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
  const api = getIpc()
  if (!api || currentWebContentsId === null) {
    ElMessage.warning('拦截未启动')
    return
  }
  const rules = buildRules()
  try {
    const status = await api.invoke(
      api.channels.INTERCEPT_UPDATE_RULES,
      currentWebContentsId,
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
  const guestId = getGuestId()
  if (guestId === null) return
  if (guestId === currentWebContentsId && attached.value) return
  currentWebContentsId = guestId
  void refreshStatus().then(() => {
    if (interceptEnabled.value && !attached.value && isElectron.value && hasActiveRule(buildRules())) {
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
  const api = getIpc()
  if (api && currentWebContentsId !== null) {
    try {
      await api.invoke(api.channels.CACHE_CLEAR)
      ElMessage.success('已清除页面缓存，正在加载最新内容')
    } catch {
      // 忽略：继续刷新
    }
  }
  const el = webviewRef.value as unknown as { reload?: () => void } | null
  if (el?.reload) {
    el.reload()
    return
  }
  const iframe = document.querySelector<HTMLIFrameElement>('#treease-frame')
  if (iframe) iframe.src = SRC
}

onMounted(() => {
  ensureLogSubscription()
  window.addEventListener('online', updateOnlineStatus)
  window.addEventListener('offline', updateOnlineStatus)
})

onUnmounted(() => {
  offLog?.()
  offLog = null
  window.removeEventListener('online', updateOnlineStatus)
  window.removeEventListener('offline', updateOnlineStatus)
  const api = getIpc()
  if (api && currentWebContentsId !== null && attached.value) {
    void api.invoke(api.channels.INTERCEPT_STOP, currentWebContentsId).catch(() => {})
  }
})
</script>

<template>
  <div class="treease-page">
    <div class="treease-toolbar">
      <span class="muted toolbar-src">{{ SRC }}</span>
      <div class="toolbar-actions">
        <el-tag v-if="attached" size="small" type="success">
          拦截中 · {{ ruleCount }} 个接口{{ hits > 0 ? ` · 命中 ${hits} 次` : '' }}
        </el-tag>
        <el-tag v-else size="small" type="info">
          未拦截
        </el-tag>
        <el-tag v-if="!isOnline" size="small" type="warning">
          离线 · 缓存模式
        </el-tag>
        <el-button size="small" :disabled="!isElectron" @click="showDialog = true">
          拦截设置
        </el-button>
        <el-button size="small" title="清除页面缓存并重新加载最新内容" @click="handleReload">
          刷新
        </el-button>
      </div>
    </div>
    <div class="treease-body">
      <webview
        v-if="isElectron"
        ref="webviewRef"
        :src="SRC"
        :partition="TREEASE_WEBVIEW_PARTITION"
        allowpopups
        class="tool-frame"
        @dom-ready="handleWebviewReady"
      />
      <iframe
        v-else
        id="treease-frame"
        :src="SRC"
        class="tool-frame"
        allow="fullscreen; clipboard-read; clipboard-write"
      />
    </div>

    <el-dialog v-model="showDialog" title="接口响应拦截" width="680px" destroy-on-close>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="每个接口独立规则"
        description="修改模式：命中后改写 JSON 响应体并返回，其余透传；屏蔽模式：请求直接失败不发出（如 sentry.io 上报）。协议层实现，规则保存后立即动态生效。"
        style="margin-bottom:12px"
      />
      <el-collapse v-model="expanded">
        <el-collapse-item v-for="(form, ri) in ruleForms" :key="form.id" :name="form.id">
          <template #title>
            <el-switch v-model="form.enabled" size="small" @click.stop />
            <span class="rule-title-name">{{ form.name || '未命名接口' }}</span>
            <el-tag v-if="form.action === 'block'" size="small" type="danger" style="margin:0 4px">
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
              <el-select v-model="form.action" style="width:100%">
                <el-option label="修改响应字段" value="modify" />
                <el-option label="屏蔽请求（不发出）" value="block" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="form.action === 'modify'" label="修改字段">
              <div class="patch-list">
                <div v-for="(row, i) in form.rows" :key="i" class="patch-row">
                  <el-input v-model="row.path" placeholder="JSON 路径，如 limits.aiProcessingMonthly.limit" />
                  <el-input v-model="row.text" placeholder="新值，JSON 格式，如 9999" />
                  <el-button size="small" type="danger" link @click="removeRow(form, i)">
                    删除
                  </el-button>
                </div>
                <div class="patch-actions">
                  <el-button size="small" plain @click="addRow(form)">
                    新增字段
                  </el-button>
                  <el-button size="small" type="danger" link @click="removeRule(ri)">
                    删除该接口
                  </el-button>
                </div>
              </div>
            </el-form-item>
            <el-form-item v-else label="说明">
              <span style="color:var(--color-text-secondary);font-size:var(--font-size-sm)">命中该匹配的请求将在发出前被拦截（BlockedByClient），上报/遥测类接口适用。</span>
              <div class="patch-actions" style="margin-top:8px">
                <el-button size="small" type="danger" link @click="removeRule(ri)">
                  删除该接口
                </el-button>
              </div>
            </el-form-item>
          </el-form>
        </el-collapse-item>
      </el-collapse>
      <div class="rule-actions">
        <el-button size="small" plain @click="addRule">
          新增接口
        </el-button>
        <el-button size="small" plain @click="resetToBuiltIn">
          恢复内置
        </el-button>
      </div>
      <div class="dialog-status">
        <span class="muted">状态：</span>
        <el-tag v-if="attached" size="small" type="success">
          拦截中 · {{ ruleCount }} 个接口{{ hits > 0 ? ` · 已命中 ${hits} 次` : ' · 等待请求' }}
        </el-tag>
        <el-tag v-else size="small" type="info">
          未启动
        </el-tag>
      </div>
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
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.treease-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--color-surface);
}

.treease-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-light);
  background: var(--color-surface-raised);

  .toolbar-src {
    font-size: var(--font-size-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
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

.rule-title-name {
  margin: 0 8px;
  font-weight: var(--font-weight-semibold);
}

.rule-title-pattern {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.patch-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.patch-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.patch-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.rule-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.dialog-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: var(--font-size-sm);
}
</style>
