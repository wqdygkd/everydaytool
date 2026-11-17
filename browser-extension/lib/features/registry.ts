import type { FeatureDefinition } from '../shell/types.ts'
import { interceptorFeature } from './interceptor/index.ts'

/** 已登记的浏览器侧 feature；新工具在此追加 */
export const FEATURES: FeatureDefinition[] = [
  interceptorFeature,
]

export function getPopupTabs(): Array<{ id: string, label: string }> {
  return FEATURES
    .filter(feature => feature.popupTab)
    .map(feature => feature.popupTab!)
}
