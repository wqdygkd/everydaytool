import type { Wb2apiManifest } from '../../../../shared/workbuddy2api-panel.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { getWb2apiManifestPath } from '../utils/paths.ts'

export function readManifest(): Wb2apiManifest | null {
  const data = readJsonDocument<Wb2apiManifest | null>(getWb2apiManifestPath(), () => null)
  if (!data || typeof data !== 'object') return null
  if (typeof data.version !== 'string' || typeof data.assetName !== 'string') return null
  return data
}

export function writeManifest(manifest: Wb2apiManifest): void {
  writeJsonDocument(getWb2apiManifestPath(), manifest)
}
