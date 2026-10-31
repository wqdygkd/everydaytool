<script setup lang="ts">
import type { OfflinePackVsCodeLinkResult, OfflinePackVsCodeQueryResult } from '@shared/offline-pack'
import { useCopy } from '@renderer/shared/composables/useClipboard'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { useOfflinePackDownload } from '../composables/useOfflinePackDownload'
import { getOfflinePackApi } from '../ipc'
import DownloaderFrame from './DownloaderFrame.vue'
import DownloadSection from './DownloadSection.vue'

const api = getOfflinePackApi()

const input = ref('')
const versions = ref<string[]>([])
const selectedVersion = ref('')
const linkUrl = ref('')
const loading = ref(false)

const { progress, downloading, result, start, cancel, openDir } = useOfflinePackDownload()

const EXAMPLES = [
  { label: '试试 Claude Code', value: 'https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code' },
  { label: '试试 Remote SSH', value: 'https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh' },
]

function itemNameFromUrl(url: string): string {
  try {
    return new URL(url).searchParams.get('itemName') ?? 'extension'
  } catch {
    return 'extension'
  }
}

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
    toast.warning('请输入插件 URL')
    return
  }
  loading.value = true
  versions.value = []
  selectedVersion.value = ''
  linkUrl.value = ''
  try {
    const res = await api.invoke(api.channels.VSCODE_QUERY, trimmed) as OfflinePackVsCodeQueryResult
    versions.value = res.versions
  } catch (error) {
    toast.error((error as Error).message || '查询失败')
  } finally {
    loading.value = false
  }
}

async function buildLink(): Promise<void> {
  if (!api || !selectedVersion.value) return
  try {
    const res = await api.invoke(api.channels.VSCODE_LINK, input.value.trim(), selectedVersion.value) as OfflinePackVsCodeLinkResult
    linkUrl.value = res.downloadUrl
  } catch (error) {
    toast.error((error as Error).message || '生成链接失败')
  }
}

async function handleDownload(): Promise<void> {
  if (!linkUrl.value) return
  const itemName = itemNameFromUrl(input.value)
  await start({ kind: 'vscode', url: linkUrl.value, filename: `${itemName}-${selectedVersion.value}.vsix` })
}
</script>

<template>
  <DownloaderFrame
    v-model="input"
    placeholder="marketplace.visualstudio.com/items?itemName=..."
    submit-label="解析插件信息"
    :examples="EXAMPLES"
    :loading="loading"
    @submit="handleSubmit"
    @example="useExample"
  >
    <template #hint>
      仅支持插件页链接，或前往
      <UiLink
        type="primary"
        :underline="false"
        @click="openExternal('https://marketplace.visualstudio.com/vscode')"
      >
        VSCode Marketplace
      </UiLink>
    </template>

    <UiPanel v-if="versions.length" variant="outlined">
      <UiGroup direction="column" gap="md" align="stretch" block>
        <UiHint size="xs">
          选择版本
        </UiHint>
        <UiSelect v-model="selectedVersion" class="full-width" placeholder="选择版本" :options="versions.map(v => ({ label: v, value: v }))" @update:model-value="buildLink" />

        <UiGroup v-if="linkUrl" gap="sm" wrap class="btn-flush">
          <UiButton type="primary" :disabled="downloading" @click="handleDownload">
            下载到本地
          </UiButton>
          <UiButton @click="useCopy(linkUrl, '下载链接')">
            复制链接
          </UiButton>
        </UiGroup>
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
