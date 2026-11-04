<script setup lang="ts">
import type { OfflinePackMsStoreFile, OfflinePackMsStoreResolveResult } from '@shared/offline-pack'
import { useCopy } from '@renderer/shared/composables/useClipboard'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import { formatDateTime } from '@shared/offline-pack'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { getOfflinePackApi } from '../ipc'
import { useOfflinePackDownloadsStore } from '../stores/downloads'
import DownloaderFrame from './DownloaderFrame.vue'

const api = getOfflinePackApi()

const input = ref('')
const resolveResult = ref<OfflinePackMsStoreResolveResult | null>(null)
const selectedFile = ref('')
const loading = ref(false)

const downloads = useOfflinePackDownloadsStore()

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
    toast.warning('离线包下载 仅在 Electron 桌面端可用')
    return
  }
  const trimmed = input.value.trim()
  if (!trimmed) {
    toast.warning('请输入商店链接、ProductId、PackageFamilyName 或 CategoryId')
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
    toast.error((error as Error).message || '解析失败')
  } finally {
    loading.value = false
  }
}

async function handleDownload(): Promise<void> {
  if (!selected.value) return
  await downloads.start(
    { kind: 'msstore', url: selected.value.url, filename: selected.value.name },
    resolveResult.value?.title || selected.value.name,
  )
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
      <UiLink
        type="primary"
        :underline="false"
        @click="openExternal('https://apps.microsoft.com/')"
      >
        Microsoft Store
      </UiLink>
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

        <UiSelect
          v-if="files.length"
          v-model="selectedFile"
          class="full-width"
          placeholder="选择安装包"
          :options="files.map(f => ({ label: f.name, value: f.url }))"
        />

        <UiGroup v-if="selected" gap="sm" align="center" wrap class="btn-flush">
          <UiButton type="primary" @click="handleDownload">
            下载到本地
          </UiButton>
          <UiButton @click="useCopy(selected.url, '下载链接')">
            复制链接
          </UiButton>
          <UiHint v-if="selected.size" size="xs" class="mono">
            {{ selected.size }}
          </UiHint>
        </UiGroup>

        <UiAlert
          v-if="resolveResult.filesError"
          type="warning"
          :closable="false"
          show-icon
          title="文件列表解析失败"
          :description="resolveResult.filesError"
        />
      </UiGroup>
    </UiPanel>
  </DownloaderFrame>
</template>
