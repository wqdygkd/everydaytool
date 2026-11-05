<script setup lang="ts">
import type { TreeaseInterceptLog, TreeaseInterceptRule, TreeaseInterceptStatus } from '../../../../shared/treease'
import { isElectronEnvironment } from '@renderer/shared/environment'
import { confirm } from '@renderer/shared/feedback'
import { useOnline } from '@vueuse/core'
import { toast } from 'vue-sonner'
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import WorkspaceHeader from '../../../../renderer/shared/components/workspace/WorkspaceHeader.vue'
import { STORAGE_KEYS } from '../../../../shared/storage-keys'
import { TREEASE_WEBVIEW_PARTITION } from '../../../../shared/webview'
import { getTreeaseEditorApi } from '../ipc'
import { freshBuiltInRules, mergeStoredRules } from '../shared/interceptRules'

const SRC = 'https://treease.com/editor'
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

const isElectron = ref(isElectronEnvironment())

// 网页预览无 preload 注入时返回 null，调用方各自走降级分支
function getIpc() {
  return getTreeaseEditorApi()
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
const isOnline = useOnline()
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

const statusLabel = computed(() => {
  if (attached.value) {
    return `拦截中 · ${ruleCount.value} 个接口${hits.value > 0 ? ` · 命中 ${hits.value}` : ''}`
  }
  return isOnline.value ? '未拦截' : '离线 · 缓存模式'
})
const statusTone = computed<'neutral' | 'success' | 'warning'>(() => {
  if (attached.value) return 'success'
  return isOnline.value ? 'neutral' : 'warning'
})

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

/** LocalStorage 镜像写入：配额满 / 隐私模式下会抛错，只影响镜像，不影响配置层 */
function writeLocalMirror(rules: TreeaseInterceptRule[]) {
  try {
    localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules))
    localStorage.setItem(ENABLED_STORAGE_KEY, interceptEnabled.value ? '1' : '0')
  } catch {
    // 镜像写不进去不影响功能：配置层文件才是事实来源
  }
}

/**
 * 保存规则：**配置层文件是唯一事实来源**（`<data>/config/treease-editor/rules.json`），
 * LocalStorage 只做镜像（网页预览 / IPC 不可用时的降级）。
 */
function persistRules(rules: TreeaseInterceptRule[]) {
  writeLocalMirror(rules)
  const api = getIpc()
  if (!api) return
  void api.invoke(api.channels.RULES_SET, rules, interceptEnabled.value).catch((error: unknown) => {
    // 写盘失败不回滚 UI（用户还能继续调），下次保存会再试
    toast.error((error as Error).message || '规则保存到数据目录失败')
  })
}

/**
 * 挂载时与配置层对齐：
 * - 配置层有规则 → 以它为准覆盖 UI（并刷新镜像）；
 * - 配置层为空 → 把 LocalStorage 里已有的规则迁上去（旧版本数据的一次性迁移）。
 */
async function syncRulesWithConfigLayer() {
  const api = getIpc()
  if (!api) return
  try {
    const document = await api.invoke(api.channels.RULES_GET) as { rules?: TreeaseInterceptRule[], enabled?: boolean }
    const stored = Array.isArray(document?.rules) ? document.rules : []
    if (stored.length > 0) {
      ruleForms.value = mergeStoredRules(stored).map(toForm)
      expanded.value = ruleForms.value.map(f => f.id)
      interceptEnabled.value = document?.enabled !== false
      writeLocalMirror(buildRules())
      return
    }
    const local = buildRules()
    if (local.length > 0) await api.invoke(api.channels.RULES_SET, local, interceptEnabled.value)
  } catch {
    // 配置层暂不可用（IPC 未就绪 / 文件损坏）：继续用镜像，不打断页面
  }
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
    toast.warning(
      `接口拦截仅在 Electron 桌面端可用（当前：edtRuntime=${Boolean(w.edtRuntime)}，UA含Electron=${navigator.userAgent.includes('Electron')}）。请完全退出 Electron 后重跑 pnpm dev`,
    )
    return
  }
  const guestId = getGuestId()
  if (guestId === null) {
    toast.warning('页面内核未就绪，请等待页面加载完成')
    return
  }
  const rules = buildRules()
  if (!hasActiveRule(rules)) {
    toast.warning('请至少启用一个接口规则（匹配 pattern，修改或屏蔽）')
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
    toast.error((e as Error).message || '启动拦截失败')
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
    toast.info('已停止拦截')
  }
  attached.value = false
  interceptEnabled.value = false
  persistRules(rules)
}

