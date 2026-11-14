import type { ProjectRecord, Scope } from '../../../../shared/skill-manager.ts'
import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'
import { getGlobalLockPath } from '../locks/global-lock.ts'
import { getProjectLockPath } from '../locks/project-lock.ts'

/**
 * 扫描器运行环境。生产环境全部缺省；测试注入临时目录，
 * 避免扫描真实主目录与仓库（结果随机器变化）。
 */
export interface ScannerEnvironment {
  cwd?: string
  homeDir?: string
  globalSkillsDir?: string
  globalLockPath?: string
}

export interface ResolvedScannerEnvironment {
  cwd: string
  homeDir: string
  globalSkillsDir: string
  globalLockPath: string
}

let scannerEnvironment: ScannerEnvironment | undefined
let projectRegistryProvider: (() => ProjectRecord[]) | undefined

/** IPC 层注入项目登记表；测试不注入时只扫描 global 与当前工作目录。 */
export function configureProjectRegistryProvider(provider: (() => ProjectRecord[]) | undefined): void {
  projectRegistryProvider = provider
}

/** 注入扫描环境；传 undefined 恢复真实主目录 / 当前工作目录。 */
export function configureScannerEnvironment(next: ScannerEnvironment | undefined): void {
  scannerEnvironment = next
}

export function resolveScannerEnvironment(): ResolvedScannerEnvironment {
  const homeDir = scannerEnvironment?.homeDir
    ? resolve(scannerEnvironment.homeDir)
    : homedir()
  return {
    cwd: scannerEnvironment?.cwd ? resolve(scannerEnvironment.cwd) : process.cwd(),
    homeDir,
    globalSkillsDir: scannerEnvironment?.globalSkillsDir
      ? resolve(scannerEnvironment.globalSkillsDir)
      : join(homeDir, '.agents', 'skills'),
    globalLockPath: scannerEnvironment?.globalLockPath
      ? resolve(scannerEnvironment.globalLockPath)
      : getGlobalLockPath(),
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

async function hashPath(path: string): Promise<string> {
  return createHash('sha256').update(path).digest('hex').slice(0, 12)
}

export async function buildScopes(): Promise<Scope[]> {
  const environment = resolveScannerEnvironment()
  const scopes: Scope[] = [{
    id: 'global',
    kind: 'global',
    label: '全局',
    skillsDir: environment.globalSkillsDir,
    lockPath: environment.globalLockPath,
    lockState: 'missing',
  }]

  const seen = new Set<string>()
  const addProject = async (inputPath: string, label?: string, force = false): Promise<void> => {
    let projectPath = resolve(inputPath)
    try {
      projectPath = await realpath(projectPath)
    } catch {
      return
    }
    if (seen.has(projectPath)) return
    const skillsDir = join(projectPath, '.agents', 'skills')
    const lockPath = getProjectLockPath(projectPath)
    if (!force && !(await pathExists(skillsDir)) && !(await pathExists(lockPath))) return
    seen.add(projectPath)
    scopes.push({
      id: `project:${await hashPath(projectPath)}`,
      kind: 'project',
      label: label || basename(projectPath) || projectPath,
      skillsDir,
      lockPath,
      projectPath,
      lockState: 'missing',
    })
  }

  const registered = projectRegistryProvider?.() ?? []
  for (const project of registered) {
    if (project.enabled !== false) await addProject(project.path, project.name, true)
  }
  await addProject(environment.cwd)
  return scopes
}
