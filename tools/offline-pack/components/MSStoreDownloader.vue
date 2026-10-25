<script setup lang="ts">
import type { OfflinePackMsStoreFile, OfflinePackMsStoreResolveResult } from '@shared/offline-pack'
import { ElMessage } from 'element-plus'
import { computed, ref } from 'vue'
import { getOfflinePackApi, openExternal } from '../api'
import { useOfflinePackDownload } from '../composables/useOfflinePackDownload'
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

function formatDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

function useExample(value: string): void {
  input.value = value
  void handleSubmit()
}

async function handleSubmit(): Promise<void> {
  if (!api) {
    ElMessage.warning('离线包下载 仅在桌面端可用')
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
    resolveResult.value = await api.invoke(api.commands.MSSTORE_RESOLVE, trimmed) as OfflinePackMsStoreResolveResult
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

async function copyLink(): Promise<void> {
  if (!selected.value) return
  try {
    await navigator.clipboard.writeText(selected.value.url)
    ElMessage.success('已复制下载链接')
  } catch {
    ElMessage.error('复制失败')
  }
}
</script>

<template>
  <div class="offline-pack-downloader">
    <p class="offline-pack-hint">
      输入 MS 应用链接、ProductId、PackageFamilyName 或 CategoryId，或前往
      <a class="offline-pack-link" href="https://apps.microsoft.com/" @click.prevent="openExternal('https://apps.microsoft.com/')">Microsoft Store</a>
    </p>

    <el-input
      v-model="input"
      class="offline-pack-input" spellcheck="false"
      placeholder="商店 URL、ProductId（12 位）、PackageFamilyName 或 CategoryId"
      clearable
      @keyup.enter="handleSubmit"
    />

    <div class="offline-pack-examples">
      <el-button v-for="e in EXAMPLES" :key="e.value" size="small" @click="useExample(e.value)">
        {{ e.label }}
      </el-button>
    </div>

    <el-button type="primary" class="offline-pack-submit" :loading="loading" @click="handleSubmit">
      {{ loading ? '解析中...' : '解析应用信息' }}
    </el-button>

    <div v-if="resolveResult" class="offline-pack-picker">
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
          {{ formatDate(resolveResult.lastModifiedDate) }}
        </UiDetailItem>
      </UiDetailGrid>

      <el-select v-if="files.length" v-model="selectedFile" class="offline-pack-select" filterable placeholder="选择安装包">
        <el-option v-for="f in files" :key="f.url" :label="f.name" :value="f.url" />
      </el-select>

      <div v-if="selected" class="offline-pack-actions">
        <el-button type="primary" :disabled="downloading" @click="handleDownload">
          下载到本地
        </el-button>
        <el-button @click="copyLink">
          复制链接
        </el-button>
        <span v-if="selected.size" class="muted mono filename">{{ selected.size }}</span>
      </div>

      <UiHint v-if="resolveResult.filesError">
        文件列表解析失败：{{ resolveResult.filesError }}
      </UiHint>
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
  box-shadow: 0 0 0 1px var(--color-border) inset, var(--shadow-sm);
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
  box-shadow: var(--shadow-sm);
}

.offline-pack-examples :deep(.el-button:hover) {
  background: var(--color-raised);
  color: var(--color-text-primary);
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
  box-shadow: var(--shadow-sm);
}

.offline-pack-select {
  width: 100%;
}

.offline-pack-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filename {
  font-size: var(--font-size-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
