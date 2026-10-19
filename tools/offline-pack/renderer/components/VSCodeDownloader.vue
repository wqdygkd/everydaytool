<script setup lang="ts">
import type { OfflinePackVsCodeLinkResult, OfflinePackVsCodeQueryResult } from '@shared/offline-pack'
import { ElMessage } from 'element-plus'
import { ref } from 'vue'
import { useOfflinePackDownload } from '../composables/useOfflinePackDownload'
import { getOfflinePackApi, openExternal } from '../ipc'
import DownloadSection from './DownloadSection.vue'

const api = getOfflinePackApi()

const input = ref('')
const versions = ref<string[]>([])
const selectedVersion = ref('')
const linkUrl = ref('')
const loading = ref(false)
const copying = ref(false)

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
    ElMessage.warning('离线包下载 仅在 Electron 桌面端可用')
    return
  }
  const trimmed = input.value.trim()
  if (!trimmed) {
    ElMessage.warning('请输入插件 URL')
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
    ElMessage.error((error as Error).message || '查询失败')
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
    ElMessage.error((error as Error).message || '生成链接失败')
  }
}

async function handleDownload(): Promise<void> {
  if (!linkUrl.value) return
  const itemName = itemNameFromUrl(input.value)
  await start({ kind: 'vscode', url: linkUrl.value, filename: `${itemName}-${selectedVersion.value}.vsix` })
}

async function copyLink(): Promise<void> {
  if (!linkUrl.value) return
  copying.value = true
  try {
    await navigator.clipboard.writeText(linkUrl.value)
    ElMessage.success('已复制下载链接')
  } catch {
    ElMessage.error('复制失败')
  } finally {
    copying.value = false
  }
}
</script>

<template>
  <div class="offline-pack-downloader">
    <p class="offline-pack-hint">
      仅支持插件页链接，或前往
      <a class="offline-pack-link" href="https://marketplace.visualstudio.com/vscode" @click.prevent="openExternal('https://marketplace.visualstudio.com/vscode')">VSCode Marketplace</a>
    </p>

    <el-input
      v-model="input"
      class="offline-pack-input" spellcheck="false"
      placeholder="marketplace.visualstudio.com/items?itemName=..."
      clearable
      @keyup.enter="handleSubmit"
    />

    <div class="offline-pack-examples">
      <el-button v-for="e in EXAMPLES" :key="e.value" size="small" @click="useExample(e.value)">
        {{ e.label }}
      </el-button>
    </div>

    <div v-if="versions.length" class="offline-pack-picker">
      <p class="offline-pack-picker-title">
        选择版本
      </p>
      <el-select v-model="selectedVersion" class="offline-pack-select" placeholder="选择版本" @change="buildLink">
        <el-option v-for="v in versions" :key="v" :label="v" :value="v" />
      </el-select>
    </div>

    <el-button type="primary" class="offline-pack-submit" :loading="loading" @click="handleSubmit">
      {{ loading ? '解析中...' : '解析插件信息' }}
    </el-button>

    <div v-if="linkUrl" class="offline-pack-actions">
      <el-button type="primary" :disabled="downloading" @click="handleDownload">
        下载到本地
      </el-button>
      <el-button :loading="copying" @click="copyLink">
        复制链接
      </el-button>
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
/* 尺寸/布局保持一致，颜色走 tool-hub 令牌 */
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

/* 输入框：h-48 + rounded-12 + 半透明底 + blur + 双层阴影 */
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

/* 示例按钮：胶囊 + 白底 + 微阴影 + muted 字 */
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

/* 选择卡片：border + 半透明底 + 小标题 */
.offline-pack-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--color-border-light);
  background: var(--color-raised);
  border-radius: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.offline-pack-picker-title {
  margin: 0;
  font-size: 11px;
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
}

.offline-pack-select {
  width: 100%;
}

/* 主按钮：占满 + h-44 + rounded-12 */
.offline-pack-submit {
  width: 100%;
  height: 44px;
  padding: 0 24px;
  border-radius: 12px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
}

.offline-pack-actions {
  display: flex;
  gap: 8px;
}
</style>
