<script setup lang="ts">
import type { CollectionSummary, SeriesRecord } from '@shared/media-library'
import { confirm } from '@renderer/shared/feedback'
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import CoverArt from '../components/CoverArt.vue'
import MediaCard from '../components/MediaCard.vue'
import MlIcon from '../components/MlIcon.vue'
import { formatBytes, KIND, mediaCountLine, searchHaystack, seriesDateLabel } from '../format'
import { useMediaLibraryStore } from '../stores/mediaLibraryStore'

const props = defineProps<{ id?: string | null }>()
const emit = defineEmits<{ edit: [collection: CollectionSummary] }>()
const router = useRouter()
const store = useMediaLibraryStore()

const creating = ref(false)
const editing = ref(false)
const pickerOpen = ref(false)
const pickerQuery = ref('')
const selectedIds = ref(new Set<string>())
const createForm = reactive({ name: '', description: '' })
const editForm = reactive({ name: '', description: '' })

const current = computed(() => props.id ? store.series.find(item => item.id === props.id) : undefined)
const currentCollections = computed(() => seriesCollections(current.value))
const linkedCollections = computed(() => {
  const ids = new Set(store.series.flatMap(item => item.collectionIds))
  return store.collections.filter(item => ids.has(item.id))
})
const linkedItems = computed(() => linkedCollections.value.reduce((sum, item) => sum + item.videos + item.images, 0))
const linkedBytes = computed(() => linkedCollections.value.reduce((sum, item) => sum + item.bytes, 0))
const pickerRows = computed(() => {
  const query = pickerQuery.value.trim().toLocaleLowerCase()
  return store.collections.filter(item => !query || searchHaystack(item).includes(query))
})

watch(current, (value) => {
  editing.value = false
  pickerOpen.value = false
  if (value) Object.assign(editForm, { name: value.name, description: value.description })
}, { immediate: true })

function seriesCollections(series: SeriesRecord | undefined): CollectionSummary[] {
  if (!series) return []
  const byId = new Map(store.collections.map(item => [item.id, item]))
  return series.collectionIds.map(id => byId.get(id)).filter((item): item is CollectionSummary => Boolean(item))
}

function stats(series: SeriesRecord) {
  const rows = seriesCollections(series)
  return {
    rows,
    videos: rows.reduce((sum, item) => sum + item.videos, 0),
    images: rows.reduce((sum, item) => sum + item.images, 0),
    bytes: rows.reduce((sum, item) => sum + item.bytes, 0),
  }
}

function openSeries(id: string): void {
  void router.push({ name: 'tool-media-library-series-detail', params: { seriesId: id } })
}

function openCollection(collection: CollectionSummary): void {
  void router.push({ name: 'tool-media-library-collection', params: { collectionId: collection.id } })
}

async function createSeries(): Promise<void> {
  const name = createForm.name.trim()
  if (!name) {
    toast.warning('请输入系列名称')
    return
  }
  try {
    const result = await store.createSeries(name, createForm.description.trim())
    createForm.name = ''
    createForm.description = ''
    creating.value = false
    toast.success('系列已创建')
    await router.push({ name: 'tool-media-library-series-detail', params: { seriesId: result.id } })
  } catch (error) {
    toast.error((error as Error).message || '创建系列失败')
  }
}

function beginEdit(): void {
  if (!current.value) return
  Object.assign(editForm, { name: current.value.name, description: current.value.description })
  editing.value = true
}

async function saveSeries(): Promise<void> {
  if (!current.value) return
  const name = editForm.name.trim()
  if (!name) {
    toast.warning('请输入系列名称')
    return
  }
  try {
    await store.updateSeries(current.value.id, name, editForm.description.trim())
    editing.value = false
    toast.success('系列已保存')
  } catch (error) {
    toast.error((error as Error).message || '保存系列失败')
  }
}

