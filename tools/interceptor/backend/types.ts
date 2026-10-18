// interceptor 工具域内部类型（不跨进程：跨进程类型放 shared/interceptor.ts）
import type { InterceptorTarget } from '../../../shared/interceptor.ts'

export interface InterceptorConfigData {
  /** 扩展配对 token（edt 生成；扩展 popup 一次性填入） */
  token: string
  /** 处理名单（edt 处理层过滤器） */
  targets: InterceptorTarget[]
}
