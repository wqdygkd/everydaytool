<script setup lang="ts">
import type { EnvConfig } from '../stores/envStore'
import { openExternal } from '@/desktop/platform'
import { isTauriEnvironment } from '@/desktop/tauri'
import { isDesktopEnvironment } from '@/shared/environment'
import EnvDialog from '../components/EnvDialog.vue'
import { useWebview } from '../composables/useWebview'
import { useEnvBrowserStore } from '../stores/envStore'

const store = useEnvBrowserStore()
const showDialog = ref(false)
const editing = ref<EnvConfig | null>(null)
const search = ref('')

const isDesktop = isDesktopEnvironment()

// 调试信息在 script 里取值：模板直接写 window / navigator 会被编译成 _ctx.window 而渲染崩溃
const webDebugInfo = computed(() => ({
  tauri: isTauriEnvironment(),
  ua: navigator.userAgent.slice(0, 80),
}))

const {
  webviewRefs,
  webviewStatus,
  loadingIds,
  getPartition,
  setWebviewRef,
  cleanup,
  cleanupAll,
  triggerAutoLogin,
} = useWebview((id: string) => store.envs.find(e => e.id === id))

const activeEnv = computed(() => store.envs.find(e => e.id === store.activeId))

const filteredEnvs = computed(() => {
  const kw = search.value.trim().toLowerCase()
  if (!kw) return store.envs
  return store.envs.filter(
    e => e.name.toLowerCase().includes(kw)
      || e.url.toLowerCase().includes(kw)
      || e.username.toLowerCase().includes(kw),
  )
})

function onCreate() {
  editing.value = null
  showDialog.value = true
}

function onEdit(env: EnvConfig) {
  editing.value = env
  showDialog.value = true
}

