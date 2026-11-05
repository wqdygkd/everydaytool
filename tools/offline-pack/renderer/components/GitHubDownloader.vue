<script setup lang="ts">
import type {
  OfflinePackGithubAsset,
  OfflinePackGithubFileResult,
  OfflinePackGithubRef,
  OfflinePackGithubRefsResult,
  OfflinePackGithubRelease,
  OfflinePackGithubResolveResult,
} from '@shared/offline-pack'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import {
  formatBytes,
  formatDateTime,
  githubSourceArchiveUrl,
  parseGithubUrl,
  sanitizeDownloadFilename,
} from '@shared/offline-pack'
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { getOfflinePackApi } from '../ipc'
import DownloaderFrame from './DownloaderFrame.vue'
import GithubArtifact from './GithubArtifact.vue'
import GithubLineButtons from './GithubLineButtons.vue'

const api = getOfflinePackApi()

/** 资产默认只展示下载量前 N 个：一个 release 可能有 50+ 个文件，全铺开反而找不到 */
const TOP_ASSETS = 5

type Section = 'releases' | 'source' | 'file'

interface RateSnapshot {
  rateRemaining?: number
  rateResetAt?: string
}

const EXAMPLES = [
  { label: '试试 docker/compose', value: 'docker/compose' },
  { label: '试试 electron/electron', value: 'electron/electron' },
  { label: '试试某个 Release', value: 'https://github.com/docker/compose/releases/tag/v5.7.0' },
]

const input = ref('')
const loading = ref(false)
const section = ref<Section>('releases')

const resolved = ref<OfflinePackGithubResolveResult | null>(null)
/** 顶部直接粘资产 / raw 链接时只渲染一张卡片，不调 API */
const direct = ref<{ url: string, filename: string, title: string, owner: string, repo: string } | null>(null)

const selectedTag = ref('')
const showNotes = ref(false)
const expanded = ref(false)

const refs = ref<OfflinePackGithubRefsResult | null>(null)
const refsLoading = ref(false)
const refsError = ref('')
const selectedRef = ref('')
const sourceFormat = ref<'zip' | 'tar.gz'>('zip')

const filePath = ref('')
const fileLoading = ref(false)
const fileResult = ref<OfflinePackGithubFileResult | null>(null)

/** 配额：RELEASES / REFS / FILE 任一响应都会刷新，缓存命中时后端回的是上次真实值 */
const rateRemaining = ref<number | undefined>()
const rateResetAt = ref<string | undefined>()

/**
 * 请求代次：重新解析仓库就 +1，所有异步回包落地前都要对一次。
 * 否则 A 仓库的 refs 慢回来会写进 B 仓库的状态，sha 与仓库错配。
 */
let epoch = 0

const releases = computed(() => resolved.value?.releases ?? [])
const release = computed<OfflinePackGithubRelease | null>(
  () => releases.value.find(item => item.tag === selectedTag.value) ?? null,
)
const releaseOptions = computed(() => releases.value.map(item => ({
  label: item.prerelease ? `${item.tag}（预发布）` : item.tag,
  value: item.tag,
})))
const sortedAssets = computed(() =>
  [...(release.value?.assets ?? [])].sort((a, b) => b.downloadCount - a.downloadCount),
)
const visibleAssets = computed(() =>
  expanded.value ? sortedAssets.value : sortedAssets.value.slice(0, TOP_ASSETS),
)

/** refs 拉取失败时降级成默认分支：codeload / contents 都接受普通分支名，别让整段不可用 */
const refOptions = computed(() => {
  const list = refs.value
  if (list && (list.branches.length || list.tags.length)) {
    return [
      ...list.branches.map(item => ({ label: `分支 · ${item.name}`, value: item.name })),
      ...list.tags.map(item => ({ label: `标签 · ${item.name}`, value: item.name })),
    ]
  }
  const branch = resolved.value?.defaultBranch
  return branch ? [{ label: `分支 · ${branch}`, value: branch }] : []
})
/** 源码包与 raw 链接都用 sha 寻址：带 `/` 的分支名拼进 URL 会歧义 */
const selectedRefSha = computed(() => {
  const list = refs.value
  if (!list) return ''
  return [...list.branches, ...list.tags].find(item => item.name === selectedRef.value)?.sha ?? ''
})
const archiveSha = computed(() => selectedRefSha.value || selectedRef.value)
const archiveUrl = computed(() => {
  if (!resolved.value || !archiveSha.value) return ''
  return githubSourceArchiveUrl(resolved.value.owner, resolved.value.repo, archiveSha.value, sourceFormat.value)
})
const archiveFilename = computed(() => {
  if (!resolved.value) return ''
  return sanitizeDownloadFilename(`${resolved.value.repo}-${selectedRef.value || 'source'}-source.${sourceFormat.value}`)
})

