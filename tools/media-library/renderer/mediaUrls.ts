import type { MediaEndpoint } from '@shared/media-library'

export function thumbUrl(
  endpoint: MediaEndpoint | null,
  collectionId: string,
  itemId: string,
  version = 0,
): string | null {
  if (!endpoint) return null
  return `${endpoint.origin}/thumb/${collectionId}/${itemId}?t=${endpoint.token}&v=${version}`
}

export function fileUrl(endpoint: MediaEndpoint | null, collectionId: string, itemId: string): string | null {
  if (!endpoint) return null
  return `${endpoint.origin}/file/${collectionId}/${itemId}?t=${endpoint.token}`
}
