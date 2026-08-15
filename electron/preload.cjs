const { contextBridge, ipcRenderer } = require('electron');

// Auto-generated from dist-backend by scripts/sync-preload.mjs — do not edit by hand.
const EDT_RUNTIME = {
  target: process.platform === 'darwin' ? 'mac' : 'win',
  platform: process.platform,
};

const IPC_CHANNELS = {
  SANDBOX_CREATE: "sandbox:create",
  SANDBOX_DELETE: "sandbox:delete",
  SANDBOX_ACTIVATE: "sandbox:activate",
  SANDBOX_CLOSE: "sandbox:close",
  SANDBOX_GET_ALL: "sandbox:get-all",
  SANDBOX_UPDATE: "sandbox:update",
  SANDBOX_REFRESH_STATUS: "sandbox:refresh-status",
  FINGERPRINT_UPDATE: "fingerprint:update",
  FINGERPRINT_GET_BY_ID: "fingerprint:get-by-id",
  FINGERPRINT_GENERATE_RANDOM: "fingerprint:generate-random",
  CHROME_DETECT_PATH: "chrome:detect-path",
  CONFIG_GET: "config:get",
  CONFIG_UPDATE: "config:update",
  CONFIG_SELECT_DATA_DIRECTORY: "config:select-data-directory",
  EVENT_STATUS_CHANGED: "sandbox:status-changed",
  EVENT_PROCESS_EXITED: "sandbox:process-exited"
};

const CDP_IPC_CHANNELS = {
  PROFILE_GET_ALL: "cdp:profile-get-all",
  PROFILE_SAVE: "cdp:profile-save",
  PROFILE_DELETE: "cdp:profile-delete",
  SCRIPT_GET_ALL: "cdp:script-get-all",
  SCRIPT_SAVE: "cdp:script-save",
  SCRIPT_DELETE: "cdp:script-delete",
  SELECT_EXECUTABLE: "cdp:select-executable",
  SELECT_SCRIPT_FILE: "cdp:select-script-file",
  LAUNCH: "cdp:launch",
  LAUNCH_BATCH: "cdp:launch-batch",
  STOP: "cdp:stop",
  STOP_ALL: "cdp:stop-all",
  GET_RUNNING: "cdp:get-running",
  REINJECT: "cdp:reinject",
  GET_TARGETS: "cdp:get-targets",
  OPEN_DEVTOOLS: "cdp:open-devtools",
  EVENT_STATUS_CHANGED: "cdp:status-changed"
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