const sectionItems = computed(() => [
  { value: 'releases', label: 'Releases', badge: releases.value.length || undefined },
  { value: 'source', label: '分支源码', badge: refs.value ? refs.value.branches.length + refs.value.tags.length : undefined },
  { value: 'file', label: '单文件' },
])

function assetFilename(asset: OfflinePackGithubAsset): string {
  const tag = release.value?.tag ?? 'release'
  return sanitizeDownloadFilename(`${resolved.value?.repo ?? 'github'}-${tag}-${asset.name}`)
}

function fileFilename(file: OfflinePackGithubFileResult): string {
  const ref = file.ref.slice(0, 7)
  return sanitizeDownloadFilename(`${file.repo}-${ref}-${file.name}`)
}

/** 直链模式同样要带仓库/版本前缀：downloads/ 是平铺目录，裸文件名会互相覆盖 */
function directFilename(ref: OfflinePackGithubRef): string {
  const file = ref.filePath?.split('/').pop() || ref.assetName || 'download.bin'
  const tag = ref.tag || ref.ref || 'direct'
  return sanitizeDownloadFilename(`${ref.repo}-${tag}-${file}`)
}

/** 直链卡只有一个文件，但用户往往接着要看整个仓库：一键回到仓库视图 */
function resolveDirectRepo(): void {
  if (!direct.value) return
  input.value = `${direct.value.owner}/${direct.value.repo}`
  void handleSubmit()
}

/** 匿名配额只剩个位数时提示重置时间，别等到 403 才发现 */
const rateTone = computed(() => (rateRemaining.value !== undefined && rateRemaining.value <= 5 ? 'warning' : 'neutral'))
const rateTitle = computed(() => (
  rateResetAt.value
    ? `GitHub API 匿名配额 60 次/小时，将于 ${formatDateTime(rateResetAt.value)} 重置`
    : 'GitHub API 匿名配额 60 次/小时'
))
/** refs 只取第一页：说清楚上限，并给出继续的路（粘 tag / 分支链接） */
const refsTruncatedHint = computed(() => {
  const list = refs.value
  if (!list) return ''
  if (list.tagsTruncated && list.branchesTruncated) return '分支与标签各只列前 100 个；更早的可以粘贴对应链接直接解析'
  if (list.tagsTruncated) return '标签只列最近 100 个；更早的可以粘贴 tag 链接直接解析'
  if (list.branchesTruncated) return '分支只列前 100 个；可直接把分支链接粘到输入框'
  return ''
})

function applyRate(rate: RateSnapshot): void {
  if (rate.rateRemaining !== undefined) rateRemaining.value = rate.rateRemaining
  if (rate.rateResetAt) rateResetAt.value = rate.rateResetAt
}

function resetResult(): void {
  epoch += 1
  resolved.value = null
  direct.value = null
  refs.value = null
  refsError.value = ''
  refsLoading.value = false
  selectedTag.value = ''
  selectedRef.value = ''
  filePath.value = ''
  fileResult.value = null
  showNotes.value = false
  expanded.value = false
  section.value = 'releases'
  // 配额跟着仓库走：直链模式下不该继续显示上一个仓库的剩余次数
  rateRemaining.value = undefined
  rateResetAt.value = undefined
}

async function ensureRefs(force = false): Promise<void> {
  if (!api || !resolved.value) return
  // 失败后不再自动重试：切区块不该反复打接口，交给「重试」按钮
  if (!force && (refsLoading.value || refs.value || refsError.value)) return

  const token = epoch
  const { owner, repo, defaultBranch } = resolved.value
  refsLoading.value = true
  refsError.value = ''
  try {
    const result = await api.invoke(api.channels.GITHUB_REFS, owner, repo) as OfflinePackGithubRefsResult
    if (token !== epoch) return
    refs.value = result
    applyRate(result)
    if (!selectedRef.value) selectedRef.value = defaultBranch
  } catch (error) {
    if (token !== epoch) return
    // 降级：没有分支列表也能用默认分支下源码 / 解析文件，只是少了选择
    refs.value = null
    refsError.value = (error as Error).message || '读取分支失败'
    if (!selectedRef.value) selectedRef.value = defaultBranch
  } finally {
    if (token === epoch) refsLoading.value = false
  }
}

