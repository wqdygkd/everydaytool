<script setup lang="ts">
import { hasLaunchOptions as hasLaunchOptionsEnabled } from '../shared/launchOptions'
import { formatSandboxStatus } from '../shared/sandbox'

const props = defineProps({
  sandbox: { type: Object, default: null },
  fingerprint: { type: Object, default: null },
})

defineEmits(['activate', 'close', 'delete', 'editFingerprint'])

const editSettingsVisible = ref(false)

const inheritExtensions = computed(() => Boolean(props.sandbox?.metadata?.inheritExtensions))
const hasLaunchOptions = computed(() => hasLaunchOptionsEnabled(props.sandbox?.metadata))
</script>

<template>
  <section class="status-panel">
    <template v-if="sandbox">
      <ActionBar
        :running="sandbox.status === 'running'"
        @activate="$emit('activate')"
        @close="$emit('close')"
        @delete="$emit('delete')"
        @edit-fingerprint="$emit('editFingerprint')"
        @edit-settings="editSettingsVisible = true"
      />

      <EditDialog
        v-model="editSettingsVisible"
        :sandbox="sandbox"
      />

      <UiGroup gap="md" class="panel-header">
        <h2>{{ sandbox.name }}</h2>
        <UiChip :tone="sandbox.status === 'running' ? 'success' : 'info'" variant="soft">
          {{ formatSandboxStatus(sandbox.status) }}
        </UiChip>
      </UiGroup>

      <UiDetailGrid class="detail-grid">
        <UiDetailItem label="PID">
          <strong>{{ sandbox.chromePid || '-' }}</strong>
        </UiDetailItem>
        <UiDetailItem label="路径">
          <strong class="path">{{ sandbox.userDataPath }}</strong>
        </UiDetailItem>
      </UiDetailGrid>

      <UiPanel variant="outlined" title="沙箱配置" class="section-block">
        <div class="sandbox-config">
          <div class="config-row">
            <span class="config-label">继承扩展</span>
            <div class="config-value">
              <UiChip :tone="inheritExtensions ? 'success' : 'info'" variant="outline">
                {{ inheritExtensions ? '已开启' : '未开启' }}
              </UiChip>
            </div>
          </div>
          <div class="config-row">
            <span class="config-label">启动参数</span>
            <div v-if="hasLaunchOptions" class="config-value launch-options-display">
              <UiChip v-if="sandbox.metadata?.launchOptions?.disableSafetyChecks" tone="danger" variant="outline">
                禁用安全检查
              </UiChip>
              <UiChip v-if="sandbox.metadata?.launchOptions?.disableCors" tone="danger" variant="outline">
                禁用 CORS
              </UiChip>
              <div v-if="sandbox.metadata?.launchOptions?.customArgs" class="custom-args">
                <span class="label">自定义:</span>
                <code>{{ sandbox.metadata.launchOptions.customArgs }}</code>
              </div>
            </div>
            <span v-else class="config-value muted">无</span>
          </div>
        </div>
      </UiPanel>

      <UiPanel variant="outlined" title="指纹状态" class="section-block">
        <div v-if="fingerprint" class="fingerprint-summary">
          <p>UA: {{ fingerprint.navigator?.userAgent?.slice(0, 60) }}...</p>
          <p>Platform: {{ fingerprint.navigator?.platform }} | 分辨率: {{ fingerprint.screen?.width }}x{{ fingerprint.screen?.height }}</p>
          <p>Canvas: {{ fingerprint.canvas?.noiseLevel }} | WebGL: {{ fingerprint.webgl?.vendor }}</p>
        </div>
        <p v-else class="muted">
          暂无指纹信息
        </p>
      </UiPanel>
    </template>

    <div v-else class="empty-panel">
      <p>请选择一个沙箱，或创建新沙箱</p>
    </div>
  </section>
</template>

<style scoped lang="scss">
.status-panel {
  flex: 1;
  min-height: 0;
  padding: var(--spacing-2xl);
  overflow: auto;
}

.panel-header {
  margin-bottom: var(--spacing-xl);

  /* 沙箱名按「区块标题」取字阶：标题标签已全局 reset 为 inherit，这里显式给档 */
  h2 {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-medium);
  }
}

.detail-grid {
  margin-bottom: var(--spacing-2xl);
}

/* 原 .section-block 的块间距 */
.section-block {
  margin-bottom: var(--spacing-lg);
}

.sandbox-config {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);

  .config-row {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    gap: var(--spacing-sm) var(--spacing-md);
    align-items: start;
  }

  .config-label {
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    line-height: var(--line-height-control);
  }

  .config-value {
    min-width: 0;
    line-height: var(--line-height-control);
  }

  .launch-options-display {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .custom-args {
    display: flex;
    flex-basis: 100%;
    align-items: baseline;
    gap: var(--spacing-sm);

    .label {
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
    }

    code {
      padding: 2px var(--spacing-sm);
      border-radius: var(--radius-xs);
      background: var(--el-fill-color-light);
      font-size: var(--font-size-sm);
    }
  }
}

.fingerprint-summary p {
  margin: var(--spacing-xs) 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.empty-panel {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

/* 原页面级 :deep(.muted) 的字号约束，随样式回收落到本组件（颜色由全局 .muted 提供） */
.muted {
  font-size: var(--font-size-sm);
}
</style>
