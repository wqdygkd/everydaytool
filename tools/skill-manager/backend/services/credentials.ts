import type { TokenState } from '../../../../shared/skill-manager.ts'
import { resolveLayerPath } from '../../../../backend/utils/data-layers.ts'
import { openSecretDetailed, sealSecret } from '../../../../backend/utils/secret-box.ts'
import {
  deleteToken as deleteTokenCore,
  listTokenHosts,
  readToken,
  saveToken as saveTokenCore,
} from './credentials-core.ts'

export function getDefaultCredentialsPath(): string {
  return resolveLayerPath('config', 'skill-manager', 'credentials.json')
}

const codec = {
  seal: (plain: string) => sealSecret(plain, 'skill-manager-token'),
  open: (value: string) => openSecretDetailed(value, 'skill-manager-token'),
}

export function listSkillManagerTokens(path = getDefaultCredentialsPath()): TokenState {
  return listTokenHosts(path, codec)
}

export function saveSkillManagerToken(host: string, token: string, path = getDefaultCredentialsPath()): TokenState {
  return saveTokenCore(path, host, token, codec)
}

export function deleteSkillManagerToken(host: string, path = getDefaultCredentialsPath()): TokenState {
  return deleteTokenCore(path, host, codec)
}

export function getSkillManagerToken(host: string, path = getDefaultCredentialsPath()): string | undefined {
  return readToken(path, host, codec)
}
