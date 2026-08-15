import { invokeCdpIpc, cdpIpcChannels, onCdpIpc } from '@renderer/shared/ipc/useCdpIpc.js';
import type {
  CdpBatchResult,
  CdpDefaults,
  CdpOpenDevToolsPayload,
  CdpProfile,
  CdpRunningState,
  CdpScript,
  CdpTarget,
} from '../../../../shared/types.js';

interface CdpProfileGetAllResult {
  profiles?: CdpProfile[];
  scripts?: CdpScript[];
  defaults?: CdpDefaults;
}

interface CdpStatusChangedPayload {
  running?: CdpRunningState[];
}

export const useCdpInjectorStore = defineStore('cdp-injector/store', () => {
  const profiles = ref<CdpProfile[]>([]);
  const scripts = ref<CdpScript[]>([]);
  const running = ref<CdpRunningState[]>([]);
  const loading = ref(false);
  const channels = cdpIpcChannels();

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const data = await invokeCdpIpc<CdpProfileGetAllResult>(channels.PROFILE_GET_ALL);
      profiles.value = data.profiles ?? [];
      scripts.value = data.scripts ?? [];
      running.value = await invokeCdpIpc<CdpRunningState[]>(channels.GET_RUNNING);
    } finally {
      loading.value = false;
    }
  }

  function bindStatusEvents(): () => void {
    return onCdpIpc<CdpStatusChangedPayload>(channels.EVENT_STATUS_CHANGED, (payload) => {
      running.value = payload?.running ?? [];
    });
  }

  async function saveAndReload<TPayload, TResult>(channel: string, payload: TPayload): Promise<TResult> {
    const saved = await invokeCdpIpc<TResult>(channel, payload);
    await load();
    return saved;
  }

  return {
    profiles,
    scripts,
    running,
    loading,
    channels,
    load,
    bindStatusEvents,
    saveProfile: (profile: CdpProfile) => saveAndReload<CdpProfile, CdpProfile | undefined>(channels.PROFILE_SAVE, profile),
    deleteProfile: async (id: string): Promise<void> => {
      await invokeCdpIpc(channels.PROFILE_DELETE, id);
      await load();
    },
    saveScript: (script: CdpScript) => saveAndReload<CdpScript, CdpScript | undefined>(channels.SCRIPT_SAVE, script),
    deleteScript: async (id: string): Promise<void> => {
      await invokeCdpIpc(channels.SCRIPT_DELETE, id);
      await load();
    },
    launchBatch: (profileIds: string[]) => invokeCdpIpc<CdpBatchResult[]>(channels.LAUNCH_BATCH, profileIds),
    stop: async (profileId: string): Promise<void> => {
      await invokeCdpIpc(channels.STOP, profileId);
      running.value = await invokeCdpIpc<CdpRunningState[]>(channels.GET_RUNNING);
    },
    stopAll: async (): Promise<void> => {
      await invokeCdpIpc(channels.STOP_ALL);
      running.value = [];
    },
    reinject: (profileId: string) => invokeCdpIpc<number>(channels.REINJECT, profileId),
    fetchTargets: (port: number) => invokeCdpIpc<CdpTarget[]>(channels.GET_TARGETS, port),
    openDevTools: (payload: CdpOpenDevToolsPayload) => invokeCdpIpc<boolean>(channels.OPEN_DEVTOOLS, payload),
    getRunningState(profileId: string): CdpRunningState | undefined {
      return running.value.find((item) => item.profileId === profileId);
    },
  };
});
