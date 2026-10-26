<script setup lang="ts">
import type { OfflinePackChromeDetail, OfflinePackChromeSearchItem } from '@shared/offline-pack'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import { ElMessage } from 'element-plus'
import { onUnmounted, ref } from 'vue'
import { useOfflinePackDownload } from '../composables/useOfflinePackDownload'
import { getOfflinePackApi } from '../ipc'
import DownloaderFrame from './DownloaderFrame.vue'
import DownloadSection from './DownloadSection.vue'

const api = getOfflinePackApi()

const input = ref('')
const searchResults = ref<OfflinePackChromeSearchItem[]>([])
const searching = ref(false)
const detail = ref<OfflinePackChromeDetail | null>(null)
const loading = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined

const { progress, downloading, result, start, cancel, openDir } = useOfflinePackDownload()

const EXAMPLES = [
  { label: '试试 uBlock Origin', value: 'cjpalhdlnbpafiamejdnhcphjbkeiagm' },
  { label: '试试 沉浸式翻译', value: 'bpoadfkcbjbfhfodiogcnhhhpibjhbnh' },
]

function extractId(value: string): string {
  const trimmed = value.trim()
  const idMatch = trimmed.match(/([a-z]{32})/)
  if (idMatch) return idMatch[1]
  if (/^[a-z]{32}$/.test(trimmed.toLowerCase())) return trimmed.toLowerCase()
  throw new Error('无效的 Chrome 扩展 URL 或 ID')
}

function shouldSkipSearch(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 2) return true
  if (/^[a-z]{32}$/.test(trimmed)) return true
  return /[./]/.test(trimmed)
}

function useExample(value: string): void {
  input.value = value
  void handleSubmit()
}

function onInput(value: string): void {
  input.value = value
  detail.value = null
  if (searchTimer) clearTimeout(searchTimer)
  searchResults.value = []
  if (shouldSkipSearch(value)) return
  searchTimer = setTimeout(search, 400, value)
}

async function search(query: string): Promise<void> {
  if (!api) return
  searching.value = true
  try {
    const res = await api.invoke(api.channels.CHROME_SEARCH, query.trim()) as { results: OfflinePackChromeSearchItem[] }
    searchResults.value = res.results ?? []
  } catch {
    searchResults.value = []
  } finally {
    searching.value = false
  }
}

function selectResult(item: OfflinePackChromeSearchItem): void {
  input.value = item.id
  detail.value = { id: item.id, name: item.name }
  searchResults.value = []
}

async function handleSubmit(): Promise<void> {
  if (!api) {
    ElMessage.warning('离线包下载 仅在 Electron 桌面端可用')
    return
  }
  loading.value = true
  searchResults.value = []
  try {
    const id = extractId(input.value)
    let next: OfflinePackChromeDetail = { id }
    try {
      const res = await api.invoke(api.channels.CHROME_DETAIL, id) as OfflinePackChromeDetail
      next = { id, name: res.name, description: res.description }
    } catch {
      // 详情失败降级放行：仅用 ID 也能继续下载
    }
    detail.value = next
  } catch (error) {
    ElMessage.error((error as Error).message || '解析失败')
  } finally {
    loading.value = false
  }
}

async function handleDownload(format: 'crx' | 'zip'): Promise<void> {
  if (!detail.value?.id) return
  await start({
    kind: 'chrome',
    id: detail.value.id,
    filename: `${detail.value.id}.crx`,
    convertToZip: format === 'zip',
  })
}

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <DownloaderFrame
    :model-value="input"
    placeholder="扩展名称、ID 或商店链接"
    submit-label="解析扩展信息"
    :examples="EXAMPLES"
    :loading="loading"
    @update:model-value="onInput"
    @submit="handleSubmit"
    @example="useExample"
  >
    <template #hint>
      输入名称搜索或直接粘贴 ID，或前往
      <el-link
        type="primary"
        :underline="false"
        @click="openExternal('https://chromewebstore.google.com/category/extensions')"
      >
        Chrome 商店
      </el-link>
    </template>

    <template #between>
      <UiGroup v-if="searchResults.length" direction="column" gap="xs" block>
        <UiListCard v-for="item in searchResults" :key="item.id" @click="selectResult(item)">
          <UiGroup justify="between" gap="sm">
            <span>{{ item.name }}</span>
            <UiHint size="xs" class="mono">
              {{ item.id }}
            </UiHint>
          </UiGroup>
        </UiListCard>
      </UiGroup>
    </template>

    <UiPanel v-if="detail" variant="outlined">
      <UiGroup direction="column" gap="md" align="stretch" block>
        <UiDetailGrid :columns="1">
          <UiDetailItem v-if="detail.name" label="名称">
            {{ detail.name }}
          </UiDetailItem>
          <UiDetailItem label="ID" mono>
            {{ detail.id }}
          </UiDetailItem>
          <UiDetailItem v-if="detail.description" label="描述">
            {{ detail.description }}
          </UiDetailItem>
        </UiDetailGrid>

        <UiGroup gap="sm" wrap class="btn-flush">
          <el-button type="primary" :disabled="downloading" @click="handleDownload('crx')">
            下载 CRX
          </el-button>
          <el-button :disabled="downloading" @click="handleDownload('zip')">
            下载 ZIP
          </el-button>
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
