import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const channelsDir = path.join(rootDir, 'dist-backend/tools/chrome-sandbox/backend/ipc');
const cdpChannelsDir = path.join(rootDir, 'dist-backend/tools/cdp-injector/backend/ipc');
const preloadPaths = [
  path.join(rootDir, 'electron/preload.cjs'),
  path.join(rootDir, 'dist-backend/electron/preload.cjs'),
];

async function extractChannels(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  const match = content.match(/const (\w+) = \{([\s\S]*?)\};/);
  if (!match) throw new Error(`无法解析通道常量: ${filePath}`);
  const body = match[2]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n  ');
  return { name: match[1], body };
}

const { body: sandboxChannels } = await extractChannels(path.join(channelsDir, 'channels.js'));
const { body: cdpChannels } = await extractChannels(path.join(cdpChannelsDir, 'channels.js'));

const preloadTemplate = `const { contextBridge, ipcRenderer } = require('electron');

// Auto-generated from dist-backend by scripts/sync-preload.mjs — do not edit by hand.
const EDT_RUNTIME = {
  target: process.platform === 'darwin' ? 'mac' : 'win',
  platform: process.platform,
};

const IPC_CHANNELS = {
  ${sandboxChannels}
};

const CDP_IPC_CHANNELS = {
  ${cdpChannels}
};

function exposeIpcApi(channels) {
  return {
    invoke(channel, ...args) {
      return ipcRenderer.invoke(channel, ...args);
    },
    on(channel, callback) {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
    channels,
  };
}

contextBridge.exposeInMainWorld('edtRuntime', EDT_RUNTIME);
contextBridge.exposeInMainWorld('chromeSandbox', exposeIpcApi(IPC_CHANNELS));
contextBridge.exposeInMainWorld('cdpInjector', exposeIpcApi(CDP_IPC_CHANNELS));
`;

for (const preloadPath of preloadPaths) {
  await fs.ensureDir(path.dirname(preloadPath));
  await fs.writeFile(preloadPath, preloadTemplate);
}

console.log('✓ preload 已同步');