function onSectionChange(value: string): void {
  section.value = value as Section
  if (section.value !== 'releases') void ensureRefs()
}

function onTagChange(): void {
  showNotes.value = false
  expanded.value = false
}

// 换 ref 后旧文件卡必须失效：否则卡片仍指向上一分支的 raw 地址
watch(selectedRef, () => {
  fileResult.value = null
})

async function applyParsedLink(ref: OfflinePackGithubRef, source: string): Promise<void> {
  if (ref.directUrl) {
    direct.value = {
      url: ref.directUrl,
      filename: directFilename(ref),
      title: ref.filePath || ref.assetName || `${ref.repo} 文件`,
      owner: ref.owner,
      repo: ref.repo,
    }
    return
  }

  const token = epoch
  const result = await api!.invoke(
    api!.channels.GITHUB_RELEASES,
    source,
  ) as OfflinePackGithubResolveResult
  if (token !== epoch) return

  resolved.value = result
  applyRate(result)

  const matched = ref.tag ? result.releases.find(item => item.tag === ref.tag) : undefined
  if (ref.tag && !matched) {
    toast.info(`最近 ${result.releases.length} 个 Release 里没有 ${ref.tag}，已展示最新版本`)
  }
  const first = matched
    ?? result.releases.find(item => !item.prerelease)
    ?? result.releases[0]
  if (first) selectedTag.value = first.tag

  // /tree/<ref>：用户点的是分支，落到「分支源码」并预选该 ref
  if (ref.ref && !ref.filePath) {
    selectedRef.value = ref.ref
    section.value = 'source'
    void ensureRefs()
  }
}

async function handleSubmit(): Promise<void> {
  if (!api) {
    toast.warning('离线包下载 仅在 Electron 桌面端可用')
    return
  }
  const trimmed = input.value.trim()
  if (!trimmed) {
    toast.warning('请输入 GitHub 仓库链接')
    return
  }
  const parsed = parseGithubUrl(trimmed)
  if (!parsed) {
    toast.error('无法识别该链接，示例：https://github.com/owner/repo 或 owner/repo')
    return
  }

  resetResult()
  const token = epoch
  loading.value = true
  try {
    await applyParsedLink(parsed, trimmed)
  } catch (error) {
    if (token !== epoch) return
    toast.error((error as Error).message || '解析失败')
  } finally {
    loading.value = false
  }
}

function useExample(value: string): void {
  input.value = value
  void handleSubmit()
}

/** 单文件解析：ref 优先用 sha（带斜杠的分支名在 raw URL 里会歧义） */
async function resolveFile(): Promise<void> {
  if (!api || !resolved.value) return
  const path = filePath.value.trim()
  if (!path) {
    toast.warning('请输入文件路径，例如 docs/README.md')
    return
  }
  const ref = archiveSha.value
  if (!ref) {
    void ensureRefs()
    toast.warning('请先选择分支或标签')
    return
  }

  const token = epoch
  fileLoading.value = true
  try {
    const result = await api.invoke(
      api.channels.GITHUB_FILE,
      resolved.value.owner,
      resolved.value.repo,
      ref,
      path,
    ) as OfflinePackGithubFileResult
    if (token !== epoch) return
    fileResult.value = result
    applyRate(result)
  } catch (error) {
    if (token !== epoch) return
    fileResult.value = null
    toast.error((error as Error).message || '解析文件失败')
  } finally {
    if (token === epoch) fileLoading.value = false
  }
}
</script>

