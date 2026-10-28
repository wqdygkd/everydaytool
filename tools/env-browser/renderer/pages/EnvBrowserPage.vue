<script setup lang="ts">
import type { WebviewTag } from '../composables/useWebview'
import type { EnvConfig } from '../stores/envStore'
import { isElectronEnvironment } from '@renderer/shared/environment'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import EnvDialog from '../components/EnvDialog.vue'
import { useWebview } from '../composables/useWebview'
import { useEnvBrowserStore } from '../stores/envStore'

const store = useEnvBrowserStore()
const showDialog = ref(false)
const editing = ref<EnvConfig | null>(null)
const search = ref('')

const isElectron = isElectronEnvironment()

// 调试信息在 script 里取值：模板直接写 window / navigator 会被编译成 _ctx.window 而渲染崩溃
const webDebugInfo = computed(() => ({
  envBrowser: Boolean((window as unknown as Record<string, unknown>).envBrowser),
  edtRuntime: String((window as unknown as Record<string, unknown>).edtRuntime),
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
    // 否则页面写入的 <img onerror=…> 会在宿主渲染层执行 JS 并进一步调用 IPC。
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
    // Electron：window.open 已被主进程 deny，改走受控通道（主进程校验协议后交系统浏览器）
    if (isElectron) {
      openExternal(url)
      ElMessage.info('已在系统浏览器中打开')
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
    return
  }
  if (action === 'devTools' && !isElectron) {
    ElMessage.warning('当前为网页预览，Guest DevTools 仅在 Electron 中可用。请在 Electron 窗口中打开。')
    return
  }
  let wv = webviewRefs.value.get(id)
  if (!wv) {
    const fallback = document.querySelector(
      `webview[partition="persist:env-${id}"]`,
    ) as WebviewTag | null
    if (fallback) {
      webviewRefs.value.set(id, fallback)
      wv = fallback
    }
  }
  if (!wv) {
    ElMessage.warning(
      '浏览器内核未就绪，请确认在 Electron 中运行且已重启 pnpm dev（需 webviewTag:true）。可先尝试“外部打开”确认 URL 可达。',
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
    wv.src = url
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
          <!-- 两种「空」要说两句话：从没建过（教它是什么 + 给入口）／搜不到（教怎么回去） -->
          <template #title>
            {{ search ? '没有匹配的环境' : '还没有环境' }}
          </template>
          <template v-if="search">
            换个关键词，或清空搜索看全部 {{ store.envs.length }} 个环境。
          </template>
          <template v-else>
            一个环境 = 一套独立登录态。同一站点开两个环境，就是两个互不串味的账号。
          </template>
          <template v-if="!search" #actions>
            <el-button size="small" @click="onCreate">
              新增环境
            </el-button>
          </template>
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
        <div v-if="!isElectron" class="web-tip">
          <el-alert
            type="warning"
            :closable="false"
            show-icon
            title="当前为网页预览模式"
            description="检测到 window.envBrowser 为空（不在 Electron 内）。请在标题为 “everydaytool” 的原生窗口中操作，而非浏览器标签 http://localhost:5173。已执行 pnpm dev 重启仍提示时，请在当前窗口 DevTools Console 执行 window.envBrowser / window.edtRuntime / navigator.userAgent 查看，并确认 Electron 窗口已弹出。"
          />
          <div class="web-debug-info">
            调试：envBrowser={{ webDebugInfo.envBrowser }}
            edtRuntime={{ webDebugInfo.edtRuntime }}
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
        <!-- webviews: keep all open in DOM, v-show active -->
        <template v-for="env in store.openEnvs" :key="env.id">
          <div class="webview-wrapper" :style="{ display: store.activeId === env.id ? 'flex' : 'none' }">
            <webview
              v-if="isElectron"
              :key="env.id"
              :ref="(el: unknown) => setWebviewRef(env.id, el)"
              :name="`env-browser-${env.id}`"
              :partition="getPartition(env)"
              allowpopups
              disablewebsecurity
              webpreferences="allowRunningInsecureContent, webSecurity=no, contextIsolation=no, nativeWindowOpen=yes"
              useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
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
        <div v-if="isElectron && store.activeId && !webviewRefs.has(store.activeId)" class="webview-debug">
          <p class="muted">
            浏览器内核初始化中… 若长时间空白，请检查：1) 已重启 pnpm dev 使 webviewTag 生效 2) 打开 DevTools 查看 Console 是否有 webview did-fail-load 3) 尝试“外部打开”对比
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

  /* webview / iframe 铺满 wrapper：布局结构，不进间距阶梯 */
  > webview,
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
