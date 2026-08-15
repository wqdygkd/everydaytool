import path from 'path';
import fs from 'fs-extra';

/**
 * macOS .app 为目录，需解析到 Contents/MacOS 下的真实二进制。
 */
export async function resolveExecutablePath(executablePath: string): Promise<string> {
  if (!executablePath?.trim()) {
    throw new Error('未设置可执行文件路径');
  }

  let resolved = path.resolve(executablePath.trim());

  if (process.platform === 'darwin' && resolved.endsWith('.app')) {
    resolved = await resolveMacAppBundle(resolved);
  } else {
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat) {
      throw new Error(`可执行文件不存在: ${resolved}`);
    }
    if (stat.isDirectory()) {
      if (process.platform === 'darwin') {
        const infoPlist = path.join(resolved, 'Contents', 'Info.plist');
        if (await fs.pathExists(infoPlist)) {
          resolved = await resolveMacAppBundle(resolved);
        } else {
          throw new Error('所选路径是目录。在 macOS 上请选择 .app 应用包或 MacOS 目录下的二进制文件');
        }
      } else {
        throw new Error('所选路径是目录，请选择可执行文件');
      }
    }
  }

  if (process.platform !== 'win32') {
    try {
      await fs.access(resolved, fs.constants.X_OK);
    } catch {
      throw new Error(`无可执行权限: ${resolved}`);
    }
  }

  return resolved;
}

async function resolveMacAppBundle(appPath: string): Promise<string> {
  const macOsDir = path.join(appPath, 'Contents', 'MacOS');
  if (!(await fs.pathExists(macOsDir))) {
    throw new Error(`无效的 .app 包（缺少 Contents/MacOS）: ${appPath}`);
  }

  const appBase = path.basename(appPath, '.app');
  const entries = await fs.readdir(macOsDir);
  const binaries: string[] = [];

  for (const name of entries) {
    const full = path.join(macOsDir, name);
    const stat = await fs.stat(full);
    if (stat.isFile()) {
      binaries.push(full);
    }
  }

  if (binaries.length === 0) {
    throw new Error(`在 ${appPath} 的 Contents/MacOS 中未找到可执行文件`);
  }

  const preferred = binaries.find((b) => path.basename(b) === appBase);
  return preferred ?? binaries[0] as string;
}
