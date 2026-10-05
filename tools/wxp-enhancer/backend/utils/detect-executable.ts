import path from 'node:path'
import process from 'node:process'
import { pathExists } from '../../../chrome-sandbox/backend/utils/file-ops.js'

const MAC_CANDIDATES = ['/Applications/Weixin.app', '/Applications/WeChat.app']

function buildWindowsCandidates(): string[] {
  const bases = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : undefined,
  ].filter((base): base is string => Boolean(base))

  const candidates: string[] = []
  for (const base of bases) {
    candidates.push(
      path.join(base, 'Tencent', 'Weixin', 'Weixin.exe'),
      path.join(base, 'Tencent', 'WeChat', 'WeChat.exe'),
    )
  }
  return candidates
}

/** 按常见安装位置探测 WXP 可执行文件，找不到返回 null（由用户手动选择） */
export async function detectWxpExecutable(): Promise<string | null> {
  const candidates = process.platform === 'win32'
    ? buildWindowsCandidates()
    : process.platform === 'darwin'
      ? MAC_CANDIDATES
      : []

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }
  return null
}
