// 子进程调用的 Promise 封装（node ESM 无 promisify(execFile) 的惯用面）。
import type { ExecFileOptions } from 'node:child_process'
import { execFile } from 'node:child_process'

export interface ExecFileResult {
  code: number
  stdout: string
  stderr: string
  error?: Error
}

/**
 * 执行外部命令并返回结果（不因非零退出码抛错，由调用方判定）。
 * windowsHide：Windows 上避免一闪而过的黑框（certutil/osascript 均可能被频繁调用）。
 */
export function runCommand(command: string, args: string[], options: ExecFileOptions = {}): Promise<ExecFileResult> {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
      resolve({
        code,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        error: error ?? undefined,
      })
    })
  })
}
