<script setup lang="ts">
import type { Component } from 'vue'
import ConfirmHost from '@renderer/shared/feedback/ConfirmHost.vue'
import { useEventListener } from '@vueuse/core'
import { findAppTab, getAppTabs } from './config/app-tabs'
import { getToolById, getToolRegistry } from './config/tools'
import AppRail from './shared/components/AppRail.vue'
import CommandPalette from './shared/components/CommandPalette.vue'
import ToolPane from './shared/components/ToolPane.vue'
import UiToaster from './shared/components/ui/UiToaster.vue'
import { useAppearance } from './shared/composables/useAppearance'
import { useCommandPalette } from './shared/composables/useCommandPalette'
import { useRailMode } from './shared/composables/useRailMode'
import { runTabCloseGuard } from './shared/composables/useTabCloseGuard'
import { appIpcChannels, onAppIpc } from './shared/ipc/useAppIpc'
import { useToolTabsStore } from './stores/toolTabs'

const route = useRoute()
const router = useRouter()
const toolsStore = useToolTabsStore()

const { appearance, load: loadAppearance, subscribe: subscribeAppearance } = useAppearance()
const { mode: railMode, label: railToggleLabel, cycle: cycleRailMode } = useRailMode()
const RAIL_TOGGLE_ICONS = {
  compact: 'sidebar',
  wide: 'sidebarWide',
  collapsed: 'sidebarCollapsed',
} as const
const railToggleIcon = computed(() => RAIL_TOGGLE_ICONS[railMode.value])
const isTransparent = computed(() => appearance.value?.enabled === true)
const materialClass = computed(() => {
  const value = appearance.value
  if (!value?.enabled) return null
  if (value.vibrancy !== 'none') return 'is-vibrancy'
  return value.material !== 'none' ? `is-${value.material}` : 'is-transparent-only'
})

onMounted(() => {
  void loadAppearance()
  subscribeAppearance()
})

function platformFromUA(): string | null {
  const ua = navigator.userAgent ?? ''
  if (/Macintosh|MacIntel|Mac OS/i.test(ua)) return 'darwin'
  if (/Windows/i.test(ua)) return 'win32'
  if (/Linux/i.test(ua)) return 'linux'
  return null
}

function detectPlatform(): string {
  const fromPreload = window.edtRuntime?.platform
  const fromUA = platformFromUA()
  if (fromUA && fromPreload && fromUA !== fromPreload) return fromUA
  return fromPreload || fromUA || 'web'
}

const platform = detectPlatform()

/**
 * 本次会话里真正挂载过的工具：未打开过的工具不在这里，因此不会因为「注册表里有」
 * 就提前拉起页面 / 后台运行时。持久化的 openIds 只负责左轨列表，点进来才算启动。
 */
const mountedToolIds = ref<string[]>([])

watch(
  () => [route.meta?.toolId as string | undefined, route.fullPath] as const,
  ([toolId, fullPath]) => {
    toolsStore.syncFromRoute(toolId ?? null)
    const tool = toolId ? getToolById(toolId) : undefined
    if (!tool) return
    if (!mountedToolIds.value.includes(tool.id)) mountedToolIds.value.push(tool.id)
    toolsStore.rememberRoute(tool.id, fullPath)
  },
  { immediate: true },
)

// 关闭工具时把常驻面板一起摘掉，卸载才会触发各工具自己的运行时清理。
watch(
  () => [...toolsStore.openIds],
  (ids) => {
    const open = new Set(ids)
    mountedToolIds.value = mountedToolIds.value.filter(id => open.has(id))
  },
)

const pageComponents: Record<string, Component> = {
  ...Object.fromEntries(getToolRegistry().map(tool => [tool.id, tool.route.component as Component])),
  ...Object.fromEntries(getAppTabs().map(tab => [tab.id, tab.component])),
}

const currentTabId = computed(() => (typeof route.meta?.toolId === 'string' ? route.meta.toolId : null))
const activeTool = computed(() => (currentTabId.value ? getToolById(currentTabId.value) : undefined))
const activeAppTab = computed(() => (currentTabId.value ? findAppTab(currentTabId.value) : undefined))
const activeToolId = computed(() => activeTool.value?.id ?? null)

const settingsTab = findAppTab('settings')
const isFullscreen = ref(false)
const hasNight = computed(() => appearance.value?.night === true)
const modeClasses = computed<string[]>(() => {
  const classes: string[] = []
  if (isFullscreen.value) classes.push('is-fullscreen')
  if (isTransparent.value) classes.push('is-transparent')
  if (hasNight.value) classes.push('is-night')
  if (materialClass.value) classes.push(materialClass.value)
  return classes
})

watch(
  modeClasses,
  (classes, previous) => {
    const html = document.documentElement
    html.classList.remove(...(previous ?? []))
    html.classList.add(...classes)
  },
  { immediate: true },
)

let offFullscreenIpc: (() => void) | undefined
function syncDomFullscreen() {
  if (document.fullscreenElement != null) isFullscreen.value = true
  else if (!offFullscreenIpc) isFullscreen.value = false
}

