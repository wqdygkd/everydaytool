<script setup lang="ts">
import type { OfflinePackDockerImageInfo, OfflinePackDockerManifest, OfflinePackDockerPlatform, OfflinePackDockerSearchItem } from '@shared/offline-pack'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import { extractDockerImageInfo, formatBytes } from '@shared/offline-pack'
import { STORAGE_KEYS } from '@shared/storage-keys'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { getOfflinePackApi } from '../ipc'
import { useOfflinePackDownloadsStore } from '../stores/downloads'
import DownloaderFrame from './DownloaderFrame.vue'

const api = getOfflinePackApi()

// 加速服务（registry 镜像代理）：docker.* 仅代理 Docker Hub（docker.io），ghcr.* 仅代理 ghcr.io，
// gh-proxy.com/docker 同时代理 Docker Hub / GHCR / GCR / Quay
type MirrorTarget = 'docker' | 'ghcr' | 'multi'
interface MirrorOption {
  label: string
  value: string
  target: MirrorTarget
}

const MIRRORS: MirrorOption[] = [
  { label: 'dockerproxy.net（支持 Docker Hub）', value: 'https://dockerproxy.net', target: 'docker' },
  { label: 'docker.1ms.run（支持 Docker Hub）', value: 'https://docker.1ms.run', target: 'docker' },
  { label: 'docker.1panel.live（支持 Docker Hub）', value: 'https://docker.1panel.live', target: 'docker' },
  { label: 'ghcr.1ms.run（支持 ghcr.io）', value: 'https://ghcr.1ms.run', target: 'ghcr' },
  { label: 'gh-proxy.com（Docker Hub / GHCR / GCR / Quay）', value: 'https://gh-proxy.com/docker', target: 'multi' },
  { label: 'v4.gh-proxy.org（支持 Docker Hub / GHCR / GCR / Quay）', value: 'https://v4.gh-proxy.org/docker', target: 'multi' },
  { label: 'v6.gh-proxy.org（支持 Docker Hub / GHCR / GCR / Quay）', value: 'https://v6.gh-proxy.org/docker', target: 'multi' },
  { label: 'cdn.gh-proxy.org（支持 Docker Hub / GHCR / GCR / Quay）', value: 'https://cdn.gh-proxy.org/docker', target: 'multi' },
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

const downloads = useOfflinePackDownloadsStore()

const EXAMPLES = [
  { label: '试试 Nginx', value: 'nginx:latest' },
  { label: '试试 Redis', value: 'redis:latest' },
  { label: '试试 Kafka', value: 'apache/kafka:latest' },
]

function formatPlatform(p: OfflinePackDockerPlatform): string {
  return p.variant ? `${p.os}/${p.architecture}/${p.variant}` : `${p.os}/${p.architecture}`
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
    toast.warning('离线包下载 仅在 Electron 桌面端可用')
    return
  }
  const trimmed = input.value.trim()
  if (!trimmed) {
    toast.warning('请输入镜像名或 Docker Hub 链接')
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
      toast.error(msg)
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
  await downloads.start(
    {
      kind: 'docker',
      registry: registry.value,
      namespace: namespace.value,
      repository: info.value.repository,
      tag: selectedTag.value,
      platform: selectedPlatform.value || undefined,
      mirror: mirror.value || undefined,
      filename: buildFilename(),
    },
    `${registry.value}/${namespace.value}/${info.value.repository}:${selectedTag.value}`,
  )
}
</script>

<template>
  <DownloaderFrame
    v-model="input"
    placeholder="镜像名，如 nginx:latest / library/nginx / docker.io/library/nginx:latest"
    submit-label="解析镜像信息"
    :examples="EXAMPLES"
    :loading="loading"
    @submit="handleSubmit"
    @example="useExample"
  >
    <template #hint>
      输入完整镜像名或 Docker Hub 仓库链接，或前往
      <UiLink
        type="primary"
        :underline="false"
        @click="openExternal('https://hub.docker.com/search')"
      >
        Docker Hub
      </UiLink>
    </template>

    <!-- 加速服务：高级选项，放在主输入框之前（切换后会自动重新解析已输入的镜像） -->
    <template #before>
      <UiPanel variant="outlined" title="加速服务">
        <UiGroup direction="column" gap="md" align="stretch" block>
          <UiSelect v-model="mirror" class="full-width" placeholder="直连（不使用加速）" :options="MIRRORS.map(m => ({ label: m.label, value: m.value }))" @update:model-value="onMirrorChange" />

          <UiGroup v-if="mirrorTarget" direction="column" gap="xs" block>
            <UiHint size="xs">
              参考示例
            </UiHint>
            <template v-if="mirrorTarget === 'docker'">
              <UiHint size="xs" class="mono">
                nginx → docker.io/library/nginx → {{ mirrorHost }}/library/nginx
              </UiHint>
              <UiHint size="xs" class="mono">
                apache/kafka → docker.io/apache/kafka → {{ mirrorHost }}/apache/kafka
              </UiHint>
            </template>
            <UiHint v-else-if="mirrorTarget === 'ghcr'" size="xs" class="mono">
              ghcr.io/immich-app/immich-server → {{ mirrorHost }}/ghcr.io/immich-app/immich-server
            </UiHint>
            <template v-else>
              <UiHint size="xs" class="mono">
                nginx → {{ mirrorHost }}/nginx
              </UiHint>
              <UiHint size="xs" class="mono">
                apache/kafka → {{ mirrorHost }}/apache/kafka
              </UiHint>
              <UiHint size="xs" class="mono">
                ghcr.io/immich-app/immich-server → {{ mirrorHost }}/ghcr.io/immich-app/immich-server
              </UiHint>
              <UiHint size="xs" class="mono">
                quay.io/prometheus/node-exporter → {{ mirrorHost }}/quay.io/prometheus/node-exporter
              </UiHint>
            </template>
          </UiGroup>
        </UiGroup>
      </UiPanel>
    </template>

    <!-- 未找到镜像：说明 + 外链 + 候选镜像 -->
    <template #between>
      <UiPanel v-if="imageNotFound && info" variant="outlined">
        <UiGroup direction="column" gap="md" align="stretch" block>
          <UiHint>
            未找到镜像 <span class="mono">{{ info.namespace || 'library' }}/{{ info.repository }}</span>。Docker 镜像不能按关键词直接解析：请输入完整的
            <span class="mono">namespace/repository</span>（如 <span class="mono">apache/kafka</span>），或从下方候选镜像中选择。
          </UiHint>

          <UiGroup gap="md" wrap>
            <UiLink
              type="primary"
              :underline="false"
              @click="openExternal(getSearchUrl(info.repository))"
            >
              前往 Docker Hub 搜索
            </UiLink>
            <UiLink
              type="primary"
              :underline="false"
              @click="openExternal(getRepoUrl(info.namespace || 'library', info.repository))"
            >
              预览当前仓库页
            </UiLink>
          </UiGroup>

          <UiGroup v-if="searchCandidates.length" direction="column" gap="sm" block>
            <UiHint size="xs">
              候选镜像（Top {{ searchCandidates.length }}）
            </UiHint>
            <UiListCard
              v-for="c in searchCandidates"
              :key="`${c.namespace}/${c.repository}`"
              @click="selectCandidate(c)"
            >
              <UiGroup justify="between" gap="md">
                <UiGroup class="ctl-fill" direction="column" gap="xs">
                  <span class="mono">{{ c.namespace }}/{{ c.repository }}</span>
                  <UiHint v-if="c.shortDescription" size="xs">
                    {{ c.shortDescription }}
                  </UiHint>
                </UiGroup>
                <UiIconButton
                  icon="external"
                  label="打开 Docker Hub 页面"
                  @click.stop="openExternal(getRepoUrl(c.namespace, c.repository))"
                />
              </UiGroup>
            </UiListCard>
          </UiGroup>
        </UiGroup>
      </UiPanel>
    </template>

    <!-- 标签 / 架构选择 + 下载 -->
    <UiPanel v-if="tags.length" variant="outlined">
      <UiGroup direction="column" gap="md" align="stretch" block>
        <UiGroup gap="md" align="center" wrap>
          <UiGroup class="tag-field ctl-fill" gap="sm" align="center">
            <UiHint size="xs" class="field-label">
              选择标签
            </UiHint>
            <UiSelect v-model="selectedTag" placeholder="选择标签" :options="tags.map(t => ({ label: t, value: t }))" @update:model-value="onTagChange" />
          </UiGroup>

          <UiGroup v-if="platforms.length" class="platform-field ctl-md" gap="sm" align="center">
            <UiHint size="xs" class="field-label">
              选择架构
            </UiHint>
            <UiSelect v-model="selectedPlatform" placeholder="选择架构" :options="platforms.map(p => ({ label: formatPlatform(p), value: formatPlatform(p) }))" @update:model-value="onPlatformChange" />
          </UiGroup>
        </UiGroup>

        <UiGroup gap="sm" align="center" wrap class="btn-flush">
          <UiButton type="primary" @click="handleDownload">
            下载并打包 TAR
          </UiButton>
          <UiHint v-if="selectedPlatform" size="xs" class="mono">
            {{ buildFilename() }}
          </UiHint>
        </UiGroup>
      </UiGroup>
    </UiPanel>

    <!-- 镜像层清单：表格化展示摘要与大小，总压缩大小走键值行 -->
    <UiPanel v-if="manifestLoading" variant="outlined" padding="var(--spacing-md)">
      <UiHint>
        获取层信息…
      </UiHint>
    </UiPanel>
    <UiPanel v-else-if="manifest && manifest.layers.length" variant="outlined" title="镜像层">
      <template #actions>
        <UiChip v-if="manifest.version" tone="primary" mono>
          {{ manifest.version }}
        </UiChip>
      </template>

      <UiTable class="manifest-table" :data="manifest.layers" max-height="240">
        <UiTableColumn label="#" width="52" align="right">
          <template #default="{ $index }">
            <span class="mono muted">{{ $index + 1 }}</span>
          </template>
        </UiTableColumn>
        <UiTableColumn label="层摘要" prop="digest" min-width="260" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono">{{ row.digest }}</span>
          </template>
        </UiTableColumn>
        <UiTableColumn label="大小" width="100" align="right">
          <template #default="{ row }">
            <span class="mono">{{ formatBytes(row.size) }}</span>
          </template>
        </UiTableColumn>
      </UiTable>

      <UiKeyValue class="manifest-total" label="总计（压缩）" label-width="auto" mono>
        {{ formatBytes(totalSize) }}
      </UiKeyValue>
    </UiPanel>
  </DownloaderFrame>
</template>

<style scoped>
/* 标签与选择框同行：标签不折行，选择框吃掉剩余宽度 */
.field-label {
  flex: none;
  white-space: nowrap;
}

.tag-field :deep(.ui-select-trigger),
.platform-field :deep(.ui-select-trigger) {
  flex: 1;
  min-width: 0;
}

/* 镜像层是结果清单，行高比默认 42px 紧凑一档 */
.manifest-table :deep(td) {
  height: 34px;
}

/* 表格与「总计」之间留一档间距（UiKeyValue 自带顶部边框，正好当汇总分隔线） */
.manifest-total {
  margin-top: var(--spacing-sm);
}
</style>
