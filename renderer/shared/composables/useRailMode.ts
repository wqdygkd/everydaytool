import type { RailMode, UiPreferences } from '../../../shared/app'
import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'
import { isRailMode } from '../../../shared/app'
import { STORAGE_KEYS } from '../../../shared/storage-keys'
import { appIpcChannels, invokeAppIpc } from '../ipc/useAppIpc'

export type { RailMode }

const MODE_ORDER: readonly RailMode[] = ['compact', 'wide', 'collapsed']

const MODE_LABELS: Record<RailMode, string> = {
  compact: '左轨：图标栏（点击展开为宽栏）',
  wide: '左轨：宽栏（点击收起）',
  collapsed: '左轨：已收起（点击恢复图标栏）',
}

export function useRailMode() {
  // LocalStorage 只做网页预览镜像；桌面端的事实来源是配置层 ui-preferences.json，
  // 这样清会话缓存 / 换数据目录 / 重启都不会把左轨状态重置。
  const storedMode = useLocalStorage<string>(STORAGE_KEYS.railMode, 'compact', {
    writeDefaults: false,
    onError: () => {},
  })

  const mode = computed<RailMode>(() => isRailMode(storedMode.value) ? storedMode.value : 'compact')
  const label = computed(() => MODE_LABELS[mode.value])
  let dirty = false

  async function persist(next: RailMode) {
    try {
      await invokeAppIpc<UiPreferences>(appIpcChannels().UI_PREFERENCES_SET, { railMode: next })
    } catch {
      // 纯浏览器预览没有 preload：LocalStorage 镜像已足够。
    }
  }

  async function syncFromConfigLayer() {
    let stored: UiPreferences
    try {
      stored = await invokeAppIpc<UiPreferences>(appIpcChannels().UI_PREFERENCES_GET)
    } catch {
      // 纯浏览器预览：保持 LocalStorage 镜像。
      return
    }

    // 等待期间用户已经点过切换：以用户这次选择为准，不回灌旧值。
    if (dirty) return

    const remoteMode = isRailMode(stored.railMode) ? stored.railMode : 'compact'
    if (remoteMode === 'compact' && mode.value !== 'compact') {
      // 旧版本只写过 LocalStorage 镜像：把用户当前选择补进配置层。
      void persist(mode.value)
      return
    }
    storedMode.value = remoteMode
  }

  function cycle() {
    const index = MODE_ORDER.indexOf(mode.value)
    const next = MODE_ORDER[(index + 1) % MODE_ORDER.length]
    dirty = true
    storedMode.value = next
    void persist(next)
  }

  void syncFromConfigLayer()

  return { mode, label, cycle }
}
