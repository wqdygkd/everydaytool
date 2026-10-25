<script setup lang="ts">
import type { Component } from 'vue'
import type { MotionScope } from './shared/composables/useGsap'
import { findAppTab, getAppTabs } from './config/app-tabs'
import { getToolRegistry } from './config/tools'
import { useAppearance } from './shared/composables/useAppearance'
import { createMotionScope, gsap } from './shared/composables/useGsap'
import { appIpcChannels, onAppIpc } from './shared/ipc/useAppIpc'
import { useToolTabsStore } from './stores/toolTabs'

const route = useRoute()
const router = useRouter()
const tabsStore = useToolTabsStore()

// 窗口外观（半透明 / 系统材质）：主进程是唯一事实来源，这里只镜像状态用于挂 CSS 类。
// 半透明是「窗口形态」而非页面样式，因此必须由原生侧决定后回推，不能只靠本地开关。
const { appearance, load: loadAppearance, subscribe: subscribeAppearance } = useAppearance()
const isTransparent = computed(() => appearance.value?.enabled === true)
// 当前生效的材质名 → CSS 类 is-<material>：translucency.scss 按类覆写 alpha，
// 新增材质只在该文件加一条规则，此处无需改动。
// vibrancy（macOS）在类型里是独立字段，这里统一归一成 material 类名。
const materialClass = computed(() => {
  const a = appearance.value
  if (!a?.enabled) return null
  if (a.vibrancy !== 'none') return `is-vibrancy`
  return a.material !== 'none' ? `is-${a.material}` : 'is-transparent-only'
})
onMounted(() => {
  void loadAppearance()
  subscribeAppearance()
})
// 平台判断必须强韧：preload 读不到 process.platform 时会回退成 'win32'（真值），
// 在 mac 上将误判导致红绿灯边距丢失；纯浏览器调试时 edtRuntime 还可能完全缺失。
// 因此用 UA 交叉校验：两者矛盾时以 UA 为准（UA 反映渲染进程真实运行环境）
function platformFromUA(): string | null {
  const ua = navigator.userAgent ?? ''
  if (/Macintosh|MacIntel|Mac OS/i.test(ua))
    return 'darwin'
  if (/Windows/i.test(ua))
    return 'win32'
  if (/Linux/i.test(ua))
    return 'linux'
  return null
}
function detectPlatform(): string {
  const fromPreload = window.edtRuntime?.platform
  const fromUA = platformFromUA()
  if (fromUA && fromPreload && fromUA !== fromPreload)
    return fromUA
  return fromPreload || fromUA || 'web'
}
const platform = detectPlatform()

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
// 应用自带页面（设置等）并入同一张表：它们同样是页签，常驻挂载可留住已加载的数据，
// 切走再切回不必重新拉一遍磁盘用量 / 目录信息。
// 注册表是静态的（构建期确定的工具清单 + 当前平台可用的应用页面），故用普通常量而非 computed。
// 应用页面按目标平台裁剪：设置是桌面端专属（electronOnly），网页预览下不进这张表。
const tabComponents: Record<string, Component> = {
  ...Object.fromEntries(getToolRegistry().map(t => [t.id, t.route.component as Component])),
  ...Object.fromEntries(getAppTabs().map(t => [t.id, t.component])),
}

const shellEl = ref<HTMLElement | null>(null)
let motion: MotionScope | undefined
// 全屏时原生窗口控件隐藏（mac 红绿灯 / Win 右上按钮），收回标题栏预留边距；
// mac 原生全屏不触发 DOM fullscreen API，主来源是主进程推送事件，DOM 监听只做兜底
const isFullscreen = ref(false)
// 外壳模式类：is-transparent 表示「已开启半透明」，is-<material> 表示当前材质
// （translucency.scss 按后者覆写 alpha），has-test-wallpaper 是玻璃调试用的假壁纸。
// 放在 isFullscreen 之后定义，避免前向引用。
const hasTestWallpaper = computed(() => appearance.value?.testWallpaper === true)
const modeClasses = computed<string[]>(() => {
  const classes: string[] = []
  if (isFullscreen.value) classes.push('is-fullscreen')
  if (isTransparent.value) classes.push('is-transparent')
  if (hasTestWallpaper.value) classes.push('has-test-wallpaper')
  if (materialClass.value) classes.push(materialClass.value)
  return classes
})
// 同一份模式类也要挂到 <html>：EP 弹层（select / cascader / dropdown / date-picker /
// autocomplete / dialog / message）全部 teleport 到 body，不在 .app-shell 内，
// 只挂外壳的话这些浮层继承不到 --alpha-* / --glass-*，会退化成「无背景」的透明面板。
// 测试壁纸同样只能挂在 <html> / body 上：它必须画在所有内容之下（含 teleport 出去的浮层），
// 挂在外壳内会随 .app-main 的滚动与层级被裁切。
// 摘掉上一轮、挂上这一轮：新增模式类只改上面的列表，不必再同步维护第二份类名清单。
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
  // 有主进程推送时以推送为准（mac 原生全屏不经过 DOM API），DOM 只补“进入”事件；
  // 纯浏览器调试（无推送）时才用 DOM 做双向同步
  if (document.fullscreenElement != null)
    isFullscreen.value = true
  else if (!offFullscreenIpc)
    isFullscreen.value = false
}

