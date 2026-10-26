import type { Wb2apiArchKey, Wb2apiOsKey } from '../../../../shared/workbuddy2api-panel.ts'
import process from 'node:process'
import {
  mapNodeArchToWb2apiArch,
  mapNodePlatformToWb2apiOs,
  WB2API_BINARY_NAME,
  WB2API_BINARY_NAME_WIN,
} from '../../../../shared/workbuddy2api-panel.ts'

export function resolveWb2apiPlatform(): { os: Wb2apiOsKey, arch: Wb2apiArchKey } {
  const os = mapNodePlatformToWb2apiOs(process.platform)
  const arch = mapNodeArchToWb2apiArch(process.arch)
  if (!os || !arch) {
    throw new Error(`当前平台不受支持：${process.platform}/${process.arch}`)
  }
  return { os, arch }
}

export function wb2apiBinaryFileName(): string {
  return process.platform === 'win32' ? WB2API_BINARY_NAME_WIN : WB2API_BINARY_NAME
}
