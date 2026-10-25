<script setup lang="ts">
import type { OfflinePackDockerImageInfo, OfflinePackDockerManifest, OfflinePackDockerPlatform, OfflinePackDockerSearchItem } from '@shared/offline-pack'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import { extractDockerImageInfo } from '@shared/offline-pack'
import { STORAGE_KEYS } from '@shared/storage-keys'
import { ElMessage } from 'element-plus'
import { computed, ref } from 'vue'
import { useOfflinePackDownload } from '../composables/useOfflinePackDownload'
import { getOfflinePackApi } from '../ipc'
import DownloadSection from './DownloadSection.vue'

const api = getOfflinePackApi()

// 加速服务（registry 镜像代理）：docker.* 仅代理 Docker Hub（docker.io），ghcr.* 仅代理 ghcr.io
type MirrorTarget = 'docker' | 'ghcr'
interface MirrorOption {
  label: string
  value: string
  target: MirrorTarget
}

const MIRRORS: MirrorOption[] = [
  { label: 'dockerproxy.net（Docker Hub）', value: 'https://dockerproxy.net', target: 'docker' },
  { label: 'docker.1ms.run（Docker Hub）', value: 'https://docker.1ms.run', target: 'docker' },
  { label: 'docker.1panel.live（Docker Hub）', value: 'https://docker.1panel.live', target: 'docker' },
  { label: 'ghcr.1ms.run（ghcr.io）', value: 'https://ghcr.1ms.run', target: 'ghcr' },
]

const MIRROR_STORAGE_KEY = STORAGE_KEYS.offlinePackRegistryMirror

