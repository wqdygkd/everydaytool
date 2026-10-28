// Treease 编辑器接口拦截域共享类型（UI ↔ Rust 桌面壳）。

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
  webviewId: number
  attached: boolean
  ruleCount: number
  hits: number
}

export interface TreeaseInterceptLog {
  webviewId: number
  hits: number
}