async function applyRules() {
  const api = getIpc()
  if (!api || currentWebContentsId === null) {
    toast.warning('拦截未启动')
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
    toast.success('规则已动态生效，后续响应将按新值修改')
  } catch (e) {
    toast.error((e as Error).message || '更新规则失败')
  }
}

function addRule() {
  const form: RuleForm = { id: genId(), name: '', enabled: true, urlPattern: '', action: 'modify', rows: [{ path: '', text: '' }] }
  ruleForms.value.push(form)
  expanded.value.push(form.id)
}

async function resetToBuiltIn() {
  try {
    await confirm('将用代码内置规则覆盖当前全部配置，继续吗？', '恢复内置', { type: 'warning' })
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
    toast.success('已恢复内置规则')
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
    toast.warning('当前处于离线状态，已保留本地缓存；恢复网络后再刷新获取最新内容')
    return
  }
  // 手动刷新 = 清页面缓存 + 重载：加载最新内容并重新缓存
  const api = getIpc()
  if (api && currentWebContentsId !== null) {
    try {
      await api.invoke(api.channels.CACHE_CLEAR)
      toast.success('已清除页面缓存，正在加载最新内容')
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
  // 规则以配置层文件为准：晚一步加载，避免与首屏镜像渲染互相覆盖
  void syncRulesWithConfigLayer()
})

onUnmounted(() => {
  offLog?.()
  offLog = null
  const api = getIpc()
  if (api && currentWebContentsId !== null && attached.value) {
    void api.invoke(api.channels.INTERCEPT_STOP, currentWebContentsId).catch(() => {})
  }
})
</script>

<template>
  <div class="treease-page tool-page">
    <WorkspaceHeader
      icon="treease"
      title="Treease 编辑器"
      description="内嵌编辑器，按接口规则实时改写或屏蔽响应"
      :status-label="statusLabel"
      :status-tone="statusTone"
    >
      <template #actions>
        <UiButton size="small" :disabled="!isElectron" @click="showDialog = true">
          拦截设置
        </UiButton>
        <UiButton size="small" title="清除页面缓存并重新加载最新内容" @click="handleReload">
          刷新
        </UiButton>
      </template>
    </WorkspaceHeader>

    <ToolSurface class="treease-surface">
      <template #toolbar>
        <UiToolbar gap="sm" flush>
          <span class="toolbar-src mono">{{ SRC }}</span>
          <UiChip v-if="!isOnline" tone="warning" variant="soft">
            离线 · 缓存模式
          </UiChip>
          <template #end>
            <span class="toolbar-hint">规则由子路由与配置层恢复，页面关闭即释放</span>
          </template>
        </UiToolbar>
      </template>

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

      <template #statusline>
        <span>TREEASE EDITOR</span>
        <span v-if="attached" class="mono">{{ ruleCount }} RULES · {{ hits }} HITS</span>
        <span class="status-spacer" />
        <span>{{ isOnline ? 'ONLINE' : 'CACHE ONLY' }}</span>
      </template>
    </ToolSurface>

    <UiDialog v-model="showDialog" title="接口响应拦截" width="680px" destroy-on-close>
      <UiAlert
        type="info"
        class="intercept-alert"
        :closable="false"
        show-icon
        title="每个接口独立规则"
        description="修改模式：命中后改写 JSON 响应体并返回，其余透传；屏蔽模式：请求直接失败不发出（如 sentry.io 上报）。协议层实现，规则保存后立即动态生效。"
      />
      <UiCollapse v-model="expanded">
        <UiCollapseItem v-for="(form, ri) in ruleForms" :key="form.id" :name="form.id">
          <template #title>
            <UiSwitchField v-model="form.enabled" @click.stop />
            <span class="rule-title-name">{{ form.name || '未命名接口' }}</span>
            <UiChip v-if="form.action === 'block'" tone="danger" variant="soft" class="rule-action-tag">
              屏蔽
            </UiChip>
            <span class="rule-title-pattern">{{ form.urlPattern || '未配置匹配' }}</span>
          </template>
          <div class="config-form">
            <UiFormField label-width="90px" label="接口名称">
              <UiInput v-model="form.name" placeholder="如：用量接口 / 屏蔽 sentry 上报" />
            </UiFormField>
            <UiFormField label-width="90px" label="接口匹配">
              <UiInput v-model="form.urlPattern" placeholder="*api.treease.com/v1/usage*，屏蔽如 *sentry.io*" />
            </UiFormField>
            <UiFormField label-width="90px" label="动作">
              <UiSelect v-model="form.action" :options="[{ label: '修改响应字段', value: 'modify' }, { label: '屏蔽请求（不发出）', value: 'block' }]" />
            </UiFormField>
            <UiFormField v-if="form.action === 'modify'" label-width="90px" label="修改字段">
              <UiGroup direction="column" gap="sm" block>
                <div v-for="(row, i) in form.rows" :key="i" class="patch-row">
                  <UiInput v-model="row.path" placeholder="JSON 路径，如 limits.aiProcessingMonthly.limit" />
                  <UiInput v-model="row.text" placeholder="新值，JSON 格式，如 9999" />
                  <UiButton size="small" type="danger" link @click="removeRow(form, i)">
                    删除
                  </UiButton>
                </div>
                <UiGroup gap="sm">
                  <UiButton size="small" plain @click="addRow(form)">
                    新增字段
                  </UiButton>
                  <UiButton size="small" type="danger" link @click="removeRule(ri)">
                    删除该接口
                  </UiButton>
                </UiGroup>
              </UiGroup>
            </UiFormField>
            <UiFormField v-else label-width="90px" label="说明">
              <UiHint>命中该匹配的请求将被拦截并返回 403，上报/遥测类接口适用。</UiHint>
              <UiGroup gap="sm" class="rule-delete-group">
                <UiButton size="small" type="danger" link @click="removeRule(ri)">
                  删除该接口
                </UiButton>
              </UiGroup>
            </UiFormField>
          </div>
        </UiCollapseItem>
      </UiCollapse>
      <UiGroup gap="sm" class="rule-actions">
        <UiButton size="small" plain @click="addRule">
          新增接口
        </UiButton>
        <UiButton size="small" plain @click="resetToBuiltIn">
          恢复内置
        </UiButton>
      </UiGroup>
      <UiGroup gap="sm" class="dialog-status">
        <span class="muted">状态：</span>
        <UiChip v-if="attached" tone="success" variant="soft">
          拦截中 · {{ ruleCount }} 个接口{{ hits > 0 ? ` · 已命中 ${hits} 次` : ' · 等待请求' }}
        </UiChip>
        <UiChip v-else tone="info" variant="soft">
          未启动
        </UiChip>
      </UiGroup>
      <template #footer>
        <UiButton v-if="!attached" type="primary" :loading="starting" @click="startIntercept">
          启动拦截
        </UiButton>
        <UiButton v-if="attached" @click="applyRules">
          保存并应用
        </UiButton>
        <UiButton v-if="attached" type="danger" plain @click="stopIntercept">
          停止拦截
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<style scoped lang="scss">
.treease-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0 18px 18px;
  overflow: hidden;
}

.treease-surface {
  min-height: 0;
}

.toolbar-src {
  flex: 1;
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toolbar-hint {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.treease-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.tool-frame {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  width: 100%;
  border: 0;
  background: var(--color-on-solid);
}

.status-spacer {
  flex: 1;
}

.intercept-alert {
  margin-bottom: var(--spacing-md);
}

.rule-title-name {
  margin: 0 var(--spacing-sm);
  font-weight: var(--font-weight-medium);
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
