import type {
  CdpDefaults,
  CdpLaunchResult,
  CdpOpenDevToolsPayload,
  CdpProfile,
  CdpRunningState,
  CdpScript,
  CdpTarget,
} from '../../../shared/types.js';
import type { IpcInvokeApi } from './types.js';

export function getCdpInjectorApi(): IpcInvokeApi {
  const api = window.cdpInjector;
  if (!api) {
    throw new Error('未检测到 CDP 注入 IPC，请通过 pnpm dev 或 pnpm start 启动 Tool Hub');
  }
  return api;
}

export function cdpIpcChannels() {
  return getCdpInjectorApi().channels;
}

export function invokeCdpIpc<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  return getCdpInjectorApi().invoke(channel, ...args) as Promise<T>;
}

export function onCdpIpc<T = unknown>(channel: string, callback: (payload: T) => void): () => void {
  return getCdpInjectorApi().on(channel, callback as (payload: unknown) => void);
}

// ---- 类型化调用 ----

export async function cdpProfileGetAll(): Promise<{
  profiles: CdpProfile[];
  scripts: CdpScript[];
  defaults: CdpDefaults;
}> {
  return invokeCdpIpc(cdpIpcChannels().PROFILE_GET_ALL);
}

export async function cdpSaveProfile(profile: CdpProfile): Promise<CdpProfile | undefined> {
  return invokeCdpIpc(cdpIpcChannels().PROFILE_SAVE, profile);
}

export async function cdpDeleteProfile(id: string): Promise<CdpProfile[]> {
  return invokeCdpIpc(cdpIpcChannels().PROFILE_DELETE, id);
}

export async function cdpGetScripts(): Promise<CdpScript[]> {
  return invokeCdpIpc(cdpIpcChannels().SCRIPT_GET_ALL);
}

export async function cdpSaveScript(script: CdpScript): Promise<CdpScript | undefined> {
  return invokeCdpIpc(cdpIpcChannels().SCRIPT_SAVE, script);
}

export async function cdpDeleteScript(id: string): Promise<CdpScript[]> {
  return invokeCdpIpc(cdpIpcChannels().SCRIPT_DELETE, id);
}

export async function cdpSelectExecutable(): Promise<string | null> {
  return invokeCdpIpc(cdpIpcChannels().SELECT_EXECUTABLE);
}

export async function cdpSelectScriptFile(): Promise<{ filePath: string; content: string } | null> {
  return invokeCdpIpc(cdpIpcChannels().SELECT_SCRIPT_FILE);
}

export async function cdpGetRunning(): Promise<CdpRunningState[]> {
  return invokeCdpIpc(cdpIpcChannels().GET_RUNNING);
}

export async function cdpLaunchBatch(ids: string[]): Promise<CdpLaunchResult[]> {
  return invokeCdpIpc(cdpIpcChannels().LAUNCH_BATCH, ids);
}

export async function cdpStop(profileId: string): Promise<boolean> {
  return invokeCdpIpc(cdpIpcChannels().STOP, profileId);
}

export async function cdpStopAll(): Promise<void> {
  return invokeCdpIpc(cdpIpcChannels().STOP_ALL);
}

export async function cdpReinject(profileId: string): Promise<number> {
  return invokeCdpIpc(cdpIpcChannels().REINJECT, profileId);
}

export async function cdpFetchTargets(port: number): Promise<CdpTarget[]> {
  return invokeCdpIpc(cdpIpcChannels().GET_TARGETS, port);
}

export async function cdpOpenDevTools(payload: CdpOpenDevToolsPayload): Promise<boolean> {
  return invokeCdpIpc(cdpIpcChannels().OPEN_DEVTOOLS, payload);
}
