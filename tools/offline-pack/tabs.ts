// offline-pack 页签与路由的映射：路由即页签状态，URL 可深链、前进后退可用。
// 路由表本体在 index.ts 的 subRoutes（经 ui/router/routes.ts 拍平），此处只放
// 页面导航与路由解析共用的映射，避免多处各写一份路径。
import chromeLogo from './assets/logos/chrome.svg'
import dockerLogo from './assets/logos/docker.svg'
import edgeLogo from './assets/logos/edge.svg'
import microsoftLogo from './assets/logos/microsoft.svg'
import vscodeLogo from './assets/logos/vscode.svg'

export type OfflinePackTabKey = 'vscode' | 'chrome' | 'edge' | 'docker' | 'msstore'

export interface OfflinePackTabDef {
  key: OfflinePackTabKey
  label: string
  /** 页签品牌 logo（SVG 资源 URL） */
  icon: string
  routeName: string
}

export const OFFLINE_PACK_TOOL_ROOT = '/tools/offline-pack'

/** 页签顺序即展示顺序；主路由重定向到第一项（vscode） */
export const OFFLINE_PACK_TABS: readonly OfflinePackTabDef[] = [
  { key: 'vscode', label: 'VSCode 插件', icon: vscodeLogo, routeName: 'tool-offline-pack-vscode' },
  { key: 'chrome', label: 'Chrome 拓展', icon: chromeLogo, routeName: 'tool-offline-pack-chrome' },
  { key: 'edge', label: 'Edge 拓展', icon: edgeLogo, routeName: 'tool-offline-pack-edge' },
  { key: 'docker', label: 'Docker 镜像', icon: dockerLogo, routeName: 'tool-offline-pack-docker' },
  { key: 'msstore', label: 'Microsoft 商店', icon: microsoftLogo, routeName: 'tool-offline-pack-msstore' },
]

/** 从路由 path 解析当前页签；非法 / 缺失回落 vscode */
export function tabKeyFromPath(path: string): OfflinePackTabKey {
  const prefix = `${OFFLINE_PACK_TOOL_ROOT}/`
  const segment = path.startsWith(prefix) ? path.slice(prefix.length).split('/')[0] : ''
  return OFFLINE_PACK_TABS.find(tab => tab.key === segment)?.key ?? 'vscode'
}
