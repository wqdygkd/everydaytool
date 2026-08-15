<template>
  <section class="status-panel">
    <template v-if="sandbox">
      <ActionBar
        :running="sandbox.status === 'running'"
        @activate="$emit('activate')"
        @close="$emit('close')"
        @delete="$emit('delete')"
        @edit-fingerprint="$emit('edit-fingerprint')"
        @edit-settings="editSettingsVisible = true"
      />

      <EditDialog
        v-model="editSettingsVisible"
        :sandbox="sandbox"
      />

      <div class="panel-header">
        <h2>{{ sandbox.name }}</h2>
        <el-tag :type="sandbox.status === 'running' ? 'success' : 'info'" size="small">
          {{ formatSandboxStatus(sandbox.status) }}
        </el-tag>
      </div>

      <div class="detail-grid">
        <div class="detail-item"><span>PID</span><strong>{{ sandbox.chromePid || '-' }}</strong></div>
        <div class="detail-item"><span>路径</span><strong class="path">{{ sandbox.userDataPath }}</strong></div>
      </div>

      <div class="section-block">
        <h3>沙箱配置</h3>
        <div class="sandbox-config">
          <div class="config-row">
            <span class="config-label">继承扩展</span>
            <div class="config-value">
              <el-tag :type="inheritExtensions ? 'success' : 'info'" size="small" effect="plain">
                {{ inheritExtensions ? '已开启' : '未开启' }}
              </el-tag>
            </div>
          </div>
          <div class="config-row">
            <span class="config-label">启动参数</span>
            <div v-if="hasLaunchOptions" class="config-value launch-options-display">
              <el-tag v-if="sandbox.metadata?.launchOptions?.disableSafetyChecks" size="small" type="danger" effect="plain">
                禁用安全检查
              </el-tag>
              <el-tag v-if="sandbox.metadata?.launchOptions?.disableCors" size="small" type="danger" effect="plain">
                禁用 CORS
              </el-tag>
              <div v-if="sandbox.metadata?.launchOptions?.customArgs" class="custom-args">
                <span class="label">自定义:</span>
                <code>{{ sandbox.metadata.launchOptions.customArgs }}</code>
              </div>
            </div>
            <span v-else class="config-value muted">无</span>
          </div>
        </div>
      </div>

      <div class="section-block">
        <h3>指纹状态</h3>
        <div v-if="fingerprint" class="fingerprint-summary">
          <p>UA: {{ fingerprint.navigator?.userAgent?.slice(0, 60) }}...</p>
          <p>Platform: {{ fingerprint.navigator?.platform }} | 分辨率: {{ fingerprint.screen?.width }}x{{ fingerprint.screen?.height }}</p>
          <p>Canvas: {{ fingerprint.canvas?.noiseLevel }} | WebGL: {{ fingerprint.webgl?.vendor }}</p>
        </div>
        <p v-else class="muted">暂无指纹信息</p>
      </div>
    </template>

    <div v-else class="empty-panel">
      <p>请选择一个沙箱，或创建新沙箱</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import ActionBar from './ActionBar.vue';
import EditDialog from './EditDialog.vue';
import { formatSandboxStatus } from '../shared/sandbox.js';
import { hasLaunchOptions as hasLaunchOptionsEnabled } from '../shared/launchOptions.js';

const props = defineProps({
  sandbox: { type: Object, default: null },
  fingerprint: { type: Object, default: null },
});

defineEmits(['activate', 'close', 'delete', 'edit-fingerprint']);

const editSettingsVisible = ref(false);

const inheritExtensions = computed(() => Boolean(props.sandbox?.metadata?.inheritExtensions));
const hasLaunchOptions = computed(() => hasLaunchOptionsEnabled(props.sandbox?.metadata));
</script>

<style scoped>
.sandbox-config {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.config-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px 12px;
  align-items: start;
}

.config-label {
  font-size: 13px;
  line-height: 22px;
  color: var(--el-text-color-secondary);
}

.config-value {
  min-width: 0;
  line-height: 22px;
}

.config-value :deep(.el-tag) {
  width: fit-content;
  max-width: 100%;
}

.launch-options-display {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.custom-args {
  display: flex;
  flex-basis: 100%;
  gap: 8px;
  align-items: baseline;
}

.custom-args .label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.custom-args code {
  background: var(--el-fill-color-light);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}
</style>
