import { execFile } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// electron-builder afterSign 钩子：无付费 Apple 证书的机器上默认只做
// linker-signed（Identifier 仍是 Electron，Sealed Resources 为空），
// Gatekeeper 会报“已损坏，无法打开”。这里显式做一次 ad-hoc 重签，
// 让 Identifier 回到 appId、Info.plist 正确封印，本地可用
// `xattr -cr` 后直接打开（分发仍需用户手动清 quarantine，无证书无法公证）。
export default async function afterSign(context) {
  if (process.platform !== 'darwin') return
  // 有正式证书时沿用 electron-builder 的签名，不覆盖
  if (process.env.CSC_NAME || process.env.CSC_LINK) return

  const appOutDir = context?.appOutDir
  if (!appOutDir) return
  const productName = context?.packager?.appInfo?.productName ?? 'everydaytool'
  const appPath = path.join(appOutDir, `${productName}.app`)

  const entitlements = path.resolve('build/entitlements.mac.plist')
  const args = ['--deep', '--force', '--options', 'runtime', '--sign', '-', '--entitlements', entitlements, appPath]
  try {
    await execFileAsync('codesign', args)
    console.log(`✓ ad-hoc re-signed ${appPath}`)
  } catch (error) {
    console.warn(`⚠ ad-hoc re-sign failed for ${appPath}:`, error?.message ?? error)
  }
}
