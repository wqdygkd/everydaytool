<script setup lang="ts">
import { confirm } from '@renderer/shared/feedback'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import MlIcon from '../components/MlIcon.vue'
import { formatAgo } from '../format'
import { useMediaLibraryStore } from '../stores/mediaLibraryStore'

const router = useRouter()
const store = useMediaLibraryStore()
const creating = ref(false)
const newTag = ref('')

const taggedCount = computed(() => store.collections.filter(item => item.tags.length).length)
const untaggedCount = computed(() => store.collections.length - taggedCount.value)
const rows = computed(() => store.tags.map((tag) => {
  const collections = store.collections.filter(item => item.tags.includes(tag.name))
  const latest = [...collections].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
  return {
    ...tag,
    count: collections.length,
    share: store.collections.length ? collections.length / store.collections.length : 0,
    latest: latest?.updatedAt,
  }
}))

function openTag(tag?: string): void {
  void router.push({ name: 'tool-media-library-library', query: tag ? { tag } : { tag: '' } })
}

async function createTag(): Promise<void> {
  const name = newTag.value.trim()
  if (!name) return
  try {
    await store.createTag(name)
    toast.success(`已创建标签「${name}」`)
    newTag.value = ''
    creating.value = false
  } catch (error) {
    toast.error((error as Error).message || '创建标签失败')
  }
}

async function deleteTag(name: string): Promise<void> {
  try {
    await confirm(
      `删除标签「${name}」？会从合集元信息中移除该标签，但不会修改原文件。`,
      '删除标签',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await store.deleteTag(name)
    toast.success(`标签「${name}」已删除`)
  } catch (error) {
    toast.error((error as Error).message || '删除标签失败')
  }
}
</script>

<template>
  <div class="ml-pane">
    <header class="view-head">
      <div>
        <h1>标签</h1>
        <p>标签只写入 edt 的元信息，不修改文件夹名称。点击任意标签回到资料库查看对应合集。</p>
      </div>
      <div class="view-head-actions">
        <button type="button" class="btn secondary" @click="creating = !creating"><MlIcon name="plus" :size="14" />新建标签</button>
      </div>
    </header>
    <div class="summary-line">
      <span><b>{{ rows.length }}</b> 个标签</span>
      <span><b>{{ taggedCount }}</b> / {{ store.collections.length }} 个合集已标记</span>
      <span><b>{{ untaggedCount }}</b> 个合集等待整理</span>
    </div>
    <form v-if="creating" class="tag-new-row" @submit.prevent="createTag">
      <input v-model="newTag" placeholder="输入标签名，回车添加" autocomplete="off" autofocus>
      <button type="submit" class="btn secondary">添加</button>
      <button type="button" class="btn ghost" @click="creating = false">取消</button>
    </form>
    <div class="list-table">
      <div class="list-head"><span>标签</span><span>合集</span><span>占资料库比例</span><span>最近使用</span><span /></div>
      <div
        v-for="tag in rows"
        :key="tag.name"
        class="tag-index-row"
        role="link"
        tabindex="0"
        @click="openTag(tag.name)"
        @keydown.enter="openTag(tag.name)"
      >
        <span class="tag-name"><span class="hash">#</span><span>{{ tag.name }}</span></span>
        <span class="tag-count">{{ tag.count }} 个</span>
        <span class="share"><i :style="{ width: `${Math.max(4, Math.round(tag.share * 100))}%` }" /></span>
        <span class="tag-last">{{ formatAgo(tag.latest) }}</span>
        <button type="button" class="icon-btn sm" :aria-label="`删除标签 ${tag.name}`" @click.stop="deleteTag(tag.name)"><MlIcon name="trash" :size="13" /></button>
      </div>
      <div class="tag-index-row" role="link" tabindex="0" @click="openTag()" @keydown.enter="openTag()">
        <span class="tag-name"><span class="hash">#</span><span>未添加标签</span></span>
        <span class="tag-count">{{ untaggedCount }} 个</span>
        <span class="share"><i :style="{ width: `${Math.round((untaggedCount / Math.max(1, store.collections.length)) * 100)}%`, opacity: '.4' }" /></span>
        <span class="tag-last">—</span>
        <MlIcon name="chevronRight" :size="14" />
      </div>
    </div>
  </div>
</template>
