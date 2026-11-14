<script setup lang="ts">
import type { ImportCommitResult, ScanNode, ScanPhase } from '@shared/media-library'
import {
  buildImportCards,
  createImportSelection,
  importCoverage,
  includedScanStats,
  mergeAllCards,
  selectedScanRoots,
  selectTopLevelCards,
  toggleImportCard,
  toggleImportExclude,
} from '@shared/media-library'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import CoverArt from '../components/CoverArt.vue'
import ImportTreeNode from '../components/ImportTreeNode.vue'
import MlIcon from '../components/MlIcon.vue'
import { formatBytes, scanCountsLabel } from '../format'
import { useMediaLibraryStore } from '../stores/mediaLibraryStore'

const emit = defineEmits<{
  close: []
}>()

const router = useRouter()
const store = useMediaLibraryStore()
const selectedPath = ref('')
const scanId = ref('')
const committing = ref(false)
const result = ref<ImportCommitResult | null>(null)

const session = store.importSession
const scanResult = computed(() => session.scanResult)
const tree = computed(() => scanResult.value?.tree ?? null)
const selectedRoots = computed(() => tree.value ? selectedScanRoots(session.selection, tree.value) : [])
const coverage = computed(() => tree.value ? importCoverage(session.selection, tree.value) : null)
const createdCollections = computed(() => {
  if (!result.value) return []
  const ids = new Set([...result.value.created, ...result.value.updated])
  return store.collections.filter(collection => ids.has(collection.id))
})
const canStart = computed(() => Boolean(selectedPath.value && (session.options.video || session.options.image)))
const canCommit = computed(() => selectedRoots.value.length > 0 && !committing.value)
const progressPercent = computed(() => {
  const percent = store.scanProgress?.percent ?? -1
  return percent < 0 ? 12 : Math.max(0, Math.min(100, percent))
})

const PHASES: Array<{ key: ScanPhase, label: string }> = [
  { key: 'enumerate', label: '枚举文件' },
  { key: 'tree', label: '读取目录树' },
  { key: 'probe', label: '读取媒体信息' },
  { key: 'write', label: '生成候选分组' },
  { key: 'done', label: '扫描完成' },
]
const phaseIndex = computed(() => {
  const phase = store.scanProgress?.phase ?? 'enumerate'
  return PHASES.findIndex(item => item.key === phase)
})
const phaseLabel = computed(() => PHASES[Math.max(0, phaseIndex.value)]?.label ?? '正在扫描')
const title = computed(() => {
  if (session.stage === 'scan') return '正在扫描'
  if (session.stage === 'confirm') return '确认合集'
  if (session.stage === 'result') return '导入完成'
  return '导入文件夹'
})
const subtitle = computed(() => {
  if (session.stage === 'scan') return '正在读取文件名、尺寸与时长；不会移动或重命名文件。'
  if (session.stage === 'confirm') return '勾选任意层级文件夹作为合集；已选合集内部可排除子目录。'
  if (session.stage === 'result') return '合集已写入资料库，原文件保持原位。'
  return '选择一个文件夹。第一次导入会自动扫描，之后可随时重新扫描。'
})

async function pickFolder(): Promise<void> {
  try {
    const path = await store.pickFolder()
    if (path) selectedPath.value = path
  } catch (error) {
    toast.error((error as Error).message || '无法选择文件夹')
  }
}

async function startScan(): Promise<void> {
  if (!canStart.value) return
  // 后端只接受 [a-z0-9]{6,40}，UUID 的连字符需要去掉
  scanId.value = crypto.randomUUID().replace(/-/g, '')
  try {
    await store.scan(scanId.value, selectedPath.value)
  } catch (error) {
    session.stage = 'select'
    toast.error((error as Error).message || '扫描失败')
  }
}

async function cancelScan(): Promise<void> {
  if (!scanId.value) return
  try {
    await store.cancelScan(scanId.value)
    session.stage = 'select'
  } catch (error) {
    toast.error((error as Error).message || '取消扫描失败')
  }
}

