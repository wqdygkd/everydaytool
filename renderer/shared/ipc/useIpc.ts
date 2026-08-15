import type {
  AppConfig,
  SetupState,
  Sandbox,
  SandboxCreatePayload,
  SandboxUpdatePayload,
  Fingerprint,
  FingerprintUpdatePayload,
} from '../../../shared/types.js';
import type { IpcInvokeApi } from './types.js';

export function getChromeSandboxApi(): IpcInvokeApi {
  const api = window.chromeSandbox;
  if (!api) {
    throw new Error('未检测到 Electron IPC，请通过 pnpm dev 或 pnpm start 启动 Tool Hub');
  }
  return api;
}

export function ipcChannels() {
  return getChromeSandboxApi().channels;
}

export function invokeIpc<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  return getChromeSandboxApi().invoke(channel, ...args) as Promise<T>;
}

export function onIpc<T = unknown>(channel: string, callback: (payload: T) => void): () => void {
  return getChromeSandboxApi().on(channel, callback as (payload: unknown) => void);
}

// ---- 类型化调用 ----

export async function sandboxGetAll(): Promise<Sandbox[]> {
  return invokeIpc<Sandbox[]>(ipcChannels().SANDBOX_GET_ALL);
}

export async function sandboxCreate(payload: SandboxCreatePayload): Promise<Sandbox> {
  return invokeIpc<Sandbox>(ipcChannels().SANDBOX_CREATE, payload);
}

export async function sandboxActivate(id: string): Promise<Sandbox | null> {
  return invokeIpc<Sandbox | null>(ipcChannels().SANDBOX_ACTIVATE, id);
}

export async function sandboxClose(id: string): Promise<Sandbox | null> {
  return invokeIpc<Sandbox | null>(ipcChannels().SANDBOX_CLOSE, id);
}

export async function sandboxDelete(id: string): Promise<boolean> {
  return invokeIpc<boolean>(ipcChannels().SANDBOX_DELETE, id);
}

export async function sandboxUpdate(id: string, payload: SandboxUpdatePayload): Promise<Sandbox | null> {
  return invokeIpc<Sandbox | null>(ipcChannels().SANDBOX_UPDATE, id, payload);
}

export async function sandboxRefreshStatus(id: string): Promise<Sandbox | null> {
  return invokeIpc<Sandbox | null>(ipcChannels().SANDBOX_REFRESH_STATUS, id);
}

export async function fingerprintGenerateRandom(): Promise<Fingerprint> {
  return invokeIpc<Fingerprint>(ipcChannels().FINGERPRINT_GENERATE_RANDOM);
}

export async function fingerprintGetById(id: string): Promise<Fingerprint | null> {
  return invokeIpc<Fingerprint | null>(ipcChannels().FINGERPRINT_GET_BY_ID, id);
}

export async function fingerprintUpdate(id: string, payload: FingerprintUpdatePayload): Promise<Fingerprint | null> {
  return invokeIpc<Fingerprint | null>(ipcChannels().FINGERPRINT_UPDATE, id, payload);
}

export async function chromeDetectPath(): Promise<string> {
  return invokeIpc<string>(ipcChannels().CHROME_DETECT_PATH);
}

export async function configGet(): Promise<SetupState> {
  return invokeIpc<SetupState>(ipcChannels().CONFIG_GET);
}

export async function configUpdate(payload: Partial<AppConfig>): Promise<SetupState> {
  return invokeIpc<SetupState>(ipcChannels().CONFIG_UPDATE, payload);
}

export async function selectDataDirectory(): Promise<string | null> {
  return invokeIpc<string | null>(ipcChannels().CONFIG_SELECT_DATA_DIRECTORY);
}
