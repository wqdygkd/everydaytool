<script setup lang="ts">
import type { OfflinePackDownloadProgress, OfflinePackDownloadResult } from '@shared/offline-pack'

defineProps<{
  progress: OfflinePackDownloadProgress | null
  downloading: boolean
  result: OfflinePackDownloadResult | null
}>()

defineEmits<{
  cancel: []
  openDir: []
}>()

function percentage(progress: OfflinePackDownloadProgress | null): number {
  if (!progress || progress.totalBytes <= 0) return 0
  return Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
}
</script>

<template>
  <div v-if="downloading || progress || result" class="download-section">
    <div v-if="downloading" class="download-progress">
      <div class="download-row">
        <span class="muted download-msg">
          {{ progress?.message ?? '下载中…' }}
          <template v-if="progress?.layerIndex">
            （层 {{ progress.layerIndex }}/{{ progress.totalLayers }}）
          </template>
        </span>
        <el-button size="small" @click="$emit('cancel')">
          取消
        </el-button>
      </div>
      <el-progress
        v-if="progress && progress.totalBytes > 0"
        :percentage="percentage(progress)"
        :show-text="false"
        class="download-bar"
      />
    </div>

    <div v-if="progress?.status === 'error' && progress.error" class="download-error">
      <el-tag size="small" type="danger">
        {{ progress.error }}
      </el-tag>
    </div>

    <!-- 结果卡片：DownloadResultCard（primary 边框 + 浅底 + 图标块） -->
    <div v-if="result" class="result-card">
      <div class="result-icon">
        <UiIcon name="offline-pack" :size="16" />
      </div>
      <div class="result-meta">
        <p class="result-name">
          {{ result.filename }}
        </p>
        <p class="result-desc">
          已保存到本地下载目录
        </p>
      </div>
      <el-button type="primary" size="small" @click="$emit('openDir')">
        打开目录
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.download-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.download-progress {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: var(--color-raised);
}

.download-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.download-msg {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.download-bar :deep(.el-progress-bar__outer) {
  background: var(--color-raised);
}

.download-error {
  padding: var(--spacing-sm) var(--spacing-md);
}

/* 结果卡片：primary/30 边框 + primary/5 浅底 + 图标块 */
.result-card {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-md);
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  background: color-mix(in srgb, var(--color-primary) 5%, transparent);
  border-radius: var(--radius-sm);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.result-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary);
}

.result-meta {
  flex: 1;
  min-width: 0;
}

.result-name {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-desc {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
</style>
