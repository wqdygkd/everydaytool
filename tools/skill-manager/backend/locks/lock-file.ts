import { readFile } from 'node:fs/promises'

export type TextReadResult
  = | { exists: true, text: string }
    | { exists: false, text: '' }

export async function readTextIfExists(path: string): Promise<TextReadResult> {
  try {
    return { exists: true, text: await readFile(path, 'utf8') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, text: '' }
    }
    throw error
  }
}

export function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
