// NAS 部署入口：读环境变量 → 创建 PikpakEngine → 起 HTTP 服务。
// 打包后 `node service.mjs` 运行；本机内嵌模式不经此入口（直接 new PikpakEngine）。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { PikpakEngine } from './engine.ts'
import { createEngineService } from './service.ts'

function env(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback
}

const configDir = env('PIKPAK_ENGINE_CONFIG_DIR', '/config')

// masterKey 优先级：导入迁移写下的 <config>/master.key > 环境变量。这样「导入数据」可以
// 覆盖主密钥，本机→NAS 一键迁移时账号库密文才能被解出来。
let masterKey = ''
try {
  masterKey = readFileSync(path.join(configDir, 'master.key'), 'utf8').trim()
} catch {
  masterKey = env('PIKPAK_ENGINE_MASTER_KEY')
}
if (!masterKey) {
  console.error('PIKPAK_ENGINE_MASTER_KEY is required')
  process.exit(1)
}

const engine = new PikpakEngine({
  configDir,
  destDir: env('PIKPAK_DEST', '/downloads'),
  masterKey,
  // 不传 fetchImpl：NAS 用 Node 22 全局 fetch（undici）。
})

const service = createEngineService({
  engine,
  token: env('PIKPAK_ENGINE_TOKEN'),
})

const port = Number(env('PIKPAK_ENGINE_PORT', '8787'))
service.listen(port, '0.0.0.0', () => {
  console.error(`pikpak-get-engine listening on :${port}`)
})
