<script setup lang="ts">
import type { Component } from 'vue'
import type { MotionScope } from './shared/composables/useGsap'
import { onMounted, onUnmounted } from 'vue'
import { getToolRegistry } from './config/tools'
import AppMenuBar from './shared/components/AppMenuBar.vue'
import { createMotionScope, gsap } from './shared/composables/useGsap'
import { useToolTabsStore } from './stores/toolTabs'

const route = useRoute()
const router = useRouter()
const tabsStore = useToolTabsStore()
const platform = window.edtRuntime?.platform ?? 'web'

// 路由 → tab 同步（原 ToolLayout 的职责，随布局迁移过来）
watch(
  () => route.meta?.toolId as string | undefined,
  (tid) => {
    if (tid) tabsStore.syncFromRoute(tid)
  },
  { immediate: true },
)

// 打开过的工具页常驻挂载，显隐只用 display 切换：
// webview 只要还在文档里，guest 就不会销毁，切 tab / 去首页再回来都不重载。
// 只有真正关闭 tab 时组件才卸载（顺带触发各页面的 onUnmounted 清理）。
const toolComponents = computed<Record<string, Component>>(() =>
  Object.fromEntries(getToolRegistry().map(t => [t.id, t.route.component as Component])),
)

const shellEl = ref<HTMLElement | null>(null)
let motion: MotionScope | undefined

onMounted(() => {
  const el = shellEl.value
  if (!el)
    return
  // 应用外壳入场：顶栏下滑、底栏上滑（不动画 .app-main，避免与子页入场 opacity 叠加发灰）
  motion = createMotionScope(() => {
    gsap.from('.app-header', { y: -16, autoAlpha: 0, duration: 0.5, ease: 'power3.out', clearProps: 'transform,opacity,visibility' })
    gsap.from('.app-footer', { y: 16, autoAlpha: 0, duration: 0.5, ease: 'power3.out', delay: 0.08, clearProps: 'transform,opacity,visibility' })
  }, el)
})

onUnmounted(() => {
  motion?.revert()
})

const currentTool = computed(() => (typeof route.meta?.toolId === 'string' ? route.meta.toolId : null))
const currentToolName = computed(() => {
  const tool = getToolRegistry().find(t => t.id === currentTool.value)
  return tool?.name || ''
})
const toolCount = computed(() => getToolRegistry().length)
const activeLabel = computed(() => currentToolName.value || `${toolCount.value} 个工具`)
const footerLabel = computed(() => currentToolName.value || '工具总览')
function goHome() {
  router.push({ name: 'home' })
}

function handleTabClick(toolId: string) {
  const tab = tabsStore.openTabs.find(t => t.id === toolId)
  if (tab) router.push({ name: tab.routeName })
}

function handleTabRemove(toolId: string) {
  const wasActive = tabsStore.activeId === toolId
  tabsStore.close(toolId)
  if (!wasActive) return
  const nextActive = tabsStore.activeId
  if (nextActive) router.push({ name: `tool-${nextActive}` })
  else router.push({ name: 'home' })
}
</script>

<template>
  <div ref="shellEl" class="app-shell" :class="`platform-${platform}`">
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark" role="button" tabindex="0" @click="goHome" @keydown.enter="goHome">edt</span>
        <AppMenuBar />
      </div>
      <div class="header-meta">
        <span>{{ activeLabel }}</span>
      </div>
    </header>

    <!-- 工具页签行：独立于标题栏行（标题 + 菜单）之下 -->
    <div v-if="tabsStore.openTabs.length" class="header-tabs">
      <el-tabs
        :model-value="tabsStore.activeId"
        type="card"
        closable
        @update:model-value="(v: string) => handleTabClick(v)"
        @tab-remove="handleTabRemove"
      >
        <el-tab-pane
          v-for="tab in tabsStore.openTabs"
          :key="tab.id"
          :name="tab.id"
          :label="tab.name"
        />
      </el-tabs>
    </div>

    <main class="app-main">
      <router-view v-slot="{ Component: RouteComponent, route: r }">
        <Transition name="page" mode="out-in">
          <component :is="RouteComponent" v-if="!r.meta?.toolId" :key="r.path" />
        </Transition>
      </router-view>
      <div v-show="!!currentTool" class="tools-host">
        <template v-for="tab in tabsStore.openTabs" :key="tab.id">
          <component :is="toolComponents[tab.id]" v-show="tab.id === tabsStore.activeId" />
        </template>
      </div>
    </main>

    <footer class="app-footer">
      <span>{{ footerLabel }}</span>
      <span class="ready">
        <span class="ready-dot" />
        ready
      </span>
    </footer>
  </div>