async function onDelete(env: EnvConfig) {
  try {
    await ElMessageBox.confirm(`确定删除环境 “${env.name}” 吗？`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  try {
    await store.remove(env.id)
    ElMessage.success('已删除')
    cleanup(env.id)
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '删除失败')
  }
}

function handleOpen(env: EnvConfig) {
  store.open(env.id)
}

function onTabRemove(id: string) {
  store.closeTab(id)
}

async function inspectStorage(id: string) {
  const wv = webviewRefs.value.get(id)
  if (!wv) {
    ElMessage.warning('内核未就绪')
    return
  }
  try {
    const cookie = (await wv.executeJavaScript('document.cookie', false)) as string
    const ls = (await wv.executeJavaScript(
      'JSON.stringify(Object.fromEntries(Object.entries(localStorage)))',
      false,
    )) as string
    const ss = (await wv.executeJavaScript(
      'JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))',
      false,
    )) as string
    let url = ''
    try {
      url = wv.getURL()
    } catch {}
    // 远程页面的 cookie / storage / URL 完全不可信：
    // 必须用纯文本渲染（Element Plus 的 message-box message 即纯文本，不再走 HTML 字符串），
    // 否则页面写入的 <img onerror=…> 会在宿主渲染层执行 JS 并进一步调用 Tauri commands。
    ElMessageBox.alert(
      [
        `URL: ${url || '(空)'}`,
        `document.cookie: ${cookie || '(空)'}`,
        `localStorage: ${ls}`,
        `sessionStorage: ${ss}`,
      ].join('\n'),
      '存储检查',
    )
  } catch (e) {
    ElMessage.error(String(e))
  }
}

function handleNav(
  action: 'back' | 'forward' | 'reload' | 'autoLogin' | 'openExternal' | 'devTools' | 'inspect',
) {
  const id = store.activeId
  if (!id) return
  if (action === 'inspect') {
    void inspectStorage(id)
    return
  }
  if (action === 'openExternal') {
    const url = webviewStatus[id]?.url || activeEnv.value?.url
    if (!url) return
    // 桌面端：外跳统一走 Tauri 受控通道（校验协议后交系统浏览器）
    if (isDesktop) {
      openExternal(url)
      ElMessage.info('已在系统浏览器中打开')
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
    return
  }
  if (action === 'devTools' && !isDesktop) {
    ElMessage.warning('当前为网页预览，Webview DevTools 仅在桌面端可用。请在桌面窗口中使用。')
    return
  }
  const wv = webviewRefs.value.get(id)
  if (!wv) {
    ElMessage.warning(
      '浏览器内核未就绪，请稍候或尝试“外部打开”确认 URL 可达。',
    )
    return
  }
  if (action === 'devTools') {
    try {
      if (wv.isDevToolsOpened?.()) wv.closeDevTools?.()
      else wv.openDevTools?.()
    } catch {
      ElMessage.info('DevTools 不可用')
    }
    return
  }
  if (action === 'back' && wv.canGoBack()) wv.goBack()
  else if (action === 'forward' && wv.canGoForward()) wv.goForward()
  else if (action === 'reload') wv.reload()
  else if (action === 'autoLogin') void triggerAutoLogin(id)
}

function handleAddressGo() {
  const id = store.activeId
  if (!id) return
  const wv = webviewRefs.value.get(id)
  const status = webviewStatus[id]
  if (!wv || !status) return
  let url = status.url.trim()
  if (!url) return
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  try {
    void new URL(url)
  } catch {
    ElMessage.error('地址格式不正确')
    return
  }
  void wv.loadURL(url).catch(() => {
    ElMessage.error('打开地址失败')
  })
}

function onAddressInput(v: string) {
  const id = store.activeId
  if (id && webviewStatus[id]) webviewStatus[id].url = v
}

function onAddressKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') handleAddressGo()
}

onMounted(async () => {
  await store.loadAll()
})

// 页面卸载（关闭工具页签）时释放全部 webview 监听器与状态，避免长期残留
onUnmounted(() => {
  cleanupAll()
})
</script>

<template>
  <div class="env-browser-page">
    <UiSidebar title="环境列表" width="300px" padding="var(--spacing-lg) var(--spacing-md)">
      <template #actions>
        <el-button type="primary" size="small" @click="onCreate">
          新增
        </el-button>
      </template>
      <el-input
        v-model="search"
        class="env-search"
        placeholder="搜索名称/地址/账号"
        size="small"
        clearable
      />
      <div v-loading="store.loading" class="env-list">
        <UiEmpty v-if="!filteredEnvs.length" center padding="var(--spacing-lg)">
          暂无环境
        </UiEmpty>
        <EnvCard
          v-for="env in filteredEnvs"
          :key="env.id"
          :env="env"
          :active="store.activeId === env.id"
          :opened="store.openIds.includes(env.id)"
          @open="handleOpen"
          @edit="onEdit"
          @delete="onDelete"
        />
      </div>
    </UiSidebar>

    <div class="main">
      <div v-if="store.openIds.length" class="tab-bar">
        <el-tabs
          :model-value="store.activeId"
          type="card"
          closable
          @update:model-value="(v: string) => store.switchTab(v)"
          @tab-remove="onTabRemove"
        >
          <el-tab-pane
            v-for="env in store.openEnvs"
            :key="env.id"
            :name="env.id"
            :label="webviewStatus[env.id]?.title || env.name"
            :closable="true"
          />
        </el-tabs>
      </div>

      <UiToolbar v-if="store.activeId" bordered surface padding="8px">
        <el-button-group>
          <el-button
            size="small"
            :disabled="!webviewStatus[store.activeId]?.canGoBack"
            @click="handleNav('back')"
          >
            <span>←</span>
          </el-button>
          <el-button
            size="small"
            :disabled="!webviewStatus[store.activeId]?.canGoForward"
            @click="handleNav('forward')"
          >
            <span>→</span>
          </el-button>
          <el-button
            size="small"
            :loading="webviewStatus[store.activeId]?.loading"
            @click="handleNav('reload')"
          >
            刷新
          </el-button>
        </el-button-group>
        <el-input
          :model-value="webviewStatus[store.activeId]?.url"
          class="address-input"
          placeholder="地址"
          size="small"
          @update:model-value="(v: string) => onAddressInput(v)"
          @keydown="onAddressKeydown"
        />
        <el-button size="small" @click="handleAddressGo">
          前往
        </el-button>
        <el-button
          size="small"
          type="primary"
          plain
          :loading="loadingIds.has(store.activeId)"
          @click="handleNav('autoLogin')"
        >
          自动登录
        </el-button>
        <el-button size="small" plain @click="handleNav('openExternal')">
          外部打开
        </el-button>
        <el-button size="small" plain @click="handleNav('devTools')">
          调试
        </el-button>
        <el-button size="small" plain @click="handleNav('inspect')">
          存储
        </el-button>
      </UiToolbar>

      <div class="browser-area">
        <div v-if="!isDesktop" class="web-tip">
          <el-alert
            type="warning"
            :closable="false"
            show-icon
            title="当前为网页预览模式"
            description="当前不在 Tauri 桌面窗口中运行。请在标题为 “everydaytool” 的原生窗口中操作，而非浏览器标签 http://localhost:5173。"
          />
          <div class="web-debug-info">
            调试：Tauri={{ webDebugInfo.tauri }}
            UA={{ webDebugInfo.ua }}
          </div>
        </div>
        <div v-if="!store.openIds.length" class="empty-browser">
          <p class="muted">
            请选择左侧环境点击“打开”，支持多环境同时打开、Tab 切换，Cookie/存储按环境隔离（partition 持久化）
          </p>
          <p class="muted empty-browser-hint">
            点击后将自动填充账号密码并尝试登录；若页面无密码框则保持已登录态
          </p>
        </div>
        <!-- 打开的 webview 常驻：宿主 div 只做布局与位置同步，真实页面由 Tauri 子 Webview 承载 -->
        <template v-for="env in store.openEnvs" :key="env.id">
          <div class="webview-wrapper" :style="{ display: store.activeId === env.id ? 'flex' : 'none' }">
            <div
              v-if="isDesktop"
              :key="`${env.id}-host`"
              :ref="(el: unknown) => setWebviewRef(env.id, el)"
              class="webview-host"
            />
            <iframe
              v-else
              :key="`${env.id}-iframe`"
              :src="env.url"
              :name="`env-browser-${env.id}`"
              allow="fullscreen"
              referrerpolicy="no-referrer"
            />
          </div>
        </template>
        <div v-if="isDesktop && store.activeId && !webviewRefs.has(store.activeId)" class="webview-debug">
          <p class="muted">
            浏览器内核初始化中… 若长时间空白，请打开 DevTools 查看 Console 是否有加载错误，或尝试“外部打开”对比。
          </p>
          <p class="muted">
            当前环境: {{ activeEnv?.url }}
          </p>
          <p class="muted">
            partition: {{ activeEnv ? getPartition(activeEnv) : '' }}
          </p>
        </div>
        <div v-if="store.activeId && !store.openEnvs.find(e => e.id === store.activeId)" class="empty-browser">
          <p class="muted">
            环境不存在或已被删除
          </p>
        </div>
      </div>
    </div>

    <EnvDialog v-model="showDialog" :editing="editing" />
  </div>
</template>

<style scoped lang="scss">
.env-browser-page {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  background: var(--color-canvas);
}
.env-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--spacing-md);
  min-height: 0;
  overflow-y: auto;
}
.env-search {
  margin-bottom: var(--spacing-md);
}
.main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.address-input {
  flex: 1;
}
.tab-bar {
  border-bottom: 1px solid var(--color-border-light);
  background: var(--color-raised);
  padding: var(--spacing-sm) var(--spacing-sm) 0;
  :deep(.el-tabs__header) {
    margin: 0;
  }
}
.web-tip {
  padding: var(--spacing-sm);
}
.web-debug-info {
  margin-top: var(--spacing-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}
.browser-area {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-raised);
  position: relative;
}
.empty-browser {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-3xl);
  text-align: center;
  font-size: var(--font-size-sm);
}
.empty-browser-hint {
  margin-top: var(--spacing-sm);
}
.webview-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;

  /* webview 宿主 / iframe 铺满 wrapper：布局结构，不进间距阶梯 */
  > .webview-host,
  > iframe {
    flex: 1;
    width: 100%;
    height: 100%;
    border: 0;
  }
}
.webview-debug {
  padding: var(--spacing-lg);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.6;
}
@media (max-width: 760px) {
  .env-browser-page {
    grid-template-columns: 1fr;
  }
  :deep(.ui-sidebar) {
    max-height: 40%;
    border-right: 0;
    border-bottom: 1px solid var(--color-border-light);
  }
}
</style>
