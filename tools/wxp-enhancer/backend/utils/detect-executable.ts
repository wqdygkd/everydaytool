import path from 'node:path'
import process from 'node:process'
import { pathExists } from '../../../../backend/utils/file-ops.ts'

// 目标应用是 WxP Client（Electron 应用，产品名 "WxP Client"）。
// 注意与微信（Weixin / WeChat）无关：名字相近但安装路径、进程完全不同，勿混入微信候选。
const WIN_EXE_RELATIVE = path.join('Wxp Client', 'WxP Client.exe')

const MAC_CANDIDATES = ['/Applications/WxP Client.app', '/Applications/WxP.app']

function buildWindowsCandidates(): string[] {
  const bases = [
    // 实测的用户级安装位（Electron 默认 NSIS per-user）
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : undefined,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
  ].filter((base): base is string => Boolean(base))

  return bases.map(base => path.join(base, WIN_EXE_RELATIVE))
}

function getCandidates(): string[] {
  if (process.platform === 'win32') {
    return buildWindowsCandidates()
  }
  if (process.platform === 'darwin') {
    return MAC_CANDIDATES
  }
  return []
}

/** 按常见安装位置探测 WxP Client 可执行文件，找不到返回 null（由用户手动选择） */
export async function detectWxpExecutable(): Promise<string | null> {
  for (const candidate of getCandidates()) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }
  return null
}