</template>

<style scoped lang="scss">
.app-shell {
  display: flex;
  flex-direction: column;
  /* 锁死视口高度：顶栏 / 页签行 / 底栏固定，滚动只发生在内容区 */
  height: 100dvh;
  overflow: hidden;
  background: var(--color-app-bg);
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  min-height: 44px;
  padding: 0 16px;
  background: color-mix(in srgb, var(--color-surface-raised) 88%, transparent);
  border-bottom: 1px solid var(--color-border-light);
  color: var(--color-text-primary);
  backdrop-filter: blur(18px);
  // 自定义标题栏（系统标题栏已隐藏）：整行可拖拽移动窗口，交互元素各自排除
  -webkit-app-region: drag;

  .brand {
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 0;
    flex: 1;
  }

  .brand-mark {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    -webkit-app-region: no-drag;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: var(--radius-lg);
    background: linear-gradient(135deg, var(--color-accent) 0 46%, var(--color-primary) 54% 100%);
    color: var(--color-surface);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--color-surface) 24%, transparent);
    overflow: hidden;
    cursor: pointer;
    user-select: none;
    transition: var(--transition-fast);

    &::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(115deg, transparent 32%, color-mix(in srgb, var(--color-surface) 28%, transparent) 50%, transparent 68%);
      background-size: 250% 100%;
      background-position: 150% 0;
      animation: brand-sheen 5.5s ease-in-out infinite;
      pointer-events: none;
    }

    &:hover {
      opacity: 0.9;
    }

    &:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 2px;
    }
  }

  .header-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);

    > span {
      border: 1px solid var(--color-border-light);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      padding: 3px 7px;
    }
  }
}

// 预留右上角原生窗口按钮（titleBarOverlay）宽度，避免 header-meta 被遮挡
.platform-win32 .app-header,
.platform-linux .app-header {
  padding-right: 148px;
}

// macOS 红绿灯按钮在左上（hiddenInset），预留其宽度
.platform-darwin .app-header {
  padding-left: 84px;
}

// 工具页签行：位于标题栏行（标题 + 菜单）之下
.header-tabs {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  padding: 6px 10px 0;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border-light);
  // 行内空白区域可拖拽窗口，页签本身可点击
  -webkit-app-region: drag;

  > :deep(.el-tabs) {
    flex: 1;
    min-width: 0;
    -webkit-app-region: no-drag;
  }

  :deep(.el-tabs__header) {
    margin: 0;
    border-bottom: none;
  }

  :deep(.el-tabs__nav) {
    border: none;
  }

  :deep(.el-tabs__item) {
    font-size: var(--font-size-sm);
  }
}

.app-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* 全应用唯一的主滚动容器：滚动条贴窗口右缘；工具页由 tools-host 精确填满、不触发外层滚动 */
  overflow-x: hidden;
  overflow-y: auto;
}

// 常驻工具页容器：子页面只用 display 显隐，不卸载
.tools-host {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  > :deep(*) {
    flex: 1;
    min-height: 0;
  }
}

.app-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  height: 32px;
  padding: 0 24px;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  background: color-mix(in srgb, var(--color-surface-raised) 82%, transparent);
  border-top: 1px solid var(--color-border-light);

  .ready {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .ready-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-success);
    box-shadow: 0 0 0 0 var(--color-success);
    animation: pulse-dot 2s cubic-bezier(0.2, 0.75, 0.25, 1) infinite;
  }
}

/* ── 路由过渡 ── */
.page-enter-active,
.page-leave-active {
  transition: opacity 0.2s cubic-bezier(0.2, 0.75, 0.25, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@keyframes pulse-dot {
  0% {
    box-shadow: 0 0 0 0 var(--color-success);
  }
  70% {
    box-shadow: 0 0 0 5px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

@keyframes brand-sheen {
  0% {
    background-position: 150% 0;
  }
  60%, 100% {
    background-position: -150% 0;
  }
}

@media (max-width: 640px) {
  .app-header {
    height: auto;
    min-height: 44px;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;

    .header-meta {
      width: 100%;
      justify-content: flex-start;
      flex-wrap: wrap;
    }
  }
}
</style>
