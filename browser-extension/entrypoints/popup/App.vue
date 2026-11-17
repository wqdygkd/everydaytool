<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getPopupTabs } from '../../lib/features/registry.ts'
import type { ShellConnectionState } from '../../lib/shell/types.ts'
import InterceptorPanel from '../../lib/features/interceptor/PopupPanel.vue'

const tabs = getPopupTabs()
const activeTab = ref(tabs[0]?.id ?? 'interceptor')
const state = ref<ShellConnectionState | null>(null)

const connLabel = computed(() => {
  if (!state.value) return '检测中…'
  if (state.value.connected) return `已连接（${state.value.appId}）`
  if (state.value.connecting) return '连接中…'
  return '未连接'
})

const showError = computed(() => {
  if (!state.value) return false
  return Boolean(state.value.lastError) || (!state.value.connected && !state.value.connecting)
})

const errorText = computed(() => {
  if (state.value?.lastError) return state.value.lastError
  return '未检测到 edt：请确认 everydaytool 正在运行。'
})

async function refreshState(): Promise<void> {
  state.value = await chrome.runtime.sendMessage({ type: 'get-shell-state' }) as ShellConnectionState
}

async function reconnect(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'shell-reconnect' })
  await refreshState()
}

function onRuntimeMessage(message: { type?: string, state?: ShellConnectionState }): void {
  if (message?.type === 'shell-state-changed' && message.state) {
    state.value = message.state
  }
}

onMounted(() => {
  void refreshState()
  chrome.runtime.onMessage.addListener(onRuntimeMessage)
})

onUnmounted(() => {
  chrome.runtime.onMessage.removeListener(onRuntimeMessage)
})
</script>

<template>
  <div class="popup">
    <header class="header">
      <span class="brand">everydaytool</span>
      <span
        class="dot"
        :class="{
          'dot-on': state?.connected,
          'dot-warn': !state?.connected && state?.connecting,
          'dot-off': !state?.connected && !state?.connecting,
        }"
      />
    </header>

    <section v-if="showError" class="error-box">
      <p>{{ errorText }}</p>
      <button type="button" class="btn btn-ghost" @click="reconnect">
        重新连接
      </button>
    </section>

    <section class="section">
      <div class="row">
        <span class="label">状态</span>
        <span class="value" :class="{ muted: !state?.connected }">{{ connLabel }}</span>
      </div>
      <div class="row">
        <span class="label">控制端口</span>
        <span class="value mono muted">{{ state?.wsPort ?? '—' }}</span>
      </div>
    </section>

    <nav v-if="tabs.length > 1" class="tabs" aria-label="模块">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </nav>

    <InterceptorPanel
      v-if="activeTab === 'interceptor'"
      :connected="Boolean(state?.connected)"
    />

    <footer class="footer">
      在 edt「拦截器」页面管理完整规则 / 流量日志。
    </footer>
  </div>
</template>
