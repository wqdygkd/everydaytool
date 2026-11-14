<script setup lang="ts">
import type { CollectionDetail, CollectionPatch, MediaItem } from '@shared/media-library'
import { confirm } from '@renderer/shared/feedback'
import { uniqueTagNames } from '@shared/media-library'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { thumbUrl } from '../mediaUrls'
import { useMediaLibraryStore } from '../stores/mediaLibraryStore'
import CoverArt from './CoverArt.vue'
import MlIcon from './MlIcon.vue'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ close: [], saved: [] }>()

const router = useRouter()
const store = useMediaLibraryStore()
const detail = ref<CollectionDetail | null>(null)
const loading = ref(false)
const saving = ref(false)
const titleError = ref(false)
const tagInput = ref('')
const showCovers = ref(false)
const draft = reactive({
  title: '',
  artists: '',
  tags: [] as string[],
  year: '',
  description: '',
  coverItemId: null as string | null,
})

const summary = computed(() => detail.value?.summary || store.collectionById(props.id))
const coverItems = computed(() => detail.value?.items.filter(item => !item.missing).slice(0, 40) || [])

function reset(next: CollectionDetail): void {
  detail.value = next
  draft.title = next.summary.title
  draft.artists = next.summary.artists.join('，')
  draft.tags = [...next.summary.tags]
  draft.year = next.summary.year
  draft.description = next.summary.description
  draft.coverItemId = next.summary.coverItemId
  titleError.value = false
  tagInput.value = ''
  showCovers.value = false
}

async function load(): Promise<void> {
  loading.value = true
  try {
    reset(await store.getCollection(props.id))
  } catch (error) {
    toast.error((error as Error).message || '合集信息加载失败')
    emit('close')
  } finally {
    loading.value = false
  }
}

function addTag(): void {
  const [next, ...rest] = uniqueTagNames(tagInput.value.split(/[,，、;；\n]/))
  if (next) draft.tags = uniqueTagNames([...draft.tags, next, ...rest])
  tagInput.value = ''
}

function onTagKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
    event.preventDefault()
    addTag()
  }
}

function removeTag(tag: string): void {
  draft.tags = draft.tags.filter(value => value !== tag)
}

function chooseCover(item: MediaItem): void {
  draft.coverItemId = item.id
  showCovers.value = false
}

