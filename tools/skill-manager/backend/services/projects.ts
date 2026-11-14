import type { ProjectRecord, ProjectRegistry } from '../../../../shared/skill-manager.ts'
import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, parse, resolve } from 'node:path'
import process from 'node:process'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { readProjectLock } from '../locks/project-lock.ts'

export const PROJECT_REGISTRY_VERSION = 1 as const

export interface ProjectLockStatus {
  path: string
  state: 'ok' | 'missing' | 'invalid' | 'unsupported'
  version?: number
  message?: string
}

export function emptyProjectRegistry(): ProjectRegistry {
  return { version: PROJECT_REGISTRY_VERSION, projects: [] }
}

export function readProjectRegistry(path: string): ProjectRegistry {
  const value = readJsonDocument<ProjectRegistry>(path, emptyProjectRegistry)
  if (!value || value.version !== PROJECT_REGISTRY_VERSION || !Array.isArray(value.projects)) {
    return emptyProjectRegistry()
  }
  return value
}

export function writeProjectRegistry(registry: ProjectRegistry, path: string): void {
  writeJsonDocument(path, registry)
}

export function projectScopeId(projectPath: string): string {
  const digest = createHash('sha256').update(projectPath).digest('hex').slice(0, 12)
  return `project:${digest}`
}

export async function normalizeProjectPath(input: string): Promise<string> {
  if (!input.trim()) throw new Error('项目路径不能为空')
  const absolute = resolve(input)
  assertNotSystemPath(absolute)

  let normalized: string
  try {
    normalized = await realpath(absolute)
  } catch {
    throw new Error(`项目路径不存在或无法访问：${absolute}`)
  }
  assertNotSystemPath(normalized)

  let info
  try {
    info = await stat(normalized)
  } catch {
    throw new Error(`项目路径不存在或无法访问：${normalized}`)
  }
  if (!info.isDirectory()) throw new Error('项目路径不是目录')
  return normalized
}

function samePath(a: string, b: string): boolean {
  const normalize = (value: string) => {
    const resolved = resolve(value)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  return normalize(a) === normalize(b)
}

function assertNotSystemPath(path: string): void {
  if (samePath(path, parse(path).root)) throw new Error('不能把文件系统根目录登记为项目')
  if (samePath(path, homedir())) throw new Error('不能把用户主目录登记为项目')
}

export async function registerProject(
  input: string,
  registryPath: string,
): Promise<ProjectRecord> {
  const path = await normalizeProjectPath(input)
  const registry = readProjectRegistry(registryPath)
  const existing = registry.projects.find(project => project.path === path)
  if (existing) return existing

  const record: ProjectRecord = {
    id: projectScopeId(path),
    name: basename(path) || path,
    path,
    addedAt: new Date().toISOString(),
    enabled: true,
  }
  const next: ProjectRegistry = {
    version: PROJECT_REGISTRY_VERSION,
    projects: [...registry.projects, record],
  }
  writeProjectRegistry(next, registryPath)
  return record
}

export function removeProject(registry: ProjectRegistry, id: string): ProjectRegistry {
  return {
    ...registry,
    projects: registry.projects.filter(project => project.id !== id),
  }
}

export async function unregisterProject(id: string, registryPath: string): Promise<void> {
  const registry = readProjectRegistry(registryPath)
  const next = removeProject(registry, id)
  if (next.projects.length !== registry.projects.length) writeProjectRegistry(next, registryPath)
}

export async function rescanProject(id: string, registryPath: string): Promise<ProjectRecord> {
  const registry = readProjectRegistry(registryPath)
  const index = registry.projects.findIndex(project => project.id === id)
  if (index < 0) throw new Error('项目不存在')
  const current = registry.projects[index]!
  const path = await normalizeProjectPath(current.path)
  await inspectProjectLock(path)
  const next: ProjectRecord = {
    ...current,
    path,
    name: basename(path) || current.name,
    lastScanAt: new Date().toISOString(),
  }
  const projects = [...registry.projects]
  projects[index] = next
  writeProjectRegistry({ ...registry, projects }, registryPath)
  return next
}

export async function inspectProjectLock(projectPath: string): Promise<ProjectLockStatus> {
  const result = await readProjectLock(projectPath)
  if (result.ok) {
    return {
      path: result.path,
      state: result.exists ? 'ok' : 'missing',
    }
  }
  return {
    path: result.path,
    state: result.reason === 'unsupported' ? 'unsupported' : 'invalid',
    ...(result.reason === 'unsupported' ? { version: result.version } : {}),
    message: result.message,
  }
}
