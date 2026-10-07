import { execFile } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const PROCESS_QUERY_TIMEOUT_MS = 5000

/**
 * 检测指定可执行文件的进程是否已在运行：
 * 单实例应用（如 WXP）在已有实例时再 spawn 只会激活旧窗口，新进程随即退出，
 * 会导致等待 CDP 超时，因此启动前先做防呆检测。
 *
 * 一律走 execFile（不经 shell）：executablePath 可被 IPC 写入，
 * 文件名拼进 shell 字符串会形成命令注入（macOS/Linux 文件名允许 ; $() 等元字符）。
 */
export async function isExecutableRunning(executablePath: string): Promise<boolean> {
  const imageName = path.basename(executablePath.trim())
  if (!imageName) return false

  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'tasklist',
        ['/NH', '/FI', `IMAGENAME eq ${imageName}`],
        { encoding: 'utf8', timeout: PROCESS_QUERY_TIMEOUT_MS, windowsHide: true },
      )
      return stdout.toLowerCase().includes(imageName.toLowerCase())
    }
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const { stdout } = await execFileAsync(
        'pgrep',
        ['-f', '--', imageName],
        { encoding: 'utf8', timeout: PROCESS_QUERY_TIMEOUT_MS },
      )
      return stdout.trim().length > 0
    }
    return false
  } catch {
    // pgrep 无匹配时以非零码退出；查询失败按未运行处理
    return false
  }
}
