<script setup lang="ts">
import type { Component } from 'vue'
import ConfirmHost from '@renderer/shared/feedback/ConfirmHost.vue'
import { findAppTab, getAppTabs } from './config/app-tabs'
import { getToolRegistry } from './config/tools'
import AppRail from './shared/components/AppRail.vue'
import CommandPalette from './shared/components/CommandPalette.vue'
import HeaderTabs from './shared/components/HeaderTabs.vue'
import UiToaster from './shared/components/ui/UiToaster.vue'
import { useAppearance } from './shared/composables/useAppearance'
import { useCommandPalette } from './shared/composables/useCommandPalette'
import { runTabCloseGuard } from './shared/composables/useTabCloseGuard'
import { appIpcChannels, onAppIpc } from './shared/ipc/useAppIpc'
import { useToolTabsStore } from './stores/toolTabs'

const route = useRoute()
const router = useRouter()
const tabsStore = useToolTabsStore()

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
    tabsStore.syncFromRoute(toolId ?? null)
  },
  { immediate: true },
)

const tabComponents: Record<string, Component> = {
  ...Object.fromEntries(getToolRegistry().map(tool => [tool.id, tool.route.component as Component])),
  ...Object.fromEntries(getAppTabs().map(tab => [tab.id, tab.component])),
}

const currentTabId = computed(() => (typeof route.meta?.toolId === 'string' ? route.meta.toolId : null))
const activeComponent = computed(() => {
  const id = currentTabId.value
  return id ? tabComponents[id] : undefined
})
const isHome = computed(() => currentTabId.value === null)

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

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
  try {
    const channel: string = appIpcChannels().EVENT_FULLSCREEN_CHANGED
    offFullscreenIpc = onAppIpc<boolean>(channel, fullscreen => isFullscreen.value = fullscreen === true)
  } catch {
    // 纯浏览器预览没有 preload。
  }
  document.addEventListener('fullscreenchange', syncDomFullscreen)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  offFullscreenIpc?.()
  document.removeEventListener('fullscreenchange', syncDomFullscreen)
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

function handleTabClick(toolId: string) {
  const tab = tabsStore.openTabs.find(item => item.id === toolId)
  if (tab) router.push({ name: tab.routeName })
}

function handleTabReorder(ids: string[]) {
  tabsStore.reorder(ids)
}

async function handleTabRemove(toolId: string) {
  if (!(await runTabCloseGuard(toolId))) return
  const wasActive = currentTabId.value === toolId
  tabsStore.close(toolId)
  if (wasActive) goHome()
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
    <AppRail
      :active-id="currentTabId"
      :show-settings="settingsTab !== undefined"
      @home="goHome"
      @search="openPalette()"
      @settings="openSettings"
      @select-tool="openTool"
    />

    <div class="app-workspace">
      <header class="app-topbar">
        <div v-if="isHome" class="topbar-context">
          <span class="topbar-title">everydaytool</span>
          <span class="topbar-meta">本地工具工作区</span>
        </div>
        <div v-else-if="tabsStore.openTabs.length" class="topbar-tabs">
          <HeaderTabs
            :tabs="tabsStore.openTabs"
            :active-id="currentTabId"
            @select="handleTabClick"
            @close="handleTabRemove"
            @reorder="handleTabReorder"
          />
        </div>
      </header>

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
.app-shell {
  display: flex;
  height: 100dvh;
  overflow: hidden;
}

.app-workspace {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
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

.topbar-context {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.topbar-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.topbar-meta {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.topbar-tabs {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  padding: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
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
