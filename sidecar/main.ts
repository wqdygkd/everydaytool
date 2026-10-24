import process from 'node:process'
import { dispatchCommand } from '../server/utils/commands.ts'
// Node 业务运行时入口（由 Rust 宿主以子进程方式启动）。
// 职责：安装平台通道 → 初始化各工具后端 → 处理 Rust 转发的命令 → 退出时释放资源。
import { installPlatformTransport } from '../server/utils/platform.ts'
import {
  hostTransport,
  markReady,
  patchConsoleToStderr,
  reportFatal,
  setInvokeHandler,
  setShutdownHandler,
  startProtocol,
} from './transport.ts'

patchConsoleToStderr()

installPlatformTransport(hostTransport)
startProtocol()

setInvokeHandler(async (domain, command, args) => {
  return await dispatchCommand(domain, command, args)
})

async function bootstrap(): Promise<void> {
  // 先装好处理器再初始化：初始化期间渲染层可能已经发起调用（读取数据目录等）。
  const { disposeServices, initializeServices } = await import('./services.ts')

  setShutdownHandler(async () => {
    await disposeServices()
  })

  try {
    await initializeServices()
    markReady()
  } catch (error) {
    reportFatal(error)
    console.error('[host] fatal during initialize', error)
    process.exit(1)
  }
}

void bootstrap()
