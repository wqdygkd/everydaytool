// 跨平台解压 ZIP：优先系统 unzip / PowerShell；失败再走 Node 纯实现（store + deflate）。
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { inflateRawSync } from 'node:zlib'

const execFileAsync = promisify(execFile)

async function extractWithSystem(zipPath: string, destDir: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, '\'\'')}' -DestinationPath '${destDir.replace(/'/g, '\'\'')}' -Force`
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      })
      return true
    }
    await execFileAsync('unzip', ['-o', zipPath, '-d', destDir], { maxBuffer: 8 * 1024 * 1024 })
    return true
  } catch {
    return false
  }
}

/** 极简 ZIP 读取（仅 Local File Header + store/deflate），够用上游发行包 */
async function extractWithNode(zipPath: string, destDir: string): Promise<void> {
  const data = await readFile(zipPath)
  let offset = 0
  while (offset + 30 <= data.length) {
    if (data.readUInt32LE(offset) !== 0x04034B50) break
    const method = data.readUInt16LE(offset + 8)
    const compSize = data.readUInt32LE(offset + 18)
    const nameLen = data.readUInt16LE(offset + 26)
    const extraLen = data.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const nameEnd = nameStart + nameLen
    const name = data.subarray(nameStart, nameEnd).toString('utf8')
    const dataStart = nameEnd + extraLen
    const dataEnd = dataStart + compSize
    if (dataEnd > data.length) throw new Error('ZIP 文件截断')
    offset = dataEnd

    if (name.endsWith('/')) {
      await mkdir(path.join(destDir, name), { recursive: true })
      continue
    }
    // 拒绝路径穿越
    const resolved = path.resolve(destDir, name)
    if (!resolved.startsWith(path.resolve(destDir) + path.sep) && resolved !== path.resolve(destDir)) {
      throw new Error(`ZIP 含非法路径：${name}`)
    }
    await mkdir(path.dirname(resolved), { recursive: true })
    const compressed = data.subarray(dataStart, dataEnd)
    let content: Buffer
    if (method === 0) content = Buffer.from(compressed)
    else if (method === 8) content = inflateRawSync(compressed)
    else throw new Error(`不支持的 ZIP 压缩方式：${method}`)
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(resolved)
      ws.on('error', reject)
      ws.on('finish', () => resolve())
      ws.end(content)
    })
  }
}

export async function extractZipArchive(zipPath: string, destDir: string): Promise<void> {
  await rm(destDir, { recursive: true, force: true })
  await mkdir(destDir, { recursive: true })
  const ok = await extractWithSystem(zipPath, destDir)
  if (!ok) await extractWithNode(zipPath, destDir)
}

/** 在解压目录内递归找 wb2api / wb2api.exe */
export async function findBinaryInDir(root: string, binaryName: string): Promise<string | null> {
  async function walk(dir: string): Promise<string | null> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const found = await walk(full)
        if (found) return found
      } else if (entry.name === binaryName) {
        const s = await stat(full)
        if (s.isFile()) return full
      }
    }
    return null
  }
  return walk(root)
}
