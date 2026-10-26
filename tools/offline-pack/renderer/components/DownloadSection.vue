<script setup lang="ts">
import type { OfflinePackDownloadProgress, OfflinePackDownloadResult } from '@shared/offline-pack'

defineProps<{
  progress: OfflinePackDownloadProgress | null
  downloading: boolean
  result: OfflinePackDownloadResult | null
}>()

const emit = defineEmits<{
  cancel: []
  openDir: []
}>()

function percentage(progress: OfflinePackDownloadProgress | null): number {
  if (!progress || progress.totalBytes <= 0) return 0
  return Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
}
</script>

<template>
  <!-- 下载中：说明 + 取消 + 进度条（进度条底色走全局 EP 绑定，不再单点覆写） -->
  <UiPanel v-if="downloading" variant="outlined" padding="var(--spacing-md)">
    <UiGroup direction="column" gap="sm" block>
      <UiGroup justify="between" gap="sm" align="center">
        <UiHint class="download-progress-message">
          {{ progress?.message ?? '下载中…' }}
          <template v-if="progress?.layerIndex">
            （层 {{ progress.layerIndex }}/{{ progress.totalLayers }}）
          </template>
        </UiHint>
        <el-button size="small" @click="emit('cancel')">
          取消
        </el-button>
      </UiGroup>

      <el-progress
        v-if="progress && progress.totalBytes > 0"
        :percentage="percentage(progress)"
        :show-text="false"
      />
    </UiGroup>
  </UiPanel>

  <el-alert
    v-if="progress?.status === 'error' && progress.error"
    type="error"
    :closable="false"
    show-icon
    :title="progress.error"
  />

  <!-- 结果：文件名（超长省略）+ 打开目录 -->
  <UiPanel v-if="result" variant="outlined" padding="var(--spacing-md)">
    <UiGroup gap="md" align="center">
      <UiIcon name="offline-pack" :size="18" class="download-result-icon" />
      <UiGroup direction="column" gap="xs" class="download-result-meta">
        <span class="mono download-result-name" :title="result.filename">{{ result.filename }}</span>
        <UiHint size="xs">
          已保存到本地下载目录
        </UiHint>
      </UiGroup>
      <el-button type="primary" size="small" @click="emit('openDir')">
        打开目录
      </el-button>
    </UiGroup>
  </UiPanel>
</template>

<style scoped>
/* 下载文件名可能很长：占满剩余宽度并单行省略，避免撑破结果面板 */
.download-result-icon {
  flex-shrink: 0;
  color: var(--color-primary);
}

/* 进度文案可长可短：占满剩余宽度并允许折行，取消按钮固定右侧 */
.download-progress-message {
  flex: 1;
  min-width: 0;
}

.download-result-meta {
  flex: 1;
  min-width: 0;
}

.download-result-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
