<script setup lang="ts">
import type { OfflinePackMsStoreFile, OfflinePackMsStoreResolveResult } from '@shared/offline-pack'
import { useCopy } from '@renderer/shared/composables/useClipboard'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import { formatDateTime } from '@shared/offline-pack'
import { ElMessage } from 'element-plus'
import { computed, ref } from 'vue'
import { useOfflinePackDownload } from '../composables/useOfflinePackDownload'
import { getOfflinePackApi } from '../ipc'
import DownloaderFrame from './DownloaderFrame.vue'
import DownloadSection from './DownloadSection.vue'

const api = getOfflinePackApi()

const input = ref('')
const resolveResult = ref<OfflinePackMsStoreResolveResult | null>(null)
const selectedFile = ref('')
const loading = ref(false)

const { progress, downloading, result, start, cancel, openDir } = useOfflinePackDownload()

const EXAMPLES = [
  { label: '试试 Windows Terminal', value: 'https://apps.microsoft.com/detail/9n0dx20hk701' },
  { label: '试试 Codex', value: 'https://apps.microsoft.com/detail/9plm9xgg6vks' },
]

const files = computed<OfflinePackMsStoreFile[]>(() => {
  const list = resolveResult.value?.files ?? []
  return list
    .filter(f => !f.name.toLowerCase().endsWith('.blockmap'))
    .sort((a, b) => a.name.localeCompare(b.name))
})

const selected = computed<OfflinePackMsStoreFile | undefined>(() => files.value.find(f => f.url === selectedFile.value))

function useExample(value: string): void {
  input.value = value
  void handleSubmit()
}

async function handleSubmit(): Promise<void> {
  if (!api) {
    ElMessage.warning('离线包下载 仅在 Electron 桌面端可用')
    return
  }
  const trimmed = input.value.trim()
  if (!trimmed) {
    ElMessage.warning('请输入商店链接、ProductId、PackageFamilyName 或 CategoryId')
    return
  }
  loading.value = true
  resolveResult.value = null
  selectedFile.value = ''
  try {
    resolveResult.value = await api.invoke(api.channels.MSSTORE_RESOLVE, trimmed) as OfflinePackMsStoreResolveResult
    if (files.value.length) {
      selectedFile.value = files.value[0].url
    }
  } catch (error) {
    ElMessage.error((error as Error).message || '解析失败')
  } finally {
    loading.value = false
  }
}

async function handleDownload(): Promise<void> {
  if (!selected.value) return
  await start({ kind: 'msstore', url: selected.value.url, filename: selected.value.name })
}
</script>

<template>
  <DownloaderFrame
    v-model="input"
    placeholder="商店 URL、ProductId（12 位）、PackageFamilyName 或 CategoryId"
    submit-label="解析应用信息"
    :examples="EXAMPLES"
    :loading="loading"
    @submit="handleSubmit"
    @example="useExample"
  >
    <template #hint>
      输入 MS 应用链接、ProductId、PackageFamilyName 或 CategoryId，或前往
      <el-link
        type="primary"
        :underline="false"
        @click="openExternal('https://apps.microsoft.com/')"
      >
        Microsoft Store
      </el-link>
    </template>

    <UiPanel v-if="resolveResult" variant="outlined">
      <UiGroup direction="column" gap="md" align="stretch" block>
        <UiDetailGrid :columns="2">
          <UiDetailItem label="名称">
            {{ resolveResult.title || '—' }}
          </UiDetailItem>
          <UiDetailItem label="发布者">
            {{ resolveResult.publisherName || '—' }}
          </UiDetailItem>
          <UiDetailItem v-if="resolveResult.productId" label="ProductId" mono>
            {{ resolveResult.productId }}
          </UiDetailItem>
          <UiDetailItem v-if="resolveResult.lastModifiedDate" label="目录更新">
            {{ formatDateTime(resolveResult.lastModifiedDate) }}
          </UiDetailItem>
        </UiDetailGrid>

        <el-select
          v-if="files.length"
          v-model="selectedFile"
          class="full-width"
          filterable
          placeholder="选择安装包"
        >
          <el-option v-for="f in files" :key="f.url" :label="f.name" :value="f.url" />
        </el-select>

        <UiGroup v-if="selected" gap="sm" align="center" wrap class="btn-flush">
          <el-button type="primary" :disabled="downloading" @click="handleDownload">
            下载到本地
          </el-button>
          <el-button @click="useCopy(selected.url, '下载链接')">
            复制链接
          </el-button>
          <UiHint v-if="selected.size" size="xs" class="mono">
            {{ selected.size }}
          </UiHint>
        </UiGroup>

        <el-alert
          v-if="resolveResult.filesError"
          type="warning"
          :closable="false"
          show-icon
          title="文件列表解析失败"
          :description="resolveResult.filesError"
        />
      </UiGroup>
    </UiPanel>

    <DownloadSection
      :progress="progress"
      :downloading="downloading"
      :result="result"
      @cancel="cancel"
      @open-dir="openDir"
    />
  </DownloaderFrame>
</template>
