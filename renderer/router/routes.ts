import type { RouteRecordRaw } from 'vue-router'
import { allToolRegistry } from '../config/tools'
import HomePage from '../pages/HomePage.vue'

// 工具页全部常驻挂载（App.vue 里按 tab 做 v-show 显隐，webview 不离文档、不重建），
// 因此路由拍平为顶层，不再经过 ToolLayout 的嵌套 router-view + keep-alive
// （keep-alive 会把 DOM 移出文档，导致 webview guest 被销毁、切回重载）。
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomePage,
    meta: { title: 'everydaytool' },
  },
  ...allToolRegistry.map(tool => ({
    ...(tool.route as RouteRecordRaw),
    path: `/tools/${(tool.route.path as string).replace(/^\//, '')}`,
  })),
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]
