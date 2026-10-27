// 开发态（未打包：`pnpm dev` / `pnpm start`）与安装版并存的身份隔离。
//
// Electron 的 userData 目录按应用名（package.json 的 name / productName）解析，未打包运行与
// 安装版会落到同一个目录（如 macOS `~/Library/Application Support/everydaytool`）。而 Chromium
// 的目录级单实例锁（`app.requestSingleInstanceLock()`）以 userData 为命名空间，于是装好的 app
// 开着时 `pnpm dev` 请求锁失败 → `app.quit()` 秒退，反过来也一样。
//
// 处理：在 ready 之前把未打包运行的 userData 换成 `<appData>/<应用名>-dev`。
// - 两种形态各持一把锁，可以同时在跑；同一形态内仍是单实例（dev 也不会开出第二个）；
// - userData 下的引导配置（data-root.json / data-root.path / setup-state.json）不再互相覆盖。
// 数据根目录不受影响：开发态默认 `<仓库>/data`、安装版 `<userData>/data`（见 data-root.ts），
// 本来就分开；但也别手动把两者切到同一个数据目录，JSON store 的并发写不是这里能兜住的。
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { isDevEnvironment } from './data-root.ts'
import { logger } from './logger.ts'

/** 开发态 userData 后缀：目录名 = `<appData>/<应用名>-dev` */
const DEV_USER_DATA_SUFFIX = '-dev'

export function getDevUserDataDirectory(): string {
  return path.join(app.getPath('appData'), `${app.getName()}${DEV_USER_DATA_SUFFIX}`)
}

/**
 * 必须在 app ready 之前调用，并且早于任何 `app.getPath('userData')` 读取：
 * Chromium 单实例锁、Electron 缓存目录、data-root.ts 的引导配置都按首次读到的路径定下来，
 * 读晚了就换不了（换掉的只是没人用的字段，进程仍握在旧目录的锁上）。
 *
 * @returns 本次进程实际使用的 userData 目录（安装版即默认目录，不做任何改动）
 */
export function configureInstanceIdentity(): string {
  if (!isDevEnvironment) return app.getPath('userData')

  const devUserData = getDevUserDataDirectory()
  try {
    // 目录必须先存在：Chromium 直接在 userData 根下创建 SingletonLock，建不出来就当成
    // 「已有实例在跑」→ requestSingleInstanceLock() 返回 false，启动即退出。
    mkdirSync(devUserData, { recursive: true })
    app.setPath('userData', devUserData)
    return devUserData
  } catch (error) {
    // 目录不可写（权限 / 路径非法）：退回默认 userData，宁可和安装版抢锁也要能启动本进程
    logger.warn('Failed to prepare isolated development userData; using default', {
      target: devUserData,
      error: (error as Error).message,
    })
    return app.getPath('userData')
  }
}
