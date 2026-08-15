import { build } from 'esbuild';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'dist-backend');

// 相对 rootDir 的后端源码入口（glob，逐文件编译、保目录结构）
const entryPoints = [
  'electron/main.ts',
  'tools/chrome-sandbox/backend/**/*.ts',
  'tools/cdp-injector/backend/**/*.ts',
];

// 需复制的非 TS 资源（相对 rootDir）
const assets = [
  'tools/chrome-sandbox/backend/chrome/chrome-process-query.ps1',
];

await fs.emptyDir(outDir);

await build({
  entryPoints,
  outdir: outDir,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  bundle: false,
  sourcemap: false,
  outbase: rootDir,
  logLevel: 'info',
});

for (const asset of assets) {
  const src = path.join(rootDir, asset);
  const dest = path.join(outDir, asset);
  await fs.ensureDir(path.dirname(dest));
  await fs.copy(src, dest);
  if (!(await fs.pathExists(dest))) {
    throw new Error(`资源复制失败: ${asset}`);
  }
}

await import('./sync-preload.mjs');

console.log('✓ backend 编译到 dist-backend/');