async function deleteCurrent(): Promise<void> {
  if (!current.value) return
  try {
    await confirm(
      `删除系列「${current.value.name}」？只会删除系列记录，合集、索引与原文件都会保留。`,
      '删除系列',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await store.deleteSeries(current.value.id)
    toast.success('系列已删除，合集保持不变')
    await router.push({ name: 'tool-media-library-series' })
  } catch (error) {
    toast.error((error as Error).message || '删除系列失败')
  }
}

function openPicker(): void {
  pickerQuery.value = ''
  selectedIds.value = new Set()
  pickerOpen.value = true
}

function togglePick(id: string): void {
  if (current.value?.collectionIds.includes(id)) return
  const next = new Set(selectedIds.value)
  next.has(id) ? next.delete(id) : next.add(id)
  selectedIds.value = next
}

async function savePicker(): Promise<void> {
  if (!current.value || !selectedIds.value.size) return
  try {
    await store.addToSeries(current.value.id, [...selectedIds.value])
    toast.success(`已添加 ${selectedIds.value.size} 个合集`)
    pickerOpen.value = false
  } catch (error) {
    toast.error((error as Error).message || '添加合集失败')
  }
}

async function removeCollection(seriesId: string, collection: CollectionSummary): Promise<void> {
  try {
    await store.removeFromSeries(seriesId, collection.id)
    toast.success(`已将「${collection.title}」移出系列`)
  } catch (error) {
    toast.error((error as Error).message || '移出系列失败')
  }
}
</script>

<template>
  <div class="ml-pane">
    <template v-if="!id">
      <header class="view-head">
        <div>
          <h1>系列</h1>
          <p>把同一主题下的多个合集串成一条观看线索。系列只保存引用，不复制文件，也不改变合集原有归属。</p>
        </div>
        <div class="view-head-actions">
          <button type="button" class="btn secondary" @click="creating = !creating">
            <MlIcon name="plus" :size="14" />新建系列
          </button>
        </div>
      </header>
      <div class="summary-line">
        <span><b>{{ store.series.length }}</b> 个系列</span>
        <span><b>{{ linkedCollections.length }}</b> 个合集被引用</span>
        <span><b>{{ linkedItems.toLocaleString('zh-CN') }}</b> 个条目</span>
        <span><b>{{ formatBytes(linkedBytes) }}</b></span>
      </div>

      <form v-if="creating" class="series-create-panel" @submit.prevent="createSeries">
        <div class="series-create-grid">
          <div class="field">
            <label for="new-series-name">系列名称</label>
            <input id="new-series-name" v-model="createForm.name" class="input" placeholder="例如：雾中三章" autofocus>
          </div>
          <div class="field">
            <label for="new-series-desc">一句说明</label>
            <input id="new-series-desc" v-model="createForm.description" class="input" placeholder="这组合集为什么放在一起？">
          </div>
        </div>
        <div class="series-create-actions">
          <button type="button" class="btn ghost" @click="creating = false">取消</button>
          <button type="submit" class="btn primary">创建系列</button>
        </div>
      </form>

      <div class="series-grid">
        <button v-for="item in store.series" :key="item.id" type="button" class="series-card" @click="openSeries(item.id)">
          <div class="series-cover">
            <div v-if="stats(item).rows.length" class="series-mosaic" :style="{ gridTemplateColumns: `repeat(${Math.min(3, stats(item).rows.length)}, minmax(0, 1fr))` }">
              <span v-for="collection in stats(item).rows.slice(0, 3)" :key="collection.id" class="series-tile">
                <CoverArt :collection="collection" small />
              </span>
            </div>
            <div v-else class="series-placeholder"><MlIcon name="layers" :size="22" /><span>还没有合集</span></div>
            <span class="series-cover-shade" />
            <span class="series-count">{{ stats(item).rows.length }} 个合集</span>
          </div>
          <div class="series-copy">
            <div class="series-title"><b>{{ item.name }}</b><span>{{ mediaCountLine(stats(item).videos, stats(item).images) }}</span></div>
            <p>{{ item.description || '还没有说明。' }}</p>
            <small>{{ seriesDateLabel(item.updatedAt) }} · {{ formatBytes(stats(item).bytes) }}</small>
          </div>
        </button>
        <button v-if="!store.series.length" type="button" class="series-add-card" @click="creating = true">
          <span><MlIcon name="plus" :size="18" /></span>
          <b>新建第一个系列</b>
          <small>把多个合集收进同一条线索</small>
        </button>
      </div>
    </template>

    <template v-else-if="current">
      <button type="button" class="back-link" @click="router.push({ name: 'tool-media-library-series' })">
        <MlIcon name="chevronLeft" :size="14" />全部系列
      </button>
      <section class="series-hero">
        <div class="series-hero-cover">
          <div v-if="currentCollections.length" class="series-mosaic" :style="{ gridTemplateColumns: `repeat(${Math.min(3, currentCollections.length)}, minmax(0, 1fr))` }">
            <span v-for="collection in currentCollections.slice(0, 3)" :key="collection.id" class="series-tile"><CoverArt :collection="collection" small /></span>
          </div>
          <div v-else class="series-placeholder"><MlIcon name="layers" :size="22" /><span>还没有合集</span></div>
          <span class="series-cover-shade" />
        </div>
        <div class="series-hero-copy">
          <div class="series-title-row"><h1>{{ current.name }}</h1><span class="tag">{{ currentCollections.length }} 个合集</span></div>
          <p class="series-desc">{{ current.description || '还没有说明。' }}</p>
          <div class="artist-stats">
            <span><b>{{ currentCollections.length }}</b> 个合集</span>
            <span><b>{{ stats(current).videos }}</b> 视频</span>
            <span><b>{{ stats(current).images }}</b> 图片</span>
            <span><b>{{ formatBytes(stats(current).bytes) }}</b></span>
          </div>
          <div class="series-hero-actions">
            <button type="button" class="btn primary" @click="openPicker"><MlIcon name="plus" :size="14" />添加合集</button>
            <button v-if="!editing" type="button" class="btn secondary" @click="beginEdit"><MlIcon name="edit" :size="14" />编辑系列</button>
            <button type="button" class="btn ghost danger-text" @click="deleteCurrent">删除系列</button>
          </div>
        </div>
      </section>

      <form v-if="editing" class="series-edit-panel" @submit.prevent="saveSeries">
        <div class="field"><label for="series-name-input">系列名称</label><input id="series-name-input" v-model="editForm.name" class="input"></div>
        <div class="field"><label for="series-desc-input">说明</label><textarea id="series-desc-input" v-model="editForm.description" class="textarea" placeholder="这组合集的共同线索…" /></div>
        <div class="series-edit-actions">
          <button type="button" class="btn ghost" @click="editing = false">取消</button>
          <button type="submit" class="btn primary">保存系列</button>
        </div>
      </form>

      <div class="section-head"><h3>系列内合集 <span>{{ currentCollections.length }}</span></h3><span class="section-meta">卡片右上角可移出系列，不影响合集本身</span></div>
      <div v-if="currentCollections.length" class="card-grid">
        <MediaCard
          v-for="collection in currentCollections"
          :key="collection.id"
          :collection="collection"
          :series-id="current.id"
          @open="openCollection"
          @play="openCollection"
          @edit="emit('edit', $event)"
          @remove-from-series="removeCollection"
        />
      </div>
      <div v-else class="empty artist-empty">
        <span class="empty-icon"><MlIcon name="layers" :size="20" /></span><h3>系列还是空的</h3>
        <p>从资料库挑选多个合集放进来，它们会按添加顺序显示。</p>
        <button type="button" class="btn primary" @click="openPicker"><MlIcon name="plus" :size="14" />添加合集</button>
      </div>
    </template>

    <div v-else class="empty">
      <span class="empty-icon"><MlIcon name="warning" :size="20" /></span><h3>系列不存在</h3>
      <button type="button" class="btn secondary" @click="router.push({ name: 'tool-media-library-series' })">返回全部系列</button>
    </div>

    <div v-if="pickerOpen && current" class="overlay" @click.self="pickerOpen = false">
      <div class="dialog series-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="series-picker-title">
        <div class="dialog-head">
          <div><h2 id="series-picker-title">添加合集到「{{ current.name }}」</h2><p>从资料库选择，可一次添加多个；只建立引用，不复制文件。</p></div>
          <button type="button" class="icon-btn" aria-label="关闭添加合集" @click="pickerOpen = false"><MlIcon name="close" :size="16" /></button>
        </div>
        <div class="dialog-body">
          <label class="search-field picker-search"><MlIcon name="search" :size="14" /><input v-model="pickerQuery" placeholder="搜索片名、艺人、标签或路径…" autofocus></label>
          <div class="picker-note">系列已有 <b>{{ current.collectionIds.length }}</b> 个合集。勾选要追加的合集，已存在的不可重复添加。</div>
          <div class="picker-list">
            <button
              v-for="collection in pickerRows"
              :key="collection.id"
              type="button"
              class="picker-row"
              :class="{ 'is-selected': current.collectionIds.includes(collection.id) || selectedIds.has(collection.id), 'is-locked': current.collectionIds.includes(collection.id) }"
              :disabled="current.collectionIds.includes(collection.id)"
              @click="togglePick(collection.id)"
            >
              <span class="picker-check"><MlIcon v-if="current.collectionIds.includes(collection.id) || selectedIds.has(collection.id)" name="check" :size="10" /></span>
              <span class="picker-thumb"><CoverArt :collection="collection" small /></span>
              <span class="picker-copy"><b>{{ collection.title }}</b><small>{{ KIND[collection.kind].label }} · {{ mediaCountLine(collection.videos, collection.images) }} · {{ collection.artists.join('、') || '未指定艺人' }}</small></span>
              <span class="picker-state">{{ current.collectionIds.includes(collection.id) ? '已在系列' : selectedIds.has(collection.id) ? '将添加' : '' }}</span>
            </button>
            <div v-if="!pickerRows.length" class="picker-empty">没有匹配的合集。试试更短的关键词。</div>
          </div>
        </div>
        <div class="dialog-foot">
          <span class="foot-note"><MlIcon name="shield" :size="13" />原文件与合集归属不变</span>
          <div class="dialog-actions">
            <button type="button" class="btn ghost" @click="pickerOpen = false">取消</button>
            <button type="button" class="btn primary" :disabled="!selectedIds.size" @click="savePicker">添加 {{ selectedIds.size }} 个合集</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
