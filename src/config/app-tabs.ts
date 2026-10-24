// 应用自带页面（非工具）：与工具页共享同一套页签 / 常驻挂载机制，
// 区别只是「没有工具元数据、不出现在首页网格」——设置就是第一个这样的页面。
//
// 为什么单独一张表而不是塞进 tools：工具是「首页可浏览的功能」，设置是应用本身的一部分；
// 混进注册表会让首页多出一张不属于任何分类的卡片，还要再引入 hidden 标记去过滤。
//
// 命名注意：这里刻意用 app-* 而不是 shell-*——桌面宿主的 `shell` 能力（openPath /
// openExternal）在 backend 里随处可见，两套「shell」并存会让阅读时反复停顿。
import type { Component } from 'vue'
import { defineAsyncComponent } from 'vue'
import { isDesktopEnvironment } from '../shared/environment'

export interface AppTab {
  /** 页签 id，同时作为路由 meta.toolId（页签高亮与常驻挂载依赖它） */
  id: string
  /** 页签标题 */
  name: string
  /** 路由 name */
  routeName: string
  /** 根级路径（应用页面不进 /tools 命名空间） */
  path: string
  component: Component
  /**
   * 桌面端专属页面：网页预览（无桌面桥接注入）下不注册路由、不出现在页签里。
   * 设置页读写的都是桌面宿主能力（数据目录 / 磁盘用量 / 缓存清理 / 窗口外观），
   * 在浏览器里只会抛「未检测到 Edt App command」，故整页按目标平台裁剪。
   */
  desktopOnly?: boolean
}

export const APP_TABS: AppTab[] = [
  {
    id: 'settings',
    name: '设置',
    routeName: 'settings',
    path: '/settings',
    desktopOnly: true,
    // 与工具页一致按需加载：设置页只在第一次打开时拉自己的 chunk
    component: defineAsyncComponent(() => import('../pages/SettingsPage.vue')),
  },
]

/** 当前客户端可用的应用页面（目标平台裁剪的唯一入口：路由 / 页签 / 标题栏入口都走这里） */
export function getAppTabs(): AppTab[] {
  return APP_TABS.filter(tab => !tab.desktopOnly || isDesktopEnvironment())
}

export function findAppTab(id: string): AppTab | undefined {
  return getAppTabs().find(tab => tab.id === id)
}
