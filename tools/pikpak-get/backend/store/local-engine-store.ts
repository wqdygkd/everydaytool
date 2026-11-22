import { randomBytes } from 'node:crypto'
import { resolveLayerPath } from '../../../../backend/utils/data-layers.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'

export interface LocalEngineConfig {
  dest: string
  masterKey: string
}

function localEnginePath(): string {
  return resolveLayerPath('config', 'pikpak-get', 'local-engine.json')
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex')
}

/**
 * 本机引擎配置：masterKey（账号库 edt-kdf:v1 加密密钥）+ dest（本机下载库）。
 * masterKey 明文落盘：它是引擎侧密钥，必须随数据目录迁移换机还原（不能用 safeStorage——
 * 那会绑死本机、换机解不开账号库）。安全级别等同 NAS 部署的 `.env`，依赖本机磁盘权限。
 */
export function getLocalEngineConfig(): LocalEngineConfig {
  const raw = readJsonDocument<Partial<LocalEngineConfig>>(localEnginePath(), () => ({}))
  const config: LocalEngineConfig = {
    dest: typeof raw.dest === 'string' && raw.dest.trim() ? raw.dest.trim() : resolveLayerPath('assets', 'pikpak-get'),
    masterKey: typeof raw.masterKey === 'string' && raw.masterKey ? raw.masterKey : '',
  }
  if (!config.masterKey) {
    config.masterKey = randomHex(32)
    writeJsonDocument(localEnginePath(), config)
  }
  return config
}

export function setLocalEngineDest(dest: string): LocalEngineConfig {
  const current = getLocalEngineConfig()
  const next: LocalEngineConfig = {
    dest: dest.trim() || current.dest,
    masterKey: current.masterKey,
  }
  writeJsonDocument(localEnginePath(), next)
  return next
}

export function setLocalEngineMasterKey(masterKey: string): LocalEngineConfig {
  const current = getLocalEngineConfig()
  const next: LocalEngineConfig = {
    dest: current.dest,
    masterKey: masterKey.trim() || current.masterKey,
  }
  writeJsonDocument(localEnginePath(), next)
  return next
}
