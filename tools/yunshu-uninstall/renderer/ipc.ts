import type {
  CleanProgress,
  CleanResult,
  ResidueScan,
} from '@shared/yunshu-uninstall'
import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'
import { YUNSHU_UNINSTALL_CHANNELS } from '@shared/yunshu-uninstall'

const { invoke, on } = createIpcHelpers('yunshuUninstall', '云枢卸载')

export function scanResidue(): Promise<ResidueScan> {
  return invoke<ResidueScan>(YUNSHU_UNINSTALL_CHANNELS.SCAN)
}

export function cleanResidue(ids: string[]): Promise<CleanResult> {
  return invoke<CleanResult>(YUNSHU_UNINSTALL_CHANNELS.CLEAN, { ids })
}

export function openTrash(): Promise<void> {
  return invoke<void>(YUNSHU_UNINSTALL_CHANNELS.OPEN_TRASH)
}

export function openKeychainAccess(): Promise<void> {
  return invoke<void>(YUNSHU_UNINSTALL_CHANNELS.OPEN_KEYCHAIN)
}

export function onCleanProgress(callback: (progress: CleanProgress) => void): () => void {
  return on<CleanProgress>(YUNSHU_UNINSTALL_CHANNELS.EVENT_PROGRESS, callback)
}
