<script setup lang="ts">
import type { Component } from 'vue'
import type { MotionScope } from './shared/composables/useGsap'
import { getToolRegistry } from './config/tools'
import { createMotionScope, gsap } from './shared/composables/useGsap'
import { useToolTabsStore } from './stores/toolTabs'

const route = useRoute()
const router = useRouter()
const tabsStore = useToolTabsStore()
const platform = window.edtRuntime?.platform ?? 'web'

// 路由 → tab 同步（含回主页清空高亮）
watch(
  () => route.meta?.toolId as string | undefined,
  (tid) => {
    tabsStore.syncFromRoute(tid ?? null)
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
  // 应用外壳入场：顶栏下滑（不动画 .app-main，避免与子页入场 opacity 叠加发灰）
  motion = createMotionScope(() => {
    gsap.from('.app-header', { y: -16, autoAlpha: 0, duration: 0.5, ease: 'power3.out', clearProps: 'transform,opacity,visibility' })
  }, el)
})

onUnmounted(() => {
  motion?.revert()
})

const currentTool = computed(() => (typeof route.meta?.toolId === 'string' ? route.meta.toolId : null))
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
  // 关闭正在查看的工具 → 回主页；关后台页签则原地不动
  if (wasActive) router.push({ name: 'home' })
}
</script>

<template>
  <div ref="shellEl" class="app-shell" :class="`platform-${platform}`">
    <header class="app-header">
      <span class="brand-mark" role="button" tabindex="0" @click="goHome" @keydown.enter="goHome">edt</span>
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
    </header>

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
  </div>
</template>

<style scoped lang="scss">
.app-shell {
  display: flex;
  flex-direction: column;
  /* 锁死视口高度：顶栏固定，滚动只发生在内容区 */
  height: 100dvh;
  overflow: hidden;
  background: var(--color-app-bg);
}

.app-header {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
  min-height: 44px;
  padding: 0 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border-light);
  color: var(--color-text-primary);
  // 自定义标题栏（系统标题栏已隐藏）：整行可拖拽移动窗口，交互元素各自排除
  -webkit-app-region: drag;

  .brand-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    -webkit-app-region: no-drag;
    flex-shrink: 0;
    height: 34px;
    padding: 0 13px;
    border-radius: 999px;
    /* 品牌标：与工具页签同款胶囊（primary-light 底 + primary 字） */
    background: var(--color-primary-light);
    color: var(--color-primary);
    font-family: "Nunito", "Roboto", inherit;
    font-size: var(--font-size-sm);
    font-weight: 800;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    cursor: pointer;
    user-select: none;
    transition: var(--transition-fast);

    &:hover {
      opacity: 0.88;
    }

    &:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 2px;
    }
  }
}

// 预留右上角原生窗口按钮（titleBarOverlay）宽度，避免标题栏内容被遮挡
.platform-win32 .app-header,
.platform-linux .app-header {
  padding-right: 148px;
}

// macOS 红绿灯按钮在左上（hiddenInset），预留其宽度
.platform-darwin .app-header {
  padding-left: 84px;
}

// 工具页签：内嵌标题栏行（品牌标右侧），Telegram 文件夹页签风格（胶囊高亮）
.header-tabs {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;

  > :deep(.el-tabs) {
    min-width: 0;
    // 页签可点击；标题栏其余空白区域保持可拖拽
    -webkit-app-region: no-drag;
    --el-tabs-header-height: 34px;
  }

  :deep(.el-tabs__header) {
    margin: 0;
    border-bottom: none;
  }

  :deep(.el-tabs__nav) {
    border: none;
  }

  :deep(.el-tabs__item) {
    border: none !important;
    border-radius: 999px;
    // EP 卡片页签有三套 padding（基础 20 / hover 13 / 激活 20）且 hover 才把关闭图标
    // 从 0 撑到 14px，任何一项变化都会让页签变宽变窄、邻居左右跳。
    // 此处全部钉死为常量（需 !important 压过 EP 的 is-active/is-closable:hover 规则），
    // 页签宽度恒定，关闭按钮常驻占位、仅透明度显隐。
    padding: 0 13px !important;
    margin-right: 4px;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    // 页签是导航控件：禁用文本选择，避免双击/拖拽选中文字
    user-select: none;
    transition: var(--transition-fast);

    &.is-active {
      background: var(--color-primary-light);
      color: var(--color-primary);
    }

    &:not(.is-active):hover {
      background: var(--color-muted);
      color: var(--color-primary);
    }

    &.is-closable .is-icon-close {
      width: 14px !important;
      opacity: 0;
    }

    &.is-closable:hover .is-icon-close,
    &.is-active.is-closable .is-icon-close {
      opacity: 1;
    }
  }
}

.app-main {
  flex: 1;
  min-height: 0;
  position: relative; // 离场页 absolute 淡出的定位基准
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

/* ── 路由过渡 ── */
.page-enter-active,
.page-leave-active {
  transition: opacity 0.2s cubic-bezier(0.2, 0.75, 0.25, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

// 离场页浮到 .app-main 之上淡出：主页→工具页时 tools-host（v-show）同帧就显示，
// 若离场主页仍占文档流，flex 列内两块内容会短暂上下叠排，工具内容先落到下部再跳回顶部
.page-leave-active {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1;
  pointer-events: none;
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 640px) {
  .app-header {
    height: auto;
    min-height: 44px;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
  }
}
</style>
