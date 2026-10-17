// browser-bridge 工具域内部类型（不跨进程：跨进程类型放 shared/browser-bridge.ts）
import type { BridgeTarget } from '../../../shared/browser-bridge.ts'

export interface BridgeConfigData {
  /** 扩展配对 token（edt 生成；扩展 popup 一次性填入） */
  token: string
  /** 处理名单（edt 处理层过滤器） */
  targets: BridgeTarget[]
}
