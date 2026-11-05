<script setup lang="ts">
import type { OfflinePackChromeDetail, OfflinePackChromeSearchItem } from '@shared/offline-pack'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import { useDebounceFn } from '@vueuse/core'
import { onScopeDispose, ref } from 'vue'
import { toast } from 'vue-sonner'
import { getOfflinePackApi } from '../ipc'
import { useOfflinePackDownloadsStore } from '../stores/downloads'
import DownloaderFrame from './DownloaderFrame.vue'

const api = getOfflinePackApi()

const input = ref('')
const searchResults = ref<OfflinePackChromeSearchItem[]>([])
const searching = ref(false)
const detail = ref<OfflinePackChromeDetail | null>(null)
const loading = ref(false)

const downloads = useOfflinePackDownloadsStore()
const debouncedSearch = useDebounceFn((value: string) => search(value), 400)

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
  searchResults.value = []
  debouncedSearch.cancel()
  if (shouldSkipSearch(value)) return
  void debouncedSearch(value)
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
  debouncedSearch.cancel()
  input.value = item.id
  detail.value = { id: item.id, name: item.name }
  searchResults.value = []
}

async function handleSubmit(): Promise<void> {
  debouncedSearch.cancel()
  if (!api) {
    toast.warning('离线包下载 仅在 Electron 桌面端可用')
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
    toast.error((error as Error).message || '解析失败')
  } finally {
    loading.value = false
  }
}

async function handleDownload(format: 'crx' | 'zip'): Promise<void> {
  if (!detail.value?.id) return
  await downloads.start(
    {
      kind: 'chrome',
      id: detail.value.id,
      filename: `${detail.value.id}.crx`,
      convertToZip: format === 'zip',
    },
    `${detail.value.name || detail.value.id}（${format.toUpperCase()}）`,
  )
}

onScopeDispose(() => debouncedSearch.cancel())
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
      <UiLink
        type="primary"
        :underline="false"
        @click="openExternal('https://chromewebstore.google.com/category/extensions')"
      >
        Chrome 商店
      </UiLink>
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
          <UiButton type="primary" @click="handleDownload('crx')">
            下载 CRX
          </UiButton>
          <UiButton @click="handleDownload('zip')">
            下载 ZIP
          </UiButton>
        </UiGroup>
      </UiGroup>
    </UiPanel>
  </DownloaderFrame>
</template>