onMounted(() => {
  const el = shellEl.value
  if (!el)
    return
  // 应用外壳入场：顶栏下滑（不动画 .app-main，避免与子页入场 opacity 叠加发灰）
  motion = createMotionScope(() => {
    gsap.from('.app-header', { y: -16, autoAlpha: 0, duration: 0.5, ease: 'power3.out', clearProps: 'transform,opacity,visibility' })
  }, el)
  try {
    const channel: string = appIpcChannels().EVENT_FULLSCREEN_CHANGED
    offFullscreenIpc = onAppIpc<boolean>(channel, fullscreen => isFullscreen.value = fullscreen === true)
  } catch {
    // 纯浏览器调试（无 edtApp 注入）：仅靠 DOM 全屏状态兜底
  }
  document.addEventListener('fullscreenchange', syncDomFullscreen)
})

onUnmounted(() => {
  offFullscreenIpc?.()
  document.removeEventListener('fullscreenchange', syncDomFullscreen)
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

// 设置页签：与工具页签同构（打开 / 高亮 / 关闭都复用 toolTabs），
// 只是入口固定在标题栏右上角，而不是首页卡片。
const settingsTab = findAppTab('settings')
const isSettingsActive = computed(() => settingsTab !== undefined && tabsStore.activeId === settingsTab.id)

function openSettings() {
  // 已打开则只切过去（页签常驻挂载，状态不丢）；未打开时由路由同步逻辑补进页签列表
  if (settingsTab) router.push({ name: settingsTab.routeName })
}
</script>

<template>
  <div ref="shellEl" class="app-shell" :class="[`platform-${platform}`, modeClasses]">
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
      <!-- 设置入口：固定在标题栏右上角、原生窗口按钮左侧（Windows 上即最小化按钮左边）。
           图标按钮而非文字按钮：标题栏里已有品牌标 + 页签，再加文字会和页签抢视觉重量；
           34px 见方与品牌标同高，右端与原生窗口按钮同一条基线。
           网页预览下 settingsTab 为 undefined（设置页是桌面端专属），入口整钮不渲染。 -->
      <button
        v-if="settingsTab"
        type="button"
        class="header-settings"
        :class="{ 'is-active': isSettingsActive }"
        aria-label="设置"
        title="设置"
        @click="openSettings"
      >
        <UiIcon name="gear" :size="17" />
      </button>
    </header>

    <main class="app-main">
      <router-view v-slot="{ Component: RouteComponent, route: r }">
        <Transition name="page" mode="out-in">
          <component :is="RouteComponent" v-if="!r.meta?.toolId" :key="r.path" />
        </Transition>
      </router-view>
      <div v-show="!!currentTool" class="tools-host">
        <template v-for="tab in tabsStore.openTabs" :key="tab.id">
          <component :is="tabComponents[tab.id]" v-show="tab.id === tabsStore.activeId" />
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
  /* 不设背景：底色由各页面自理（工具页 .tool-page 自带 app-bg，首页透明跟随窗口），
     外壳留白才能让半透明窗口透出桌面 */
}

/* 半透明窗口的画布 / 阴影 / 标题栏规则统一收敛到
   renderer/shared/styles/translucency.scss（按模式覆写 alpha），此处不再重复。 */

.app-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
  flex-shrink: 0;
  min-height: var(--titlebar-height);
  // 基座保持常规边距；mac 红绿灯安全边距由下方 .platform-darwin 规则提供，
  // win/linux 右侧按钮预留由下方规则提供（各平台互不干扰）
  padding: 0 var(--spacing-lg);
  /* 无背景色：标题栏透出窗口画布（半透明窗口下即透出桌面），
     分层靠下方内容区的边界，不再靠一条实色带 + 分隔线 */
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
    border-radius: var(--radius-control);
    /* 品牌标：圆角矩形（primary-light 底 + primary 字） */
    background: var(--color-primary-light);
    color: var(--color-primary);
    font-family: var(--font-brand);
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

// 设置入口：钉在标题栏右端，Windows / Linux 上正好落在原生「最小化」按钮左侧。
// 右侧已由上面的平台规则预留 148px 原生按钮区，这里只需与页签分开一个小间距——
// app-header 的 gap 已经提供，不再额外加 margin。
.header-settings {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  // margin-left: auto 是「永远靠右」的真正保障：有页签时 .header-tabs（flex:1）已吃掉
  // 剩余空间，此处 auto 为 0 不影响布局；**页签全部关闭时 .header-tabs 因 v-if 被移除**，
  // 没有它兜底按钮就会紧挨品牌标跑到左边去。
  margin-left: auto;
  -webkit-app-region: no-drag;
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: var(--transition-fast);

  &:hover {
    background: var(--color-fill);
    color: var(--color-text-primary);
  }

  // 设置页签处于激活态时高亮：入口状态与「当前是否在看设置」保持一致
  &.is-active {
    background: var(--color-primary-light);
    color: var(--color-primary);
  }

  // 标题栏元素不参与全局 el-button 焦点规则，键盘焦点环单独给
  &:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }
}