const {
  open: paletteOpen,
  query: paletteQuery,
  openPalette,
  closePalette,
} = useCommandPalette()

function onGlobalKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (paletteOpen.value) closePalette()
    else openPalette()
  }
}

useEventListener(window, 'keydown', onGlobalKeydown)
useEventListener(document, 'fullscreenchange', syncDomFullscreen)

onMounted(() => {
  try {
    const channel: string = appIpcChannels().EVENT_FULLSCREEN_CHANGED
    offFullscreenIpc = onAppIpc<boolean>(channel, fullscreen => isFullscreen.value = fullscreen === true)
  } catch {
    // 纯浏览器预览没有 preload。
  }
})

onUnmounted(() => {
  offFullscreenIpc?.()
})

function goHome() {
  router.push({ name: 'home' })
}

function pushTool(toolId: string) {
  const last = toolsStore.lastRoute(toolId)
  const fallback = () => router.push({ name: `tool-${toolId}` })
  return last ? router.push(last).catch(fallback) : fallback()
}

function openTool(toolId: string) {
  closePalette(false)
  void pushTool(toolId)
}

function selectPaletteTool(toolId: string) {
  openTool(toolId)
}

/**
 * 关闭工具：先过工具自己的关闭守卫（如「关闭将停止服务」），再决定落点。
 * 关当前工具时切到最近使用过、此刻还开着的另一个工具；一个都没有才回首页。
 */
async function handleToolClose(toolId: string) {
  if (!(await runTabCloseGuard(toolId))) return
  const wasActive = currentTabId.value === toolId
  // 必须在 close 之前取：close 会把这个工具从 recentIds / openIds 里摘掉
  const fallbackId = wasActive ? toolsStore.recentFallback(toolId) : null
  toolsStore.close(toolId)
  if (!wasActive) return

  const fallback = fallbackId
    ? toolsStore.openTools.find(tool => tool.id === fallbackId)
    : undefined
  if (fallback) void pushTool(fallback.id)
  else goHome()
}

function openSettings() {
  if (settingsTab) router.push({ name: settingsTab.routeName })
}

const topbarMenuItems = [
  { command: 'switch', label: '切换工具', icon: 'search' as const },
  { command: 'close', label: '关闭当前工具', icon: 'close' as const, danger: true },
]

function onTopbarCommand(command: string) {
  if (command === 'switch') {
    openPalette()
    return
  }
  if (command === 'close' && activeTool.value) void handleToolClose(activeTool.value.id)
}
</script>

<template>
  <div
    class="app-shell"
    :class="[`platform-${platform}`, modeClasses]"
  >
    <header class="app-topbar">
      <UiIconButton
        class="rail-toggle"
        :icon="railToggleIcon"
        :size="30"
        :label="railToggleLabel"
        aria-controls="app-rail"
        :aria-expanded="railMode !== 'collapsed'"
        @click="cycleRailMode"
      />

      <template v-if="activeTool">
        <button
          type="button"
          class="tool-switcher"
          aria-haspopup="dialog"
          :title="activeTool.name"
          @click="openPalette()"
        >
          <span class="tool-switcher-tile" aria-hidden="true">
            <UiIcon :name="activeTool.icon" :size="15" />
          </span>
          <span class="tool-switcher-name">{{ activeTool.name }}</span>
          <UiIcon name="chevronDown" :size="12" class="tool-switcher-chevron" />
        </button>
        <span class="topbar-desc">{{ activeTool.description }}</span>
        <span class="topbar-grow" aria-hidden="true" />
        <div id="app-topbar-state" class="topbar-state-slot" />
        <div id="app-topbar-actions" class="topbar-actions-slot" />
        <UiDropdown class="topbar-more" :items="topbarMenuItems" @command="onTopbarCommand">
          <template #trigger>
            <UiIconButton icon="more" :size="28" label="更多" />
          </template>
        </UiDropdown>
      </template>

      <template v-else-if="activeAppTab">
        <UiIconTile size="sm" :name="activeAppTab.icon" :icon-size="17" />
        <span class="topbar-title">{{ activeAppTab.name }}</span>
        <span class="topbar-meta">{{ activeAppTab.description }}</span>
      </template>

      <template v-else>
        <span class="topbar-brand" aria-hidden="true">EDT</span>
        <span class="topbar-title">everydaytool</span>
        <span class="topbar-meta">本地工具工作区</span>
      </template>
    </header>

    <div class="app-body">
      <AppRail
        :active-id="currentTabId"
        :open-tools="toolsStore.openTools"
        :show-settings="settingsTab !== undefined"
        :mode="railMode"
        @home="goHome"
        @search="openPalette()"
        @settings="openSettings"
        @select-tool="openTool"
        @close="handleToolClose"
      />

      <main class="app-main">
        <router-view v-slot="{ Component: RouteComponent, route: currentRoute }">
          <Transition name="page" mode="out-in">
            <component
              :is="RouteComponent"
              v-if="!currentRoute.meta?.toolId"
              :key="currentRoute.path"
            />
          </Transition>
        </router-view>

        <Transition name="page" mode="out-in">
          <component
            :is="activeAppTab?.component"
            v-if="activeAppTab"
            :key="activeAppTab.id"
            class="tool-runtime"
          />
        </Transition>

        <div class="tool-stack">
          <ToolPane
            v-for="toolId in mountedToolIds"
            :key="toolId"
            :active="toolId === activeToolId"
            :path="toolId === activeToolId ? route.fullPath : (toolsStore.lastRoute(toolId) ?? '')"
          >
            <component
              :is="pageComponents[toolId]"
              v-if="pageComponents[toolId]"
              class="tool-runtime"
            />
          </ToolPane>
        </div>
      </main>
    </div>

    <CommandPalette
      :open="paletteOpen"
      :initial-query="paletteQuery"
      @close="closePalette()"
      @select="selectPaletteTool"
    />
    <UiToaster position="top-center" :duration="3000" />
    <ConfirmHost />
  </div>
