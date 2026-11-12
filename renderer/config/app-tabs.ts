// 应用自带页面（非工具）：与工具页共享同一套「按路由挂载活动页」的机制，
// 区别只是「没有工具元数据、不出现在首页网格」——设置就是第一个这样的页面。
//
// 为什么单独一张表而不是塞进 tools：工具是「首页可浏览的功能」，设置是应用本身的一部分；
// 混进注册表会让首页多出一张不属于任何分类的卡片，还要再引入 hidden 标记去过滤。
//
// 命名注意：这里刻意用 app-* 而不是 shell-*——Electron 的 `shell` 模块（openPath /
// openExternal）在 backend 里随处可见，两套「shell」并存会让阅读时反复停顿。
import type { Component } from 'vue'
import type { IconName } from '../shared/components/ui/icons'
import { defineAsyncComponent } from 'vue'
import { isElectronEnvironment } from '../shared/environment'

export interface AppTab {
  /** 页面 id，同时作为路由 meta.toolId（标题栏上下文与活动组件解析依赖它） */
  id: string
  /** 页面名称（标题栏主文案） */
  name: string
  /** 标题栏图标（与工具 icon 同一套 SVG 图标集） */
  icon: IconName
  /** 标题栏副文案：一句话说明这个页面是干什么的 */
  description: string
  /** 路由 name */
  routeName: string
  /** 根级路径（应用页面不进 /tools 命名空间） */
  path: string
  component: Component
  /**
   * 桌面端专属页面：网页预览（无 preload 注入）下不注册路由、不出现在标题栏入口里。
   * 设置页读写的都是主进程能力（数据目录 / 磁盘用量 / 缓存清理 / 窗口外观），
   * 在浏览器里只会抛「未检测到 Edt App IPC」，故整页按目标平台裁剪。
   */
  electronOnly?: boolean
}

export const APP_TABS: AppTab[] = [
  {
    id: 'settings',
    name: '设置',
    icon: 'gear',
    description: '数据存储、窗口外观与高级配置',
    routeName: 'settings',
    path: '/settings',
    electronOnly: true,
    // 与工具页一致按需加载：设置页只在第一次打开时拉自己的 chunk
    component: defineAsyncComponent(() => import('../pages/SettingsPage.vue')),
  },
]

/** 当前客户端可用的应用页面（目标平台裁剪的唯一入口：路由 / 标题栏 / rail 入口都走这里） */
export function getAppTabs(): AppTab[] {
  return APP_TABS.filter(tab => !tab.electronOnly || isElectronEnvironment())
}

export function findAppTab(id: string): AppTab | undefined {
  return getAppTabs().find(tab => tab.id === id)
}
