// interceptor 工具域内部类型（不跨进程：跨进程类型放 shared/interceptor.ts）
import type { InterceptorTarget } from '../../../shared/interceptor.ts'

export interface InterceptorConfigData {
  /** 代理监听端口（首次启动随机分配并落盘后固定；用户可手动修改；null = 尚未分配） */
  proxyPort: number | null
  /** 处理名单（白名单闸门：一个条目 = 一个 origin） */
  targets: InterceptorTarget[]
}
