import fs from 'fs-extra';
import { cdpConfigStore } from '../store/config-store.js';
import { CdpInjectionSession, waitForCdpPort } from './cdp-client.js';
import { processLauncher } from './launcher-service.js';
import { sleep } from '../utils/sleep.js';
import { logger } from '../../../chrome-sandbox/backend/utils/logger.js';
import type {
  CdpBatchResult,
  CdpLaunchResult,
  CdpProfile,
  CdpRunningState,
} from '../../../../shared/types.js';

const sessions = new Map<string, CdpInjectionSession>();

const runningState = new Map<string, CdpRunningState>();

let statusEmitter: ((payload: { running: CdpRunningState[] }) => void) | null = null;

export function setCdpStatusEmitter(emitter: (payload: { running: CdpRunningState[] }) => void): void {
  statusEmitter = emitter;
}

function emitStatus(): void {
  if (!statusEmitter) return;
  statusEmitter({
    running: [...runningState.values()],
  });
}

function setState(profileId: string, patch: Partial<CdpRunningState>): CdpRunningState {
  const current = runningState.get(profileId) ?? { profileId } as CdpRunningState;
  const next: CdpRunningState = { ...current, ...patch, profileId, updatedAt: Date.now() };
  runningState.set(profileId, next);
  emitStatus();
  return next;
}

function clearState(profileId: string): void {
  runningState.delete(profileId);
  emitStatus();
}

async function resolveScriptContent(profile: CdpProfile): Promise<string> {
  if (profile.scriptContent?.trim()) {
    return profile.scriptContent;
  }
  if (profile.scriptPath) {
    return fs.readFile(profile.scriptPath, 'utf-8');
  }
  if (profile.scriptId) {
    const script = await cdpConfigStore.getScriptById(profile.scriptId);
    if (!script?.content) {
      throw new Error('关联脚本不存在或内容为空');
    }
    return script.content;
  }
  throw new Error('未配置注入脚本');
}

function getProfileIdsOnPort(port: number): string[] {
  const profileIds: string[] = [];
  for (const [profileId, state] of runningState.entries()) {
    if (state.port === port) {
      profileIds.push(profileId);
    }
  }
  return profileIds;
}

export const injectorService = {
  getRunning(): CdpRunningState[] {
    return [...runningState.values()];
  },

  async launchProfile(profileId: string): Promise<CdpRunningState> {
    const profile = await cdpConfigStore.getProfileById(profileId);
    if (!profile) {
      throw new Error('应用配置不存在');
    }
    if (!profile.executable) {
      throw new Error('未设置可执行文件路径');
    }
    if (!profile.debugPort) {
      throw new Error('未设置调试端口');
    }

    const defaults = await cdpConfigStore.getDefaults();
    const scriptSource = await resolveScriptContent(profile);
    const startupDelayMs = profile.startupDelayMs ?? defaults.startupDelayMs;
    const cdpTimeoutMs = profile.cdpTimeoutMs ?? defaults.cdpTimeoutMs;
    const pollIntervalMs = profile.pollIntervalMs ?? defaults.pollIntervalMs;

    setState(profileId, {
      name: profile.name,
      port: profile.debugPort,
      status: 'launching',
      message: '正在启动进程…',
      targetCount: 0,
    });

    try {
      const { pid, args } = await processLauncher.launch(
        profileId,
        profile.executable,
        profile.args ?? '',
        profile.debugPort,
      );

      setState(profileId, {
        pid,
        status: 'waiting',
        message: `进程已启动 (PID ${pid})，等待 CDP…`,
        launchArgs: args,
      });

      await sleep(startupDelayMs);

      setState(profileId, {
        status: 'connecting',
        message: `连接调试端口 ${profile.debugPort}…`,
      });

      await waitForCdpPort(profile.debugPort, cdpTimeoutMs);

      const session = new CdpInjectionSession({
        port: profile.debugPort,
        scriptSource,
        pollIntervalMs,
        onTargetsInjected: ({ count, total }) => {
          setState(profileId, {
            status: 'running',
            message: `已注入 ${count} 个新目标（共 ${total} 个 page）`,
            targetCount: total,
          });
        },
      });

      sessions.set(profileId, session);
      await session.start();

      const state = setState(profileId, {
        status: 'running',
        message: '注入会话已建立，新页面将自动注入',
        targetCount: session.injectedTargetCount,
      });

      logger.info('cdp:launch success', { profileId, port: profile.debugPort, pid });
      return state;
    } catch (error) {
      await this.stopProfile(profileId);
      setState(profileId, {
        status: 'error',
        message: (error as Error).message,
      });
      logger.error('cdp:launch failed', { profileId, error: (error as Error).message });
      throw error;
    }
  },

  async launchBatch(profileIds: string[]): Promise<CdpBatchResult[]> {
    const results: CdpBatchResult[] = [];
    for (const profileId of profileIds) {
      try {
        const state = await this.launchProfile(profileId);
        results.push({ profileId, ok: true, state });
      } catch (error) {
        results.push({ profileId, ok: false, error: (error as Error).message });
      }
    }
    return results;
  },

  async stopProfile(profileId: string): Promise<boolean> {
    const session = sessions.get(profileId);
    if (session) {
      await session.stop();
      sessions.delete(profileId);
    }
    await processLauncher.stop(profileId);
    clearState(profileId);
    return true;
  },

  async stopAll(): Promise<void> {
    const ids = [...runningState.keys()];
    await Promise.all(ids.map((id) => this.stopProfile(id)));
  },

  async reinjectProfile(profileId: string): Promise<number> {
    const session = sessions.get(profileId);
    if (!session) {
      throw new Error('该应用未在运行或未建立注入会话');
    }
    if (session.paused) {
      throw new Error('DevTools 调试中，注入已暂停，请先关闭 DevTools 窗口');
    }
    const profile = await cdpConfigStore.getProfileById(profileId);
    if (!profile) {
      throw new Error('应用配置不存在');
    }
    const scriptSource = await resolveScriptContent(profile);
    session.setScriptSource(scriptSource);
    const count = await session.reinjectAll();
    setState(profileId, {
      status: 'running',
      message: `已重新注入 ${count} 个目标`,
      targetCount: session.injectedTargetCount,
    });
    return count;
  },

  async pauseByPort(port: number): Promise<void> {
    for (const profileId of getProfileIdsOnPort(port)) {
      const session = sessions.get(profileId);
      if (session) {
        await session.pause();
      }
      setState(profileId, {
        status: 'running',
        message: '注入已暂停（DevTools 调试中）',
      });
    }
  },

  resumeByPort(port: number): void {
    for (const profileId of getProfileIdsOnPort(port)) {
      sessions.get(profileId)?.resume();
      setState(profileId, {
        status: 'running',
        message: '注入会话已恢复',
      });
    }
  },
};