// macOS 红绿灯按钮在左上（hiddenInset，位置见 electron/main.ts 的 trafficLightPosition）：
// x=20 + 三灯 52px + 16px 间隙 = 88px 起放内容
.platform-darwin .app-header {
  padding-left: 88px;
}

// 工具页签：内嵌标题栏行（品牌标右侧），圆角高亮
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
    border-radius: var(--radius-sm);
    // EP 卡片页签有三套 padding（基础 20 / hover 13 / 激活 20）且 hover 才把关闭图标
    // 从 0 撑到 14px，任何一项变化都会让页签变宽变窄、邻居左右跳。
    // 此处全部钉死为常量（需 !important 压过 EP 的 is-active/is-closable:hover 规则），
    // 页签宽度恒定，关闭按钮常驻占位、仅透明度显隐。
    padding: 0 13px !important;
    margin-right: var(--spacing-xs);
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
      background: var(--color-fill);
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
  /* 窄窗口标题栏折两行：首行 = 品牌标 + 设置钮（设置贴右），次行 = 页签（整行、横向可滚动）。
     用 row + wrap 而不是 column：column 下设置钮会独占一整行，右侧再空出一大片，
     既浪费高度又让它看起来像是「掉到左边去了」的反面版本。 */
  .app-header {
    height: auto;
    min-height: var(--titlebar-height);
    flex-wrap: wrap;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-md) var(--spacing-md);
  }

  /* 页签整行：flex-basis 100% 强制换行，order 保证它排在设置钮之后 */
  .header-tabs {
    flex: 1 0 100%;
    order: 1;
    min-width: 0;
    overflow-x: auto;
  }

  /* 首行右端：宽窗口里由 .header-tabs 的 flex:1 挤到右边，这里页签已换行，
     必须靠 auto 外边距把按钮顶到行尾 */
  .header-settings {
    order: 0;
    margin-left: auto;
  }

  // 窄窗口 / 页面放大时 mac 仍需红绿灯安全边距（特异性高于上方基座规则）
  .platform-darwin .app-header {
    padding-left: 88px;
  }
}

// 全屏时原生窗口控件隐藏（mac 红绿灯 / Win 右上按钮），收回标题栏预留边距；
// 放媒体查询之后，特异性也高于各平台规则，窄窗口全屏同样生效
.app-shell.is-fullscreen.platform-darwin .app-header {
  padding-left: var(--spacing-lg);
}

.app-shell.is-fullscreen.platform-win32 .app-header,
.app-shell.is-fullscreen.platform-linux .app-header {
  padding-right: var(--spacing-lg);
}
</style>
