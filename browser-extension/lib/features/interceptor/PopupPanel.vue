<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type {
  InterceptorRuleSummary,
  InterceptorTarget,
} from '../../../../shared/interceptor.ts'

const props = defineProps<{
  connected: boolean
}>()

type PopupState = {
  connected: boolean
  connecting: boolean
  lastError: string | null
  proxyEnabled: boolean
  proxyPort: number | null
  wsPort: number | null
  appId: string
  scriptSupported: boolean
  targets: InterceptorTarget[]
  rules: InterceptorRuleSummary[]
}

type SiteInfo = {
  ok?: boolean
  local?: boolean
  error?: string
  targets?: InterceptorTarget[]
  related?: InterceptorTarget[]
  rules?: Array<InterceptorRuleSummary & { scope?: 'global' | 'site' }>
  total?: number
}

type EntryTag = { text: string, tone?: 'plain' | 'ok' | 'muted' | 'warn' }

const popupState = ref<PopupState | null>(null)
const currentUrl = ref<string | null>(null)
const currentHost = ref('—')
const siteInfo = ref<SiteInfo>({})
const suggestHosts = ref<string[]>([])
const proxyBusy = ref(false)
const refreshBusy = ref(false)
const actionError = ref<string | null>(null)

const proxyEnabled = computed(() => Boolean(popupState.value?.proxyEnabled))
const proxyPortLabel = computed(() => popupState.value?.proxyPort ? String(popupState.value.proxyPort) : '—')
const proxyDisabled = computed(() => {
  const state = popupState.value
  if (!state) return true
  return !state.connected && !state.proxyEnabled
})
const scriptSupported = computed(() => popupState.value?.scriptSupported !== false)

const targetCountLabel = computed(() => {
  const info = siteInfo.value
  const targets = info.targets || []
  const related = info.related || []
  const total = typeof info.total === 'number' ? info.total : targets.length + related.length
  return total ? `（本站 ${targets.length} / 共 ${total}）` : ''
})

const targetHint = computed(() => {
  const info = siteInfo.value
  const targets = info.targets || []
  const total = typeof info.total === 'number' ? info.total : 0
  if (info.error) return info.error
  if (!targets.length && total > 0) return `名单里有 ${total} 条配置，但都不匹配当前站点。`
  return ''
})

const ruleHint = computed(() => {
  const info = siteInfo.value
  if (info.local && info.error) return `${info.error}（规则未按域过滤）`
  return ''
})

const relatedVisible = computed(() => (siteInfo.value.related || []).length > 0)

function send<T = unknown>(message: Record<string, unknown>): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

function targetTags(target: InterceptorTarget, dimmed: boolean): EntryTag[] {
  return [
    ...(dimmed ? [{ text: '未命中', tone: 'plain' as const }] : []),
    ...(target.enabled === false ? [{ text: '已禁用', tone: 'plain' as const }] : []),
  ]
}

function ruleTags(rule: InterceptorRuleSummary & { scope?: 'global' | 'site' }): EntryTag[] {
  return [
    { text: rule.scope === 'global' ? '全局' : '本站', tone: rule.scope === 'global' ? 'plain' : 'ok' },
    { text: rule.typeLabel || rule.type, tone: 'plain' },
    { text: rule.condition, tone: 'muted' },
    ...(rule.enabled === false ? [{ text: '已禁用', tone: 'plain' as const }] : []),
  ]
}

async function refreshSiteLists(): Promise<void> {
  if (!currentUrl.value) {
    siteInfo.value = { targets: [], related: [], rules: [], total: 0 }
    return
  }
  try {
    siteInfo.value = await send<SiteInfo>({ type: 'get-site-info', url: currentUrl.value }) || {}
  }
  catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    siteInfo.value = { ok: false, error: `站点查询失败：${message}`, targets: [], related: [], rules: [] }
  }
}

async function refreshSuggestions(): Promise<void> {
  if (!currentUrl.value || !popupState.value?.connected) {
    suggestHosts.value = []
    return
  }
  const result = await send<{ hosts?: string[] }>({ type: 'suggest-targets', url: currentUrl.value })
  const hostname = (() => {
    try {
      return new URL(currentUrl.value!).hostname
    }
    catch {
      return ''
    }
  })()
  suggestHosts.value = (result?.hosts || [])
    .filter(host => host !== hostname)
    .slice(0, 8)
}