async function save(): Promise<void> {
  const title = draft.title.trim()
  if (!title) {
    titleError.value = true
    return
  }
  addTag()
  saving.value = true
  const patch: CollectionPatch = {
    title,
    artists: uniqueTagNames(draft.artists.split(/[,，、;；\n]/)),
    tags: uniqueTagNames(draft.tags),
    year: draft.year.trim(),
    description: draft.description.trim(),
    coverItemId: draft.coverItemId,
  }
  try {
    await store.updateCollection(props.id, patch)
    toast.success('信息已保存，原文件未修改')
    emit('saved')
  } catch (error) {
    toast.error((error as Error).message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  try {
    await confirm(
      `将“${summary.value?.title || '此合集'}”从媒体库移除？原文件不会被删除。`,
      '移除合集',
      { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await store.removeCollection(props.id)
    toast.success('合集已从媒体库移除')
    emit('saved')
    await router.push({ name: 'tool-media-library-library' })
  } catch (error) {
    toast.error((error as Error).message || '移除失败')
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

watch(() => props.id, load, { immediate: true })
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="scrim" @click="emit('close')" />
  <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="edit-collection-title">
    <div class="drawer-head">
      <div>
        <h2 id="edit-collection-title">编辑信息</h2>
        <p>只修改 edt 元信息 · 原文件不变</p>
      </div>
      <button class="icon-btn" type="button" aria-label="关闭编辑" @click="emit('close')">
        <MlIcon name="close" :size="16" />
      </button>
    </div>

    <form v-if="summary && !loading" class="drawer-body" @submit.prevent="save">
      <div class="field" :class="{ invalid: titleError }">
        <label for="collection-title">标题</label>
        <input
          id="collection-title"
          v-model="draft.title"
          class="input"
          autocomplete="off"
          @input="titleError = false"
        >
        <p class="field-error">标题不能为空。</p>
      </div>

      <div class="field">
        <label for="collection-artists">艺人 <small>使用逗号分隔多个艺人</small></label>
        <input id="collection-artists" v-model="draft.artists" class="input" autocomplete="off" placeholder="例如：艺人 A，艺人 B">
      </div>

      <div class="field">
        <div class="field-label">标签 <small>回车或逗号添加</small></div>
        <div class="chip-field">
          <span v-for="tag in draft.tags" :key="tag" class="edit-chip">
            {{ tag }}
            <button type="button" :aria-label="`移除 ${tag}`" @click="removeTag(tag)">
              <MlIcon name="close" :size="10" />
            </button>
          </span>
          <input
            v-model="tagInput"
            placeholder="添加标签…"
            autocomplete="off"
            @keydown="onTagKeydown"
          >
        </div>
      </div>

      <div class="field">
        <label for="collection-year">年份</label>
        <input id="collection-year" v-model="draft.year" class="input year-input" inputmode="numeric" autocomplete="off">
      </div>

      <div class="field">
        <label for="collection-description">描述</label>
        <textarea id="collection-description" v-model="draft.description" class="textarea" placeholder="给这个合集写一句说明…" />
      </div>

      <div class="field">
        <div class="field-label">封面 <small>从合集条目中选择</small></div>
        <div class="cover-preview">
          <CoverArt :collection="{ ...summary, coverItemId: draft.coverItemId }" />
          <button class="btn" type="button" @click="showCovers = !showCovers">
            <MlIcon name="image" :size="13" />
            {{ showCovers ? '收起选择' : '更换封面' }}
          </button>
        </div>
        <div v-if="showCovers" class="cover-picker">
          <button
            v-for="item in coverItems"
            :key="item.id"
            type="button"
            :class="{ active: item.id === draft.coverItemId }"
            :title="item.name"
            @click="chooseCover(item)"
          >
            <img :src="thumbUrl(store.endpoint, id, item.id) || ''" :alt="item.name">
            <MlIcon v-if="item.id === draft.coverItemId" name="check" :size="13" />
          </button>
        </div>
      </div>

      <div class="field">
        <div class="field-label">来源 <small>只读</small></div>
        <div class="readonly-row">
          <MlIcon name="folder" :size="14" />
          <code>{{ summary.rootPath }}</code>
          <button class="icon-btn sm" type="button" aria-label="在文件夹中显示" @click="store.revealInFolder({ collectionId: id })">
            <MlIcon name="external" :size="14" />
          </button>
        </div>
      </div>

      <button class="remove-collection" type="button" @click="remove">
        <MlIcon name="trash" :size="14" />
        从媒体库移除
      </button>
    </form>

    <div v-else class="drawer-body drawer-loading">正在加载…</div>

    <div class="drawer-foot">
      <button class="btn ghost" type="button" @click="emit('close')">取消</button>
      <button class="btn primary" type="button" :disabled="saving || loading" @click="save">
        {{ saving ? '保存中…' : '保存更改' }}
      </button>
    </div>
  </aside>
</template>

<style scoped lang="scss">
:global(.ml .scrim) { z-index: 79; }
:global(.ml .drawer) { z-index: 80; }

.year-input { width: 120px; }

.drawer-loading {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
}

.cover-picker {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  max-height: 216px;
  margin-top: 8px;
  overflow-y: auto;
}

.cover-picker button {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border: 1px solid var(--color-border-light);
  border-radius: 7px;
  background: var(--color-fill);
}

.cover-picker button.active { border-color: var(--color-primary-strong); }

.cover-picker img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.cover-picker .ic {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 2px;
  border-radius: 50%;
  background: var(--color-primary-strong);
  color: #fff;
  box-sizing: content-box;
}

.remove-collection {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 22px;
  color: var(--color-error);
  font-size: var(--font-size-xs);
}
</style>
