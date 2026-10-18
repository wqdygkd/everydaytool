// Treease 编辑器接口拦截域共享类型（renderer ↔ 主进程 backend）。

export interface TreeaseInterceptPatch {
  path: string
  value: unknown
}

export interface TreeaseInterceptRule {
  id: string
  name: string
  enabled: boolean
  urlPattern: string
  action: 'modify' | 'block'
  patches: TreeaseInterceptPatch[]
}

export interface TreeaseInterceptStatus {
  webContentsId: number
  attached: boolean
  ruleCount: number
  hits: number
}

export interface TreeaseInterceptLog {
  webContentsId: number
  hits: number
}