<template>
  <DownloaderFrame
    v-model="input"
    placeholder="仓库链接，或 Release / 分支 / 文件链接"
    submit-label="解析"
    :examples="EXAMPLES"
    :loading="loading"
    @submit="handleSubmit"
    @example="useExample"
  >
    <template #hint>
      仅支持<strong>公开仓库</strong>；解析走 GitHub API（匿名 60 次/小时），下载按下方按钮选择线路
      （左半下载、右半复制该线路的加速链接）。
    </template>

    <template #between>
      <UiGroup v-if="resolved || direct" gap="sm" align="center" wrap>
        <UiChip v-if="rateRemaining !== undefined" :tone="rateTone" variant="outline" mono :title="rateTitle">
          API 剩余 {{ rateRemaining }} 次
        </UiChip>
        <UiHint size="xs">
          API 直连，下载才经加速节点
        </UiHint>
      </UiGroup>
    </template>

    <!-- 直链：release 资产 / raw 文件，一张卡直接给线路按钮 -->
    <GithubArtifact v-if="direct" :name="direct.filename" :title="direct.title">
      <template #meta>
        <UiChip variant="soft">
          直链
        </UiChip>
        <UiButton size="small" text @click="resolveDirectRepo">
          解析该仓库
        </UiButton>
      </template>
      <GithubLineButtons :official-url="direct.url" :filename="direct.filename" :title="direct.title" />
    </GithubArtifact>

    <template v-if="resolved">
      <!-- 仓库卡 -->
      <UiPanel variant="outlined">
        <UiGroup direction="column" gap="sm" align="stretch" block>
          <UiGroup justify="between" align="start" gap="md">
            <UiGroup direction="column" gap="xs">
              <UiLink
                type="primary"
                :underline="false"
                @click="openExternal(`https://github.com/${resolved.owner}/${resolved.repo}`)"
              >
                {{ resolved.owner }}/{{ resolved.repo }}
              </UiLink>
              <UiHint v-if="resolved.description" size="xs">
                {{ resolved.description }}
              </UiHint>
            </UiGroup>
            <UiGroup gap="sm" align="center" wrap>
              <UiChip v-if="resolved.archived" tone="warning" variant="soft">
                已归档
              </UiChip>
              <UiChip v-if="resolved.stars !== undefined" variant="outline" mono>
                ★ {{ resolved.stars }}
              </UiChip>
            </UiGroup>
          </UiGroup>
          <UiGroup gap="md" align="center" wrap>
            <UiHint v-if="resolved.language" size="xs">
              {{ resolved.language }}
            </UiHint>
            <UiHint size="xs">
              默认分支 <span class="mono">{{ resolved.defaultBranch }}</span>
            </UiHint>
            <UiHint v-if="resolved.updatedAt" size="xs">
              更新于 {{ formatDateTime(resolved.updatedAt) }}
            </UiHint>
          </UiGroup>
        </UiGroup>
      </UiPanel>

      <UiMenuHorizontal :model-value="section" :items="sectionItems" @update:model-value="onSectionChange" />

      <!-- Releases -->
      <UiGroup v-if="section === 'releases'" direction="column" gap="md" align="stretch" block>
        <template v-if="releases.length">
          <UiGroup gap="sm" align="center" wrap>
            <UiHint size="xs" class="field-label">
              版本
            </UiHint>
            <UiSelect v-model="selectedTag" :options="releaseOptions" @update:model-value="onTagChange" />
            <UiHint v-if="release?.publishedAt" size="xs">
              {{ formatDateTime(release.publishedAt) }}
            </UiHint>
            <UiChip v-if="release?.prerelease" tone="warning" variant="soft">
              预发布
            </UiChip>
            <UiButton v-if="release?.body" size="small" text @click="showNotes = !showNotes">
              {{ showNotes ? '收起更新日志' : '更新日志' }}
            </UiButton>
          </UiGroup>

          <pre v-if="showNotes && release?.body" class="release-notes">{{ release.body }}</pre>

          <GithubArtifact v-for="asset in visibleAssets" :key="asset.id" :name="asset.name">
            <template #meta>
              <span class="artifact-size">{{ formatBytes(asset.size) }}</span>
              <span v-if="asset.downloadCount" class="artifact-count">
                {{ asset.downloadCount.toLocaleString() }} 次下载
              </span>
            </template>
            <GithubLineButtons
              :official-url="asset.browserDownloadUrl"
              :filename="assetFilename(asset)"
              :title="`${resolved.repo} ${release?.tag ?? ''} · ${asset.name}`"
            />
          </GithubArtifact>

          <UiButton
            v-if="sortedAssets.length > TOP_ASSETS"
            size="small"
            text
            @click="expanded = !expanded"
          >
            {{ expanded ? '收起' : `展开全部 (${sortedAssets.length})` }}
          </UiButton>
          <UiHint v-if="!sortedAssets.length" size="xs">
            该版本没有附件，可以到「分支源码」直接下 zip。
          </UiHint>
        </template>

        <UiEmpty
          v-else
          variant="bordered"
          title="该仓库还没有发布 Release"
          text="去「分支源码」直接下 zip / tar.gz，或换一个仓库"
        />
      </UiGroup>

      <!-- 分支 / 标签源码 -->
      <UiGroup v-else-if="section === 'source'" direction="column" gap="md" align="stretch" block>
        <UiGroup gap="sm" align="center" wrap>
          <UiHint size="xs" class="field-label">
            分支 / 标签
          </UiHint>
          <UiSelect
            v-model="selectedRef"
            :options="refOptions"
            :disabled="refsLoading"
            class="ctl-md"
          />
          <UiGroup gap="xs" class="btn-flush">
            <UiButton
              size="small"
              :type="sourceFormat === 'zip' ? 'primary' : 'default'"
              @click="sourceFormat = 'zip'"
            >
              ZIP
            </UiButton>
            <UiButton
              size="small"
              :type="sourceFormat === 'tar.gz' ? 'primary' : 'default'"
              @click="sourceFormat = 'tar.gz'"
            >
              tar.gz
            </UiButton>
          </UiGroup>
          <UiHint v-if="selectedRefSha" size="xs" class="mono">
            {{ selectedRefSha.slice(0, 7) }}
          </UiHint>
          <UiButton v-if="refsLoading" size="small" text disabled loading>
            读取分支…
          </UiButton>
          <UiButton v-else-if="refsError" size="small" text @click="ensureRefs(true)">
            分支读取失败，重试
          </UiButton>
        </UiGroup>
        <UiHint v-if="refsTruncatedHint" size="xs">
          {{ refsTruncatedHint }}
        </UiHint>

        <GithubArtifact v-if="archiveUrl" :name="`${resolved.repo} · ${selectedRef}.${sourceFormat}`">
          <template #meta>
            <UiChip variant="soft">
              {{ sourceFormat }}
            </UiChip>
          </template>
          <GithubLineButtons
            :official-url="archiveUrl"
            :filename="archiveFilename"
            :title="`${resolved.repo} ${selectedRef} 源码包`"
          />
        </GithubArtifact>
        <UiHint v-else size="xs">
          {{ refsError || (refs ? '该仓库没有可用的分支或标签' : '正在读取分支与标签…') }}
        </UiHint>
      </UiGroup>

      <!-- 单文件 -->
      <UiGroup v-else direction="column" gap="md" align="stretch" block>
        <UiGroup gap="sm" align="center" wrap>
          <UiSelect
            v-model="selectedRef"
            :options="refOptions"
            :disabled="refsLoading"
            class="ctl-md"
          />
          <UiInput
            v-model="filePath"
            class="ctl-fill"
            placeholder="docs/README.md"
            @keydown.enter="resolveFile"
          />
          <UiButton size="small" :loading="fileLoading" @click="resolveFile">
            解析文件
          </UiButton>
        </UiGroup>
        <UiHint size="xs">
          只解析路径本身（不进目录浏览）；也可以把 GitHub 文件链接直接粘到上面的输入框。
        </UiHint>

        <GithubArtifact
          v-if="fileResult"
          :name="fileResult.path"
          :title="`${fileResult.repo}@${fileResult.ref} · ${fileResult.path}`"
        >
          <template #meta>
            <UiChip variant="soft" mono>
              {{ formatBytes(fileResult.size) }}
            </UiChip>
          </template>
          <GithubLineButtons
            :official-url="fileResult.downloadUrl"
            :filename="fileFilename(fileResult)"
            :title="`${fileResult.repo} · ${fileResult.name}`"
          />
        </GithubArtifact>
      </UiGroup>
    </template>
  </DownloaderFrame>
</template>

<style scoped lang="scss">
.field-label {
  flex: none;
  white-space: nowrap;
}

.artifact-size {
  padding: 1px 4px;
  border-radius: var(--radius-xs);
  background: var(--color-fill);
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
}

.artifact-count {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.release-notes {
  max-height: 180px;
  margin: 0;
  padding: var(--spacing-sm) var(--spacing-md);
  overflow: auto;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: var(--color-fill);
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
