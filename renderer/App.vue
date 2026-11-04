<script setup lang="ts">
import type { Component } from 'vue'
import type { IconName } from './shared/components/ui/icons'
import ConfirmHost from '@renderer/shared/feedback/ConfirmHost.vue'
import { useEventListener } from '@vueuse/core'
import { findAppTab, getAppTabs } from './config/app-tabs'
import { getToolById, getToolRegistry } from './config/tools'
import AppRail from './shared/components/AppRail.vue'
import CommandPalette from './shared/components/CommandPalette.vue'
import UiToaster from './shared/components/ui/UiToaster.vue'
import { useAppearance } from './shared/composables/useAppearance'
import { useCommandPalette } from './shared/composables/useCommandPalette'
import { runTabCloseGuard } from './shared/composables/useTabCloseGuard'
import { appIpcChannels, onAppIpc } from './shared/ipc/useAppIpc'
import { useToolTabsStore } from './stores/toolTabs'

const route = useRoute()
const router = useRouter()
const toolsStore = useToolTabsStore()

const { appearance, load: loadAppearance, subscribe: subscribeAppearance } = useAppearance()
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

watch(
  () => route.meta?.toolId as string | undefined,
  (toolId) => {
    toolsStore.syncFromRoute(toolId ?? null)
  },
  { immediate: true },
)

const pageComponents: Record<string, Component> = {
  ...Object.fromEntries(getToolRegistry().map(tool => [tool.id, tool.route.component as Component])),
  ...Object.fromEntries(getAppTabs().map(tab => [tab.id, tab.component])),
}

const currentTabId = computed(() => (typeof route.meta?.toolId === 'string' ? route.meta.toolId : null))
const activeComponent = computed(() => {
  const id = currentTabId.value
  return id ? pageComponents[id] : undefined
})

const activeTool = computed(() => (currentTabId.value ? getToolById(currentTabId.value) : undefined))
const activeAppTab = computed(() => (currentTabId.value ? findAppTab(currentTabId.value) : undefined))

interface TitlebarContext {
  name: string
  description: string
}

/** 标题栏图标：首页没有图标（用 EDT 字标），工具 / 应用页取注册表元数据 */
const titlebarIcon = computed<IconName | null>(
  () => activeTool.value?.icon ?? activeAppTab.value?.icon ?? null,
)

/**
 * 标题栏是在描述「当前这块内容是什么」：首页讲应用本身，工具讲工具能力，应用页（设置）讲页面职责。
 * 全部走注册表里的元数据，组件不再各写一份文案。
 */
const titlebar = computed<TitlebarContext>(() => {
  if (activeTool.value) {
    return { name: activeTool.value.name, description: activeTool.value.description }
  }
  if (activeAppTab.value) {
    return { name: activeAppTab.value.name, description: activeAppTab.value.description }
  }
  return { name: 'everydaytool', description: '本地工具工作区' }
})

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

function openTool(toolId: string) {
  closePalette(false)
  router.push({ name: `tool-${toolId}` })
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
  if (fallback) router.push({ name: fallback.routeName })
  else goHome()
}

function openSettings() {
  if (settingsTab) router.push({ name: settingsTab.routeName })
}
</script>

<template>
  <div
    class="app-shell"
    :class="[`platform-${platform}`, modeClasses]"
  >
    <header class="app-topbar">
      <div class="topbar-context">
        <span v-if="titlebarIcon === null" class="topbar-brand" aria-hidden="true">EDT</span>
        <UiIconTile v-else size="sm" :name="titlebarIcon" :icon-size="17" />
        <span class="topbar-title">{{ titlebar.name }}</span>
        <span class="topbar-meta">{{ titlebar.description }}</span>
      </div>
    </header>

    <div class="app-body">
      <AppRail
        :active-id="currentTabId"
        :open-tools="toolsStore.openTools"
        :show-settings="settingsTab !== undefined"
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

        <Transition name="workspace" mode="out-in">
          <component
            :is="activeComponent"
            v-if="activeComponent"
            :key="currentTabId ?? undefined"
            class="tool-runtime"
          />
        </Transition>
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
  gap: var(--spacing-md);
  flex: 0 0 var(--topbar-height);
  height: var(--topbar-height);
  min-width: 0;
  padding: 0 var(--spacing-lg);
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-light) 72%, transparent);
  background: var(--color-header);
  backdrop-filter: var(--glass-header);
  color: var(--color-text-primary);
  -webkit-app-region: drag;
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

/* 标题栏只剩一块「当前上下文」：图标 + 名称 + 一行说明。
   整块不可交互（首页入口在左轨），因此整行仍是窗口拖拽区；说明是唯一可收缩的项，
   窗口变窄时先省略说明，名称与图标不动。 */
.topbar-context {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 9px;
  min-width: 0;
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
.page-leave-active,
.workspace-enter-active,
.workspace-leave-active {
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.page-enter-from,
.workspace-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.page-leave-to,
.workspace-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

@media (prefers-reduced-motion: reduce) {
  .page-enter-active,
  .page-leave-active,
  .workspace-enter-active,
  .workspace-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
