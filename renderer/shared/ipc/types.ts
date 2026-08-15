// IPC 边界类型：window.chromeSandbox / window.cdpInjector 全局声明

export interface IpcInvokeApi {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, callback: (payload: unknown) => void): () => void;
  channels: Record<string, string>;
}

declare global {
  interface Window {
    chromeSandbox: IpcInvokeApi;
    cdpInjector: IpcInvokeApi;
  }
}

export {};