function changeCard(node: ScanNode): void {
  session.selection = toggleImportCard(session.selection, node)
}

function changeExclude(node: ScanNode): void {
  session.selection = toggleImportExclude(session.selection, node)
}

function selectTopLevel(): void {
  if (tree.value) session.selection = selectTopLevelCards(tree.value)
}

function mergeAll(): void {
  if (tree.value) session.selection = mergeAllCards(tree.value)
}

function clearSelection(): void {
  session.selection = createImportSelection()
}

function rescan(): void {
  session.scanResult = null
  session.selection = createImportSelection()
  session.stage = 'select'
}

async function commit(): Promise<void> {
  if (!tree.value || !scanResult.value || !canCommit.value) return
  committing.value = true
  try {
    result.value = await store.commitImport({
      scanId: scanResult.value.scanId,
      cards: buildImportCards(session.selection, tree.value),
    })
    toast.success(`已生成 ${result.value.created.length + result.value.updated.length} 个合集`)
  } catch (error) {
    toast.error((error as Error).message || '导入失败')
  } finally {
    committing.value = false
  }
}

async function close(): Promise<void> {
  if (session.stage === 'scan' && scanId.value) {
    await store.cancelScan(scanId.value).catch(() => undefined)
  }
  store.resetImport()
  emit('close')
}

async function finishAt(routeName: 'tool-media-library-library' | 'tool-media-library-inbox'): Promise<void> {
  await router.push({ name: routeName })
  await close()
}
</script>

