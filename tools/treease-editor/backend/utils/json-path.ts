const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

export function isUnsafeJsonPathSegment(segment: string): boolean {
  return UNSAFE_SEGMENTS.has(segment)
}

export function hasUnsafeJsonPath(path: string): boolean {
  return path.split('.').map(part => part.trim()).some(isUnsafeJsonPathSegment)
}