async function refresh(): Promise<void> {
  actionError.value = null
  try {
    popupState.value = await send<PopupState>({ type: 'get-popup-state' })
  }
  catch {
    return
  }
  if (!popupState.value) return

  const tab = await getActiveTab()
  currentUrl.value = tab?.url && /^https?:/.test(tab.url) ? tab.url : null
  if (currentUrl.value) {
    try {
      const url = new URL(currentUrl.value)
      currentHost.value = `${url.protocol}//${url.host}`
    }
    catch {
      currentHost.value = '—'
    }
    await refreshSiteLists()
    await refreshSuggestions()
  }
  else {
    currentHost.value = '当前标签不是网页'
    siteInfo.value = { targets: [], related: [], rules: [] }
    suggestHosts.value = []
  }
}

async function onProxyToggle(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  proxyBusy.value = true
  try {
    const result = await send<{ ok?: boolean, error?: string }>({ type: 'set-proxy', enabled: input.checked })
    if (result && result.ok === false) {
      input.checked = false
      actionError.value = result.error || '操作失败'
      return
    }
    setTimeout(() => { void refresh() }, 400)
  }
  finally {
    proxyBusy.value = false
  }
}

async function addCurrentSite(): Promise<void> {
  if (!currentUrl.value) return
  const result = await send<{ ok?: boolean }>({ type: 'add-target', url: currentUrl.value })
  if (result?.ok) setTimeout(() => { void refreshSiteLists() }, 300)
}

async function reconnectAndRefresh(): Promise<void> {
  refreshBusy.value = true
  try {
    await send({ type: 'shell-reconnect' })
    await refresh()
  }
  finally {
    refreshBusy.value = false
  }
}

async function toggleTarget(id: string, enabled: boolean): Promise<void> {
  await send({ type: 'toggle-target', id, enabled })
  setTimeout(() => { void refreshSiteLists() }, 250)
}

async function removeTarget(id: string): Promise<void> {
  await send({ type: 'remove-target-id', id })
  setTimeout(() => { void refreshSiteLists() }, 250)
}

async function toggleRule(id: string, enabled: boolean): Promise<void> {
  await send({ type: 'toggle-rule', id, enabled })
  setTimeout(() => { void refreshSiteLists() }, 250)
}

async function removeRule(id: string): Promise<void> {
  await send({ type: 'remove-rule', id })
  setTimeout(() => { void refreshSiteLists() }, 250)
}

async function addSuggestHost(host: string): Promise<void> {
  await send({ type: 'add-target', url: `http://${host}/`, key: 'host', operator: 'equals' })
  setTimeout(() => { void refreshSiteLists() }, 250)
}

function onRuntimeMessage(message: { type?: string }): void {
  if (message?.type === 'popup-state-changed') void refresh()
}

watch(() => props.connected, () => {
  void refresh()
})

onMounted(() => {
  void refresh()
  chrome.runtime.onMessage.addListener(onRuntimeMessage)
})

onUnmounted(() => {
  chrome.runtime.onMessage.removeListener(onRuntimeMessage)
})
</script>