<template>
  <div class="overlay">
    <section
      class="dialog"
      :class="{ 'import-dialog-wide': session.stage === 'confirm' }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-title"
    >
      <header class="dialog-head">
        <div>
          <h2 id="import-title">
            {{ title }}
          </h2>
          <p>{{ subtitle }}</p>
        </div>
        <button type="button" class="icon-btn" aria-label="关闭导入" @click="close">
          <MlIcon name="close" :size="16" />
        </button>
      </header>

      <div class="dialog-body" :class="{ 'is-import-confirm': session.stage === 'confirm' }">
        <template v-if="session.stage === 'select'">
          <button id="dropzone" type="button" class="dropzone" @click="pickFolder">
            <span class="dz-icon"><MlIcon name="folderPlus" :size="19" /></span>
            <b>选择一个媒体文件夹</b>
            <small>只读取文件名、尺寸与时长；不移动、不改名、不写入原目录</small>
          </button>

          <div v-if="selectedPath" class="path-row">
            <MlIcon name="folder" :size="14" />
            <code>{{ selectedPath }}</code>
            <button type="button" class="btn ghost import-change-path" @click="pickFolder">
              更改
            </button>
          </div>

          <div class="form-section">
            <h3>合集归属</h3>
            <div class="recognition-note">
              <span class="note-icon"><MlIcon name="layers" :size="15" /></span>
              <div>
                <b>扫描后逐层确认</b>
                <small>在目录树中勾选任意层级文件夹作为一张卡片；卡片内可排除不需要的子目录。确认前不写元信息。</small>
              </div>
            </div>
          </div>

          <div class="form-section">
            <h3>媒体类型</h3>
            <div class="form-grid">
              <div>
                <label class="check-row"><input v-model="session.options.video" type="checkbox"> 包含视频</label>
                <div class="ext-chips">
                  <span>mp4</span><span>mkv</span><span>mov</span><span>webm</span>
                </div>
              </div>
              <div>
                <label class="check-row"><input v-model="session.options.image" type="checkbox"> 包含图片</label>
                <div class="ext-chips">
                  <span>jpg</span><span>png</span><span>webp</span><span>gif</span><span>avif</span>
                </div>
              </div>
            </div>
          </div>

          <div class="form-section">
            <h3>扫描选项</h3>
            <div class="form-grid">
              <label class="check-row"><input v-model="session.options.recursive" type="checkbox"> 读取子文件夹</label>
              <label class="check-row"><input v-model="session.options.hidden" type="checkbox"> 包含隐藏文件</label>
            </div>
          </div>
        </template>

        <div v-else-if="session.stage === 'scan'" class="scan-stage">
          <div class="scan-top">
            <span>{{ phaseLabel }}</span>
            <b>{{ store.scanProgress?.percent === -1 ? '处理中' : `${store.scanProgress?.percent ?? 0}%` }}</b>
          </div>
          <div class="scan-progress">
            <i :style="{ width: `${progressPercent}%` }" />
          </div>
          <div class="scan-file">
            {{ store.scanProgress?.current || '正在读取文件夹…' }}
          </div>
          <div class="scan-log-list">
            <div
              v-for="(phase, index) in PHASES"
              :key="phase.key"
              class="scan-log-step"
              :class="{ active: index === phaseIndex, done: index < phaseIndex }"
            >
              <i class="step-dot" />
              <span>{{ phase.label }}</span>
              <small v-if="phase.key === 'enumerate'">{{ store.scanProgress?.files ?? 0 }} 个文件</small>
              <small v-else-if="phase.key === 'tree'">{{ store.scanProgress?.folders ?? 0 }} 个文件夹</small>
              <small v-else>{{ index < phaseIndex ? '完成' : index === phaseIndex ? '进行中' : '等待中' }}</small>
            </div>
          </div>
        </div>

        <div v-else-if="session.stage === 'confirm' && tree && coverage" class="import-confirm">
          <div class="import-confirm-main">
            <div class="tree-toolbar">
              <div class="tree-toolbar-label">
                <b>目录树</b><small>{{ scanResult?.folders ?? 0 }} 个文件夹 · {{ coverage.total.videos + coverage.total.images }} 个媒体</small>
              </div>
              <div class="tree-actions">
                <button type="button" class="tree-action" @click="selectTopLevel">
                  按一级文件夹
                </button>
                <button type="button" class="tree-action" @click="mergeAll">
                  合并为一张
                </button>
                <button type="button" class="tree-action" @click="clearSelection">
                  清空
                </button>
              </div>
            </div>
            <div id="import-tree" class="tree-shell">
              <ImportTreeNode
                :node="tree"
                :selection="session.selection"
                @toggle-card="changeCard"
                @toggle-exclude="changeExclude"
              />
            </div>
          </div>

          <aside id="import-summary" class="import-summary">
            <div class="summary-head">
              <h3>将生成 {{ selectedRoots.length }} 张卡片</h3>
              <p>每个勾选文件夹一张；子目录递归归入父卡片，同一文件不会进入两张卡片。</p>
            </div>
            <div class="summary-metrics">
              <span><b>{{ selectedRoots.length }}</b> 张卡片</span>
              <span><b>{{ coverage.included.videos }}</b> 视频</span>
              <span><b>{{ coverage.included.images }}</b> 图片</span>
              <span><b>{{ formatBytes(coverage.included.bytes) }}</b></span>
            </div>
            <div v-if="selectedRoots.length" class="summary-list">
              <div v-for="(node, index) in selectedRoots" :key="node.path" class="summary-card-row">
                <span class="summary-index">{{ String(index + 1).padStart(2, '0') }}</span>
                <div>
                  <b>{{ node.name }}</b>
                  <small>{{ scanCountsLabel(includedScanStats(session.selection, node)) }} · {{ formatBytes(includedScanStats(session.selection, node).bytes) }}</small>
                </div>
                <button type="button" class="icon-btn sm" :aria-label="`移除卡片 ${node.name}`" @click="changeCard(node)">
                  <MlIcon name="close" :size="12" />
                </button>
              </div>
            </div>
            <div v-else class="summary-empty">
              尚未选择卡片。勾选左侧任意文件夹，或使用“合并为一张”。
            </div>
            <div v-if="coverage.excluded.videos || coverage.excluded.images || coverage.excluded.other" class="summary-note is-warn">
              <MlIcon name="minus" :size="12" />
              <span>已排除 {{ session.selection.excluded.size }} 个文件夹（{{ scanCountsLabel(coverage.excluded) }}），不计入卡片。</span>
            </div>
            <div v-if="coverage.unassigned.videos || coverage.unassigned.images" class="summary-note">
              <MlIcon name="info" :size="12" />
              <span>未纳入 {{ scanCountsLabel(coverage.unassigned) }}；这些媒体不会生成卡片。</span>
            </div>
            <div class="summary-note">
              <MlIcon name="shield" :size="12" />
              <span>确认后才写入 edt 元信息；原文件不移动、不改名。</span>
            </div>
          </aside>
        </div>

        <template v-else-if="session.stage === 'result' && result">
          <div class="result-hero">
            <span class="result-check"><MlIcon name="check" :size="22" /></span>
            <div>
              <h3>已处理 {{ result.created.length + result.updated.length }} 个合集</h3>
              <p>从 {{ selectedPath }} 识别，原文件保持原位。</p>
            </div>
          </div>
          <div class="result-stats">
            <span>新增 <b>{{ result.created.length }}</b> 个合集</span>
            <span>更新 <b>{{ result.updated.length }}</b></span>
            <span>视频 <b>{{ result.videos }}</b></span>
            <span>图片 <b>{{ result.images }}</b></span>
            <span>跳过 <b>{{ result.skipped }}</b></span>
            <span>耗时 <b>{{ (result.elapsedMs / 1000).toFixed(1) }} 秒</b></span>
          </div>
          <div v-if="createdCollections.length" class="result-grid">
            <div v-for="collection in createdCollections" :key="collection.id" class="result-card">
              <div class="result-thumb">
                <CoverArt :collection="collection" />
              </div>
              <b>{{ collection.title }}</b>
              <small>{{ scanCountsLabel({ videos: collection.videos, images: collection.images, other: 0, bytes: collection.bytes }) }} · {{ formatBytes(collection.bytes) }}</small>
            </div>
          </div>
          <div class="import-result-note">
            这些合集已标记为“待整理”。补上艺人与标签后可通过资料库筛选快速找到。
          </div>
        </template>
      </div>

      <footer class="dialog-foot">
        <span class="foot-note"><MlIcon name="shield" :size="13" />{{ session.stage === 'scan' ? '扫描只读，可随时取消' : session.stage === 'confirm' ? '确认后才写入元信息' : '原文件不会被移动、重命名或写入' }}</span>
        <div class="dialog-actions">
          <template v-if="session.stage === 'select'">
            <button type="button" class="btn ghost" @click="close">
              取消
            </button>
            <button type="button" class="btn primary" :disabled="!canStart" @click="startScan">
              <MlIcon name="refresh" :size="14" />开始扫描
            </button>
          </template>
          <button v-else-if="session.stage === 'scan'" type="button" class="btn ghost" @click="cancelScan">
            取消扫描
          </button>
          <template v-else-if="session.stage === 'confirm'">
            <button type="button" class="btn ghost" @click="rescan">
              重新扫描
            </button>
            <button type="button" class="btn primary" :disabled="!canCommit" @click="commit">
              {{ committing ? '正在生成…' : `生成 ${selectedRoots.length} 张卡片` }}
            </button>
          </template>
          <template v-else>
            <button type="button" class="btn ghost" @click="finishAt('tool-media-library-inbox')">
              前往待整理
            </button>
            <button type="button" class="btn secondary" @click="close">
              完成
            </button>
            <button type="button" class="btn primary" @click="finishAt('tool-media-library-library')">
              在资料库中查看
            </button>
          </template>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped lang="scss">
.import-change-path {
  height: 26px;
  padding: 0 7px;
  font-size: var(--font-size-xs);
}

.import-result-note {
  margin-top: 14px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}
</style>