function readMirror(): string {
  try {
    return localStorage.getItem(MIRROR_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

const mirror = ref(readMirror())

// 选中加速服务的目标仓库（docker.io / ghcr.io）；未选择或自定义地址时为 null
const mirrorTarget = computed<MirrorTarget | null>(() => MIRRORS.find(m => m.value === mirror.value)?.target ?? null)

// 选中加速服务的主机名（去协议 / 尾斜杠），参考示例动态替换代理地址
const mirrorHost = computed(() => mirror.value.replace(/^https?:\/\//i, '').replace(/\/+$/, ''))

const input = ref('')
const tags = ref<string[]>([])
const selectedTag = ref('')
const platforms = ref<OfflinePackDockerPlatform[]>([])
const selectedPlatform = ref('')
const searchCandidates = ref<OfflinePackDockerSearchItem[]>([])
const imageNotFound = ref(false)
const info = ref<OfflinePackDockerImageInfo | null>(null)
// 缺省 registry / namespace 归一化，避免多处重复 `info.value.xxx || 'xxx'`
const registry = computed(() => info.value?.registry || 'docker.io')
const namespace = computed(() => info.value?.namespace || 'library')
const manifest = ref<OfflinePackDockerManifest | null>(null)
const manifestLoading = ref(false)
const loading = ref(false)

const { progress, downloading, result, start, cancel, openDir } = useOfflinePackDownload()

const EXAMPLES = [
  { label: '试试 Nginx', value: 'nginx:latest' },
  { label: '试试 Redis', value: 'redis:latest' },
  { label: '试试 Kafka', value: 'apache/kafka:latest' },
]

function formatPlatform(p: OfflinePackDockerPlatform): string {
  return p.variant ? `${p.os}/${p.architecture}/${p.variant}` : `${p.os}/${p.architecture}`
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

const totalSize = computed(() => (manifest.value?.layers ?? []).reduce((sum, layer) => sum + layer.size, 0))

function getRepoUrl(namespace: string, repository: string): string {
  return `https://hub.docker.com/r/${namespace}/${repository}`
}

function getSearchUrl(keyword: string): string {
  return `https://hub.docker.com/search?q=${encodeURIComponent(keyword)}`
}

function buildFilename(): string {
  if (!info.value) return 'image.tar'
  const ns = info.value.namespace ? `${info.value.namespace}-` : ''
  const arch = selectedPlatform.value.split('/')[1]
  const suffix = arch && arch !== 'amd64' ? `-${arch}` : ''
  // 优先用真实版本号，解析不到时回退到标签
  const version = manifest.value?.version || selectedTag.value
  return `${ns}${info.value.repository}-${version}${suffix}.tar`
}

function useExample(value: string): void {
  input.value = value
  void handleSubmit()
}

/** 切换加速服务：持久化选择，并重新解析已输入的镜像（走新端点） */
function onMirrorChange(): void {
  try {
    if (mirror.value) localStorage.setItem(MIRROR_STORAGE_KEY, mirror.value)
    else localStorage.removeItem(MIRROR_STORAGE_KEY)
  } catch {
    // 持久化失败不影响本次使用
  }
  if (input.value.trim()) void handleSubmit()
}

async function handleSubmit(): Promise<void> {
  if (!api) {
    ElMessage.warning('离线包下载 仅在 Electron 桌面端可用')
    return
  }
  const trimmed = input.value.trim()
  if (!trimmed) {
    ElMessage.warning('请输入镜像名或 Docker Hub 链接')
    return
  }
  loading.value = true
  tags.value = []
  selectedTag.value = ''
  platforms.value = []
  selectedPlatform.value = ''
  searchCandidates.value = []
  imageNotFound.value = false
  manifest.value = null
  manifestLoading.value = false
  info.value = null
  try {
    const parsed = extractDockerImageInfo(trimmed)
    info.value = parsed
    const res = await api.invoke(api.channels.DOCKER_TAGS, registry.value, namespace.value, parsed.repository, mirror.value || undefined) as string[]
    tags.value = res ?? []
    if (tags.value.length) {
      selectedTag.value = parsed.tag && parsed.tag !== 'latest' ? parsed.tag : (tags.value[0] ?? 'latest')
      await loadPlatforms()
    } else {
      // 未找到：先结束「解析中」再异步搜索候选
      loading.value = false
      imageNotFound.value = true
      await searchCandidatesFallback(trimmed)
    }
  } catch (error) {
    // 出错即结束「解析中」
    loading.value = false
    const msg = (error as Error).message || '解析失败'
    if (/404|未找到/.test(msg)) {
      imageNotFound.value = true
      await searchCandidatesFallback(trimmed)
    } else {
      ElMessage.error(msg)
    }
  } finally {
    loading.value = false
  }
}

async function searchCandidatesFallback(keyword: string): Promise<void> {
  if (!api) return
  try {
    const res = await api.invoke(api.channels.DOCKER_SEARCH, keyword) as OfflinePackDockerSearchItem[]
    searchCandidates.value = res ?? []
  } catch {
    searchCandidates.value = []
  }
}

async function loadPlatforms(): Promise<void> {
  if (!api || !info.value) return
  platforms.value = []
  selectedPlatform.value = ''
  try {
    const res = await api.invoke(api.channels.DOCKER_PLATFORMS, registry.value, namespace.value, info.value.repository, selectedTag.value, mirror.value || undefined) as OfflinePackDockerPlatform[]
    platforms.value = res ?? []
    if (platforms.value.length) {
      const defaultPlatform = platforms.value.find(p => p.architecture === 'amd64' && p.os === 'linux') ?? platforms.value[0]
      selectedPlatform.value = formatPlatform(defaultPlatform)
    }
  } catch {
    platforms.value = []
  }
  await fetchManifest()
}

async function fetchManifest(): Promise<void> {
  if (!api || !info.value) return
  manifestLoading.value = true
  manifest.value = null
  try {
    manifest.value = await api.invoke(api.channels.DOCKER_MANIFEST, registry.value, namespace.value, info.value.repository, selectedTag.value, selectedPlatform.value || undefined, mirror.value || undefined) as OfflinePackDockerManifest
  } catch {
    manifest.value = null
  } finally {
    manifestLoading.value = false
  }
}

async function onTagChange(): Promise<void> {
  await loadPlatforms()
}

async function onPlatformChange(): Promise<void> {
  await fetchManifest()
}

function selectCandidate(item: OfflinePackDockerSearchItem): void {
  input.value = `${item.namespace}/${item.repository}`
  searchCandidates.value = []
  void handleSubmit()
}

async function handleDownload(): Promise<void> {
  if (!info.value) return
  await start({
    kind: 'docker',
    registry: registry.value,
    namespace: namespace.value,
    repository: info.value.repository,
    tag: selectedTag.value,
    platform: selectedPlatform.value || undefined,
    mirror: mirror.value || undefined,
    filename: buildFilename(),
  })
}
</script>

<template>
  <div class="offline-pack-downloader">
    <p class="offline-pack-hint">
      输入完整镜像名或 Docker Hub 仓库链接，或前往
      <a class="offline-pack-link" href="https://hub.docker.com/search" @click.prevent="openExternal('https://hub.docker.com/search')">Docker Hub</a>
    </p>

    <div class="mirror-card">
      <div class="mirror-head">
        <span class="mirror-title">加速服务</span>
        <span class="muted mirror-note">docker.* 仅代理 Docker Hub（docker.io），ghcr.* 仅代理 ghcr.io</span>
      </div>

      <el-select
        v-model="mirror"
        class="mirror-select"
        filterable
        allow-create
        clearable
        placeholder="直连（不使用加速）"
        @change="onMirrorChange"
      >
        <el-option v-for="m in MIRRORS" :key="m.value" :label="m.label" :value="m.value" />
      </el-select>

      <div v-if="mirrorTarget" class="mirror-examples">
        <p class="muted mirror-example-title">
          参考示例
        </p>
        <template v-if="mirrorTarget === 'docker'">
          <p class="mirror-example-group">
            Docker Hub
          </p>
          <p class="mono mirror-example">
            nginx → docker.io/library/nginx → {{ mirrorHost }}/library/nginx
          </p>
          <p class="mono mirror-example">
            apache/kafka → docker.io/apache/kafka → {{ mirrorHost }}/apache/kafka
          </p>
        </template>
        <template v-else>
          <p class="mirror-example-group">
            ghcr.io
          </p>
          <p class="mono mirror-example">
            ghcr.io/immich-app/immich-server → {{ mirrorHost }}/ghcr.io/immich-app/immich-server
          </p>
        </template>
      </div>
    </div>

    <el-input
      v-model="input"
      class="offline-pack-input" spellcheck="false"
      placeholder="镜像名，如 nginx:latest / library/nginx / docker.io/library/nginx:latest"
      clearable
      @keyup.enter="handleSubmit"
    />

    <div class="offline-pack-examples">
      <el-button v-for="e in EXAMPLES" :key="e.value" size="small" @click="useExample(e.value)">
        {{ e.label }}
      </el-button>
    </div>

    <div v-if="imageNotFound && info" class="notfound-card">
      <p class="notfound-title">
        未找到对应镜像：{{ info.namespace || 'library' }}/{{ info.repository }}
      </p>
      <p class="notfound-desc">
        Docker 镜像不能按关键词直接解析。当前输入已按
        <span class="mono">{{ info.namespace || 'library' }}/{{ info.repository }}</span>
        查找；如果你要找社区镜像，请从候选项选择，或输入类似
        <span class="mono">apache/kafka</span> 的完整名称。
      </p>
      <div class="notfound-links">
        <a class="offline-pack-link" :href="getSearchUrl(info.repository)" @click.prevent="openExternal(getSearchUrl(info.repository))">前往 DockerHub 搜索</a>
        <a class="offline-pack-link" :href="getRepoUrl(info.namespace || 'library', info.repository)" @click.prevent="openExternal(getRepoUrl(info.namespace || 'library', info.repository))">预览当前仓库页</a>
      </div>
      <div v-if="searchCandidates.length" class="candidates">
        <p class="candidates-title">
          候选镜像（Top {{ searchCandidates.length }}）
        </p>
        <div v-for="c in searchCandidates" :key="`${c.namespace}/${c.repository}`" class="candidate-card">
          <div class="candidate-meta">
            <p class="candidate-name">
              {{ c.namespace }}/{{ c.repository }}
            </p>
            <p v-if="c.shortDescription" class="candidate-desc">
              {{ c.shortDescription }}
            </p>
          </div>
          <div class="candidate-actions">
            <el-button size="small" type="primary" @click="selectCandidate(c)">
              选择
            </el-button>
            <el-button size="small" class="candidate-link" title="打开 Docker Hub 页面" @click="openExternal(getRepoUrl(c.namespace, c.repository))">
              <UiIcon name="external" :size="16" />
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <el-button type="primary" class="offline-pack-submit" :loading="loading" @click="handleSubmit">
      {{ loading ? '解析中...' : '解析镜像信息' }}
    </el-button>

    <div v-if="tags.length" class="offline-pack-picker">
      <div class="picker-row">
        <div class="picker-field">
          <p class="offline-pack-picker-title">
            选择标签
          </p>
          <el-select v-model="selectedTag" class="offline-pack-select" placeholder="选择标签" @change="onTagChange">
            <el-option v-for="t in tags" :key="t" :label="t" :value="t" />
          </el-select>
        </div>

        <div v-if="platforms.length" class="picker-field picker-arch">
          <p class="offline-pack-picker-title">
            选择架构
          </p>
          <el-select v-model="selectedPlatform" class="offline-pack-select" placeholder="选择架构" @change="onPlatformChange">
            <el-option v-for="p in platforms" :key="formatPlatform(p)" :label="formatPlatform(p)" :value="formatPlatform(p)" />
          </el-select>
        </div>
      </div>

      <div class="offline-pack-actions">
        <el-button type="primary" :disabled="downloading" @click="handleDownload">
          下载并打包 TAR
        </el-button>
        <span v-if="selectedPlatform" class="muted mono filename">{{ buildFilename() }}</span>
      </div>
    </div>

    <div v-if="manifestLoading" class="manifest-card">
      <span class="muted">获取层信息...</span>
    </div>
    <div v-else-if="manifest && manifest.layers.length" class="manifest-card">
      <div class="manifest-title">
        <UiIcon name="layers" :size="16" />
        <span>镜像层（{{ manifest.layers.length }} 层）</span>
        <span v-if="manifest.version" class="manifest-version mono">{{ manifest.version }}</span>
      </div>
      <div class="manifest-layers">
        <div v-for="(layer, i) in manifest.layers" :key="layer.digest" class="manifest-row">
          <span class="mono manifest-digest">{{ i + 1 }}. {{ layer.digest.slice(7, 19) }}...</span>
          <span class="mono manifest-size">{{ formatBytes(layer.size) }}</span>
        </div>
      </div>
      <div class="manifest-total">
        <span>总计（压缩）</span>
        <span class="mono">{{ formatBytes(totalSize) }}</span>
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

.mirror-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--color-border-light);
  background: var(--color-raised);
  border-radius: 12px;
}

.mirror-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.mirror-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.mirror-note {
  font-size: var(--font-size-xs);
}

.mirror-select {
  width: 100%;
}

.mirror-examples {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border-light);
}

.mirror-example-title {
  margin: 0 0 2px;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.mirror-example-group {
  margin: 6px 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.mirror-example {
  margin: 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--color-text-secondary);
  word-break: break-all;
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

/* 未找到镜像：主题色边框 + 浅底提示卡片 */
.notfound-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  background: color-mix(in srgb, var(--color-primary) 5%, transparent);
  border-radius: 16px;
}

.notfound-title {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-primary);
}

.notfound-desc {
  margin: 0;
  font-size: var(--font-size-xs);
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.notfound-links {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: var(--font-size-xs);
}

.candidates {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.candidates-title {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.candidate-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--color-border-light);
  border-radius: 10px;
  transition: var(--transition-fast);
}

.candidate-card:hover {
  background: var(--color-raised);
}

.candidate-meta {
  flex: 1;
  min-width: 0;
}

.candidate-name {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.candidate-desc {
  margin: 4px 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.candidate-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.candidate-link {
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 8px;
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

/* 标签 + 架构一行并排：标签占满剩余，架构固定宽 */
.picker-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.picker-field {
  flex: 1;
  min-width: 0;
}

.picker-arch {
  flex: 0 0 192px;
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

/* 镜像层大小卡片：灰底 + 阴影 + 层列表 + 总计 */
.manifest-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--color-border-light);
  background: var(--color-raised);
  border-radius: 16px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06), 0 1px 6px rgba(0, 0, 0, 0.04);
}

.manifest-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.manifest-title :deep(.ui-icon) {
  color: var(--color-primary);
}

.manifest-version {
  margin-left: auto;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-primary);
}

.manifest-layers {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.manifest-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.manifest-digest {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manifest-size {
  flex-shrink: 0;
}

.manifest-total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid var(--color-border-light);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}
</style>
