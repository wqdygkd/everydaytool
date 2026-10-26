import type { Wb2apiAppSettings } from '../../../../shared/workbuddy2api-panel.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { defaultWb2apiAppSettings, parseListenPort } from '../../../../shared/workbuddy2api-panel.ts'
import { getWb2apiSettingsPath } from '../utils/paths.ts'

export function readAppSettings(): Wb2apiAppSettings {
  const raw = readJsonDocument<Partial<Wb2apiAppSettings>>(getWb2apiSettingsPath(), defaultWb2apiAppSettings)
  return {
    port: parseListenPort(String(raw.port ?? ''), defaultWb2apiAppSettings().port),
  }
}

export function writeAppSettings(settings: Wb2apiAppSettings): void {
  writeJsonDocument(getWb2apiSettingsPath(), settings)
}