<template>
  <div class="interceptor-panel">
    <section v-if="actionError" class="error-box">
      <p>{{ actionError }}</p>
    </section>

    <section class="section">
      <div class="row">
        <span class="label">代理端口</span>
        <span class="value mono muted">{{ proxyPortLabel }}</span>
      </div>
      <div class="row">
        <span class="label">挂载代理（启用 edt 处理）</span>
        <label class="switch">
          <input
            type="checkbox"
            :checked="proxyEnabled"
            :disabled="proxyDisabled || proxyBusy"
            @change="onProxyToggle"
          >
          <span class="slider" />
        </label>
      </div>
      <p class="hint">
        edt 断开时自动恢复直连；处理范围由 edt 侧处理名单决定。
      </p>
    </section>

    <section class="section">
      <div class="label">
        当前站点
      </div>
      <p class="host">
        {{ currentHost }}
      </p>
      <div class="row wrap">
        <button
          type="button"
          class="btn"
          :disabled="!currentUrl"
          @click="addCurrentSite"
        >
          加入名单（当前 origin）
        </button>
      </div>
      <p class="hint">
        名单是<strong>白名单闸门</strong>，只按请求的 origin（协议 + 域名 + 端口）判定：命中才拆包、记流量并交给<strong>规则</strong>；没命中整条透传、规则不跑。
      </p>
    </section>

    <section class="section">
      <div class="row">
        <span class="label">处理名单 <span class="muted">{{ targetCountLabel }}</span></span>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="refreshBusy"
          @click="reconnectAndRefresh"
        >
          {{ refreshBusy ? '刷新中…' : '重连并刷新' }}
        </button>
      </div>
      <p v-if="targetHint" class="hint">
        {{ targetHint }}
      </p>
      <ul class="entry-list">
        <li v-if="!(siteInfo.targets || []).length" class="muted">
          {{ !currentUrl ? '当前标签不是网页' : (siteInfo.error || '当前站点未命中名单') }}
        </li>
        <li
          v-for="target in siteInfo.targets || []"
          :key="target.id"
          class="entry"
        >
          <div class="entry-main">
            <span class="mono entry-title">{{ target.origin }}</span>
            <span
              v-for="(tag, i) in targetTags(target, false)"
              :key="i"
              class="tag"
              :class="tag.tone ? `tag-${tag.tone}` : undefined"
            >{{ tag.text }}</span>
          </div>
          <div class="entry-actions">
            <label class="switch switch-sm">
              <input
                type="checkbox"
                :checked="target.enabled !== false"
                @change="toggleTarget(target.id, ($event.target as HTMLInputElement).checked)"
              >
              <span class="slider" />
            </label>
            <button type="button" class="btn btn-danger btn-sm" @click="removeTarget(target.id)">
              移除
            </button>
          </div>
        </li>
      </ul>
      <div v-if="relatedVisible" class="related-wrap">
        <div class="sub-label">
          同主机、不同 origin（当前站点未命中）
        </div>
        <ul class="entry-list entry-list-dim">
          <li
            v-for="target in siteInfo.related || []"
            :key="target.id"
            class="entry"
          >
            <div class="entry-main">
              <span class="mono entry-title">{{ target.origin }}</span>
              <span
                v-for="(tag, i) in targetTags(target, true)"
                :key="i"
                class="tag"
                :class="tag.tone ? `tag-${tag.tone}` : undefined"
              >{{ tag.text }}</span>
            </div>
            <div class="entry-actions">
              <label class="switch switch-sm">
                <input
                  type="checkbox"
                  :checked="target.enabled !== false"
                  @change="toggleTarget(target.id, ($event.target as HTMLInputElement).checked)"
                >
                <span class="slider" />
              </label>
              <button type="button" class="btn btn-danger btn-sm" @click="removeTarget(target.id)">
                移除
              </button>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <section class="section">
      <div class="label">
        可用规则 <span class="muted">{{ (siteInfo.rules || []).length ? `（${(siteInfo.rules || []).length}）` : '' }}</span>
      </div>
      <p v-if="ruleHint" class="hint">
        {{ ruleHint }}
      </p>
      <p class="hint">
        按当前页面的域筛选：本站规则在前，不绑定域的全局规则在后（都可禁用 / 移除）。
      </p>
      <ul class="entry-list">
        <li v-if="!(siteInfo.rules || []).length" class="muted">
          {{ !currentUrl ? '当前标签不是网页' : '该站点没有可用规则' }}
        </li>
        <li
          v-for="rule in siteInfo.rules || []"
          :key="rule.id"
          class="entry"
        >
          <div class="entry-main">
            <span class="entry-title">{{ rule.name || '未命名规则' }}</span>
            <span
              v-for="(tag, i) in ruleTags(rule)"
              :key="i"
              class="tag"
              :class="tag.tone ? `tag-${tag.tone}` : undefined"
            >{{ tag.text }}</span>
          </div>
          <div class="entry-actions">
            <label class="switch switch-sm">
              <input
                type="checkbox"
                :checked="rule.enabled !== false"
                @change="toggleRule(rule.id, ($event.target as HTMLInputElement).checked)"
              >
              <span class="slider" />
            </label>
            <button type="button" class="btn btn-danger btn-sm" @click="removeRule(rule.id)">
              移除
            </button>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="scriptSupported" class="section">
      <div class="label">
        相关域名（来自 edt 流量）
      </div>
      <ul class="suggest-list">
        <li v-if="!suggestHosts.length" class="muted">
          暂无（先让页面产生一些经过 edt 的请求）
        </li>
        <li v-for="host in suggestHosts" :key="host">
          <span>{{ host }}</span>
          <button type="button" class="suggest-add" @click="addSuggestHost(host)">
            + 加入
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
