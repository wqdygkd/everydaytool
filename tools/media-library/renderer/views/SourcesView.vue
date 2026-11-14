<script setup lang="ts">
import type { SourceRecord } from '@shared/media-library'
import { confirm } from '@renderer/shared/feedback'
import { computed } from 'vue'
import { toast } from 'vue-sonner'
import MlIcon from '../components/MlIcon.vue'
import { formatAgo, formatBytes } from '../format'
import { useMediaLibraryStore } from '../stores/mediaLibraryStore'

const emit = defineEmits<{ 'open-import': [] }>()
const store = useMediaLibraryStore()
const totalItems = computed(() => store.collections.reduce((sum, item) => sum + item.videos + item.images, 0))
const totalBytes = computed(() => store.collections.reduce((sum, item) => sum + item.bytes, 0))

function openImport(): void {
  // 公共事件名沿用媒体库页面约定。
  // eslint-disable-next-line vue/custom-event-name-casing
  emit('open-import')
}

function sourceStats(source: SourceRecord) {
  const rows = store.collections.filter(item => item.sourceId === source.id)
  return {
    collections: rows.length,
    items: rows.reduce((sum, item) => sum + item.videos + item.images, 0),
    bytes: rows.reduce((sum, item) => sum + item.bytes, 0),
  }
}

function statusLabel(status: SourceRecord['status']): string {
  if (status === 'changed') return '待重扫'
  if (status === 'missing') return '路径缺失'
  return '已索引'
}

async function rescan(source: SourceRecord): Promise<void> {
  try {
    const result = await store.rescanSource(source.id)
    toast.success(`「${source.label}」扫描完成：新增 ${result.summary.added}，变更 ${result.summary.modified}，缺失 ${result.summary.missing}`)
  } catch (error) {
    toast.error((error as Error).message || '扫描来源失败')
  }
}

async function remove(source: SourceRecord): Promise<void> {
  try {
    await confirm(
      `从媒体库移除来源「${source.label}」？只会移除索引记录，不会删除目录中的任何文件。`,
      '移除来源',
      { type: 'warning', confirmButtonText: '移除索引', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await store.removeSource(source.id)
    toast.success('来源索引已移除，原文件保持不变')
  } catch (error) {
    toast.error((error as Error).message || '移除来源失败')
  }
}

async function reveal(source: SourceRecord): Promise<void> {
  try {
    await store.revealInFolder({ sourceId: source.id })
  } catch (error) {
    toast.error((error as Error).message || '无法在文件夹中显示')
  }
}
</script>

<template>
  <div class="ml-pane">
    <header class="view-head">
      <div>
        <h1>来源</h1>
        <p>扫描以来源为单位。文件移动或删除后，重新扫描即可更新；edt 不会自动删除索引，也不会碰原文件。</p>
      </div>
      <div class="view-head-actions">
        <button type="button" class="btn secondary" @click="openImport"><MlIcon name="folderPlus" :size="14" />添加来源</button>
      </div>
    </header>
    <div class="summary-line">
      <span><b>{{ store.sources.length }}</b> 个来源</span>
      <span><b>{{ store.collections.length }}</b> 个合集</span>
      <span><b>{{ totalItems.toLocaleString('zh-CN') }}</b> 个条目</span>
      <span><b>{{ formatBytes(totalBytes) }}</b> 已索引</span>
    </div>
    <div class="source-list">
      <div v-for="source in store.sources" :key="source.id" class="source-row">
        <div class="source-main">
          <b>{{ source.label }} <span v-if="source.status !== 'indexed'" class="tag warn">{{ source.status === 'missing' ? '路径缺失' : '有变更' }}</span></b>
          <button type="button" class="source-path" :title="source.path" @click="reveal(source)">{{ source.path }}</button>
        </div>
        <span class="source-cell">{{ sourceStats(source).collections }} 个合集</span>
        <span class="source-cell">{{ sourceStats(source).items.toLocaleString('zh-CN') }} 项</span>
        <span class="source-cell">{{ formatBytes(sourceStats(source).bytes) }}</span>
        <div class="source-actions">
          <span class="source-status" :class="{ changed: source.status !== 'indexed' }"><i />{{ statusLabel(source.status) }}</span>
          <button type="button" class="btn ghost" @click="rescan(source)"><MlIcon name="refresh" :size="13" />扫描</button>
          <button type="button" class="icon-btn sm" :aria-label="`移除来源 ${source.label}`" @click="remove(source)"><MlIcon name="trash" :size="13" /></button>
        </div>
      </div>
      <div v-if="!store.sources.length" class="empty">
        <span class="empty-icon"><MlIcon name="folderPlus" :size="20" /></span><h3>还没有来源</h3>
        <p>添加一个媒体文件夹，扫描后即可生成合集索引。</p>
        <button type="button" class="btn primary" @click="openImport">添加来源</button>
      </div>
    </div>
    <div class="scan-log-block">
      <h3>最近扫描</h3>
      <div class="scan-log">
        <div v-for="entry in store.scanLog" :key="`${entry.at}-${entry.sourceLabel}-${entry.text}`" class="scan-log-row">
          <MlIcon :name="entry.tone === 'warn' ? 'warning' : 'check'" :size="12" />
          <span>{{ formatAgo(entry.at) }}</span><span>{{ entry.sourceLabel }}</span><span>{{ entry.text }}</span>
        </div>
        <div v-if="!store.scanLog.length" class="scan-log-row"><MlIcon name="info" :size="12" /><span>还没有扫描记录</span></div>
      </div>
    </div>
  </div>
</template>