</template>

<style scoped lang="scss">
/* 外壳是「整宽标题栏 + 下面一行（左轨 + 内容）」：标题栏铺满整宽，
   macOS 的红绿灯直接落在标题栏左侧，左轨从标题栏下方开始，
   不再需要给 rail 加顶部 padding 去让灯（那种做法会让标题栏断开、也挡不住分隔线穿过红绿灯）。 */
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
}

.app-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.app-topbar {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex: 0 0 var(--topbar-height);
  height: var(--topbar-height);
  min-width: 0;
  padding: 0 var(--spacing-lg);
  background: transparent;
  color: var(--color-text-primary);
  -webkit-app-region: drag;
}

.rail-toggle {
  flex: none;
  -webkit-app-region: no-drag;
}

.app-topbar .rail-toggle:hover {
  background: color-mix(in srgb, var(--color-primary) 7%, transparent);
  color: var(--color-text-primary);
}

/* macOS：红绿灯落在标题栏里（trafficLightPosition 见 electron/main.ts），
   内容整体让到灯组右侧；84px = 灯组右缘约 72px + 12px 间距，
   也正好等于「左轨 68px + 16px」这个内容起点，视觉上与下方主区对齐。 */
.platform-darwin .app-topbar {
  padding-left: 84px;
}

/* 全屏时 macOS 隐藏红绿灯，标题栏回到普通左内边距 */
.app-shell.is-fullscreen.platform-darwin .app-topbar {
  padding-left: var(--spacing-lg);
}

/* 工具页：切换器是可交互胶囊，其余部分仍是窗口拖拽区。 */
.tool-switcher {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: none;
  max-width: 268px;
  height: 34px;
  min-width: 0;
  padding: 0 9px 0 5px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
  outline: none;
  -webkit-app-region: no-drag;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);

  &:hover {
    border-color: transparent;
    background: color-mix(in srgb, var(--color-primary) 7%, transparent);
  }

  &:focus-visible {
    box-shadow: var(--shadow-focus);
  }
}

.tool-switcher-tile {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-xs);
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.tool-switcher-name {
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-switcher-chevron {
  flex: none;
  color: var(--color-text-tertiary);
}

.topbar-desc {
  min-width: 0;
  max-width: 46%;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar-grow {
  flex: 1;
  min-width: 8px;
}

.topbar-state-slot,
.topbar-actions-slot {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex: none;
  min-width: 0;
  -webkit-app-region: no-drag;
}

.topbar-state-slot {
  gap: 6px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.topbar-actions-slot :deep(.ui-button) {
  height: 30px;
  padding: 0 12px;
  font-size: var(--font-size-sm);
}

.topbar-more {
  flex: none;
  -webkit-app-region: no-drag;
}

/* 首页字标与 UiIconTile（sm）同尺寸，保证三种状态的图标位对齐 */
.topbar-brand {
  display: grid;
  place-items: center;
  flex: none;
  width: 31px;
  height: 31px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary-strong);
  font-family: var(--font-brand);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-brand);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  user-select: none;
}

.topbar-title {
  flex: none;
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
}

.topbar-meta {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-main {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* 已打开工具的常驻层：绝对定位不参与首页 / 设置页的 flex 布局，
   z-index 高于标题栏与左轨，保证工具内对话框（teleport 到面板）仍能盖住整个窗口。 */
.tool-stack {
  position: absolute;
  inset: 0;
  z-index: 30;
  pointer-events: none;
}

.tool-runtime {
  flex: 1;
  min-height: 0;
}

.platform-win32 .app-topbar,
.platform-linux .app-topbar {
  padding-right: 148px;
}

.app-shell.is-fullscreen.platform-win32 .app-topbar,
.app-shell.is-fullscreen.platform-linux .app-topbar {
  padding-right: var(--spacing-lg);
}

.page-enter-active,
.page-leave-active {
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

@media (prefers-reduced-motion: reduce) {
  .page-enter-active,
  .page-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
