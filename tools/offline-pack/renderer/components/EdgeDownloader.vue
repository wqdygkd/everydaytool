<script setup lang="ts">
import type { OfflinePackEdgeDetail, OfflinePackEdgeSearchItem } from '@shared/offline-pack'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import { parseEdgeQuery } from '@shared/offline-pack'
import { ElMessage } from 'element-plus'
import { onUnmounted, ref } from 'vue'
import { useOfflinePackDownload } from '../composables/useOfflinePackDownload'
import { getOfflinePackApi } from '../ipc'
import DownloaderFrame from './DownloaderFrame.vue'
import DownloadSection from './DownloadSection.vue'

const api = getOfflinePackApi()

const input = ref('')
const searchResults = ref<OfflinePackEdgeSearchItem[]>([])
const searching = ref(false)
const detail = ref<OfflinePackEdgeDetail | null>(null)
const loading = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined

const { progress, downloading, result, start, cancel, openDir } = useOfflinePackDownload()

const EXAMPLES = [
  { label: '试试 uBlock Origin Lite', value: 'cimighlppcgcoapaliogpjjdehbnofhn' },
]

function shouldSkipSearch(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 2) return true
  if (parseEdgeQuery(trimmed)) return true
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
    const res = await api.invoke(api.channels.EDGE_SEARCH, query.trim()) as { results: OfflinePackEdgeSearchItem[] }
    searchResults.value = res.results ?? []
  } catch {
    searchResults.value = []
  } finally {
    searching.value = false
  }
}

function selectResult(item: OfflinePackEdgeSearchItem): void {
  input.value = item.id
  detail.value = { id: item.id, storeProductId: item.storeProductId, name: item.name, developer: item.developer }
  searchResults.value = []
}

async function handleSubmit(): Promise<void> {
  if (!api) {
    ElMessage.warning('离线包下载 仅在 Electron 桌面端可用')
    return
  }
  if (!input.value.trim()) {
    ElMessage.warning('请输入扩展名称、CRX ID、ProductId 或商店链接')
    return
  }
  loading.value = true
  searchResults.value = []
  try {
    detail.value = await api.invoke(api.channels.EDGE_DETAIL, input.value.trim()) as OfflinePackEdgeDetail
  } catch (error) {
    ElMessage.error((error as Error).message || '获取详情失败')
  } finally {
    loading.value = false
  }
}

async function handleDownload(format: 'crx' | 'zip'): Promise<void> {
  if (!detail.value?.id) return
  await start({
    kind: 'edge',
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
    placeholder="扩展名称、32 位 CRX ID、12 位 ProductId 或 Edge Add-ons URL"
    submit-label="解析扩展信息"
    :examples="EXAMPLES"
    :loading="loading"
    @update:model-value="onInput"
    @submit="handleSubmit"
    @example="useExample"
  >
    <template #hint>
      输入名称搜索，或直接粘贴 CRX ID / ProductId / 商店链接，或前往
      <el-link
        type="primary"
        :underline="false"
        @click="openExternal('https://microsoftedge.microsoft.com/addons/')"
      >
        Edge 加载项
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
        <UiDetailGrid :columns="2">
          <UiDetailItem v-if="detail.name" label="名称">
            {{ detail.name }}
          </UiDetailItem>
          <UiDetailItem v-if="detail.version" label="版本" mono>
            {{ detail.version }}
          </UiDetailItem>
          <UiDetailItem v-if="detail.developer" label="开发者">
            {{ detail.developer }}
          </UiDetailItem>
          <UiDetailItem v-if="detail.rating" label="评分" mono>
            {{ detail.rating }}
          </UiDetailItem>
          <UiDetailItem label="CRX ID" mono>
            {{ detail.id }}
          </UiDetailItem>
          <UiDetailItem v-if="detail.storeProductId" label="ProductId" mono>
            {{ detail.storeProductId }}
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
