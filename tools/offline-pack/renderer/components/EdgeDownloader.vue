<script setup lang="ts">
import type { OfflinePackEdgeDetail, OfflinePackEdgeSearchItem } from '@shared/offline-pack'
import { parseEdgeQuery } from '@shared/offline-pack'
import { ElMessage } from 'element-plus'
import { onUnmounted, ref } from 'vue'
import { useOfflinePackDownload } from '../composables/useOfflinePackDownload'
import { getOfflinePackApi, openExternal } from '../ipc'
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
  <div class="offline-pack-downloader">
    <p class="offline-pack-hint">
      输入名称搜索，或直接粘贴 CRX ID / ProductId / 商店链接，或前往
      <a class="offline-pack-link" href="https://microsoftedge.microsoft.com/addons/" @click.prevent="openExternal('https://microsoftedge.microsoft.com/addons/')">Edge 加载项</a>
    </p>

    <el-input
      :model-value="input"
      class="offline-pack-input" spellcheck="false"
      placeholder="扩展名称、32 位 CRX ID、12 位 ProductId 或 Edge Add-ons URL"
      clearable
      @update:model-value="onInput"
      @keyup.enter="handleSubmit"
    />

    <div class="offline-pack-examples">
      <el-button v-for="e in EXAMPLES" :key="e.value" size="small" @click="useExample(e.value)">
        {{ e.label }}
      </el-button>
    </div>

    <div v-if="searchResults.length" class="search-results">
      <UiListCard v-for="item in searchResults" :key="item.id" @click="selectResult(item)">
        <span class="search-name">{{ item.name }}</span>
        <span class="muted mono search-id">{{ item.id }}</span>
      </UiListCard>
    </div>

    <el-button type="primary" class="offline-pack-submit" :loading="loading" @click="handleSubmit">
      {{ loading ? '解析中...' : '解析扩展信息' }}
    </el-button>

    <div v-if="detail" class="offline-pack-picker">
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

      <div class="offline-pack-actions">
        <el-button type="primary" :disabled="downloading" @click="handleDownload('crx')">
          下载 CRX
        </el-button>
        <el-button :disabled="downloading" @click="handleDownload('zip')">
          下载 ZIP
        </el-button>
      </div>
    </div>

    <DownloadSection
      :progress="progress"
      :downloading="downloading"
      :result="result"
      @cancel="cancel"
      @open-dir="openDir"
    />
  </div>
</template>

<style scoped>
.offline-pack-downloader {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.offline-pack-hint {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.offline-pack-link {
  color: var(--color-primary);
  text-decoration: none;
}

.offline-pack-link:hover {
  text-decoration: underline;
}

.offline-pack-input :deep(.el-input__wrapper) {
  height: 48px;
  padding: 0 16px;
  border-radius: 12px;
  background: var(--color-raised);
  box-shadow: 0 0 0 1px var(--color-border) inset, 0 1px 3px rgba(0, 0, 0, 0.1);
}

.offline-pack-input :deep(.el-input__wrapper.is-focus) {
  background: var(--color-raised);
  box-shadow: 0 0 0 1px var(--color-primary) inset;
}

.offline-pack-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.offline-pack-examples :deep(.el-button) {
  height: auto;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-regular);
  color: var(--color-text-secondary);
  background: var(--color-raised);
  border-color: transparent;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.offline-pack-examples :deep(.el-button:hover) {
  background: var(--color-raised);
  color: var(--color-text-primary);
}

.search-results {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.search-name {
  margin-right: 8px;
}

.search-id {
  font-size: var(--font-size-xs);
}

.offline-pack-submit {
  width: 100%;
  height: 44px;
  padding: 0 24px;
  border-radius: 12px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
}

.offline-pack-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--color-border-light);
  background: var(--color-raised);
  border-radius: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.offline-pack-actions {
  display: flex;
  gap: 8px;
}
</style>
